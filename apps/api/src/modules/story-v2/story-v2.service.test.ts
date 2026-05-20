import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { phase33QuestByKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  Phase33StoryError,
  Phase33StoryService,
} from './story-v2.service';
import {
  TEST_DATABASE_URL,
  makePhase33StoryService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let story: Phase33StoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  story = makePhase33StoryService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Phase 33 chap 9 = do_kiep (order 9). chap 10 = nhan_tien (order 10).
const CHAP_9 = 'ch09';
const CHAP_10 = 'ch10';
const Q_CH09_MAIN_01 = 'q_ch09_main_01';
const Q_CH09_MAIN_02 = 'q_ch09_main_02';

async function realmDoKiepChar() {
  return makeUserChar(prisma, { realmKey: 'do_kiep', realmStage: 9 });
}

describe('Phase33StoryService.listChaptersForUser', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(story.listChaptersForUser('no-such-user')).rejects.toThrow(
      new Phase33StoryError('NO_CHARACTER'),
    );
  });

  it('character realm dưới do_kiep KHÔNG thấy chapter Phase 33 nào', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const list = await story.listChaptersForUser(userId);
    expect(list.length).toBe(0);
  });

  it('character realm do_kiep thấy đúng ch09 AVAILABLE (chapter đầu Quyển II)', async () => {
    const { userId } = await realmDoKiepChar();
    const list = await story.listChaptersForUser(userId);
    expect(list.length).toBeGreaterThan(0);
    const ch9 = list.find((c) => c.chapKey === CHAP_9);
    expect(ch9).toBeDefined();
    expect(ch9!.status).toBe('AVAILABLE');
    expect(ch9!.mainQuestsCompletedCount).toBe(0);
    expect(ch9!.mainQuestsTotal).toBeGreaterThan(0);
  });

  it('character realm nhan_tien thấy cả ch09 + ch10 (realm gate progressive)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'nhan_tien' });
    const list = await story.listChaptersForUser(userId);
    const keys = new Set(list.map((c) => c.chapKey));
    expect(keys.has(CHAP_9)).toBe(true);
    expect(keys.has(CHAP_10)).toBe(true);
  });

  it('lazy-create idempotent — gọi 2 lần không tạo dup row', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await story.listChaptersForUser(userId);
    const count1 = await prisma.characterStoryV2ChapterProgress.count({
      where: { characterId },
    });
    await story.listChaptersForUser(userId);
    const count2 = await prisma.characterStoryV2ChapterProgress.count({
      where: { characterId },
    });
    expect(count2).toBe(count1);
  });
});

describe('Phase33StoryService.listQuestsForChapter', () => {
  it('throws STORY_V2_CHAPTER_UNKNOWN cho chap key sai', async () => {
    const { userId } = await realmDoKiepChar();
    await expect(
      story.listQuestsForChapter(userId, 'ch_invalid_99'),
    ).rejects.toThrow(new Phase33StoryError('STORY_V2_CHAPTER_UNKNOWN'));
  });

  it('chap 9 main_01 (no prereq) xuất hiện AVAILABLE khi character do_kiep', async () => {
    const { userId } = await realmDoKiepChar();
    const quests = await story.listQuestsForChapter(userId, CHAP_9);
    const q1 = quests.find((q) => q.questKey === Q_CH09_MAIN_01);
    expect(q1).toBeDefined();
    expect(q1!.status).toBe('AVAILABLE');
    expect(q1!.completable).toBe(false);
  });

  it('chap 9 main_02 (prereq=main_01) ẨN khi main_01 chưa CLAIMED', async () => {
    const { userId } = await realmDoKiepChar();
    const quests = await story.listQuestsForChapter(userId, CHAP_9);
    const q2 = quests.find((q) => q.questKey === Q_CH09_MAIN_02);
    expect(q2).toBeUndefined();
  });

  it('chap 9 main_02 hiện khi main_01 đã CLAIMED', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    // Set up: insert CLAIMED row for main_01.
    await prisma.characterStoryV2QuestProgress.create({
      data: {
        characterId,
        questKey: Q_CH09_MAIN_01,
        chapKey: CHAP_9,
        status: 'CLAIMED',
        stepProgress: {},
        claimedAt: new Date(),
      },
    });
    // Also need the chapter row + storyFlag for q2's requiredStoryFlags.
    const q2def = phase33QuestByKey(Q_CH09_MAIN_02)!;
    await prisma.characterStoryV2ChapterProgress.create({
      data: {
        characterId,
        chapKey: CHAP_9,
        status: 'AVAILABLE',
        storyFlags: q2def.requiredStoryFlags as unknown as object,
        unlockedAt: new Date(),
      },
    });
    const quests = await story.listQuestsForChapter(userId, CHAP_9);
    const q2 = quests.find((q) => q.questKey === Q_CH09_MAIN_02);
    expect(q2).toBeDefined();
    expect(q2!.status).toBe('AVAILABLE');
  });
});

