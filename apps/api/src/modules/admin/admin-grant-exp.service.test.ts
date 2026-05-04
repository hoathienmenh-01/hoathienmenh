import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { AdminError, AdminService } from './admin.service';
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

describe('AdminService.grantExp', () => {
  it('grant 5000 exp → exp tăng đúng + audit row admin.exp.grant', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 100n });

    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, 5000n, 'smoke seed');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.exp).toBe(5100n);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.exp.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.deltaExp).toBe('5000');
    expect(meta.reason).toBe('smoke seed');
  });

  it('grant exp 10^17 BigInt-safe → exp + delta đúng (không bị Number overflow)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 1n });
    const big = 10n ** 17n;

    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, big, '');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.exp).toBe(big + 1n);
  });

  it('exp = 0 → INVALID_INPUT (chỉ cộng dương)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', player.userId, 0n, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('exp âm → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', player.userId, -100n, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('exp > MAX_GRANT_EXP (10^18) → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', player.userId, 10n ** 19n, ''),
    ).rejects.toThrow(AdminError);
  });

  it('target không tồn tại → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', 'no-such-user', 100n, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('target không có character → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const u = await prisma.user.create({
      data: { email: 'no-char@xt.local', passwordHash: 'x' },
    });

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', u.id, 100n, ''),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('actor = target → CANNOT_TARGET_SELF', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantExp(adminU.userId, 'ADMIN', adminU.userId, 100n, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('MOD grant cho ADMIN → FORBIDDEN', async () => {
    const mod = await makeUserChar(prisma, { role: 'MOD' });
    const target = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantExp(mod.userId, 'MOD', target.userId, 100n, ''),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('MOD grant cho PLAYER → OK (hierarchy MOD allowed PLAYER)', async () => {
    const mod = await makeUserChar(prisma, { role: 'MOD' });
    const player = await makeUserChar(prisma, { exp: 0n });

    await admin.grantExp(mod.userId, 'MOD', player.userId, 50n, 'mod test');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.exp).toBe(50n);
  });
});
