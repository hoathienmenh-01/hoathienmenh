import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;
let quests: QuestService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  quests = new QuestService(prisma, currency, inventory);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Admin grant-quest-track — Phase 12 Story PR-5 main storyline Chapter 1
 * playable harness. Test bypass-track step kill cho `phamnhan_grind_01`
 * (kill 10 son_thu, no prereq) — admin track 10 → COMPLETED. Cover
 * positive flow + validation + RBAC + audit log.
 */
describe('AdminService.grantQuestTrack', () => {
  it('positive flow: accept phamnhan_grind_01 → admin track kill son_thu × 10 → COMPLETED', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    // Player accept quest first (lazy-create AVAILABLE row).
    await quests.listForUser(player.userId);
    await quests.accept(player.userId, 'phamnhan_grind_01');

    await admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
      kind: 'kill',
      targetType: 'monster',
      targetId: 'son_thu',
      amount: 10,
      reason: 'e2e seed',
    });

    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId: player.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('COMPLETED');
    expect(row!.completedAt).not.toBeNull();
    const progress = row!.stepProgress as Record<string, number>;
    expect(progress.step_01).toBe(10);
  });

  it('partial track (3 lần × amount 1) → counter cộng dồn, chưa COMPLETED', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await quests.listForUser(player.userId);
    await quests.accept(player.userId, 'phamnhan_grind_01');

    for (let i = 0; i < 3; i++) {
      await admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      });
    }

    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId: player.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    expect(row!.status).toBe('ACCEPTED');
    expect((row!.stepProgress as Record<string, number>).step_01).toBe(3);
  });

  it('audit log row created với meta đầy đủ', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await quests.listForUser(player.userId);
    await quests.accept(player.userId, 'phamnhan_grind_01');

    await admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
      kind: 'kill',
      targetType: 'monster',
      targetId: 'son_thu',
      amount: 5,
      reason: 'unit test',
    });

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.quest.track' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.targetUserId).toBe(player.userId);
    expect(meta.kind).toBe('kill');
    expect(meta.targetType).toBe('monster');
    expect(meta.targetId).toBe('son_thu');
    expect(meta.amount).toBe(5);
    expect(meta.reason).toBe('unit test');
  });

  it('không có ACCEPTED quest match → no-op (fail-soft)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
      kind: 'kill',
      targetType: 'monster',
      targetId: 'son_thu',
      amount: 5,
      reason: '',
    });

    const rows = await prisma.questProgress.findMany({
      where: { characterId: player.characterId },
    });
    expect(rows).toHaveLength(0);
  });

  it('targetId không match catalog → no-op (fail-soft, mirror gameplay hook)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await quests.listForUser(player.userId);
    await quests.accept(player.userId, 'phamnhan_grind_01');

    await admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
      kind: 'kill',
      targetType: 'monster',
      targetId: 'fake_monster',
      amount: 1,
      reason: '',
    });

    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId: player.characterId,
          questKey: 'phamnhan_grind_01',
        },
      },
    });
    expect(row!.status).toBe('ACCEPTED');
    expect((row!.stepProgress as Record<string, number>).step_01).toBe(0);
  });

  it('kind invalid → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'talk' as never,
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('targetType invalid → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'kill',
        targetType: 'npc' as never,
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('amount = 0 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 0,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('amount > 999 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1000,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('targetId rỗng → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', player.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: '',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('actor = target → CANNOT_TARGET_SELF', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', adminU.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('MOD track quest cho ADMIN target → FORBIDDEN', async () => {
    const modU = await makeUserChar(prisma, { role: 'MOD' });
    const target = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantQuestTrack(modU.userId, 'MOD', target.userId, {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('target user không tồn tại → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grantQuestTrack(adminU.userId, 'ADMIN', 'fake-user-id-xxxx', {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 1,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
