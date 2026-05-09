import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;
let inventory: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — QuestService cần NpcAffinityService cho rewards.affinity.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Item stackable consumable trong shared catalog.
const ITEM_KEY = 'huyet_chi_dan';

async function grantLoot(characterId: string, qty: number): Promise<void> {
  await inventory.grant(characterId, [{ itemKey: ITEM_KEY, qty }], {
    reason: 'COMBAT_LOOT',
  });
}

describe('AdminService.revokeInventory', () => {
  it('revoke đúng qty → trừ qty + ghi ledger ADMIN_REVOKE', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await grantLoot(player.characterId, 10);

    await admin.revokeInventory(
      adminU.userId,
      'ADMIN',
      player.userId,
      ITEM_KEY,
      3,
      'test clean',
    );

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId, itemKey: ITEM_KEY },
    });
    const total = rows.reduce((s, r) => s + r.qty, 0);
    expect(total).toBe(7);

    const ledgers = await prisma.itemLedger.findMany({
      where: {
        characterId: player.characterId,
        itemKey: ITEM_KEY,
        reason: 'ADMIN_REVOKE',
      },
    });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].qtyDelta).toBe(-3);
    expect(ledgers[0].actorUserId).toBe(adminU.userId);
  });

  it('revoke đủ sạch → xoá row, còn row = 0 không xuất hiện', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await grantLoot(player.characterId, 5);

    await admin.revokeInventory(
      adminU.userId,
      'ADMIN',
      player.userId,
      ITEM_KEY,
      5,
      '',
    );

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId, itemKey: ITEM_KEY },
    });
    expect(rows).toHaveLength(0);
  });

  it('tổng qty trong túi < revoke qty → INVALID_INPUT, không đụng inventory', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await grantLoot(player.characterId, 3);

    await expect(
      admin.revokeInventory(
        adminU.userId,
        'ADMIN',
        player.userId,
        ITEM_KEY,
        10,
        '',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: player.characterId, itemKey: ITEM_KEY },
    });
    expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(3);

    const ledgers = await prisma.itemLedger.findMany({
      where: { characterId: player.characterId, reason: 'ADMIN_REVOKE' },
    });
    expect(ledgers).toHaveLength(0);
  });

  it('target không có character → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    // Tạo user không có character
    const orphanUser = await prisma.user.create({
      data: { email: `orphan-${Date.now()}@xt.local`, passwordHash: 'x' },
    });

    await expect(
      admin.revokeInventory(
        adminU.userId,
        'ADMIN',
        orphanUser.id,
        ITEM_KEY,
        1,
        '',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('self target → CANNOT_TARGET_SELF', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.revokeInventory(
        adminU.userId,
        'ADMIN',
        adminU.userId,
        ITEM_KEY,
        1,
        '',
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('MOD revoke MOD khác → FORBIDDEN', async () => {
    const modActor = await makeUserChar(prisma, { role: 'MOD' });
    const modTarget = await makeUserChar(prisma, { role: 'MOD' });
    await grantLoot(modTarget.characterId, 5);

    await expect(
      admin.revokeInventory(
        modActor.userId,
        'MOD',
        modTarget.userId,
        ITEM_KEY,
        1,
        '',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('qty <= 0 hoặc qty > 999 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await grantLoot(player.characterId, 5);

    await expect(
      admin.revokeInventory(adminU.userId, 'ADMIN', player.userId, ITEM_KEY, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      admin.revokeInventory(adminU.userId, 'ADMIN', player.userId, ITEM_KEY, 1000, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('itemKey không tồn tại trong catalog → INVALID_INPUT (ITEM_NOT_FOUND mapped)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.revokeInventory(
        adminU.userId,
        'ADMIN',
        player.userId,
        'no_such_item_key_12345',
        1,
        '',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('ghi audit log admin.inventory.revoke với meta đầy đủ', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await grantLoot(player.characterId, 5);

    await admin.revokeInventory(
      adminU.userId,
      'ADMIN',
      player.userId,
      ITEM_KEY,
      2,
      'suspicious grant from bug',
    );

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.inventory.revoke' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta).toMatchObject({
      targetUserId: player.userId,
      itemKey: ITEM_KEY,
      qty: 2,
      reason: 'suspicious grant from bug',
    });
  });
});
