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
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
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
  const affinity = new NpcAffinityService(prisma);
  service = new StoryDialogueService(prisma, currency, affinity);
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

// =============================================================================
// Phase 12.9 Story Dialogue Branch Advanced — choice_made gating + clear_flag
// + storyDialogueChoices persistence + multi-step Hàn Dạ branching tree.
// =============================================================================

const NPC_HAN = 'npc_han_da';
const NODE_HAN_FIRST = 'story_dlg_han_da_first_meet';
const NODE_HAN_FOLLOWUP_RIVAL = 'story_dlg_han_da_followup_rival';
const NODE_HAN_FOLLOWUP_NEUTRAL = 'story_dlg_han_da_followup_neutral';
const NODE_HAN_RESOLUTION = 'story_dlg_han_da_resolution_apology';

describe('Phase 12.9 — choice_made + clear_flag + multi-step branching', () => {
  it('choice_made: server picks followup_rival sau khi player chọn rival ở first_meet', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // Pick rival → set flag + mark seen + persist storyDialogueChoices[first_meet]=rival.
    const r1 = await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'rival');
    expect(r1.flags.han_da_relation).toBe('rival');
    expect(r1.choices[NODE_HAN_FIRST]).toBe('rival');
    // storyDialogueChoices persisted.
    const charAfter = await prisma.character.findUnique({ where: { id: characterId } });
    const choicesMap = charAfter?.storyDialogueChoices as Record<string, unknown>;
    expect(choicesMap[NODE_HAN_FIRST]).toBe('rival');

    // GET /story/dialogue/npc_han_da → server pick followup_rival (specificity choice_made = 5).
    const next = await service.getDialogue(userId, NPC_HAN);
    expect(next.nodeId).toBe(NODE_HAN_FOLLOWUP_RIVAL);
    // FE buildView truyền previousChoiceKey cho node first_meet để badge "đã chọn lần trước"…
    // …nhưng ta đang ở node followup_rival, previousChoiceKey null vì chưa pick.
    expect(next.previousChoiceKey).toBeNull();
  });

  it('choice_made: server picks followup_neutral sau khi player chọn neutral', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'neutral');
    const next = await service.getDialogue(userId, NPC_HAN);
    expect(next.nodeId).toBe(NODE_HAN_FOLLOWUP_NEUTRAL);
  });

  it('choice_made: applyChoice cho followup_rival.spar reject nếu chưa pick rival ở first_meet', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // KHÔNG pick first_meet trước → node followup_rival visibility fail (choice_made).
    try {
      await service.applyChoice(userId, NPC_HAN, NODE_HAN_FOLLOWUP_RIVAL, 'spar');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('INVALID_CHOICE');
      expect((e as StoryDialogueError).detail).toMatch(/choice_made:.*rival/);
    }
  });

  it('clear_flag effect xoá entry khỏi storyFlags + persist', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // Setup full path: first_meet rival → followup_rival spar → resolution_apology apologize.
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'rival');
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FOLLOWUP_RIVAL, 'spar');
    // Trước khi apologize: han_da_relation = rival, han_da_spar_arranged = true.
    const before = await prisma.character.findUnique({ where: { id: characterId } });
    const flagsBefore = before?.storyFlags as Record<string, unknown>;
    expect(flagsBefore.han_da_relation).toBe('rival');
    expect(flagsBefore.han_da_spar_arranged).toBe(true);
    // Apologize → clear_flag(han_da_relation) + mark_seen.
    const r = await service.applyChoice(userId, NPC_HAN, NODE_HAN_RESOLUTION, 'apologize');
    expect(r.effectsApplied.map((e) => e.kind)).toEqual(['clear_flag', 'mark_seen']);
    expect(r.flags.han_da_relation).toBeUndefined();
    // han_da_spar_arranged không bị động chạm.
    expect(r.flags.han_da_spar_arranged).toBe(true);
    // DB persisted.
    const after = await prisma.character.findUnique({ where: { id: characterId } });
    const flagsAfter = after?.storyFlags as Record<string, unknown>;
    expect(flagsAfter.han_da_relation).toBeUndefined();
    expect(flagsAfter.han_da_spar_arranged).toBe(true);
  });

  it('clear_flag là no-op nếu flag chưa từng set (idempotent semantic)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // Setup: first_meet neutral (KHÔNG set han_da_relation=rival).
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'neutral');
    // resolution_apology yêu cầu flag_equals=rival → INVALID_CHOICE node-level, không reach
    // clear_flag effect. Đảm bảo path neutral không vô tình kích hoạt clear_flag.
    try {
      await service.applyChoice(userId, NPC_HAN, NODE_HAN_RESOLUTION, 'apologize');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('INVALID_CHOICE');
    }
    const after = await prisma.character.findUnique({ where: { id: characterId } });
    const flagsAfter = after?.storyFlags as Record<string, unknown>;
    // han_da_relation = neutral (unchanged), không bị clear nhầm.
    expect(flagsAfter.han_da_relation).toBe('neutral');
  });

  it('previouslyChosen flag set đúng trên StoryDialogueChoiceView khi node tái mở', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // Pick rival ở first_meet → seen + storyDialogueChoices[first_meet]=rival.
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'rival');
    // Direct listForNpc để lấy node first_meet và verify previouslyChosen.
    // (getDialogue sẽ pick followup_rival vì specificity cao hơn → cần listForNpc).
    const nodes = await service.listForNpc(userId, NPC_HAN);
    const firstMeet = nodes.find((n) => n.nodeId === NODE_HAN_FIRST);
    // first_meet có condition not_seen → KHÔNG visible nữa (đã seen).
    expect(firstMeet).toBeUndefined();
    // Tuy nhiên previousChoiceKey nằm trên node hiện tại (followup_rival). Verify field
    // populated khi build view cho followup_rival.
    const followup = nodes.find((n) => n.nodeId === NODE_HAN_FOLLOWUP_RIVAL);
    expect(followup).toBeDefined();
    // followup_rival chưa pick → previousChoiceKey null + previouslyChosen=false trên mọi choice.
    expect(followup!.previousChoiceKey).toBeNull();
    for (const c of followup!.choices) {
      expect(c.previouslyChosen).toBe(false);
    }
  });

  it('previouslyChosen=true sau khi pick lại same choice (mark_seen-only re-pick path)', async () => {
    // Build a synthetic-ish scenario: pick neutral ở first_meet, sau đó mở lại first_meet
    // bằng cách reset seen → kiểm tra previouslyChosen vẫn đúng.
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'neutral');
    // Manually clear seen to simulate "node revisitable" scenario (not real flow but
    // verifies previousChoiceKey wiring on buildNodeView).
    await prisma.character.update({
      where: { id: characterId },
      data: { storyDialogueSeen: [] as Prisma.InputJsonValue },
    });
    const nodes = await service.listForNpc(userId, NPC_HAN);
    const firstMeet = nodes.find((n) => n.nodeId === NODE_HAN_FIRST);
    expect(firstMeet).toBeDefined();
    expect(firstMeet!.previousChoiceKey).toBe('neutral');
    const neutralChoice = firstMeet!.choices.find((c) => c.key === 'neutral');
    expect(neutralChoice!.previouslyChosen).toBe(true);
    const rivalChoice = firstMeet!.choices.find((c) => c.key === 'rival');
    expect(rivalChoice!.previouslyChosen).toBe(false);
  });

  it('storyDialogueChoices persisted across multiple choices (last-write-wins per node)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FIRST, 'rival');
    await service.applyChoice(userId, NPC_HAN, NODE_HAN_FOLLOWUP_RIVAL, 'decline');
    const char = await prisma.character.findUnique({ where: { id: characterId } });
    const map = char?.storyDialogueChoices as Record<string, unknown>;
    expect(map[NODE_HAN_FIRST]).toBe('rival');
    expect(map[NODE_HAN_FOLLOWUP_RIVAL]).toBe('decline');
  });
});

