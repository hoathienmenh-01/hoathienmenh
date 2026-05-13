/**
 * Phase 33.0 — Tu Tiên Lộ Quyển II–IV quest expansion catalog.
 *
 * Catalog static cho tất cả quest mở rộng từ Chap 9–27. Tuân thủ cấu trúc:
 *   - Mỗi chap có 5 main quest (`q_chXX_main_01..05`) đẩy breakthrough cảnh giới.
 *   - 3 side quest (`q_chXX_side_01..03`) sâu hơn NPC / gameplay.
 *   - 1 hidden quest (`q_chXX_hidden_01`) gắn cơ duyên (affinity/flag/karma).
 *   - 1 daily quest (`q_chXX_daily_01`) — cap 1 lần/ngày sau khi clear chap.
 *   - 1 weekly quest (`q_chXX_weekly_01`) — cap 1 lần/tuần sau khi clear chap.
 *
 * Reward cap theo `Phase33RewardPolicyKey`:
 *   - quyen_ii: main ≤ 4_000 linhThach, side ≤ 1_800, hidden ≤ 2_500
 *   - quyen_iii: main ≤ 7_500 linhThach, side ≤ 3_200, hidden ≤ 4_500
 *   - quyen_iv: main ≤ 12_000 linhThach, side ≤ 5_500, hidden ≤ 7_500
 *
 * Layer này KHÔNG bơm reward trực tiếp; mọi grant đi qua RewardLedger ở runtime
 * service (Phase 33 follow-up). Catalog chỉ khai báo `rewards` để UI hiển thị
 * và để service áp ledger idempotent.
 *
 * Test: `story-quest-expansion.test.ts` enforce 95 main / 57 side / 19 hidden /
 * 19 daily / 19 weekly, key unique, NPC/boss/region/dungeon refs resolve, reward
 * cap, daily/weekly cap.
 */

import { STORY_CHAPTERS_V2 } from './story-chapters-quyen-ii-iv';
import type { Phase33RewardPolicyKey } from './story-chapters-quyen-ii-iv';

export type Phase33QuestKind = 'main' | 'side' | 'hidden' | 'daily' | 'weekly';

export type Phase33StepKind =
  | 'talk'
  | 'kill'
  | 'collect'
  | 'explore'
  | 'choice'
  | 'dungeon_clear'
  | 'boss_defeat'
  | 'flag_set';

export type Phase33TargetType =
  | 'npc'
  | 'monster'
  | 'item'
  | 'region'
  | 'choice'
  | 'dungeon'
  | 'boss'
  | 'flag';

export interface Phase33QuestStepDef {
  id: string;
  kind: Phase33StepKind;
  targetType: Phase33TargetType;
  /** ID phụ thuộc `targetType`. */
  targetId: string;
  count: number;
  descriptionVi: string;
  descriptionEn: string;
}

export interface Phase33ItemReward {
  itemKey: string;
  qty: number;
  /** Bind on pickup. Mặc định `true` cho main reward. */
  bind?: boolean;
}

export interface Phase33AffinityDelta {
  npcKey: string;
  delta: number;
}

export interface Phase33FactionDelta {
  factionKey: string;
  delta: number;
}

export interface Phase33QuestReward {
  linhThach?: number;
  exp?: number;
  congHien?: number;
  items?: readonly Phase33ItemReward[];
  affinity?: readonly Phase33AffinityDelta[];
  faction?: readonly Phase33FactionDelta[];
  storyFlags?: readonly string[];
}

export interface Phase33QuestDef {
  questKey: string;
  kind: Phase33QuestKind;
  chapKey: string;
  volumeKey: string;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  giverNpcKey: string;
  requiredRealmKey: string;
  requiredRealmOrder: number;
  prerequisiteQuestKey: string | null;
  /** Story flag cần bật để mở quest này (hidden quest dùng nhiều). */
  requiredStoryFlags: readonly string[];
  /** Hidden quest đôi khi gate bằng affinity NPC. */
  requiredAffinityNpcKey: string | null;
  requiredAffinityScore: number | null;
  steps: readonly Phase33QuestStepDef[];
  rewards: Phase33QuestReward;
  rewardPolicyKey: Phase33RewardPolicyKey;
  /** Daily quest cap. Null nếu không phải daily. */
  dailyCap: number | null;
  /** Weekly quest cap. Null nếu không phải weekly. */
  weeklyCap: number | null;
  /** Trigger UI tooltip cho hidden quest. */
  hiddenTriggerHintVi: string | null;
  hiddenTriggerHintEn: string | null;
  loreSummaryVi: string;
  loreSummaryEn: string;
}

/* ─────────────────────────── builders ─────────────────────────── */

interface Phase33ChapterTemplate {
  chapKey: string;
  chapNumber: number;
  volumeKey: string;
  realmKey: string;
  realmOrder: number;
  rewardPolicyKey: Phase33RewardPolicyKey;
  primaryNpc: string;
  secondaryNpc: string;
  hiddenNpc: string;
  boss: string;
  storyDungeon: string;
  region: string;
  monster: string;
  collectItem: string;
  mainRewardItem: string;
  sideRewardItem: string;
  hiddenRewardItem: string;
  dailyRewardItem: string;
  weeklyRewardItem: string;
  mainTitleVi: string;
  mainTitleEn: string;
  hiddenHintVi: string;
  hiddenHintEn: string;
  storyFlagIntro: string;
  storyFlagCleared: string;
  storyFlagHidden: string;
  affinityNpcForHidden: string;
  affinityScore: number;
}

const REWARD_CAP: Record<
  Phase33RewardPolicyKey,
  { main: number; side: number; hidden: number; daily: number; weekly: number; exp: number }
> = {
  reward_policy_quyen_ii: { main: 4_000, side: 1_800, hidden: 2_500, daily: 350, weekly: 1_500, exp: 4_500 },
  reward_policy_quyen_iii: { main: 7_500, side: 3_200, hidden: 4_500, daily: 600, weekly: 2_800, exp: 8_500 },
  reward_policy_quyen_iv: { main: 12_000, side: 5_500, hidden: 7_500, daily: 1_000, weekly: 4_500, exp: 14_000 },
};

function mainQuestsFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');
  const baseRewardLinhThach = Math.floor(cap.main * 0.45);
  const baseRewardExp = Math.floor(cap.exp * 0.4);
  const flagsIntro = [t.storyFlagIntro];
  const flagsCleared = [t.storyFlagCleared];

  function step(
    seq: number,
    kind: Phase33StepKind,
    targetType: Phase33TargetType,
    targetId: string,
    count: number,
    descVi: string,
    descEn: string,
  ): Phase33QuestStepDef {
    return {
      id: `step_${seq}`,
      kind,
      targetType,
      targetId,
      count,
      descriptionVi: descVi,
      descriptionEn: descEn,
    };
  }

  const q1: Phase33QuestDef = {
    questKey: `q_ch${padded}_main_01`,
    kind: 'main',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `${t.mainTitleVi} — Mở mạch`,
    titleEn: `${t.mainTitleEn} — Open the Vein`,
    descriptionVi: `Khởi đầu Chap ${t.chapNumber}: gặp ${t.primaryNpc} để nhận tin tức và mở cờ cốt truyện.`,
    descriptionEn: `Open Chap ${t.chapNumber}: meet ${t.primaryNpc} for the briefing and the chapter intro flag.`,
    giverNpcKey: t.primaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: null,
    requiredStoryFlags: [],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      step(
        1,
        'talk',
        'npc',
        t.primaryNpc,
        1,
        `Gặp ${t.primaryNpc} tại ${t.region}.`,
        `Meet ${t.primaryNpc} at ${t.region}.`,
      ),
      step(
        2,
        'flag_set',
        'flag',
        t.storyFlagIntro,
        1,
        `Ghi nhận tình huống mở chương.`,
        `Record the chapter intro.`,
      ),
    ],
    rewards: {
      linhThach: Math.floor(baseRewardLinhThach * 0.5),
      exp: Math.floor(baseRewardExp * 0.5),
      congHien: 8,
      storyFlags: flagsIntro,
      affinity: [{ npcKey: t.primaryNpc, delta: 4 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Mở chương Chap ${t.chapNumber} — đặt cờ cốt truyện và kéo người chơi vào sự kiện chính.`,
    loreSummaryEn: `Chapter ${t.chapNumber} opener — sets the story flag and pulls the player into the main event.`,
  };

  const q2: Phase33QuestDef = {
    questKey: `q_ch${padded}_main_02`,
    kind: 'main',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `${t.mainTitleVi} — Lần dấu`,
    titleEn: `${t.mainTitleEn} — Trace the Threads`,
    descriptionVi: `Đi vào ${t.region}, hạ đám ${t.monster} cản đường để lấy chứng cứ.`,
    descriptionEn: `Enter ${t.region} and clear ${t.monster} packs for evidence.`,
    giverNpcKey: t.primaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: q1.questKey,
    requiredStoryFlags: [t.storyFlagIntro],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      step(
        1,
        'explore',
        'region',
        t.region,
        1,
        `Khảo sát ${t.region} để tìm dấu Tịch Thiên Điện.`,
        `Survey ${t.region} for Tịch Thiên signs.`,
      ),
      step(
        2,
        'kill',
        'monster',
        t.monster,
        6,
        `Hạ ${t.monster} canh giữ khu vực.`,
        `Defeat ${t.monster} guards.`,
      ),
      step(
        3,
        'collect',
        'item',
        t.collectItem,
        2,
        `Thu hồi vật chứng quan trọng.`,
        `Collect key evidence.`,
      ),
    ],
    rewards: {
      linhThach: Math.floor(baseRewardLinhThach * 0.6),
      exp: Math.floor(baseRewardExp * 0.7),
      congHien: 10,
      affinity: [{ npcKey: t.primaryNpc, delta: 3 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Thu thập chứng cứ tại ${t.region}, củng cố tuyến điều tra.`,
    loreSummaryEn: `Collect evidence at ${t.region} to firm the investigation.`,
  };

  const q3: Phase33QuestDef = {
    questKey: `q_ch${padded}_main_03`,
    kind: 'main',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `${t.mainTitleVi} — Đối thoại`,
    titleEn: `${t.mainTitleEn} — Council`,
    descriptionVi: `Trở về gặp ${t.secondaryNpc}, đàm sách lược trước khi vào bí cảnh ${t.storyDungeon}.`,
    descriptionEn: `Return to ${t.secondaryNpc} to plan before entering ${t.storyDungeon}.`,
    giverNpcKey: t.secondaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: q2.questKey,
    requiredStoryFlags: [t.storyFlagIntro],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      step(
        1,
        'talk',
        'npc',
        t.secondaryNpc,
        1,
        `Bàn kế với ${t.secondaryNpc}.`,
        `Plan with ${t.secondaryNpc}.`,
      ),
      step(
        2,
        'choice',
        'choice',
        `choice_ch${padded}_main_03_approach`,
        1,
        `Chọn lối tiếp cận: cứng rắn hoặc khéo léo.`,
        `Pick the approach: hard line or soft hand.`,
      ),
    ],
    rewards: {
      linhThach: Math.floor(baseRewardLinhThach * 0.55),
      exp: Math.floor(baseRewardExp * 0.65),
      congHien: 9,
      affinity: [
        { npcKey: t.secondaryNpc, delta: 4 },
        { npcKey: t.primaryNpc, delta: 2 },
      ],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Chọn cách tiếp cận quyết định khắc hoạ NPC và affinity về sau.`,
    loreSummaryEn: `The chosen approach colors NPCs and downstream affinity.`,
  };

  const q4: Phase33QuestDef = {
    questKey: `q_ch${padded}_main_04`,
    kind: 'main',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `${t.mainTitleVi} — Bí cảnh`,
    titleEn: `${t.mainTitleEn} — Story Dungeon`,
    descriptionVi: `Vào bí cảnh ${t.storyDungeon}, tiếp cận trận pháp chính.`,
    descriptionEn: `Enter ${t.storyDungeon} and reach the core array.`,
    giverNpcKey: t.primaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: q3.questKey,
    requiredStoryFlags: [t.storyFlagIntro],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      step(
        1,
        'dungeon_clear',
        'dungeon',
        t.storyDungeon,
        1,
        `Hoàn thành bí cảnh ${t.storyDungeon}.`,
        `Clear story dungeon ${t.storyDungeon}.`,
      ),
    ],
    rewards: {
      linhThach: Math.floor(baseRewardLinhThach * 0.85),
      exp: Math.floor(baseRewardExp * 0.95),
      congHien: 14,
      items: [{ itemKey: t.mainRewardItem, qty: 1, bind: true }],
      affinity: [{ npcKey: t.primaryNpc, delta: 4 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Bí cảnh chính của chap — phần hành động chính tuyến.`,
    loreSummaryEn: `Main story dungeon — primary action beat.`,
  };

  const q5: Phase33QuestDef = {
    questKey: `q_ch${padded}_main_05`,
    kind: 'main',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `${t.mainTitleVi} — Đoạn kết`,
    titleEn: `${t.mainTitleEn} — Climax`,
    descriptionVi: `Hạ ${t.boss}, đóng cờ kết chương ${t.chapNumber}.`,
    descriptionEn: `Defeat ${t.boss} and set the Chapter ${t.chapNumber} clear flag.`,
    giverNpcKey: t.primaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: q4.questKey,
    requiredStoryFlags: [t.storyFlagIntro],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      step(
        1,
        'boss_defeat',
        'boss',
        t.boss,
        1,
        `Đánh bại ${t.boss}.`,
        `Defeat ${t.boss}.`,
      ),
      step(
        2,
        'flag_set',
        'flag',
        t.storyFlagCleared,
        1,
        `Ghi nhận chương đã đóng.`,
        `Set the chapter clear flag.`,
      ),
    ],
    rewards: {
      linhThach: cap.main,
      exp: cap.exp,
      congHien: 22,
      items: [{ itemKey: t.mainRewardItem, qty: 1, bind: true }],
      storyFlags: flagsCleared,
      affinity: [{ npcKey: t.primaryNpc, delta: 6 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Kết chương: hạ boss, set cờ clear, mở chap sau.`,
    loreSummaryEn: `Chapter climax: boss down, clear flag set, next chapter unlocks.`,
  };

  return [q1, q2, q3, q4, q5];
}

function sideQuestsFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');

  function side(
    seq: number,
    titleVi: string,
    titleEn: string,
    giverNpc: string,
    descVi: string,
    descEn: string,
    steps: readonly Phase33QuestStepDef[],
    extraAffinity: readonly Phase33AffinityDelta[],
  ): Phase33QuestDef {
    return {
      questKey: `q_ch${padded}_side_0${seq}`,
      kind: 'side',
      chapKey: t.chapKey,
      volumeKey: t.volumeKey,
      titleVi,
      titleEn,
      descriptionVi: descVi,
      descriptionEn: descEn,
      giverNpcKey: giverNpc,
      requiredRealmKey: t.realmKey,
      requiredRealmOrder: t.realmOrder,
      prerequisiteQuestKey: `q_ch${padded}_main_01`,
      requiredStoryFlags: [t.storyFlagIntro],
      requiredAffinityNpcKey: null,
      requiredAffinityScore: null,
      steps,
      rewards: {
        linhThach: Math.floor(cap.side * (0.7 + seq * 0.1)),
        exp: Math.floor(cap.exp * 0.18),
        congHien: 6,
        items: [{ itemKey: t.sideRewardItem, qty: 1, bind: true }],
        affinity: extraAffinity,
      },
      rewardPolicyKey: t.rewardPolicyKey,
      dailyCap: null,
      weeklyCap: null,
      hiddenTriggerHintVi: null,
      hiddenTriggerHintEn: null,
      loreSummaryVi: `Side quest đào sâu NPC / địa điểm trong Chap ${t.chapNumber}.`,
      loreSummaryEn: `Side quest deepening an NPC or location in Chapter ${t.chapNumber}.`,
    };
  }

  const s1 = side(
    1,
    `Chap ${t.chapNumber} — Việc của ${t.primaryNpc}`,
    `Chapter ${t.chapNumber} — Errand for ${t.primaryNpc}`,
    t.primaryNpc,
    `Giúp ${t.primaryNpc} xử việc phụ liên quan đến ${t.region}.`,
    `Help ${t.primaryNpc} with a side matter at ${t.region}.`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.primaryNpc, count: 1, descriptionVi: 'Nghe yêu cầu.', descriptionEn: 'Get the brief.' },
      { id: 'step_2', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 4, descriptionVi: `Dọn ${t.monster}.`, descriptionEn: `Clear ${t.monster}.` },
    ],
    [{ npcKey: t.primaryNpc, delta: 4 }],
  );

  const s2 = side(
    2,
    `Chap ${t.chapNumber} — Tâm sự với ${t.secondaryNpc}`,
    `Chapter ${t.chapNumber} — Counsel with ${t.secondaryNpc}`,
    t.secondaryNpc,
    `${t.secondaryNpc} có chuyện riêng — lắng nghe và đóng cờ tâm trạng.`,
    `${t.secondaryNpc} has a personal matter — listen and lock the mood flag.`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.secondaryNpc, count: 1, descriptionVi: 'Lắng nghe.', descriptionEn: 'Listen.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_side_02_mood`, count: 1, descriptionVi: 'Chọn cách phản hồi.', descriptionEn: 'Pick a response.' },
    ],
    [{ npcKey: t.secondaryNpc, delta: 5 }],
  );

  const s3 = side(
    3,
    `Chap ${t.chapNumber} — Người trong cuộc`,
    `Chapter ${t.chapNumber} — Insider`,
    t.hiddenNpc,
    `${t.hiddenNpc} đề cập một vụ việc bên lề ${t.region} — quyết định ảnh hưởng affinity về sau.`,
    `${t.hiddenNpc} brings up a side matter near ${t.region} — your choice ripples in affinity later.`,
    [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: `Khảo sát ${t.region}.`, descriptionEn: `Survey ${t.region}.` },
      { id: 'step_2', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Lấy vật chứng.', descriptionEn: 'Take evidence.' },
      { id: 'step_3', kind: 'talk', targetType: 'npc', targetId: t.hiddenNpc, count: 1, descriptionVi: 'Báo cáo.', descriptionEn: 'Report.' },
    ],
    [{ npcKey: t.hiddenNpc, delta: 6 }],
  );

  return [s1, s2, s3];
}

function hiddenQuestFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');

  const hidden: Phase33QuestDef = {
    questKey: `q_ch${padded}_hidden_01`,
    kind: 'hidden',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `Cơ duyên Chap ${t.chapNumber} — Bóng cũ`,
    titleEn: `Karma Chap ${t.chapNumber} — Old Shadow`,
    descriptionVi: `Khi affinity ${t.affinityNpcForHidden} đủ ${t.affinityScore}+, một tuyến ẩn hé lộ.`,
    descriptionEn: `When affinity with ${t.affinityNpcForHidden} reaches ${t.affinityScore}+, a hidden route opens.`,
    giverNpcKey: t.affinityNpcForHidden,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: `q_ch${padded}_main_03`,
    requiredStoryFlags: [t.storyFlagIntro],
    requiredAffinityNpcKey: t.affinityNpcForHidden,
    requiredAffinityScore: t.affinityScore,
    steps: [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Đi theo manh mối bóng cũ.', descriptionEn: 'Follow the old shadow.' },
      { id: 'step_2', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Lấy vật ký ức.', descriptionEn: 'Recover memory token.' },
      { id: 'step_3', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_hidden_01_truth`, count: 1, descriptionVi: 'Chọn nói thật hay giấu kín.', descriptionEn: 'Reveal or conceal the truth.' },
      { id: 'step_4', kind: 'flag_set', targetType: 'flag', targetId: t.storyFlagHidden, count: 1, descriptionVi: 'Đóng cờ tuyến ẩn.', descriptionEn: 'Set the hidden route flag.' },
    ],
    rewards: {
      linhThach: cap.hidden,
      exp: Math.floor(cap.exp * 0.4),
      congHien: 16,
      items: [{ itemKey: t.hiddenRewardItem, qty: 1, bind: true }],
      storyFlags: [t.storyFlagHidden],
      affinity: [{ npcKey: t.affinityNpcForHidden, delta: 8 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: t.hiddenHintVi,
    hiddenTriggerHintEn: t.hiddenHintEn,
    loreSummaryVi: `Cơ duyên Chap ${t.chapNumber} — gắn affinity và mở mảnh ký ức.`,
    loreSummaryEn: `Chapter ${t.chapNumber} karma — affinity gated memory shard.`,
  };

  return [hidden];
}

function dailyQuestFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');

  const daily: Phase33QuestDef = {
    questKey: `q_ch${padded}_daily_01`,
    kind: 'daily',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `Chap ${t.chapNumber} — Tuần tra hằng ngày`,
    titleEn: `Chapter ${t.chapNumber} — Daily Patrol`,
    descriptionVi: `Sau khi clear chap, quét ${t.region} một vòng để duy trì trật tự.`,
    descriptionEn: `After clearing the chapter, sweep ${t.region} to keep order.`,
    giverNpcKey: t.secondaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: `q_ch${padded}_main_05`,
    requiredStoryFlags: [t.storyFlagCleared],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      { id: 'step_1', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 5, descriptionVi: `Dẹp ${t.monster}.`, descriptionEn: `Clear ${t.monster}.` },
      { id: 'step_2', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Tuần tra một vòng.', descriptionEn: 'Patrol once.' },
    ],
    rewards: {
      linhThach: cap.daily,
      exp: Math.floor(cap.exp * 0.06),
      congHien: 2,
      items: [{ itemKey: t.dailyRewardItem, qty: 1, bind: true }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: 1,
    weeklyCap: null,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Daily lặp lại — cap 1 lần/ngày để giữ kinh tế.`,
    loreSummaryEn: `Daily repeatable — cap 1/day to preserve economy.`,
  };

  return [daily];
}

function weeklyQuestFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');

  const weekly: Phase33QuestDef = {
    questKey: `q_ch${padded}_weekly_01`,
    kind: 'weekly',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `Chap ${t.chapNumber} — Tuần lễ thanh tẩy`,
    titleEn: `Chapter ${t.chapNumber} — Weekly Cleanse`,
    descriptionVi: `Tuần lễ: hạ trùm phụ ${t.boss} tái xuất ở ${t.region} (giảm sức mạnh).`,
    descriptionEn: `Weekly: defeat a weakened replay of ${t.boss} at ${t.region}.`,
    giverNpcKey: t.primaryNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: `q_ch${padded}_main_05`,
    requiredStoryFlags: [t.storyFlagCleared],
    requiredAffinityNpcKey: null,
    requiredAffinityScore: null,
    steps: [
      { id: 'step_1', kind: 'boss_defeat', targetType: 'boss', targetId: t.boss, count: 1, descriptionVi: `Đánh bại ${t.boss} (chế độ tuần lễ).`, descriptionEn: `Defeat ${t.boss} (weekly replay).` },
    ],
    rewards: {
      linhThach: cap.weekly,
      exp: Math.floor(cap.exp * 0.18),
      congHien: 8,
      items: [{ itemKey: t.weeklyRewardItem, qty: 1, bind: true }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: 1,
    hiddenTriggerHintVi: null,
    hiddenTriggerHintEn: null,
    loreSummaryVi: `Weekly lặp lại — cap 1 lần/tuần, không drop top tier.`,
    loreSummaryEn: `Weekly repeatable — cap 1/week, no top-tier drops.`,
  };

  return [weekly];
}

/* ─────────────────────────── chapter templates ─────────────────────────── */

const CHAPTER_TEMPLATES: readonly Phase33ChapterTemplate[] = [
  {
    chapKey: 'ch09', chapNumber: 9, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'do_kiep', realmOrder: 9,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_moc_thanh_y',
    hiddenNpc: 'npc_han_da',
    boss: 'boss_thien_kiep_hoa_than',
    storyDungeon: 'ch09_cuu_trong_thien_kiep',
    region: 'region_cuu_trong_kiep_dai',
    monster: 'monster_thien_loi_yeu',
    collectItem: 'item_tich_thien_an_phan',
    mainRewardItem: 'reward_item_thien_kiep_dan',
    sideRewardItem: 'reward_item_loi_quang_thach',
    hiddenRewardItem: 'reward_item_thien_kiep_tan_anh',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_thien_kiep_tinh_hoa',
    mainTitleVi: 'Chap 9 — Cửu Trọng Thiên Kiếp',
    mainTitleEn: 'Chap 9 — Nine-Layer Tribulation',
    hiddenHintVi: 'Khi Hàn Dạ đủ tin cậy, đêm trước thiên kiếp sẽ hé lộ một bóng cũ.',
    hiddenHintEn: 'When Hàn Dạ trusts you enough, the eve of tribulation reveals an old shadow.',
    storyFlagIntro: 'flag_ch09_intro',
    storyFlagCleared: 'flag_ch09_cleared',
    storyFlagHidden: 'route_ch09_inner_demon_resolved',
    affinityNpcForHidden: 'npc_han_da',
    affinityScore: 35,
  },
  {
    chapKey: 'ch10', chapNumber: 10, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'nhan_tien', realmOrder: 10,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_to_nguyet_ly',
    hiddenNpc: 'npc_luc_binh',
    boss: 'boss_tien_gioi_giam_cong',
    storyDungeon: 'ch10_phi_thang_doanh_mine_break',
    region: 'region_phi_thang_doanh',
    monster: 'monster_tien_dinh_giam_thu',
    collectItem: 'item_phi_thang_xich',
    mainRewardItem: 'reward_item_phi_thang_lenh',
    sideRewardItem: 'reward_item_tien_thach_so',
    hiddenRewardItem: 'reward_item_phi_thang_ky_uc',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_doan_xich',
    mainTitleVi: 'Chap 10 — Phi Thăng Doanh',
    mainTitleEn: 'Chap 10 — Ascension Camp',
    hiddenHintVi: 'Lục Bình giữ một mảnh xích cũ — đủ thân, hỏi sẽ kể.',
    hiddenHintEn: 'Lục Bình keeps an old chain shard — close enough, ask and she speaks.',
    storyFlagIntro: 'flag_ch10_intro',
    storyFlagCleared: 'flag_ch10_cleared',
    storyFlagHidden: 'route_ch10_saved_prisoners',
    affinityNpcForHidden: 'npc_luc_binh',
    affinityScore: 30,
  },
  {
    chapKey: 'ch11', chapNumber: 11, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'dia_tien', realmOrder: 11,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_moc_thanh_y',
    hiddenNpc: 'npc_to_nguyet_ly',
    boss: 'boss_dia_mach_tien_thu',
    storyDungeon: 'ch11_tieu_tien_mach_guardian',
    region: 'region_tieu_tien_mach',
    monster: 'monster_tien_thu_son_lam',
    collectItem: 'item_tien_mach_hoa',
    mainRewardItem: 'reward_item_tien_mach_an',
    sideRewardItem: 'reward_item_tien_hoa_kho',
    hiddenRewardItem: 'reward_item_tien_thu_minh_uoc',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_tien_mach_tinh_hoa',
    mainTitleVi: 'Chap 11 — Tiểu Tiên Mạch',
    mainTitleEn: 'Chap 11 — Minor Immortal Vein',
    hiddenHintVi: 'Tô Nguyệt Ly đọc được tâm tư tiên thú — đủ thân, đàm có thể thay diệt.',
    hiddenHintEn: 'Tô Nguyệt Ly reads the beast’s heart — close enough, parley replaces kill.',
    storyFlagIntro: 'flag_ch11_intro',
    storyFlagCleared: 'flag_ch11_cleared',
    storyFlagHidden: 'route_ch11_branch_palace_built',
    affinityNpcForHidden: 'npc_to_nguyet_ly',
    affinityScore: 28,
  },
  {
    chapKey: 'ch12', chapNumber: 12, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'thien_tien', realmOrder: 12,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_han_da',
    hiddenNpc: 'npc_van_kim_nuong',
    boss: 'boss_thien_mon_thu_tuong',
    storyDungeon: 'ch12_thien_mon_trial',
    region: 'region_thien_mon',
    monster: 'monster_thien_mon_ve_si',
    collectItem: 'item_thien_mon_thanh_lenh',
    mainRewardItem: 'reward_item_thien_thuat_so',
    sideRewardItem: 'reward_item_thien_mon_an',
    hiddenRewardItem: 'reward_item_van_kim_lenh',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_thien_mon_tinh',
    mainTitleVi: 'Chap 12 — Thiên Môn',
    mainTitleEn: 'Chap 12 — Heavenly Gate',
    hiddenHintVi: 'Vạn Kim Nương biết một tuyến luồn qua thuế Tiên Đình — cần affinity đủ.',
    hiddenHintEn: 'Vạn Kim Nương knows a route around the Tiên Đình tax — affinity required.',
    storyFlagIntro: 'flag_ch12_intro',
    storyFlagCleared: 'flag_ch12_cleared',
    storyFlagHidden: 'route_ch12_anti_tien_dinh',
    affinityNpcForHidden: 'npc_van_kim_nuong',
    affinityScore: 32,
  },
  {
    chapKey: 'ch13', chapNumber: 13, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'huyen_tien', realmOrder: 13,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_to_nguyet_ly',
    hiddenNpc: 'npc_hoa_thien_dao_to',
    boss: 'boss_huyen_co_khoi_loi',
    storyDungeon: 'ch13_thu_kho_cam',
    region: 'region_thu_kho_cam',
    monster: 'monster_thu_kho_thu_ho',
    collectItem: 'item_sach_co_xoa',
    mainRewardItem: 'reward_item_hoa_thien_co_kinh',
    sideRewardItem: 'reward_item_thu_kho_van',
    hiddenRewardItem: 'reward_item_dao_to_tan_anh_dau',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_thu_kho_tinh',
    mainTitleVi: 'Chap 13 — Sử Sách',
    mainTitleEn: 'Chap 13 — Histories Erased',
    hiddenHintVi: 'Hoa Thiên Đạo Tổ Tàn Ảnh đáp lời nếu ý chí Hoa Thiên đủ thuần.',
    hiddenHintEn: 'The Hoa Thiên Patriarch remnant answers when Hoa Thiên will is pure.',
    storyFlagIntro: 'flag_ch13_intro',
    storyFlagCleared: 'flag_ch13_cleared',
    storyFlagHidden: 'route_ch13_lineage_restored',
    affinityNpcForHidden: 'npc_hoa_thien_dao_to',
    affinityScore: 40,
  },
  {
    chapKey: 'ch14', chapNumber: 14, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'kim_tien', realmOrder: 14,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_moc_thanh_y',
    hiddenNpc: 'npc_han_da',
    boss: 'boss_kim_giap_tien_quan',
    storyDungeon: 'ch14_kim_than_tri',
    region: 'region_kim_than_tri',
    monster: 'monster_kim_giap_ve_si',
    collectItem: 'item_kim_than_dich',
    mainRewardItem: 'reward_item_kim_than_dan',
    sideRewardItem: 'reward_item_kim_than_phu',
    hiddenRewardItem: 'reward_item_kim_than_co_chu',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_kim_than_tinh',
    mainTitleVi: 'Chap 14 — Kim Thân',
    mainTitleEn: 'Chap 14 — Golden Body',
    hiddenHintVi: 'Hàn Dạ giữ một câu chú khắc giáp cũ — affinity cao thì đưa.',
    hiddenHintEn: 'Hàn Dạ keeps an old armor incantation — high affinity, she hands it over.',
    storyFlagIntro: 'flag_ch14_intro',
    storyFlagCleared: 'flag_ch14_cleared',
    storyFlagHidden: 'route_ch14_kim_than_hardened',
    affinityNpcForHidden: 'npc_han_da',
    affinityScore: 45,
  },
  {
    chapKey: 'ch15', chapNumber: 15, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'thai_at_kim_tien', realmOrder: 15,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_han_da',
    hiddenNpc: 'npc_to_nguyet_ly',
    boss: 'boss_thai_at_phap_linh',
    storyDungeon: 'ch15_thai_at_phap_linh',
    region: 'region_thai_at_phap_dia',
    monster: 'monster_thai_at_phap_anh',
    collectItem: 'item_thai_at_phap_manh',
    mainRewardItem: 'reward_item_thai_at_phap_an',
    sideRewardItem: 'reward_item_thai_at_kim_phu',
    hiddenRewardItem: 'reward_item_thai_at_phap_linh_chuc',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_thai_at_tinh',
    mainTitleVi: 'Chap 15 — Thái Ất Pháp',
    mainTitleEn: 'Chap 15 — Tai Yi Law',
    hiddenHintVi: 'Tô Nguyệt Ly nghe pháp tắc nguyên thủy — đủ affinity, dẫn đường đi sâu.',
    hiddenHintEn: 'Tô Nguyệt Ly hears primal law — enough affinity, she guides the deep route.',
    storyFlagIntro: 'flag_ch15_intro',
    storyFlagCleared: 'flag_ch15_cleared',
    storyFlagHidden: 'route_ch15_thai_at_seed_taken',
    affinityNpcForHidden: 'npc_to_nguyet_ly',
    affinityScore: 50,
  },
  {
    chapKey: 'ch16', chapNumber: 16, volumeKey: 'quyen_ii_tien_gioi',
    realmKey: 'dai_la_kim_tien', realmOrder: 16,
    rewardPolicyKey: 'reward_policy_quyen_ii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_to_nguyet_ly',
    hiddenNpc: 'npc_huyet_la_sat',
    boss: 'boss_bach_de_tu',
    storyDungeon: 'ch16_bach_de_final',
    region: 'region_bach_de_dien',
    monster: 'monster_bach_de_ve_si',
    collectItem: 'item_bach_de_an',
    mainRewardItem: 'reward_item_dai_la_dao_qua',
    sideRewardItem: 'reward_item_bach_de_phu',
    hiddenRewardItem: 'reward_item_huyet_la_sat_chuc',
    dailyRewardItem: 'reward_item_tien_thach_so',
    weeklyRewardItem: 'reward_item_dai_la_tinh',
    mainTitleVi: 'Chap 16 — Đại La Đạo Quả',
    mainTitleEn: 'Chap 16 — Da Luo Dao Fruit',
    hiddenHintVi: 'Huyết La Sát chọn phe quyết liệt — affinity đủ, hé tin về Bạch Đế Tử.',
    hiddenHintEn: 'Huyết La Sát picks sides hard — enough affinity, she names Bạch Đế Tử’s tells.',
    storyFlagIntro: 'flag_ch16_intro',
    storyFlagCleared: 'flag_ch16_cleared',
    storyFlagHidden: 'route_ch16_saved_prisoners',
    affinityNpcForHidden: 'npc_huyet_la_sat',
    affinityScore: 50,
  },
  /* ─── Quyển III ─── */
  {
    chapKey: 'ch17', chapNumber: 17, volumeKey: 'quyen_iii_thanh_dao',
    realmKey: 'chuan_thanh', realmOrder: 17,
    rewardPolicyKey: 'reward_policy_quyen_iii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_moc_thanh_y',
    hiddenNpc: 'npc_han_da',
    boss: 'boss_tam_niem_hoa_than',
    storyDungeon: 'ch17_tam_niem_dai',
    region: 'region_tam_niem_dai',
    monster: 'monster_tam_niem_anh',
    collectItem: 'item_tam_niem_phan',
    mainRewardItem: 'reward_item_tam_niem_dao_an',
    sideRewardItem: 'reward_item_tam_niem_phu',
    hiddenRewardItem: 'reward_item_tam_niem_co_kinh',
    dailyRewardItem: 'reward_item_chuan_thanh_thach',
    weeklyRewardItem: 'reward_item_tam_niem_tinh',
    mainTitleVi: 'Chap 17 — Trảm Tam Niệm',
    mainTitleEn: 'Chap 17 — Sever Three Thoughts',
    hiddenHintVi: 'Hàn Dạ đã từng trảm sai một niệm — affinity đủ, cô kể vết sẹo cũ.',
    hiddenHintEn: 'Hàn Dạ once cut wrong — enough affinity, she shows the old scar.',
    storyFlagIntro: 'flag_ch17_intro',
    storyFlagCleared: 'flag_ch17_cleared',
    storyFlagHidden: 'route_ch17_tam_niem_truth',
    affinityNpcForHidden: 'npc_han_da',
    affinityScore: 55,
  },
  {
    chapKey: 'ch18', chapNumber: 18, volumeKey: 'quyen_iii_thanh_dao',
    realmKey: 'thanh_nhan', realmOrder: 18,
    rewardPolicyKey: 'reward_policy_quyen_iii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_tich_thien_thanh_su',
    hiddenNpc: 'npc_to_nguyet_ly',
    boss: 'boss_tich_thien_phap_tuong',
    storyDungeon: 'ch18_thanh_nhan_kiep',
    region: 'region_thanh_nhan_dai',
    monster: 'monster_thanh_nhan_kiep_anh',
    collectItem: 'item_thanh_vi_phan',
    mainRewardItem: 'reward_item_dao_hieu_lenh',
    sideRewardItem: 'reward_item_thanh_nhan_phu',
    hiddenRewardItem: 'reward_item_tin_nguong_phan',
    dailyRewardItem: 'reward_item_chuan_thanh_thach',
    weeklyRewardItem: 'reward_item_thanh_nhan_tinh',
    mainTitleVi: 'Chap 18 — Lập Đạo',
    mainTitleEn: 'Chap 18 — Found a Dao',
    hiddenHintVi: 'Tô Nguyệt Ly thấy tín ngưỡng có hai mặt — affinity đủ, hé route trả lại.',
    hiddenHintEn: 'Tô Nguyệt Ly sees faith as a coin — enough affinity, she opens the return route.',
    storyFlagIntro: 'flag_ch18_intro',
    storyFlagCleared: 'flag_ch18_cleared',
    storyFlagHidden: 'route_ch18_thanh_doc_lap',
    affinityNpcForHidden: 'npc_to_nguyet_ly',
    affinityScore: 60,
  },
  {
    chapKey: 'ch19', chapNumber: 19, volumeKey: 'quyen_iii_thanh_dao',
    realmKey: 'hon_nguyen', realmOrder: 19,
    rewardPolicyKey: 'reward_policy_quyen_iii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_moc_thanh_y',
    hiddenNpc: 'npc_hoa_thien_dao_to',
    boss: 'boss_hon_nguyen_co_thu',
    storyDungeon: 'ch19_hon_nguyen_chi_hai',
    region: 'region_hon_nguyen_chi_hai',
    monster: 'monster_hon_nguyen_song_quy',
    collectItem: 'item_hon_nguyen_thu_phan',
    mainRewardItem: 'reward_item_hon_nguyen_dao_an',
    sideRewardItem: 'reward_item_hon_nguyen_phu',
    hiddenRewardItem: 'reward_item_hon_nguyen_co_kinh',
    dailyRewardItem: 'reward_item_chuan_thanh_thach',
    weeklyRewardItem: 'reward_item_hon_nguyen_tinh',
    mainTitleVi: 'Chap 19 — Hỗn Nguyên',
    mainTitleEn: 'Chap 19 — Primordial Sea',
    hiddenHintVi: 'Hoa Thiên Đạo Tổ tàn ảnh có thể can dự nếu Đạo Liên đủ chín.',
    hiddenHintEn: 'The Patriarch remnant can mediate if the Dao Lotus is ripe enough.',
    storyFlagIntro: 'flag_ch19_intro',
    storyFlagCleared: 'flag_ch19_cleared',
    storyFlagHidden: 'route_ch19_co_thu_persuaded',
    affinityNpcForHidden: 'npc_hoa_thien_dao_to',
    affinityScore: 60,
  },
  {
    chapKey: 'ch20', chapNumber: 20, volumeKey: 'quyen_iii_thanh_dao',
    realmKey: 'dao_quan', realmOrder: 20,
    rewardPolicyKey: 'reward_policy_quyen_iii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_to_nguyet_ly',
    hiddenNpc: 'npc_dao_vuc_chi_tam',
    boss: 'boss_dao_quan_doi_lap',
    storyDungeon: 'ch20_dao_vuc_tai_ach',
    region: 'region_dao_vuc_hoa_thien',
    monster: 'monster_dao_vuc_pham_quy',
    collectItem: 'item_dao_vuc_luat_phan',
    mainRewardItem: 'reward_item_dao_quan_an',
    sideRewardItem: 'reward_item_dao_vuc_phu',
    hiddenRewardItem: 'reward_item_dao_vuc_chi_tam_an',
    dailyRewardItem: 'reward_item_chuan_thanh_thach',
    weeklyRewardItem: 'reward_item_dao_quan_tinh',
    mainTitleVi: 'Chap 20 — Đạo Vực',
    mainTitleEn: 'Chap 20 — Dao Domain',
    hiddenHintVi: 'Đạo Vực Chi Tâm sống dậy khi quản trị Đạo Vực vừa nhân vừa luật.',
    hiddenHintEn: 'The Domain’s Heart awakens when rule is both humane and lawful.',
    storyFlagIntro: 'flag_ch20_intro',
    storyFlagCleared: 'flag_ch20_cleared',
    storyFlagHidden: 'route_ch20_luat_mem',
    affinityNpcForHidden: 'npc_dao_vuc_chi_tam',
    affinityScore: 65,
  },
  {
    chapKey: 'ch21', chapNumber: 21, volumeKey: 'quyen_iii_thanh_dao',
    realmKey: 'thien_dao', realmOrder: 21,
    rewardPolicyKey: 'reward_policy_quyen_iii',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_hoa_thien_dao_to',
    hiddenNpc: 'npc_tich_thien_thanh_su',
    boss: 'boss_tich_thien_thanh_su_chan_than',
    storyDungeon: 'ch21_thien_dao_ban_nga',
    region: 'region_the_gioi_chi_tam',
    monster: 'monster_thien_dao_anh_xa',
    collectItem: 'item_thien_dao_ban_nga_phan',
    mainRewardItem: 'reward_item_thien_dao_an',
    sideRewardItem: 'reward_item_thien_dao_phu',
    hiddenRewardItem: 'reward_item_tich_thien_chan_kinh',
    dailyRewardItem: 'reward_item_chuan_thanh_thach',
    weeklyRewardItem: 'reward_item_thien_dao_tinh',
    mainTitleVi: 'Chap 21 — Thiên Đạo',
    mainTitleEn: 'Chap 21 — Heavenly Dao',
    hiddenHintVi: 'Khi affinity đủ, Tịch Thiên Thánh Sứ có thể tự lộ một sự thật khó nuốt.',
    hiddenHintEn: 'With enough affinity, the Tịch Thiên Saint Envoy reveals a bitter truth.',
    storyFlagIntro: 'flag_ch21_intro',
    storyFlagCleared: 'flag_ch21_cleared',
    storyFlagHidden: 'route_ch21_thanh_su_truth',
    affinityNpcForHidden: 'npc_tich_thien_thanh_su',
    affinityScore: 70,
  },
  /* ─── Quyển IV ─── */
  {
    chapKey: 'ch22', chapNumber: 22, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'ban_nguyen', realmOrder: 22,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_nguyen_linh_nu',
    hiddenNpc: 'npc_hoa_thien_dao_to',
    boss: 'boss_ban_nguyen_thu',
    storyDungeon: 'ch22_ban_nguyen_hai',
    region: 'region_ban_nguyen_hai',
    monster: 'monster_ban_nguyen_pham_quy',
    collectItem: 'item_ban_nguyen_khi_phan',
    mainRewardItem: 'reward_item_ban_nguyen_an',
    sideRewardItem: 'reward_item_ban_nguyen_phu',
    hiddenRewardItem: 'reward_item_ban_nguyen_co_kinh',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_ban_nguyen_tinh',
    mainTitleVi: 'Chap 22 — Bản Nguyên Hải',
    mainTitleEn: 'Chap 22 — Origin Sea',
    hiddenHintVi: 'Hoa Thiên Đạo Tổ tàn ảnh thì thầm khi Đạo Liên hé nụ trong nước nguyên.',
    hiddenHintEn: 'The Patriarch remnant whispers when the Dao Lotus buds in primal water.',
    storyFlagIntro: 'flag_ch22_intro',
    storyFlagCleared: 'flag_ch22_cleared',
    storyFlagHidden: 'route_ch22_dao_lien_evolved',
    affinityNpcForHidden: 'npc_hoa_thien_dao_to',
    affinityScore: 75,
  },
  {
    chapKey: 'ch23', chapNumber: 23, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'huyen_huyen', realmOrder: 23,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_huyen_huyen_giam_quan',
    hiddenNpc: 'npc_to_nguyet_ly',
    boss: 'boss_vo_tuong_dao_anh',
    storyDungeon: 'ch23_huyen_huyen_co_bi',
    region: 'region_huyen_huyen_co_bi',
    monster: 'monster_ngoai_dao_anh',
    collectItem: 'item_co_bi_phan',
    mainRewardItem: 'reward_item_ngoai_dao_an',
    sideRewardItem: 'reward_item_huyen_huyen_phu',
    hiddenRewardItem: 'reward_item_huyen_huyen_chan_kinh',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_huyen_huyen_tinh',
    mainTitleVi: 'Chap 23 — Huyền Huyền',
    mainTitleEn: 'Chap 23 — Mystery Stele',
    hiddenHintVi: 'Tô Nguyệt Ly thấy được vế sau câu khắc — affinity đủ, đọc giúp người chơi.',
    hiddenHintEn: 'Tô Nguyệt Ly sees the back of the inscription — close enough, she reads it for the player.',
    storyFlagIntro: 'flag_ch23_intro',
    storyFlagCleared: 'flag_ch23_cleared',
    storyFlagHidden: 'route_ch23_ngoai_dao_seen',
    affinityNpcForHidden: 'npc_to_nguyet_ly',
    affinityScore: 75,
  },
  {
    chapKey: 'ch24', chapNumber: 24, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'vo_thuy', realmOrder: 24,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_vo_thuy_lao_nhan',
    hiddenNpc: 'npc_moc_thanh_y',
    boss: 'boss_thoi_gian_tan_anh',
    storyDungeon: 'ch24_thoi_gian_luan_hai',
    region: 'region_thoi_gian_luan_hai',
    monster: 'monster_thoi_gian_vong_anh',
    collectItem: 'item_thoi_gian_phan',
    mainRewardItem: 'reward_item_thoi_gian_an',
    sideRewardItem: 'reward_item_vo_thuy_phu',
    hiddenRewardItem: 'reward_item_vo_thuy_ky_uc',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_vo_thuy_tinh',
    mainTitleVi: 'Chap 24 — Vô Thủy',
    mainTitleEn: 'Chap 24 — No Beginning',
    hiddenHintVi: 'Mộc Thanh Y giữ một ký ức từ Thanh Khê — affinity đủ, cô chia sẻ phiên bản gốc.',
    hiddenHintEn: 'Mộc Thanh Y holds a Thanh Khê memory — high affinity, she shares the original take.',
    storyFlagIntro: 'flag_ch24_intro',
    storyFlagCleared: 'flag_ch24_cleared',
    storyFlagHidden: 'route_ch24_truth_origin',
    affinityNpcForHidden: 'npc_moc_thanh_y',
    affinityScore: 80,
  },
  {
    chapKey: 'ch25', chapNumber: 25, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'vo_chung', realmOrder: 25,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_vo_chung_dong_tu',
    hiddenNpc: 'npc_tich_thien_thanh_su',
    boss: 'boss_vo_chung_chi_mon',
    storyDungeon: 'ch25_vo_chung_chi_mon',
    region: 'region_tuong_lai_chien_truong',
    monster: 'monster_tuong_lai_vong_anh',
    collectItem: 'item_dinh_menh_phan',
    mainRewardItem: 'reward_item_vo_chung_an',
    sideRewardItem: 'reward_item_vo_chung_phu',
    hiddenRewardItem: 'reward_item_tich_thien_lai_thu',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_vo_chung_tinh',
    mainTitleVi: 'Chap 25 — Vô Chung',
    mainTitleEn: 'Chap 25 — No Ending',
    hiddenHintVi: 'Tịch Thiên Thánh Sứ tương lai gửi thư cho người chơi — affinity đủ, mở ra.',
    hiddenHintEn: 'The future Saint Envoy sends the player a letter — enough affinity, it opens.',
    storyFlagIntro: 'flag_ch25_intro',
    storyFlagCleared: 'flag_ch25_cleared',
    storyFlagHidden: 'route_ch25_future_warning',
    affinityNpcForHidden: 'npc_tich_thien_thanh_su',
    affinityScore: 85,
  },
  {
    chapKey: 'ch26', chapNumber: 26, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'vinh_hang', realmOrder: 26,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_tich_thien_dao_chu',
    hiddenNpc: 'npc_hoa_thien_dao_to',
    boss: 'boss_tich_thien_dao_chu',
    storyDungeon: 'ch26_tich_thien_dao_chu',
    region: 'region_vinh_hang_dao_nguyen',
    monster: 'monster_tich_thien_dao_anh',
    collectItem: 'item_tich_thien_chan_phan',
    mainRewardItem: 'reward_item_vinh_hang_an',
    sideRewardItem: 'reward_item_vinh_hang_phu',
    hiddenRewardItem: 'reward_item_hoa_thien_phuc_kinh',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_vinh_hang_tinh',
    mainTitleVi: 'Chap 26 — Vĩnh Hằng',
    mainTitleEn: 'Chap 26 — Eternity',
    hiddenHintVi: 'Hoa Thiên Đạo Tổ tàn ảnh sống dậy khi người chơi chọn route phục sinh.',
    hiddenHintEn: 'The Patriarch remnant awakens when the player picks the rebirth route.',
    storyFlagIntro: 'flag_ch26_intro',
    storyFlagCleared: 'flag_ch26_cleared',
    storyFlagHidden: 'ending_hoa_thien_phuc_sinh',
    affinityNpcForHidden: 'npc_hoa_thien_dao_to',
    affinityScore: 90,
  },
  {
    chapKey: 'ch27', chapNumber: 27, volumeKey: 'quyen_iv_ban_nguyen',
    realmKey: 'hu_khong_chi_ton', realmOrder: 27,
    rewardPolicyKey: 'reward_policy_quyen_iv',
    primaryNpc: 'npc_lang_van_sinh',
    secondaryNpc: 'npc_hoa_thien_dao_to',
    hiddenNpc: 'npc_tich_thien_dao_chu',
    boss: 'boss_vo_dao_chung',
    storyDungeon: 'ch27_vo_dao_chung',
    region: 'region_hu_khong_ngoai_vuc',
    monster: 'monster_hu_khong_vong_anh',
    collectItem: 'item_vo_dao_chung_phan',
    mainRewardItem: 'reward_item_hu_khong_an',
    sideRewardItem: 'reward_item_hu_khong_phu',
    hiddenRewardItem: 'reward_item_tich_thien_van_co',
    dailyRewardItem: 'reward_item_ban_nguyen_thach',
    weeklyRewardItem: 'reward_item_hu_khong_tinh',
    mainTitleVi: 'Chap 27 — Hư Không Chí Tôn',
    mainTitleEn: 'Chap 27 — Void Sovereign',
    hiddenHintVi: 'Khi Tịch Thiên Đạo Chủ tin người chơi đủ, đề nghị Tân Ước được hé lộ.',
    hiddenHintEn: 'When the Tịch Thiên Dao Master trusts the player enough, the New Pact is offered.',
    storyFlagIntro: 'flag_ch27_intro',
    storyFlagCleared: 'flag_ch27_cleared',
    storyFlagHidden: 'ending_tich_thien_tan_uoc',
    affinityNpcForHidden: 'npc_tich_thien_dao_chu',
    affinityScore: 95,
  },
];

export const STORY_QUEST_EXPANSION: readonly Phase33QuestDef[] =
  CHAPTER_TEMPLATES.flatMap((template) => [
    ...mainQuestsFor(template),
    ...sideQuestsFor(template),
    ...hiddenQuestFor(template),
    ...dailyQuestFor(template),
    ...weeklyQuestFor(template),
  ]);

export function phase33QuestByKey(questKey: string): Phase33QuestDef | undefined {
  return STORY_QUEST_EXPANSION.find((quest) => quest.questKey === questKey);
}

export function phase33QuestsByChapter(chapKey: string): readonly Phase33QuestDef[] {
  return STORY_QUEST_EXPANSION.filter((quest) => quest.chapKey === chapKey);
}

export function phase33QuestsByKind(kind: Phase33QuestKind): readonly Phase33QuestDef[] {
  return STORY_QUEST_EXPANSION.filter((quest) => quest.kind === kind);
}

export function phase33QuestsByVolume(volumeKey: string): readonly Phase33QuestDef[] {
  return STORY_QUEST_EXPANSION.filter((quest) => quest.volumeKey === volumeKey);
}

/** Trả danh sách story flag mới phát sinh từ catalog quest expansion. */
export function phase33StoryFlagsFromQuests(): readonly string[] {
  const out = new Set<string>();
  for (const q of STORY_QUEST_EXPANSION) {
    for (const flag of q.rewards.storyFlags ?? []) out.add(flag);
    for (const flag of q.requiredStoryFlags) out.add(flag);
    for (const step of q.steps) {
      if (step.kind === 'flag_set') out.add(step.targetId);
    }
  }
  return Array.from(out).sort();
}

/** Trả danh sách NPC referenced (chapter NPC + giver). */
export function phase33ReferencedNpcKeys(): readonly string[] {
  const out = new Set<string>();
  for (const chapter of STORY_CHAPTERS_V2) {
    for (const npc of chapter.mainNpcKeys) out.add(npc);
  }
  for (const quest of STORY_QUEST_EXPANSION) {
    out.add(quest.giverNpcKey);
    if (quest.requiredAffinityNpcKey) out.add(quest.requiredAffinityNpcKey);
    for (const aff of quest.rewards.affinity ?? []) out.add(aff.npcKey);
  }
  return Array.from(out).sort();
}

/** Trả danh sách boss referenced. */
export function phase33ReferencedBossKeys(): readonly string[] {
  const out = new Set<string>();
  for (const chapter of STORY_CHAPTERS_V2) {
    for (const boss of chapter.bossKeys) out.add(boss);
  }
  for (const quest of STORY_QUEST_EXPANSION) {
    for (const step of quest.steps) {
      if (step.kind === 'boss_defeat') out.add(step.targetId);
    }
  }
  return Array.from(out).sort();
}

/** Trả danh sách dungeon referenced. */
export function phase33ReferencedDungeonKeys(): readonly string[] {
  const out = new Set<string>();
  for (const chapter of STORY_CHAPTERS_V2) {
    for (const dgn of chapter.storyDungeonKeys) out.add(dgn);
  }
  for (const quest of STORY_QUEST_EXPANSION) {
    for (const step of quest.steps) {
      if (step.kind === 'dungeon_clear') out.add(step.targetId);
    }
  }
  return Array.from(out).sort();
}

/** Trả reward cap theo policy. */
export function phase33RewardCap(
  policyKey: Phase33RewardPolicyKey,
): { main: number; side: number; hidden: number; daily: number; weekly: number; exp: number } {
  return REWARD_CAP[policyKey];
}

/** Items referenced. */
export function phase33ReferencedItemKeys(): readonly string[] {
  const out = new Set<string>();
  for (const quest of STORY_QUEST_EXPANSION) {
    for (const item of quest.rewards.items ?? []) out.add(item.itemKey);
    for (const step of quest.steps) {
      if (step.kind === 'collect') out.add(step.targetId);
    }
  }
  return Array.from(out).sort();
}

/** Regions referenced. */
export function phase33ReferencedRegionKeys(): readonly string[] {
  const out = new Set<string>();
  for (const quest of STORY_QUEST_EXPANSION) {
    for (const step of quest.steps) {
      if (step.kind === 'explore') out.add(step.targetId);
    }
  }
  return Array.from(out).sort();
}