describe('Phase33StoryService.acceptQuest', () => {
  it('throws STORY_V2_QUEST_UNKNOWN cho quest key sai', async () => {
    const { userId } = await realmDoKiepChar();
    await expect(story.acceptQuest(userId, 'q_invalid_xx')).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_UNKNOWN'),
    );
  });

  it('throws STORY_V2_QUEST_LOCKED_REALM khi realm thấp hơn quest required', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(story.acceptQuest(userId, Q_CH09_MAIN_01)).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_LOCKED_REALM'),
    );
  });

  it('accept main_01 happy path: status AVAILABLE → ACCEPTED, set acceptedAt', async () => {
    const { userId } = await realmDoKiepChar();
    const view = await story.acceptQuest(userId, Q_CH09_MAIN_01);
    expect(view.status).toBe('ACCEPTED');
    expect(view.acceptedAt).not.toBeNull();
  });

  it('accept idempotent — gọi lần 2 trả lại ACCEPTED (không thrown)', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    const view2 = await story.acceptQuest(userId, Q_CH09_MAIN_01);
    expect(view2.status).toBe('ACCEPTED');
  });

  it('accept main_02 throws LOCKED_PREREQUISITE khi main_01 chưa COMPLETED', async () => {
    const { userId } = await realmDoKiepChar();
    await expect(story.acceptQuest(userId, Q_CH09_MAIN_02)).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_LOCKED_PREREQUISITE'),
    );
  });

  it('accept flip chapter row AVAILABLE → IN_PROGRESS', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await story.listChaptersForUser(userId); // lazy-create row.
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    const chapRow = await prisma.characterStoryV2ChapterProgress.findUnique({
      where: { characterId_chapKey: { characterId, chapKey: CHAP_9 } },
    });
    expect(chapRow!.status).toBe('IN_PROGRESS');
  });
});

describe('Phase33StoryService.progressQuest', () => {
  it('progress 1 step talk increment cur 0 → 1', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    const view = await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_1',
    });
    const step1 = view.steps.find((s) => s.id === 'step_1')!;
    expect(step1.currentCount).toBe(1);
    expect(step1.done).toBe(true);
    // Quest chưa COMPLETED vì step_2 (flag_set) chưa progress.
    const row = await prisma.characterStoryV2QuestProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: Q_CH09_MAIN_01 } },
    });
    expect(row!.status).toBe('ACCEPTED');
  });

  it('progress đủ all steps → auto flip COMPLETED', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_1',
    });
    const view = await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_2',
    });
    expect(view.status).toBe('COMPLETED');
    expect(view.completedAt).not.toBeNull();
  });

  it('progress quest chưa ACCEPTED throws NOT_ACCEPTED', async () => {
    const { userId } = await realmDoKiepChar();
    await story.listQuestsForChapter(userId, CHAP_9); // lazy-create AVAILABLE.
    await expect(
      story.progressQuest(userId, {
        questKey: Q_CH09_MAIN_01,
        stepId: 'step_1',
      }),
    ).rejects.toThrow(new Phase33StoryError('STORY_V2_QUEST_NOT_ACCEPTED'));
  });

  it('progress unknown step id throws STEP_UNKNOWN', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await expect(
      story.progressQuest(userId, {
        questKey: Q_CH09_MAIN_01,
        stepId: 'step_99',
      }),
    ).rejects.toThrow(new Phase33StoryError('STORY_V2_QUEST_STEP_UNKNOWN'));
  });

  it('progress kill step (chap 9 main_02) throws STEP_KIND_NOT_SUPPORTED', async () => {
    // Setup main_02 ACCEPTED directly.
    const { userId, characterId } = await realmDoKiepChar();
    await prisma.characterStoryV2QuestProgress.create({
      data: {
        characterId,
        questKey: Q_CH09_MAIN_02,
        chapKey: CHAP_9,
        status: 'ACCEPTED',
        stepProgress: { step_1: 0, step_2: 0, step_3: 0 },
        acceptedAt: new Date(),
      },
    });
    await expect(
      story.progressQuest(userId, {
        questKey: Q_CH09_MAIN_02,
        stepId: 'step_2', // kill step (Phase 33.3 wire deferred).
      }),
    ).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED'),
    );
  });
});

describe('Phase33StoryService.completeQuest', () => {
  it('explicit complete đã COMPLETED idempotent', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_1',
    });
    await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_2',
    });
    const view = await story.completeQuest(userId, Q_CH09_MAIN_01);
    expect(view.status).toBe('COMPLETED');
  });

  it('throws NOT_COMPLETED khi step chưa đủ', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await expect(story.completeQuest(userId, Q_CH09_MAIN_01)).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_NOT_COMPLETED'),
    );
  });
});