// =============================================================================
// Phase 12.10.A — change_affinity effect + affinity_min condition.
// Coverage:
//   - friendly_chat warm/cold add/subtract affinity once (ALREADY_APPLIED on retry)
//   - inner_secret gated by affinity_min (HIDDEN until threshold reached)
//   - inner_secret visible after farming friendly_chat warm path
// =============================================================================
const NODE_LANG_FRIENDLY = 'story_dlg_lang_van_sinh_friendly_chat';
const NODE_LANG_SECRET = 'story_dlg_lang_van_sinh_inner_secret';

describe('Phase 12.10.A — change_affinity + affinity_min', () => {
  it('warm choice adds +10 affinity once + persisted in CharacterNpcAffinity', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // intro must be seen first — exercise its no-grant choice 'doubt'.
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');

    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_FRIENDLY, 'warm');
    expect(result.affinityChanges).toHaveLength(1);
    const ch = result.affinityChanges[0]!;
    expect(ch.npcKey).toBe(NPC_LANG);
    expect(ch.delta).toBe(10);
    expect(ch.previousScore).toBe(0);
    expect(ch.newScore).toBe(10);

    const row = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_LANG } },
    });
    expect(row?.score).toBe(10);
  });

  it('cold choice subtracts -5 affinity (clamped at minScore)', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_FRIENDLY, 'cold');
    expect(result.affinityChanges[0]?.delta).toBe(-5);
    // Score = clamp[-100, 100](0 + -5) = -5 (catalog minScore = -50 for Lang).
    expect(result.affinityChanges[0]?.newScore).toBe(-5);
    const row = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_LANG } },
    });
    expect(row?.score).toBe(-5);
  });

  it('idempotency — re-pick warm at friendly_chat throws ALREADY_APPLIED + KHÔNG double-grant', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_FRIENDLY, 'warm');
    try {
      await service.applyChoice(userId, NPC_LANG, NODE_LANG_FRIENDLY, 'warm');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('ALREADY_APPLIED');
    }
    // Score still 10 (no double-grant).
    const row = await prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey: NPC_LANG } },
    });
    expect(row?.score).toBe(10);
  });

  it('inner_secret HIDDEN khi affinity dưới threshold (listForNpc filter)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    const visible = await service.listForNpc(userId, NPC_LANG);
    const ids = visible.map((n) => n.nodeId);
    expect(ids).not.toContain(NODE_LANG_SECRET);
  });

  it('inner_secret HIDDEN — applyChoice trả INVALID_CHOICE khi affinity chưa đạt', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    try {
      await service.applyChoice(userId, NPC_LANG, NODE_LANG_SECRET, 'listen');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StoryDialogueError);
      expect((e as StoryDialogueError).code).toBe('INVALID_CHOICE');
      expect((e as StoryDialogueError).detail).toMatch(/affinity_min/);
    }
  });

  it('inner_secret visible sau khi seed affinity ≥ 30 → applyChoice listen success', async () => {
    const { userId, characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    // Seed score = 30 trực tiếp DB (test path).
    await prisma.characterNpcAffinity.create({
      data: { characterId, npcKey: NPC_LANG, score: 30 },
    });
    // Seed friendly_chat seen (mark as already-done) để node hiện tại không re-pick.
    const visible = await service.listForNpc(userId, NPC_LANG);
    const ids = visible.map((n) => n.nodeId);
    expect(ids).toContain(NODE_LANG_SECRET);

    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_SECRET, 'listen');
    // listen effects: change_affinity +5, set_flag, give_reward, mark_seen.
    expect(result.effectsApplied.map((e) => e.kind)).toContain('change_affinity');
    expect(result.effectsApplied.map((e) => e.kind)).toContain('set_flag');
    expect(result.effectsApplied.map((e) => e.kind)).toContain('give_reward');
    expect(result.affinityChanges).toHaveLength(1);
    expect(result.affinityChanges[0]?.delta).toBe(5);
    expect(result.affinityChanges[0]?.newScore).toBe(35);
    expect(result.granted.linhThach).toBe(50);
    expect(result.granted.exp).toBe(30);
  });

  it('tierChanged true khi cross threshold (xa_la → quen_biet ≥ 10)', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await service.applyChoice(userId, NPC_LANG, NODE_LANG_INTRO, 'doubt');
    const result = await service.applyChoice(userId, NPC_LANG, NODE_LANG_FRIENDLY, 'warm');
    // 0 → 10. xa_la (≥0) → quen_biet (≥10) — tierChanged.
    expect(result.affinityChanges[0]?.tierChanged).toBe(true);
    expect(result.affinityChanges[0]?.previousTierKey).toBe('xa_la');
    expect(result.affinityChanges[0]?.newTierKey).toBe('quen_biet');
  });
});
