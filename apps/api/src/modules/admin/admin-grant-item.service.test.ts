import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// `huyet_chi_dan` là pill stackable trong shared catalog (consumable HEAL_HP).
const STACKABLE_KEY = 'huyet_chi_dan';

describe('AdminService.grantItem', () => {
  it('grant 5× item stackable → InventoryItem qty=5 + ItemLedger ADMIN_GRANT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantItem(
      adminU.userId,
      'ADMIN',
      player.userId,
      STACKABLE_KEY,
      5,
      'smoke seed',
    );

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId, itemKey: STACKABLE_KEY },
    });
    expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(5);

    const ledgers = await prisma.itemLedger.findMany({
      where: {
        characterId: player.characterId,
        itemKey: STACKABLE_KEY,
        reason: 'ADMIN_GRANT',
      },
    });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].qtyDelta).toBe(5);
    expect(ledgers[0].actorUserId).toBe(adminU.userId);
    expect(ledgers[0].refType).toBe('User');
    expect(ledgers[0].refId).toBe(player.userId);
    const meta = ledgers[0].meta as Record<string, unknown>;
    expect(meta.reason).toBe('smoke seed');
  });

  it('grant 2 lần stackable → qty cộng dồn (đúng stack semantic)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantItem(adminU.userId, 'ADMIN', player.userId, STACKABLE_KEY, 3, '');
    await admin.grantItem(adminU.userId, 'ADMIN', player.userId, STACKABLE_KEY, 2, '');

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId, itemKey: STACKABLE_KEY },
    });
    expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(5);
    expect(rows).toHaveLength(1); // stackable → single row.

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.inventory.grant' },
    });
    expect(audits).toHaveLength(2);
  });

  it('itemKey không tồn tại trong shared catalog → INVALID_INPUT (no silent noop)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', player.userId, 'fake_key_xyz', 1, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(0);
    const ledgers = await prisma.itemLedger.findMany({
      where: { characterId: player.characterId },
    });
    expect(ledgers).toHaveLength(0);
  });

  it('qty = 0 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', player.userId, STACKABLE_KEY, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('qty âm → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', player.userId, STACKABLE_KEY, -1, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('qty > 999 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', player.userId, STACKABLE_KEY, 1000, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('actor = target → CANNOT_TARGET_SELF', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', adminU.userId, STACKABLE_KEY, 1, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('target không tồn tại → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantItem(adminU.userId, 'ADMIN', 'no-such-user', STACKABLE_KEY, 1, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('MOD grant cho ADMIN → FORBIDDEN', async () => {
    const mod = await makeUserChar(prisma, { role: 'MOD' });
    const target = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantItem(mod.userId, 'MOD', target.userId, STACKABLE_KEY, 1, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
