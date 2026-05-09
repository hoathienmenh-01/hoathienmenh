import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
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
  const quests = new QuestService(prisma, currency, inventory, new NpcAffinityService(prisma, inventory));
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AdminService.grantExp', () => {
  it('grant 500 exp dưới ngưỡng stage 1 (luyenkhi cap=1600) → exp tăng + stage giữ nguyên 1 + audit row', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 100n });

    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, 500n, 'smoke seed');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.exp).toBe(600n);
    expect(c?.realmStage).toBe(1);
    expect(c?.realmKey).toBe('luyenkhi');

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.exp.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.deltaExp).toBe('500');
    expect(meta.reason).toBe('smoke seed');
    expect(meta.realmStageAfter).toBe(1);
    expect(meta.expAfter).toBe('600');
  });

  it('grant 5000 exp luyenkhi (vượt cap stage 1+2) → auto-advance stage 1→3 + exp leftover', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 100n });

    // luyenkhi cap1=1600, cap2=2240, cap3=3136. 5100 → stage 1→2 (-1600=3500)
    // → stage 2→3 (-2240=1260) → stage 3 cap=3136 > 1260 → dừng.
    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, 5000n, 'auto-advance');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.exp).toBe(1260n);
    expect(c?.realmStage).toBe(3);
    expect(c?.realmKey).toBe('luyenkhi');
  });

  it('grant exp đủ peak luyenkhi → stage 9 + exp >= cost(9), KHÔNG auto-cross realm (manual breakthrough)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 0n });

    // luyenkhi sum cap stage 1..8 = 1600+2240+3136+4390+6147+8605+12047+16866 = 55031
    // (Math.round với 1.4^idx mid-rounding). Grant 200000 → stage 9, exp =
    // 200000-55031 = 144969 (>= cost(9)=23613). Loop dừng tại stage 9 dù exp
    // dư cao — peak phải manual /character/breakthrough.
    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, 200000n, 'peak seed');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.realmStage).toBe(9);
    expect(c?.realmKey).toBe('luyenkhi');
    expect(c?.exp).toBe(144969n);
  });

  it('grant exp 10^17 BigInt-safe → stage 9 + exp leftover BigInt-safe (không bị Number overflow)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma, { exp: 1n });
    const big = 10n ** 17n;

    await admin.grantExp(adminU.userId, 'ADMIN', player.userId, big, '');

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    // Sau auto-advance stage 1..8, exp = 10^17 + 1 - 55031 (sum cap luyenkhi).
    expect(c?.realmStage).toBe(9);
    expect(c?.realmKey).toBe('luyenkhi');
    expect(c?.exp).toBe(big + 1n - 55031n);
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
    expect(c?.realmStage).toBe(1);
  });
});