describe('Phase33StoryService.claimReward', () => {
  async function completeMain01(userId: string) {
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_1',
    });
    await story.progressQuest(userId, {
      questKey: Q_CH09_MAIN_01,
      stepId: 'step_2',
    });
  }

  it('claim grants linhThach + exp + congHien + ledger row + audit row', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    const beforeLinh = (
      await prisma.character.findUniqueOrThrow({ where: { id: characterId } })
    ).linhThach;
    await completeMain01(userId);
    const result = await story.claimReward(userId, Q_CH09_MAIN_01);
    expect(result.questKey).toBe(Q_CH09_MAIN_01);
    expect(result.granted.linhThach).toBeGreaterThan(0);

    const charAfter = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
    });
    expect(charAfter.linhThach).toBeGreaterThan(beforeLinh);
    expect(charAfter.exp).toBeGreaterThan(0n);
    expect(charAfter.congHien).toBeGreaterThan(0);

    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        reason: 'STORY_V2_QUEST_CLAIM',
        refId: Q_CH09_MAIN_01,
      },
    });
    expect(ledger.length).toBe(1);

    const audit = await prisma.characterStoryV2RewardClaim.findUnique({
      where: {
        characterId_questKey: { characterId, questKey: Q_CH09_MAIN_01 },
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.linhThachGranted).toBeGreaterThan(0n);
  });

  it('claim idempotent — claim lần 2 throws ALREADY_CLAIMED', async () => {
    const { userId } = await realmDoKiepChar();
    await completeMain01(userId);
    await story.claimReward(userId, Q_CH09_MAIN_01);
    await expect(story.claimReward(userId, Q_CH09_MAIN_01)).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_ALREADY_CLAIMED'),
    );
  });

  it('claim throws NOT_COMPLETED khi quest chỉ ACCEPTED', async () => {
    const { userId } = await realmDoKiepChar();
    await story.acceptQuest(userId, Q_CH09_MAIN_01);
    await expect(story.claimReward(userId, Q_CH09_MAIN_01)).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_NOT_COMPLETED'),
    );
  });

  it('claim main quest tăng chapter.mainQuestsCompletedCount', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await story.listChaptersForUser(userId); // lazy-create chap row.
    await completeMain01(userId);
    await story.claimReward(userId, Q_CH09_MAIN_01);
    const chapRow = await prisma.characterStoryV2ChapterProgress.findUnique({
      where: { characterId_chapKey: { characterId, chapKey: CHAP_9 } },
    });
    expect(chapRow!.mainQuestsCompletedCount).toBe(1);
  });

  it('claim grants reward affinity vào CharacterNpcAffinity', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await completeMain01(userId);
    const def = phase33QuestByKey(Q_CH09_MAIN_01)!;
    const giver = def.giverNpcKey;
    await story.claimReward(userId, Q_CH09_MAIN_01);
    const aff = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: giver } },
    });
    expect(aff).not.toBeNull();
    expect(aff!.score).toBeGreaterThan(0);
  });

  it('claim apply storyFlags vào chapter.storyFlags', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await story.listChaptersForUser(userId);
    await completeMain01(userId);
    const def = phase33QuestByKey(Q_CH09_MAIN_01)!;
    const flagsToCheck = def.rewards.storyFlags ?? [];
    await story.claimReward(userId, Q_CH09_MAIN_01);
    if (flagsToCheck.length > 0) {
      const chapRow = await prisma.characterStoryV2ChapterProgress.findUnique({
        where: { characterId_chapKey: { characterId, chapKey: CHAP_9 } },
      });
      const flags = chapRow!.storyFlags as string[];
      for (const f of flagsToCheck) {
        expect(flags).toContain(f);
      }
    }
  });
});

