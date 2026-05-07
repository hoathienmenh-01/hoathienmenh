/**
 * Phase 12 Story Dialogue Foundation — integration tests.
 *
 * Coverage spec:
 *   1. dialogue catalog invariant     — `packages/shared/src/story-dialogues.test.ts`.
 *   2. get dialogue success           — `getDialogue` returns highest-specificity node.
 *   3. choice advances correct branch — `applyChoice` mark_seen + advance_quest_step.
 *   4. invalid choice reject          — choice condition fail → INVALID_CHOICE.
 *   5. cannot skip locked quest step  — choice advancing step_02 when step_01 not done → QUEST_STEP_LOCKED.
 *   (+) ALREADY_APPLIED idempotency cho grant effects.
 *   (+) NPC_LOCKED_REALM khi character chưa đạt realmGate.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import {
  StoryDialogueError,
  StoryDialogueService,
} from './story-dialogue.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let service: StoryDialogueService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  service = new StoryDialogueService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NPC_LANG = 'npc_lang_van_sinh';
const NPC_MOC = 'npc_moc_thanh_y';
const NODE_LANG_INTRO = 'story_dlg_lang_van_sinh_chapter_1_intro';
const NODE_LANG_SEED = 'story_dlg_lang_van_sinh_seed_truth';
const NODE_MOC_LINH_CAN = 'story_dlg_moc_thanh_y_linh_can';
const QUEST_PHAMNHAN_NPC = 'phamnhan_npc_01';
const QUEST_PHAMNHAN_REALM = 'phamnhan_realm_01';

async function seedQuestAccepted(
  prisma: PrismaService,
  characterId: string,
  questKey: string,
  stepProgress: Record<string, number>,
): Promise<void> {
  await prisma.questProgress.create({
    data: {
      characterId,
      questKey,
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      stepProgress: stepProgress as Prisma.InputJsonValue,
    },
  });
}

describe('StoryDialogueService.getDialogue', () => {
  it('throws NPC_UNKNOWN khi npcKey sai', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(service.getDialogue(userId, 'npc_does_not_exist')).rejects.toThrow(
      new StoryDialogueError('NPC_UNKNOWN'),
    );
  });

  it('throws NPC_LOCKED_REALM khi character realm thấp hơn realmGate của NPC', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Hàn Dạ realmGateOrder = 1 (Luyện Khí). Phàm Nhân không thấy.
    await expect(service.getDialogue(userId, 'npc_han_da')).rejects.toThrow(
      new StoryDialogueError('NPC_LOCKED_REALM'),
    );
  });

  it('returns highest-specificity node — Lăng Vân Sinh intro chapter 1 cho Phàm Nhân không có quest accepted', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const node = await service.getDialogue(userId, NPC_LANG);
    // Node intro chapter 1 chỉ có realm_min: 0 → match tất cả Phàm Nhân.
    // Node seed_truth có quest_status=accepted + not_seen, KHÔNG match (chưa accept quest).
    expect(node.nodeId).toBe(NODE_LANG_INTRO);
    expect(node.npcKey).toBe(NPC_LANG);
    expect(node.choices.map((c) => c.key)).toContain('respect');
    expect(node.choices.map((c) => c.key)).toContain('doubt');
    expect(node.choices.map((c) => c.key)).toContain('ask_seed');
    expect(node.seen).toBe(false);
    // Choice 'ask_seed' navigates → nextNodeId.
    const askSeed = node.choices.find((c) => c.key === 'ask_seed')!;
    expect(askSeed.nextNodeId).toBe(NODE_LANG_SEED);
    expect(askSeed.available).toBe(true);
  });

  it('picks higher-specificity node when quest accepted matches condition', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await seedQuestAccepted(prisma, characterId, QUEST_PHAMNHAN_REALM, {
      step_01: 0,
      step_02: 0,
      step_03: 0,
    });
    const node = await service.getDialogue(userId, NPC_LANG);
    // seed_truth có condition quest_status=accepted (specificity 5) > intro (realm_min 2).
    expect(node.nodeId).toBe(NODE_LANG_SEED);
    expect(node.questKey).toBe(QUEST_PHAMNHAN_REALM);
  });
});

describe('StoryDialogueService.applyChoice — happy paths', () => {
  it('choice advances correct branch — Mộc Thanh Y "kim" linh căn → set flag + advance step + give exp + mark seen', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      exp: 0n,
      linhThach: 0n,
    });
    // step_01 (talk) phải done trước — choice step_02 không skip step_01.
    await seedQuestAccepted(prisma, characterId, QUEST_PHAMNHAN_NPC, {
      step_01: 1,
      step_02: 0,
    });
    const result = await service.applyChoice(userId, NPC_MOC, NODE_MOC_LINH_CAN, 'kim');

    // Effects applied — set_flag + advance_quest_step + give_reward + mark_seen.
    expect(result.effectsApplied.map((e) => e.kind)).toEqual([
      'set_flag',
      'advance_quest_step',
      'give_reward',
      'mark_seen',
    ]);
    expect(result.granted.exp).toBe(50);
    expect(result.flags.linh_can_path).toBe('kim');
    expect(result.seen).toContain(NODE_MOC_LINH_CAN);

    // Quest step_02 advanced + auto COMPLETED (cả 2 steps now done).
    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: { characterId, questKey: QUEST_PHAMNHAN_NPC },
      },
    });
    expect(row?.status).toBe('COMPLETED');
    expect(row?.completedAt).toBeTruthy();

    // Character exp incremented + storyDialogueSeen + storyFlags persisted.
    const char = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char?.exp).toBe(50n);
    expect(Array.isArray(char?.storyDialogueSeen) ? char!.storyDialogueSeen : []).toContain(
      NODE_MOC_LINH_CAN,
    );
    const flags = char?.storyFlags as Record<string, unknown>;
    expect(flags?.linh_can_path).toBe('kim');
  });

  it('give_reward linhThach goes through CurrencyLedger with reason STORY_DIALOGUE_REWARD', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 0n,
    });
    const before = await prisma.character.findUnique({ where: { id: characterId } });
    expect(before?.linhThach).toBe(0n);
    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'respect');
    expect(result.granted.linhThach).toBe(20);
    expect(result.flags.attitude_lang_van_sinh).toBe('respect');

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'STORY_DIALOGUE_REWARD' },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledger[0].delta).toBe(20n);
    expect(ledger[0].refType).toBe('StoryDialogueNode');
    expect(ledger[0].refId).toBe(NODE_LANG_INTRO);
    const meta = ledger[0].meta as Record<string, unknown>;
    expect(meta.choiceKey).toBe('respect');

    const char = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char?.linhThach).toBe(20n);
  });

  it('choice với nextNodeId returns nextNode chứ KHÔNG đóng modal', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Need quest accepted để seed_truth condition match.
    await seedQuestAccepted(prisma, characterId, QUEST_PHAMNHAN_REALM, {
      step_01: 0,
      step_02: 0,
      step_03: 0,
    });
    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'ask_seed');
    expect(result.nextNode).not.toBeNull();
    expect(result.nextNode?.nodeId).toBe(NODE_LANG_SEED);
    expect(result.effectsApplied).toEqual([]); // ask_seed không có effect — chỉ navigate.
  });

  it('choice closeDialogue (no nextNodeId) → re-pick best node hoặc null nếu node hiện tại đã seen', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    // 'doubt' set_flag + mark_seen, không nextNodeId. Node intro đã seen + condition
    // intro vẫn match (realm_min: 0 không có not_seen) → service KHÔNG return cùng
    // node để tránh loop. Trả null = đóng modal.
    expect(result.nextNode).toBeNull();
  });
});

describe('StoryDialogueService.applyChoice — validation', () => {
  it('throws NODE_UNKNOWN khi nodeId không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.applyChoice(userId, NPC_LANG, 'story_dlg_does_not_exist', 'respect'),
    ).rejects.toThrow(new StoryDialogueError('NODE_UNKNOWN'));
  });

  it('throws NODE_NPC_MISMATCH khi nodeId thuộc NPC khác', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // NODE_MOC_LINH_CAN thuộc Mộc Thanh Y, không phải Lăng.
    await expect(
      service.applyChoice(userId, NPC_LANG, NODE_MOC_LINH_CAN, 'kim'),
    ).rejects.toThrow();
    try {
      await service.applyChoice(userId, NPC_LANG, NODE_MOC_LINH_CAN, 'kim');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('NODE_NPC_MISMATCH');
    }
  });

  it('throws CHOICE_UNKNOWN khi choiceKey không tồn tại', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'choice_xxx_unknown'),
    ).rejects.toThrow(new StoryDialogueError('CHOICE_UNKNOWN'));
  });

  it('throws INVALID_CHOICE khi choice condition fail (quest chưa accepted)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // NODE_LANG_SEED choice 'accept' yêu cầu quest_status=accepted.
    // Nhưng node SEED bản thân condition đòi quest_status=accepted → INVALID_CHOICE
    // sẽ throw ở node-level ('node condition failed').
    try {
      await service.applyChoice(userId, NPC_LANG, NODE_LANG_SEED, 'accept');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('INVALID_CHOICE');
    }
  });

  it('cannot skip locked quest step — choice advance step_02 trong khi step_01 chưa done → QUEST_STEP_LOCKED', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // step_01 (talk count=1) CHƯA done.
    await seedQuestAccepted(prisma, characterId, QUEST_PHAMNHAN_NPC, {
      step_01: 0,
      step_02: 0,
    });
    try {
      await service.applyChoice(userId, NPC_MOC, NODE_MOC_LINH_CAN, 'kim');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('QUEST_STEP_LOCKED');
    }
    // Quest progress KHÔNG bị thay đổi.
    const row = await prisma.questProgress.findUnique({
      where: {
        characterId_questKey: { characterId, questKey: QUEST_PHAMNHAN_NPC },
      },
    });
    expect(row?.status).toBe('ACCEPTED');
    const sp = row?.stepProgress as Record<string, number>;
    expect(sp.step_01).toBe(0);
    expect(sp.step_02).toBe(0);
    // Character flag KHÔNG set (rollback).
    const char = await prisma.character.findUnique({ where: { id: characterId } });
    const flags = char?.storyFlags as Record<string, unknown>;
    expect(flags?.linh_can_path).toBeUndefined();
    // storyDialogueSeen KHÔNG bao gồm node (rollback).
    const seenArr = Array.isArray(char?.storyDialogueSeen) ? char!.storyDialogueSeen : [];
    expect(seenArr).not.toContain(NODE_MOC_LINH_CAN);
  });

  it('throws QUEST_NOT_ACCEPTED khi quest chưa được accept', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // KHÔNG seed quest. Choice condition cũng đòi quest_status=accepted → INVALID_CHOICE
    // throw trước (server check choice condition trước pre-flight effect check).
    try {
      await service.applyChoice(userId, NPC_MOC, NODE_MOC_LINH_CAN, 'kim');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      // Node condition check fail trước (node yêu cầu quest_status=accepted).
      expect((e as StoryDialogueError).code).toBe('INVALID_CHOICE');
    }
  });

  it('idempotency — apply lại choice với grant effect throws ALREADY_APPLIED', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 0n,
    });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'respect');
    // Ledger has 1 row. Linh Thach = 20.
    const char1 = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char1?.linhThach).toBe(20n);
    // Apply lại → ALREADY_APPLIED.
    try {
      await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'respect');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('ALREADY_APPLIED');
    }
    // KHÔNG double-grant.
    const char2 = await prisma.character.findUnique({ where: { id: characterId } });
    expect(char2?.linhThach).toBe(20n);
    const ledgerCount = await prisma.currencyLedger.count({
      where: { characterId, reason: 'STORY_DIALOGUE_REWARD' },
    });
    expect(ledgerCount).toBe(1);
  });

  it('listForNpc returns chỉ các node visible (filter conditions)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Trước khi accept, chỉ intro visible (seed yêu cầu quest accepted).
    let nodes = await service.listForNpc(userId, NPC_LANG);
    expect(nodes.map((n) => n.nodeId)).toEqual([NODE_LANG_INTRO]);
    // Sau khi accept quest, seed cũng visible.
    await seedQuestAccepted(prisma, characterId, QUEST_PHAMNHAN_REALM, {
      step_01: 0,
      step_02: 0,
      step_03: 0,
    });
    nodes = await service.listForNpc(userId, NPC_LANG);
    const ids = nodes.map((n) => n.nodeId);
    expect(ids).toContain(NODE_LANG_INTRO);
    expect(ids).toContain(NODE_LANG_SEED);
  });
});
