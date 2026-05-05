import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { questByKey, QUESTS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { QuestError, QuestService } from './quest.service';
import { TEST_DATABASE_URL, makeQuestService, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let quests: QuestService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  quests = makeQuestService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const QUEST_PHAMNHAN_GRIND = 'phamnhan_grind_01';
const QUEST_PHAMNHAN_MAIN = 'phamnhan_main_01';
const QUEST_LUYENKHI_MAIN = 'luyenkhi_main_01';

describe('QuestService.listForUser', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(quests.listForUser('non-existent-user')).rejects.toThrow(
      new QuestError('NO_CHARACTER'),
    );
  });

  it('character realm phamnhan chỉ thấy phamnhan quest, không thấy luyenkhi+', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await quests.listForUser(userId);
    expect(list.length).toBeGreaterThan(0);
    for (const q of list) {
      expect(q.realmKey).toBe('phamnhan');
      expect(q.requiredRealmOrder).toBe(0);
    }
  });

  it('character realm luyenkhi thấy phamnhan + luyenkhi quest có prereq được tự động tính', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const list = await quests.listForUser(userId);
    const realmKeys = new Set(list.map((q) => q.realmKey));
    expect(realmKeys.has('phamnhan')).toBe(true);
    // luyenkhi quest có prereq=phamnhan_grind_01 (chưa CLAIMED) → ẩn.
    const luyenkhiVisible = list.filter((q) => q.realmKey === 'luyenkhi');
    expect(luyenkhiVisible.length).toBeGreaterThan(0);
    // Quest không có prereq luôn xuất hiện.
    const noPrereq = luyenkhiVisible.filter((q) => !q.prerequisiteQuestKey);
    expect(noPrereq.length).toBeGreaterThan(0);
  });

  it('lazy-create AVAILABLE row idempotent — gọi lần 2 không tạo dup', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await quests.listForUser(userId);
    const count1 = await prisma.questProgress.count({ where: { characterId } });
    await quests.listForUser(userId);
    const count2 = await prisma.questProgress.count({ where: { characterId } });
    expect(count2).toBe(count1);
  });

  it('list quest status default AVAILABLE cho quest đã unlock, completable=false khi chưa accept', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const list = await quests.listForUser(userId);
    for (const q of list) {
      expect(q.status).toBe('AVAILABLE');
      expect(q.completable).toBe(false);
      expect(q.acceptedAt).toBeNull();
    }
  });
});

describe('QuestService.accept', () => {
  it('throws QUEST_UNKNOWN cho quest key sai', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(quests.accept(userId, 'fake_quest_xxx')).rejects.toThrow(
      new QuestError('QUEST_UNKNOWN'),
    );
  });

  it('throws QUEST_LOCKED_REALM khi character realm thấp hơn quest required', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(quests.accept(userId, QUEST_LUYENKHI_MAIN)).rejects.toThrow(
      new QuestError('QUEST_LOCKED_REALM'),
    );
  });

  it('throws QUEST_LOCKED_PREREQUISITE khi prereq quest chưa COMPLETED', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const def = questByKey(QUEST_LUYENKHI_MAIN);
    expect(def?.prerequisiteQuestKey).toBeTruthy();
    await expect(quests.accept(userId, QUEST_LUYENKHI_MAIN)).rejects.toThrow(
      new QuestError('QUEST_LOCKED_PREREQUISITE'),
    );
  });

  it('accept chuyển AVAILABLE → ACCEPTED + set acceptedAt', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const view = await quests.accept(userId, QUEST_PHAMNHAN_GRIND);
    expect(view.status).toBe('ACCEPTED');
    expect(view.acceptedAt).toBeTruthy();
    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: QUEST_PHAMNHAN_GRIND } },
    });
    expect(row?.status).toBe('ACCEPTED');
    expect(row?.acceptedAt).toBeTruthy();
  });

  it('accept hai lần liên tiếp: lần 2 throws QUEST_NOT_AVAILABLE (CAS guard)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await quests.accept(userId, QUEST_PHAMNHAN_GRIND);
    await expect(quests.accept(userId, QUEST_PHAMNHAN_GRIND)).rejects.toThrow(
      new QuestError('QUEST_NOT_AVAILABLE'),
    );
  });
});