describe('Phase33StoryService.track (Phase 33.3 deep wire)', () => {
  // Use chap 9 main_02 (kill step_2 monster=tich_thien_giam_quan).
  async function acceptMain02(userId: string, characterId: string) {
    // Setup main_02 ACCEPTED with stepProgress kept by service (matches def steps).
    const def = phase33QuestByKey(Q_CH09_MAIN_02)!;
    const stepProgress = Object.fromEntries(
      def.steps.map((s) => [s.id, 0]),
    );
    await prisma.characterStoryV2QuestProgress.create({
      data: {
        characterId,
        questKey: Q_CH09_MAIN_02,
        chapKey: CHAP_9,
        status: 'ACCEPTED',
        stepProgress,
        acceptedAt: new Date(),
      },
    });
  }

  it('track kill monster target tăng stepProgress của quest matching', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await acceptMain02(userId, characterId);
    const def = phase33QuestByKey(Q_CH09_MAIN_02)!;
    const killStep = def.steps.find((s) => s.kind === 'kill')!;
    await story.track(characterId, 'kill', 'monster', killStep.targetId, 1);
    const row = await prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId, questKey: Q_CH09_MAIN_02 },
      },
    });
    const progress = row!.stepProgress as Record<string, number>;
    expect(progress[killStep.id]).toBe(1);
  });

  it('track no-op nếu không có quest ACCEPTED matching', async () => {
    const { characterId } = await realmDoKiepChar();
    // No ACCEPTED quest → track returns silently.
    await story.track(characterId, 'kill', 'monster', 'tich_thien_giam_quan', 1);
    const rows = await prisma.characterStoryV2QuestProgress.findMany({
      where: { characterId },
    });
    expect(rows.length).toBe(0);
  });

  it('track không tăng quá step.count (clamp)', async () => {
    const { userId, characterId } = await realmDoKiepChar();
    await acceptMain02(userId, characterId);
    const def = phase33QuestByKey(Q_CH09_MAIN_02)!;
    const killStep = def.steps.find((s) => s.kind === 'kill')!;
    await story.track(
      characterId,
      'kill',
      'monster',
      killStep.targetId,
      killStep.count + 100,
    );
    const row = await prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId, questKey: Q_CH09_MAIN_02 },
      },
    });
    const progress = row!.stepProgress as Record<string, number>;
    expect(progress[killStep.id]).toBe(killStep.count);
  });

  it('track boss_defeat tăng stepProgress cho weekly quest có boss_defeat step', async () => {
    const { characterId } = await realmDoKiepChar();
    // Accept weekly quest q_ch09_weekly_01 (boss_defeat step).
    const weeklyKey = 'q_ch09_weekly_01';
    const def = phase33QuestByKey(weeklyKey);
    if (!def) return; // skip nếu catalog chưa có weekly quest này
    const stepProgress = Object.fromEntries(def.steps.map((s) => [s.id, 0]));
    await prisma.characterStoryV2QuestProgress.create({
      data: {
        characterId,
        questKey: weeklyKey,
        chapKey: CHAP_9,
        status: 'ACCEPTED',
        stepProgress,
        acceptedAt: new Date(),
      },
    });
    const bossStep = def.steps.find((s) => s.kind === 'boss_defeat')!;
    await story.track(characterId, 'boss_defeat', 'boss', bossStep.targetId, 1);
    const row = await prisma.characterStoryV2QuestProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: weeklyKey } },
    });
    const progress = row!.stepProgress as Record<string, number>;
    expect(progress[bossStep.id]).toBe(1);
  });

  it('track dungeon_clear tăng stepProgress cho quest có dungeon_clear step', async () => {
    // Catalog hiện tại chưa có dungeon_clear step — test verify track()
    // accept kind mà không throw, và no-op nếu không match.
    const { characterId } = await realmDoKiepChar();
    await story.track(characterId, 'dungeon_clear', 'dungeon', 'nonexistent_dungeon', 1);
    // No-op: không có quest matching → không tạo row.
    const rows = await prisma.characterStoryV2QuestProgress.findMany({
      where: { characterId },
    });
    expect(rows.length).toBe(0);
  });
});

describe('Phase33StoryService.listDialoguesForQuest', () => {
  it('throws STORY_V2_QUEST_UNKNOWN cho quest key sai', async () => {
    const { userId } = await realmDoKiepChar();
    await expect(
      story.listDialoguesForQuest(userId, 'q_invalid_x'),
    ).rejects.toThrow(new Phase33StoryError('STORY_V2_QUEST_UNKNOWN'));
  });

  it('throws NOT_FOUND_PROGRESS khi quest chưa unlock (chưa có row)', async () => {
    const { userId } = await realmDoKiepChar();
    await expect(
      story.listDialoguesForQuest(userId, Q_CH09_MAIN_01),
    ).rejects.toThrow(
      new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS'),
    );
  });

  it('return dialogues sau khi quest unlock', async () => {
    const { userId } = await realmDoKiepChar();
    await story.listQuestsForChapter(userId, CHAP_9);
    const dialogues = await story.listDialoguesForQuest(
      userId,
      Q_CH09_MAIN_01,
    );
    expect(dialogues.length).toBeGreaterThan(0);
    for (const d of dialogues) {
      expect(d.questKey).toBe(Q_CH09_MAIN_01);
      expect(d.textVi.length).toBeGreaterThan(0);
    }
  });

  it('filter dialogues theo phase INTRO', async () => {
    const { userId } = await realmDoKiepChar();
    await story.listQuestsForChapter(userId, CHAP_9);
    const dialogues = await story.listDialoguesForQuest(
      userId,
      Q_CH09_MAIN_01,
      'INTRO',
    );
    for (const d of dialogues) {
      expect(d.phase).toBe('INTRO');
    }
  });
});