describe('QuestService.progress (talk/explore/choice)', () => {
  it('throws QUEST_NOT_ACCEPTED khi quest chưa accept', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_MAIN);
    const talkStep = def?.steps.find((s) => s.kind === 'talk');
    expect(talkStep).toBeTruthy();
    await expect(
      quests.progress(userId, { questKey: QUEST_PHAMNHAN_MAIN, stepId: talkStep!.id }),
    ).rejects.toThrow(new QuestError('QUEST_NOT_ACCEPTED'));
  });

  it('throws QUEST_STEP_KIND_MISMATCH cho kill step (chỉ kill qua track)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Tìm quest có ít nhất 1 kill step — phamnhan grind có kill.
    const def = questByKey(QUEST_PHAMNHAN_GRIND);
    const killStep = def?.steps.find((s) => s.kind === 'kill');
    expect(killStep).toBeTruthy();
    await quests.accept(userId, QUEST_PHAMNHAN_GRIND);
    await expect(
      quests.progress(userId, { questKey: QUEST_PHAMNHAN_GRIND, stepId: killStep!.id }),
    ).rejects.toThrow(new QuestError('QUEST_STEP_KIND_MISMATCH'));
  });

  it('throws QUEST_STEP_UNKNOWN cho stepId không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await quests.accept(userId, QUEST_PHAMNHAN_MAIN);
    await expect(
      quests.progress(userId, { questKey: QUEST_PHAMNHAN_MAIN, stepId: 'fake_step_xxx' }),
    ).rejects.toThrow(new QuestError('QUEST_STEP_UNKNOWN'));
  });

  it('progress talk step cộng counter + auto COMPLETED khi all steps done', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_MAIN);
    expect(def).toBeTruthy();

    await quests.accept(userId, QUEST_PHAMNHAN_MAIN);
    // Dispatch theo step.kind — talk/explore/choice qua progress(); kill/collect qua track().
    for (const step of def!.steps) {
      if (step.kind === 'talk' || step.kind === 'explore' || step.kind === 'choice') {
        for (let i = 0; i < step.count; i++) {
          await quests.progress(userId, { questKey: QUEST_PHAMNHAN_MAIN, stepId: step.id });
        }
      } else {
        await quests.track(characterId, step.kind, step.targetType, step.targetId, step.count);
      }
    }
    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: QUEST_PHAMNHAN_MAIN } },
    });
    expect(row?.status).toBe('COMPLETED');
    expect(row?.completedAt).toBeTruthy();
  });

  it('progress amount cộng dồn không vượt step.count (clamp)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_MAIN);
    const talkStep = def!.steps[0];
    expect(talkStep.kind).toBe('talk');
    await quests.accept(userId, QUEST_PHAMNHAN_MAIN);
    // Cộng amount lớn hơn step.count.
    const view = await quests.progress(userId, {
      questKey: QUEST_PHAMNHAN_MAIN,
      stepId: talkStep.id,
      amount: 99,
    });
    const updated = view.steps.find((s) => s.id === talkStep.id);
    expect(updated?.currentCount).toBe(talkStep.count); // clamp.
    expect(updated?.done).toBe(true);
  });
});

describe('QuestService.track (kill/collect — internal hook)', () => {
  it('track kill increment counter cho ACCEPTED quest matching target monster', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Tìm quest có kill step + target monster trong catalog.
    const targetQuest = QUESTS.find(
      (q) =>
        q.steps.some((s) => s.kind === 'kill' && s.targetType === 'monster') &&
        q.requiredRealmOrder === 0,
    );
    expect(targetQuest).toBeTruthy();
    const killStep = targetQuest!.steps.find((s) => s.kind === 'kill')!;

    await quests.accept(userId, targetQuest!.key);
    await quests.track(characterId, 'kill', 'monster', killStep.targetId, 1);

    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: targetQuest!.key } },
    });
    const stepProgress = row?.stepProgress as Record<string, number>;
    expect(stepProgress[killStep.id]).toBe(1);
  });

  it('track không cộng quest chưa ACCEPTED (AVAILABLE row hoặc no row)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const targetQuest = QUESTS.find(
      (q) =>
        q.steps.some((s) => s.kind === 'kill' && s.targetType === 'monster') &&
        q.requiredRealmOrder === 0,
    );
    const killStep = targetQuest!.steps.find((s) => s.kind === 'kill')!;
    // Lazy-create AVAILABLE row.
    await quests.listForUser(userId);
    await quests.track(characterId, 'kill', 'monster', killStep.targetId, 5);

    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: targetQuest!.key } },
    });
    const stepProgress = row?.stepProgress as Record<string, number>;
    expect(stepProgress?.[killStep.id] ?? 0).toBe(0);
  });

  it('track không match wrong target — không cộng ngẫu nhiên', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const targetQuest = QUESTS.find(
      (q) =>
        q.steps.some((s) => s.kind === 'kill' && s.targetType === 'monster') &&
        q.requiredRealmOrder === 0,
    );
    await quests.accept(userId, targetQuest!.key);
    await quests.track(characterId, 'kill', 'monster', 'monster_không_tồn_tại', 99);

    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: targetQuest!.key } },
    });
    const stepProgress = row?.stepProgress as Record<string, number>;
    const sum = Object.values(stepProgress ?? {}).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });

  it('track auto-COMPLETED khi cộng tới đúng count', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const targetQuest = QUESTS.find(
      (q) =>
        q.steps.length === 1 &&
        q.steps[0].kind === 'kill' &&
        q.steps[0].targetType === 'monster' &&
        q.requiredRealmOrder === 0,
    );
    if (!targetQuest) {
      // Fallback: pick any kill quest, cộng đủ tất cả các step.
      const fallback = QUESTS.find(
        (q) =>
          q.steps.every((s) => s.kind === 'kill' && s.targetType === 'monster') &&
          q.requiredRealmOrder === 0,
      );
      expect(fallback).toBeTruthy();
      await quests.accept(userId, fallback!.key);
      for (const step of fallback!.steps) {
        await quests.track(characterId, 'kill', 'monster', step.targetId, step.count);
      }
      const row = await prisma.questProgress.findUnique({
        where: { characterId_questKey: { characterId, questKey: fallback!.key } },
      });
      expect(row?.status).toBe('COMPLETED');
      return;
    }
    await quests.accept(userId, targetQuest.key);
    await quests.track(characterId, 'kill', 'monster', targetQuest.steps[0].targetId, targetQuest.steps[0].count);
    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: targetQuest.key } },
    });
    expect(row?.status).toBe('COMPLETED');
  });

  it('track amount âm hoặc 0 → no-op', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const targetQuest = QUESTS.find(
      (q) =>
        q.steps.some((s) => s.kind === 'kill' && s.targetType === 'monster') &&
        q.requiredRealmOrder === 0,
    );
    const killStep = targetQuest!.steps.find((s) => s.kind === 'kill')!;
    await quests.accept(userId, targetQuest!.key);
    await quests.track(characterId, 'kill', 'monster', killStep.targetId, 0);
    await quests.track(characterId, 'kill', 'monster', killStep.targetId, -5);
    const row = await prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: targetQuest!.key } },
    });
    const stepProgress = row?.stepProgress as Record<string, number>;
    expect(stepProgress[killStep.id] ?? 0).toBe(0);
  });
});

describe('QuestService.transitionToCompleted — Character.storyChapter bump', () => {
  it('main quest COMPLETED bump Character.storyChapter monotonic', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_MAIN);
    expect(def?.kind).toBe('main');
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { storyChapter: true },
    });
    expect(before.storyChapter).toBe(0);

    await quests.accept(userId, QUEST_PHAMNHAN_MAIN);
    for (const step of def!.steps) {
      if (step.kind === 'talk' || step.kind === 'explore' || step.kind === 'choice') {
        for (let i = 0; i < step.count; i++) {
          await quests.progress(userId, { questKey: QUEST_PHAMNHAN_MAIN, stepId: step.id });
        }
      } else {
        await quests.track(characterId, step.kind, step.targetType, step.targetId, step.count);
      }
    }

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { storyChapter: true },
    });
    expect(after.storyChapter).toBe(1); // phamnhan main → chapter 1.
  });

  it('grind quest COMPLETED KHÔNG bump storyChapter', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_GRIND);
    expect(def?.kind).toBe('grind');
    await quests.accept(userId, QUEST_PHAMNHAN_GRIND);
    // Cộng đủ qua track (kill/collect).
    for (const step of def!.steps) {
      if (step.kind === 'kill' || step.kind === 'collect') {
        await quests.track(characterId, step.kind, step.targetType, step.targetId, step.count);
      } else {
        for (let i = 0; i < step.count; i++) {
          await quests.progress(userId, { questKey: QUEST_PHAMNHAN_GRIND, stepId: step.id });
        }
      }
    }
    const ch = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { storyChapter: true },
    });
    expect(ch.storyChapter).toBe(0);
  });
});

// ============================================================================
// Phase 12 PR-3 — claim path tests.
// ============================================================================

/**
 * Helper: drive 1 quest tới COMPLETED state qua accept + progress/track.
 */
async function bringQuestToCompleted(
  userId: string,
  characterId: string,
  questKey: string,
): Promise<void> {
  const def = questByKey(questKey);
  if (!def) throw new Error(`unknown quest ${questKey}`);
  await quests.accept(userId, questKey);
  for (const step of def.steps) {
    if (step.kind === 'kill' || step.kind === 'collect') {
      await quests.track(characterId, step.kind, step.targetType, step.targetId, step.count);
    } else {
      for (let i = 0; i < step.count; i++) {
        await quests.progress(userId, { questKey, stepId: step.id });
      }
    }
  }
}

describe('QuestService.claim — Phase 12 PR-3', () => {
  it('throws QUEST_UNKNOWN cho quest key không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(quests.claim(userId, 'nonexistent_quest_99')).rejects.toThrow(
      new QuestError('QUEST_UNKNOWN'),
    );
  });

  it('throws NO_CHARACTER nếu user không có character', async () => {
    await expect(quests.claim('non-existent-user', QUEST_PHAMNHAN_GRIND)).rejects.toThrow(
      new QuestError('NO_CHARACTER'),
    );
  });

  it('throws QUEST_NOT_FOUND_PROGRESS nếu quest chưa từng accept', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(quests.claim(userId, QUEST_PHAMNHAN_GRIND)).rejects.toThrow(
      new QuestError('QUEST_NOT_FOUND_PROGRESS'),
    );
  });

  it('throws QUEST_NOT_COMPLETED nếu quest đang ACCEPTED (chưa xong steps)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await quests.accept(userId, QUEST_PHAMNHAN_GRIND);
    await expect(quests.claim(userId, QUEST_PHAMNHAN_GRIND)).rejects.toThrow(
      new QuestError('QUEST_NOT_COMPLETED'),
    );
  });

  it('claim COMPLETED quest grant linhThach + exp + congHien + items qua ledger', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true, tienNgoc: true, exp: true, congHien: true },
    });
    await bringQuestToCompleted(userId, characterId, QUEST_PHAMNHAN_GRIND);

    const def = questByKey(QUEST_PHAMNHAN_GRIND)!;
    const r = def.rewards;
    const result = await quests.claim(userId, QUEST_PHAMNHAN_GRIND);

    expect(result.questKey).toBe(QUEST_PHAMNHAN_GRIND);
    expect(result.granted.linhThach).toBe(r.linhThach ?? 0);
    expect(result.granted.tienNgoc).toBe(r.tienNgoc ?? 0);
    expect(result.granted.exp).toBe(r.exp ?? 0);
    expect(result.granted.congHien).toBe(r.congHien ?? 0);

    // Status transitioned + claimedAt set.
    const row = await prisma.questProgress.findUniqueOrThrow({
      where: { characterId_questKey: { characterId, questKey: QUEST_PHAMNHAN_GRIND } },
      select: { status: true, claimedAt: true },
    });
    expect(row.status).toBe('CLAIMED');
    expect(row.claimedAt).not.toBeNull();

    // Character stats bumped.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true, tienNgoc: true, exp: true, congHien: true },
    });
    expect(after.linhThach - before.linhThach).toBe(BigInt(r.linhThach ?? 0));
    expect(after.tienNgoc - before.tienNgoc).toBe(r.tienNgoc ?? 0);
    expect(after.exp - before.exp).toBe(BigInt(r.exp ?? 0));
    expect(after.congHien - before.congHien).toBe(r.congHien ?? 0);

    // Ledger contract: 1 row / currency có grant > 0.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'QUEST_CLAIM', refId: QUEST_PHAMNHAN_GRIND },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger.length).toBe(
      ((r.linhThach ?? 0) > 0 ? 1 : 0) + ((r.tienNgoc ?? 0) > 0 ? 1 : 0),
    );
    for (const l of ledger) {
      expect(l.refType).toBe('Quest');
      expect(l.refId).toBe(QUEST_PHAMNHAN_GRIND);
      expect(l.delta > 0n).toBe(true);
    }
  });

  it('claim main quest grant items vào ItemLedger với reason=QUEST_CLAIM', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const def = questByKey(QUEST_PHAMNHAN_MAIN)!;
    expect(def.rewards.items?.length ?? 0).toBeGreaterThan(0);

    await bringQuestToCompleted(userId, characterId, QUEST_PHAMNHAN_MAIN);
    const result = await quests.claim(userId, QUEST_PHAMNHAN_MAIN);
    expect(result.granted.items.length).toBe(def.rewards.items!.length);

    const itemLedger = await prisma.itemLedger.findMany({
      where: { characterId, reason: 'QUEST_CLAIM', refId: QUEST_PHAMNHAN_MAIN },
    });
    expect(itemLedger.length).toBe(def.rewards.items!.length);
    for (const il of itemLedger) {
      expect(il.refType).toBe('Quest');
      expect(il.qtyDelta > 0).toBe(true);
    }

    const inventoryRows = await prisma.inventoryItem.findMany({
      where: { characterId, itemKey: { in: def.rewards.items!.map((it) => it.itemKey) } },
    });
    expect(inventoryRows.length).toBe(def.rewards.items!.length);
    for (const it of def.rewards.items!) {
      const row = inventoryRows.find((r) => r.itemKey === it.itemKey);
      expect(row?.qty).toBe(it.qty);
    }
  });

  it('claim lần 2 cùng quest throws QUEST_ALREADY_CLAIMED — KHÔNG ghi thêm ledger', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await bringQuestToCompleted(userId, characterId, QUEST_PHAMNHAN_GRIND);
    await quests.claim(userId, QUEST_PHAMNHAN_GRIND);

    const ledgerBefore = await prisma.currencyLedger.count({
      where: { characterId, reason: 'QUEST_CLAIM' },
    });

    await expect(quests.claim(userId, QUEST_PHAMNHAN_GRIND)).rejects.toThrow(
      new QuestError('QUEST_ALREADY_CLAIMED'),
    );

    const ledgerAfter = await prisma.currencyLedger.count({
      where: { characterId, reason: 'QUEST_CLAIM' },
    });
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it('concurrency: 2 parallel claim cùng questKey → 1 grant + 1 ledger row, loser throws ALREADY_CLAIMED', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await bringQuestToCompleted(userId, characterId, QUEST_PHAMNHAN_GRIND);
    const def = questByKey(QUEST_PHAMNHAN_GRIND)!;

    const before = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true },
    });

    // Fire 2 parallel claim — đúng 1 winner.
    const settled = await Promise.allSettled([
      quests.claim(userId, QUEST_PHAMNHAN_GRIND),
      quests.claim(userId, QUEST_PHAMNHAN_GRIND),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rej = rejected[0] as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(QuestError);
    expect((rej.reason as QuestError).code).toBe('QUEST_ALREADY_CLAIMED');

    // Đúng 1 ledger row / currency có grant.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'QUEST_CLAIM', refId: QUEST_PHAMNHAN_GRIND },
    });
    const expectedLedgerRows =
      ((def.rewards.linhThach ?? 0) > 0 ? 1 : 0) +
      ((def.rewards.tienNgoc ?? 0) > 0 ? 1 : 0);
    expect(ledger.length).toBe(expectedLedgerRows);

    // Currency đã bump đúng 1 lần (KHÔNG double-grant).
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach - before.linhThach).toBe(BigInt(def.rewards.linhThach ?? 0));
  });
});

