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

export type Phase33QuestKind = 'main' | 'side' | 'hidden' | 'daily' | 'weekly' | 'branch';

/**
 * Phase 33.0B — reward tier theo `requiredRealmOrder` để reward scale mịn hơn
 * trong cùng một Volume. Multiplier áp lên base policy của Volume; kết quả luôn
 * clamp dưới `volume_cap` để không phá test reward cap hiện hữu.
 */
export type Phase33RewardTier =
  | 't1_early'
  | 't2_mid'
  | 't3_late'
  | 't4_thanh'
  | 't5_thien_dao'
  | 't6_ban_nguyen'
  | 't7_endgame';

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

interface Phase33RewardCapDef {
  main: number;
  side: number;
  /** Branch cap = side * 0.8 (Phase 33.0B). */
  branch: number;
  hidden: number;
  daily: number;
  weekly: number;
  exp: number;
}

const REWARD_CAP: Record<Phase33RewardPolicyKey, Phase33RewardCapDef> = {
  reward_policy_quyen_ii: { main: 4_000, side: 1_800, branch: 1_440, hidden: 2_500, daily: 350, weekly: 1_500, exp: 4_500 },
  reward_policy_quyen_iii: { main: 7_500, side: 3_200, branch: 2_560, hidden: 4_500, daily: 600, weekly: 2_800, exp: 8_500 },
  reward_policy_quyen_iv: { main: 12_000, side: 5_500, branch: 4_400, hidden: 7_500, daily: 1_000, weekly: 4_500, exp: 14_000 },
};

const TIER_MULTIPLIER: Record<Phase33RewardTier, number> = {
  t1_early: 0.85,
  t2_mid: 1.0,
  t3_late: 1.15,
  t4_thanh: 1.0,
  t5_thien_dao: 1.2,
  t6_ban_nguyen: 1.0,
  t7_endgame: 1.2,
};

/** Realm order → reward tier (Phase 33.0B). */
export function getStoryRewardTierForRealmOrder(order: number): Phase33RewardTier {
  if (order <= 10) return 't1_early';
  if (order <= 13) return 't2_mid';
  if (order <= 16) return 't3_late';
  if (order <= 19) return 't4_thanh';
  if (order <= 21) return 't5_thien_dao';
  if (order <= 24) return 't6_ban_nguyen';
  return 't7_endgame';
}

function tierMultiplierFor(realmOrder: number): number {
  return TIER_MULTIPLIER[getStoryRewardTierForRealmOrder(realmOrder)];
}

/** Reward budget linhThach cho 1 quest theo chapter + kind (Phase 33.0B helper). */
export function getStoryRewardBudgetForChapter(
  chapKey: string,
  kind: Phase33QuestKind,
): number {
  const chapter = STORY_CHAPTERS_V2.find((c) => c.chapKey === chapKey);
  if (!chapter) return 0;
  const cap = REWARD_CAP[chapter.rewardPolicyKey];
  const mult = tierMultiplierFor(chapter.requiredRealmOrder);
  const raw =
    kind === 'main' ? cap.main
    : kind === 'side' ? cap.side
    : kind === 'branch' ? cap.branch
    : kind === 'hidden' ? cap.hidden
    : kind === 'daily' ? cap.daily
    : cap.weekly;
  // Always clamp under per-kind volume cap so PR A doesn't break reward cap test.
  return Math.min(raw, Math.floor(raw * mult));
}

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

  /* ── Phase 33.0B — extra main beats q6..q16 (post-boss aftermath → next chapter seed). ── */

  const tierMult = tierMultiplierFor(t.realmOrder);
  const mainBudget = Math.min(cap.main, Math.floor(cap.main * tierMult));
  const expBudget = Math.min(cap.exp, Math.floor(cap.exp * tierMult));

  function mkExtraMain(
    seq: number,
    titleViSuffix: string,
    titleEnSuffix: string,
    descVi: string,
    descEn: string,
    giverNpc: string,
    prereqKey: string,
    steps: readonly Phase33QuestStepDef[],
    rewardFactor: number,
    extraAffinity: readonly Phase33AffinityDelta[],
    flagSet: string | null,
    loreVi: string,
    loreEn: string,
  ): Phase33QuestDef {
    const linhThach = Math.min(mainBudget, Math.floor(mainBudget * rewardFactor));
    const exp = Math.min(expBudget, Math.floor(expBudget * rewardFactor));
    return {
      questKey: `q_ch${padded}_main_${String(seq).padStart(2, '0')}`,
      kind: 'main',
      chapKey: t.chapKey,
      volumeKey: t.volumeKey,
      titleVi: `${t.mainTitleVi} — ${titleViSuffix}`,
      titleEn: `${t.mainTitleEn} — ${titleEnSuffix}`,
      descriptionVi: descVi,
      descriptionEn: descEn,
      giverNpcKey: giverNpc,
      requiredRealmKey: t.realmKey,
      requiredRealmOrder: t.realmOrder,
      prerequisiteQuestKey: prereqKey,
      requiredStoryFlags: [t.storyFlagIntro],
      requiredAffinityNpcKey: null,
      requiredAffinityScore: null,
      steps,
      rewards: {
        linhThach,
        exp,
        congHien: 6 + seq,
        affinity: extraAffinity,
        ...(flagSet ? { storyFlags: [flagSet] } : {}),
      },
      rewardPolicyKey: t.rewardPolicyKey,
      dailyCap: null,
      weeklyCap: null,
      hiddenTriggerHintVi: null,
      hiddenTriggerHintEn: null,
      loreSummaryVi: loreVi,
      loreSummaryEn: loreEn,
    };
  }

  const flagAftermath = `flag_ch${padded}_aftermath`;
  const flagInnerTested = `flag_ch${padded}_inner_tested`;
  const flagSecretDoor = `flag_ch${padded}_secret_door`;
  const flagSectDispute = `flag_ch${padded}_sect_dispute`;
  const flagFiveElements = `flag_ch${padded}_ngu_hanh`;
  const flagNextSeed = `flag_ch${padded}_next_seed`;

  const q6 = mkExtraMain(
    6,
    'Hậu sự',
    'Aftermath',
    `Sau khi hạ ${t.boss}, ${t.primaryNpc} cần dọn ${t.region} kẻo tàn dư còn nuôi mưu.`,
    `After ${t.boss} falls, ${t.primaryNpc} insists on clearing ${t.region} before remnants regroup.`,
    t.primaryNpc,
    `q_ch${padded}_main_05`,
    [
      step(1, 'kill', 'monster', t.monster, 4, `Dẹp đám ${t.monster} tản binh.`, `Mop up scattered ${t.monster}.`),
      step(2, 'collect', 'item', t.collectItem, 1, `Lượm tang vật còn sót.`, `Pick up the last evidence.`),
      step(3, 'flag_set', 'flag', flagAftermath, 1, `Đóng cờ hậu sự.`, `Close the aftermath flag.`),
    ],
    0.55,
    [{ npcKey: t.primaryNpc, delta: 2 }],
    flagAftermath,
    `Hậu sự sau boss — dọn region, mở đường tâm tư cho NPC chính.`,
    `Aftermath sweep — clears the region and opens the primary NPC's reflection arc.`,
  );

  const q7 = mkExtraMain(
    7,
    'Tâm ma thoáng hiện',
    'Inner Demon Glimpse',
    `${t.primaryNpc} nhận ra một bóng tâm ma soi qua thiên kiếp Chap ${t.chapNumber} — cần quyết định nuốt hay dồn lại.`,
    `${t.primaryNpc} senses an inner demon casting through the Chap ${t.chapNumber} tribulation — swallow it or seal it.`,
    t.primaryNpc,
    `q_ch${padded}_main_06`,
    [
      step(1, 'talk', 'npc', t.primaryNpc, 1, `Hỏi ${t.primaryNpc} về bóng tâm ma.`, `Ask ${t.primaryNpc} about the demon.`),
      step(2, 'choice', 'choice', `choice_ch${padded}_main_07_demon`, 1, `Chọn nuốt tâm ma hay dồn ấn.`, `Swallow the demon or seal it.`),
      step(3, 'flag_set', 'flag', flagInnerTested, 1, `Đóng cờ tâm ma đã thử.`, `Set the inner-demon-tested flag.`),
    ],
    0.5,
    [{ npcKey: t.primaryNpc, delta: 3 }],
    flagInnerTested,
    `Choice tâm ma — ảnh hưởng affinity và mở hidden tâm cảnh về sau.`,
    `Inner demon choice — colors affinity and opens a later hidden mind dungeon.`,
  );

  const q8 = mkExtraMain(
    8,
    'Đồng đạo thử lửa',
    'Ally Trial',
    `${t.secondaryNpc} đề nghị thử lửa cùng nhau ở ${t.region} để củng cố đạo tâm trước chương sau.`,
    `${t.secondaryNpc} proposes a joint trial at ${t.region} to firm up daoist resolve for the chapters ahead.`,
    t.secondaryNpc,
    `q_ch${padded}_main_07`,
    [
      step(1, 'explore', 'region', t.region, 1, `Khảo sát ${t.region} cùng ${t.secondaryNpc}.`, `Sweep ${t.region} with ${t.secondaryNpc}.`),
      step(2, 'kill', 'monster', t.monster, 5, `Dẹp ${t.monster} canh phục.`, `Defeat lurking ${t.monster}.`),
      step(3, 'collect', 'item', t.collectItem, 1, `Lượm vật tế đạo.`, `Pick a daoist token.`),
    ],
    0.55,
    [{ npcKey: t.secondaryNpc, delta: 4 }],
    null,
    `Đồng hành side beat — khắc hoạ tình thân ${t.secondaryNpc}.`,
    `Joint trial — deepens the bond with ${t.secondaryNpc}.`,
  );

  const q9 = mkExtraMain(
    9,
    'Xung đột tông môn',
    'Sect Dispute',
    `Một tông môn nhỏ tại ${t.region} tranh chấp với người của ${t.primaryNpc}; cần phán xét nhanh.`,
    `A minor sect at ${t.region} clashes with ${t.primaryNpc}'s people; a swift verdict is needed.`,
    t.primaryNpc,
    `q_ch${padded}_main_08`,
    [
      step(1, 'talk', 'npc', t.primaryNpc, 1, `Nghe trình bày từ ${t.primaryNpc}.`, `Take ${t.primaryNpc}'s brief.`),
      step(2, 'kill', 'monster', t.monster, 3, `Trấn áp đám hộ vệ tông môn nhỏ.`, `Put down the minor sect guards.`),
      step(3, 'choice', 'choice', `choice_ch${padded}_main_09_sect`, 1, `Tha hay diệt tông môn nhỏ.`, `Spare or annihilate the minor sect.`),
      step(4, 'flag_set', 'flag', flagSectDispute, 1, `Đóng cờ phán xét.`, `Lock the verdict flag.`),
    ],
    0.6,
    [{ npcKey: t.primaryNpc, delta: 3 }],
    flagSectDispute,
    `Xung đột phân nhánh — quyết định ảnh hưởng faction state ở chapter sau.`,
    `Sect dispute branch — the verdict echoes in later faction state.`,
  );

  const q10 = mkExtraMain(
    10,
    'Bí mật địa phương',
    'Local Secret',
    `${t.hiddenNpc} chỉ một cánh cửa giấu trong ${t.region} — chỉ mở khi đã hạ ${t.boss}.`,
    `${t.hiddenNpc} hints at a hidden door in ${t.region} — only after ${t.boss} falls.`,
    t.hiddenNpc,
    `q_ch${padded}_main_09`,
    [
      step(1, 'explore', 'region', t.region, 1, `Theo dấu ${t.hiddenNpc}.`, `Follow ${t.hiddenNpc}'s trail.`),
      step(2, 'collect', 'item', t.collectItem, 1, `Mở khoá chứng vật.`, `Lift the key token.`),
      step(3, 'flag_set', 'flag', flagSecretDoor, 1, `Đóng cờ cánh cửa bí.`, `Lock the secret door flag.`),
    ],
    0.55,
    [{ npcKey: t.hiddenNpc, delta: 4 }],
    flagSecretDoor,
    `Bí mật địa phương — mở tuyến hidden phụ về sau (hidden_02).`,
    `Local secret — opens a later hidden branch (hidden_02).`,
  );

  const q11 = mkExtraMain(
    11,
    'Pháp bảo phế tích',
    'Dharma Treasure Ruin',
    `${t.secondaryNpc} cho hay có pháp bảo cũ tại ${t.region} — tìm trước khi thế lực phụ thừa cơ.`,
    `${t.secondaryNpc} reports a derelict dharma treasure in ${t.region} — recover it before a minor faction does.`,
    t.secondaryNpc,
    `q_ch${padded}_main_10`,
    [
      step(1, 'collect', 'item', t.collectItem, 2, `Thu hồi pháp bảo lõi.`, `Recover the core relic.`),
      step(2, 'talk', 'npc', t.secondaryNpc, 1, `Bàn giao cho ${t.secondaryNpc}.`, `Hand off to ${t.secondaryNpc}.`),
    ],
    0.55,
    [{ npcKey: t.secondaryNpc, delta: 3 }],
    null,
    `Pháp bảo cũ — gắn lore Quyển ${t.volumeKey.includes('ii_') ? 'II' : t.volumeKey.includes('iii_') ? 'III' : 'IV'}.`,
    `Dharma ruin — ties into the volume's lore.`,
  );

  const q12 = mkExtraMain(
    12,
    'Trận pháp Ngũ Hành',
    'Five Elements Array',
    `Trận pháp Ngũ Hành phía sau ${t.region} bất ổn — cần kích lại để giữ mạch tiên.`,
    `The Five Elements array behind ${t.region} flickers — re-attune it to keep the vein stable.`,
    t.primaryNpc,
    `q_ch${padded}_main_11`,
    [
      step(1, 'kill', 'monster', t.monster, 4, `Diệt yêu thú phá trận.`, `Slay array-breakers.`),
      step(2, 'explore', 'region', t.region, 1, `Đi đủ năm cửa Ngũ Hành.`, `Walk all five element gates.`),
      step(3, 'flag_set', 'flag', flagFiveElements, 1, `Đóng cờ Ngũ Hành.`, `Lock the Five Elements flag.`),
    ],
    0.55,
    [{ npcKey: t.primaryNpc, delta: 2 }],
    flagFiveElements,
    `Trận pháp Ngũ Hành — beat gameplay khác main boss.`,
    `Five elements array — a non-boss gameplay beat.`,
  );

  const q13 = mkExtraMain(
    13,
    'Cứu trợ điều tra',
    'Relief Investigation',
    `Một tu sĩ tán tu kêu cứu ở ${t.region}; ${t.primaryNpc} bảo điều tra trước khi rút.`,
    `A wandering cultivator cries for help at ${t.region}; ${t.primaryNpc} insists on a quick probe first.`,
    t.primaryNpc,
    `q_ch${padded}_main_12`,
    [
      step(1, 'talk', 'npc', t.hiddenNpc, 1, `Nghe lời chứng từ ${t.hiddenNpc}.`, `Hear the witness at ${t.hiddenNpc}.`),
      step(2, 'explore', 'region', t.region, 1, `Lần hiện trường.`, `Survey the site.`),
      step(3, 'choice', 'choice', `choice_ch${padded}_main_13_aid`, 1, `Cứu rồi điều tra hay điều tra rồi cứu.`, `Save then probe or probe then save.`),
    ],
    0.5,
    [{ npcKey: t.hiddenNpc, delta: 3 }],
    null,
    `Cứu trợ + điều tra — beat đạo đức nhỏ trong chap.`,
    `Aid + probe — a small moral beat in the chapter.`,
  );

  const q14 = mkExtraMain(
    14,
    'Đạo tâm thử thách',
    'Dao Heart Trial',
    `${t.primaryNpc} hỏi: kết chap rồi, đạo tâm có vững không? Một thử thách nhỏ chứng minh.`,
    `${t.primaryNpc} asks: with the chapter closed, does your dao heart hold? A small trial proves it.`,
    t.primaryNpc,
    `q_ch${padded}_main_13`,
    [
      step(1, 'choice', 'choice', `choice_ch${padded}_main_14_resolve`, 1, `Đối mặt câu hỏi đạo tâm.`, `Face the dao heart question.`),
      step(2, 'flag_set', 'flag', `flag_ch${padded}_dao_heart`, 1, `Đóng cờ đạo tâm.`, `Lock the dao heart flag.`),
    ],
    0.5,
    [{ npcKey: t.primaryNpc, delta: 4 }],
    `flag_ch${padded}_dao_heart`,
    `Choice đạo tâm — tăng affinity primary, mở dialog node mới.`,
    `Dao heart choice — boosts primary affinity, opens a new dialogue node.`,
  );

  const q15 = mkExtraMain(
    15,
    'Tôn sư đàm đạo',
    'Master Council',
    `Trước khi rời ${t.region}, ${t.secondaryNpc} thỉnh ${t.primaryNpc} đàm đạo về cảnh giới sau.`,
    `Before leaving ${t.region}, ${t.secondaryNpc} invites ${t.primaryNpc} to discuss the next realm.`,
    t.secondaryNpc,
    `q_ch${padded}_main_14`,
    [
      step(1, 'talk', 'npc', t.primaryNpc, 1, `Đàm đạo cùng ${t.primaryNpc}.`, `Council with ${t.primaryNpc}.`),
      step(2, 'talk', 'npc', t.secondaryNpc, 1, `Đối thoại sâu với ${t.secondaryNpc}.`, `Deeper exchange with ${t.secondaryNpc}.`),
    ],
    0.5,
    [
      { npcKey: t.primaryNpc, delta: 3 },
      { npcKey: t.secondaryNpc, delta: 3 },
    ],
    null,
    `Đàm đạo — beat nhịp chậm, tăng affinity đôi và mở dialogue.`,
    `Council — slow beat, double affinity boost and dialogue opener.`,
  );

  const q16 = mkExtraMain(
    16,
    'Mở mạch chương sau',
    'Next Chapter Seed',
    `${t.primaryNpc} đặt một mảnh tin nhỏ — đó là hạt mầm dẫn vào chương ${t.chapNumber + 1}.`,
    `${t.primaryNpc} leaves a small clue — the seed for Chapter ${t.chapNumber + 1}.`,
    t.primaryNpc,
    `q_ch${padded}_main_15`,
    [
      step(1, 'talk', 'npc', t.primaryNpc, 1, `Nhận lời gửi gắm.`, `Take the parting word.`),
      step(2, 'flag_set', 'flag', flagNextSeed, 1, `Đóng cờ mở mạch.`, `Lock the seed flag.`),
    ],
    0.5,
    [{ npcKey: t.primaryNpc, delta: 3 }],
    flagNextSeed,
    `Mở mạch — seed flag cho chương sau (UNWIRED tới Phase 33.1 runtime).`,
    `Chapter seed flag — UNWIRED to runtime until Phase 33.1.`,
  );

  return [q1, q2, q3, q4, q5, q6, q7, q8, q9, q10, q11, q12, q13, q14, q15, q16];
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
      questKey: `q_ch${padded}_side_${String(seq).padStart(2, '0')}`,
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
        // Phase 33.0B: scale theo tier + clamp dưới side cap.
        linhThach: Math.min(
          cap.side,
          Math.floor(cap.side * Math.min(0.95, 0.45 + Math.min(seq, 11) * 0.05) * tierMultiplierFor(t.realmOrder)),
        ),
        exp: Math.min(cap.exp, Math.floor(cap.exp * 0.18 * tierMultiplierFor(t.realmOrder))),
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

  /* ── Phase 33.0B — extra side themes s4..s11 (8 themes mở rộng thế giới). ── */

  const s4 = side(
    4,
    `Chap ${t.chapNumber} — Trợ đan cho ${t.secondaryNpc}`,
    `Chapter ${t.chapNumber} — Alchemy Aid for ${t.secondaryNpc}`,
    t.secondaryNpc,
    `${t.secondaryNpc} đang luyện đan, cần nguyên liệu từ ${t.region}.`,
    `${t.secondaryNpc} is brewing a pill and needs material from ${t.region}.`,
    [
      { id: 'step_1', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 3, descriptionVi: 'Lấy nguyên liệu đan.', descriptionEn: 'Gather alchemy material.' },
      { id: 'step_2', kind: 'talk', targetType: 'npc', targetId: t.secondaryNpc, count: 1, descriptionVi: 'Giao liệu.', descriptionEn: 'Deliver.' },
    ],
    [{ npcKey: t.secondaryNpc, delta: 3 }],
  );

  const s5 = side(
    5,
    `Chap ${t.chapNumber} — Lệch trận pháp`,
    `Chapter ${t.chapNumber} — Formation Mishap`,
    t.primaryNpc,
    `Trận pháp phụ tại ${t.region} lệch nhịp — phải sửa nhanh.`,
    `An auxiliary array at ${t.region} drifts — fix it before it cracks.`,
    [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Trứ ngụ tại trận tâm.', descriptionEn: 'Stand at the array core.' },
      { id: 'step_2', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 3, descriptionVi: 'Dẹp phá trận.', descriptionEn: 'Slay array breakers.' },
      { id: 'step_3', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Lấy đá định trận.', descriptionEn: 'Recover the anchor stone.' },
    ],
    [{ npcKey: t.primaryNpc, delta: 3 }],
  );

  const s6 = side(
    6,
    `Chap ${t.chapNumber} — Tuần tra tông môn`,
    `Chapter ${t.chapNumber} — Sect Patrol`,
    t.primaryNpc,
    `${t.primaryNpc} nhờ bạn tuần tra vòng ${t.region} để giữ trật tự.`,
    `${t.primaryNpc} asks you to patrol ${t.region} to keep order.`,
    [
      { id: 'step_1', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 6, descriptionVi: 'Tuần tra diệt yêu.', descriptionEn: 'Patrol and slay.' },
    ],
    [{ npcKey: t.primaryNpc, delta: 3 }],
  );

  const s7 = side(
    7,
    `Chap ${t.chapNumber} — Gặt lộc tiên thức`,
    `Chapter ${t.chapNumber} — Gathering Run`,
    t.hiddenNpc,
    `${t.hiddenNpc} cần thu gỗm lộc tiên thức xung quanh ${t.region}.`,
    `${t.hiddenNpc} needs to gather immortal foodstuff around ${t.region}.`,
    [
      { id: 'step_1', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 5, descriptionVi: 'Gặt lộc.', descriptionEn: 'Harvest the bounty.' },
      { id: 'step_2', kind: 'talk', targetType: 'npc', targetId: t.hiddenNpc, count: 1, descriptionVi: 'Giao lệ.', descriptionEn: 'Hand off.' },
    ],
    [{ npcKey: t.hiddenNpc, delta: 3 }],
  );

  const s8 = side(
    8,
    `Chap ${t.chapNumber} — Thuần phục yêu thú`,
    `Chapter ${t.chapNumber} — Beast Tamer`,
    t.secondaryNpc,
    `Một yêu thú hiển nhân tính ở ${t.region} — ${t.secondaryNpc} muốn thử thuần phục.`,
    `A beast at ${t.region} shows wit — ${t.secondaryNpc} wants to try taming.`,
    [
      { id: 'step_1', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 2, descriptionVi: 'Làm suy yếu yêu thú lãnh đạo.', descriptionEn: 'Weaken the leader beast.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_side_08_tame`, count: 1, descriptionVi: 'Thuần phục hay diệt.', descriptionEn: 'Tame or slay.' },
    ],
    [{ npcKey: t.secondaryNpc, delta: 4 }],
  );

  const s9 = side(
    9,
    `Chap ${t.chapNumber} — Truy lùng lời đồn`,
    `Chapter ${t.chapNumber} — Rumour Tracker`,
    t.primaryNpc,
    `Một lời đồn đen tối lan khắp ${t.region} — truy vết mà dập.`,
    `A dark rumour circles ${t.region} — trace it and quench it.`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.primaryNpc, count: 1, descriptionVi: 'Nghe đầu mối.', descriptionEn: 'Take the lead.' },
      { id: 'step_2', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Lần dấu.', descriptionEn: 'Track the source.' },
      { id: 'step_3', kind: 'talk', targetType: 'npc', targetId: t.hiddenNpc, count: 1, descriptionVi: 'Buộc người tụ lời đồn nhận.', descriptionEn: 'Confront the source.' },
    ],
    [{ npcKey: t.primaryNpc, delta: 3 }],
  );

  const s10 = side(
    10,
    `Chap ${t.chapNumber} — Thư pháp cổ nghiên`,
    `Chapter ${t.chapNumber} — Old Scripture`,
    t.hiddenNpc,
    `${t.hiddenNpc} tìm được một đoạn thư pháp cổ ở ${t.region}; cần dịch.`,
    `${t.hiddenNpc} found old script fragments at ${t.region}; help translate.`,
    [
      { id: 'step_1', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 2, descriptionVi: 'Lấy đủ mảnh thư.', descriptionEn: 'Gather all fragments.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_side_10_translate`, count: 1, descriptionVi: 'Dịch ẩn hay công khai.', descriptionEn: 'Translate quietly or publicly.' },
    ],
    [{ npcKey: t.hiddenNpc, delta: 4 }],
  );

  const s11 = side(
    11,
    `Chap ${t.chapNumber} — Hộ tống đoàn buôn`,
    `Chapter ${t.chapNumber} — Escort Caravan`,
    t.primaryNpc,
    `Một đoàn buôn nhỏ đi ngang ${t.region} mong cửu đợ — ${t.primaryNpc} nhận.`,
    `A small caravan crosses ${t.region} — ${t.primaryNpc} accepts the escort.`,
    [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Hộ tống đoàn.', descriptionEn: 'Escort the caravan.' },
      { id: 'step_2', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 4, descriptionVi: 'Dẹp kẻ cướp.', descriptionEn: 'Defeat bandits.' },
      { id: 'step_3', kind: 'talk', targetType: 'npc', targetId: t.primaryNpc, count: 1, descriptionVi: 'Báo cáo kết thuán.', descriptionEn: 'Report safe passage.' },
    ],
    [{ npcKey: t.primaryNpc, delta: 3 }],
  );

  return [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11];
}

function branchQuestsFor(t: Phase33ChapterTemplate): readonly Phase33QuestDef[] {
  const cap = REWARD_CAP[t.rewardPolicyKey];
  const padded = String(t.chapNumber).padStart(2, '0');
  const tierMult = tierMultiplierFor(t.realmOrder);
  const branchBudget = Math.min(cap.branch, Math.floor(cap.branch * tierMult));
  const expBudget = Math.min(cap.exp, Math.floor(cap.exp * 0.16 * tierMult));

  function branch(
    seq: number,
    titleViSuffix: string,
    titleEnSuffix: string,
    descVi: string,
    descEn: string,
    giverNpc: string,
    affinityNpc: string,
    affinityScore: number,
    chainKey: string,
    steps: readonly Phase33QuestStepDef[],
    rewardFactor: number,
    extraAffinity: readonly Phase33AffinityDelta[],
  ): Phase33QuestDef {
    return {
      questKey: `q_ch${padded}_branch_${String(seq).padStart(2, '0')}`,
      kind: 'branch',
      chapKey: t.chapKey,
      volumeKey: t.volumeKey,
      titleVi: `Chap ${t.chapNumber} — Nhánh: ${titleViSuffix}`,
      titleEn: `Chapter ${t.chapNumber} — Branch: ${titleEnSuffix}`,
      descriptionVi: descVi,
      descriptionEn: descEn,
      giverNpcKey: giverNpc,
      requiredRealmKey: t.realmKey,
      requiredRealmOrder: t.realmOrder,
      prerequisiteQuestKey: `q_ch${padded}_main_05`,
      requiredStoryFlags: [t.storyFlagIntro],
      requiredAffinityNpcKey: affinityNpc,
      requiredAffinityScore: affinityScore,
      steps,
      rewards: {
        // Branch cap < side; clamp dưới branch cap.
        linhThach: Math.min(branchBudget, Math.floor(branchBudget * rewardFactor)),
        exp: expBudget,
        congHien: 4 + seq,
        items: [{ itemKey: t.sideRewardItem, qty: 1, bind: true }],
        affinity: extraAffinity,
      },
      rewardPolicyKey: t.rewardPolicyKey,
      dailyCap: null,
      weeklyCap: null,
      hiddenTriggerHintVi: `Nhánh ${chainKey} mở khi affinity ${affinityNpc} ≥ ${affinityScore}.`,
      hiddenTriggerHintEn: `Branch ${chainKey} opens when affinity with ${affinityNpc} reaches ${affinityScore}.`,
      loreSummaryVi: `Branch chain ${chainKey} — nhánh phụ affinity-gated, không ảnh hưởng main plot.`,
      loreSummaryEn: `Branch chain ${chainKey} — affinity-gated side path, no main plot impact.`,
    };
  }

  const b1 = branch(
    1,
    `Tâm giao nhỏ với ${t.primaryNpc}`,
    `Small Bond with ${t.primaryNpc}`,
    `Sẩn dịp sau boss, ${t.primaryNpc} ngỏ lời tâm giao sâu hơn.`,
    `After the boss falls, ${t.primaryNpc} offers a deeper bond.`,
    t.primaryNpc,
    t.primaryNpc,
    20,
    `branch_ch${padded}_primary_bond`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.primaryNpc, count: 1, descriptionVi: 'Lắng nghe.', descriptionEn: 'Listen.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_branch_01_bond`, count: 1, descriptionVi: 'Nhận lời hay giữ khoảng cách.', descriptionEn: 'Accept or keep distance.' },
    ],
    0.6,
    [{ npcKey: t.primaryNpc, delta: 4 }],
  );

  const b2 = branch(
    2,
    `Ẩn sư ${t.hiddenNpc} hé lộ`,
    `Hidden Mentor ${t.hiddenNpc} Reveal`,
    `${t.hiddenNpc} hạ màn nửa — tiết lộ đoạn công pháp phụ cho người đủ tình.`,
    `${t.hiddenNpc} lowers their veil halfway — a side technique for those close enough.`,
    t.hiddenNpc,
    t.hiddenNpc,
    25,
    `branch_ch${padded}_hidden_mentor`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.hiddenNpc, count: 1, descriptionVi: 'Nghe giải.', descriptionEn: 'Take the teaching.' },
      { id: 'step_2', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Lấy vật chứng pháp.', descriptionEn: 'Take the proof token.' },
    ],
    0.7,
    [{ npcKey: t.hiddenNpc, delta: 5 }],
  );

  const b3 = branch(
    3,
    `Thế lực phụ của ${t.secondaryNpc}`,
    `Side Faction of ${t.secondaryNpc}`,
    `${t.secondaryNpc} dung nạp một thế lực nhỏ — cần môi giới tin tưởng.`,
    `${t.secondaryNpc} adopts a minor faction — needs a trusted broker.`,
    t.secondaryNpc,
    t.secondaryNpc,
    22,
    `branch_ch${padded}_secondary_faction`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.secondaryNpc, count: 1, descriptionVi: 'Nhận vai môi giới.', descriptionEn: 'Take the broker role.' },
      { id: 'step_2', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Gặp thế lực mới.', descriptionEn: 'Meet the minor faction.' },
      { id: 'step_3', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_branch_03_faction`, count: 1, descriptionVi: 'Chánh trực hay trách khéo.', descriptionEn: 'Forthright or smooth.' },
    ],
    0.65,
    [{ npcKey: t.secondaryNpc, delta: 4 }],
  );

  const b4 = branch(
    4,
    `Mở cửa hàng phụ với ${t.primaryNpc}`,
    `Side Shop with ${t.primaryNpc}`,
    `${t.primaryNpc} muốn mở cửa hàng nhỏ ở ${t.region} — cần số vốn khởi.`,
    `${t.primaryNpc} opens a side shop at ${t.region} — needs seed capital.`,
    t.primaryNpc,
    t.primaryNpc,
    28,
    `branch_ch${padded}_shop_unlock`,
    [
      { id: 'step_1', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 3, descriptionVi: 'Lấy nguyên liệu khởi.', descriptionEn: 'Gather starter materials.' },
      { id: 'step_2', kind: 'talk', targetType: 'npc', targetId: t.primaryNpc, count: 1, descriptionVi: 'Góp vốn.', descriptionEn: 'Invest.' },
    ],
    0.7,
    [{ npcKey: t.primaryNpc, delta: 5 }],
  );

  const b5 = branch(
    5,
    `Lựa chọn hậu quả với ${t.secondaryNpc}`,
    `Echoed Choice with ${t.secondaryNpc}`,
    `Một lựa chọn cũ cuốn lại — ${t.secondaryNpc} hỏi bạn có đổi không.`,
    `An old choice returns — ${t.secondaryNpc} asks if you'd change it.`,
    t.secondaryNpc,
    t.secondaryNpc,
    30,
    `branch_ch${padded}_choice_echo`,
    [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.secondaryNpc, count: 1, descriptionVi: 'Đối thoại về lựa chọn cũ.', descriptionEn: 'Discuss the old choice.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_branch_05_echo`, count: 1, descriptionVi: 'Giữ hay đổi.', descriptionEn: 'Hold or alter.' },
      { id: 'step_3', kind: 'flag_set', targetType: 'flag', targetId: `flag_ch${padded}_branch_echo`, count: 1, descriptionVi: 'Đóng cờ hậu quả.', descriptionEn: 'Lock the echo flag.' },
    ],
    0.7,
    [{ npcKey: t.secondaryNpc, delta: 5 }],
  );

  const b6 = branch(
    6,
    `Tông môn phụ của ${t.hiddenNpc}`,
    `Side Palace of ${t.hiddenNpc}`,
    `${t.hiddenNpc} tiết lộ một tông môn phụ cũ ở ${t.region}, cần người tu sửa.`,
    `${t.hiddenNpc} reveals a derelict side palace at ${t.region}; restoration needed.`,
    t.hiddenNpc,
    t.hiddenNpc,
    35,
    `branch_ch${padded}_side_palace`,
    [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Thăm tông môn phế.', descriptionEn: 'Visit the abandoned palace.' },
      { id: 'step_2', kind: 'kill', targetType: 'monster', targetId: t.monster, count: 3, descriptionVi: 'Xử tàn dư.', descriptionEn: 'Clear remnants.' },
      { id: 'step_3', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Phục hồi bản tứ.', descriptionEn: 'Recover the founding crest.' },
      { id: 'step_4', kind: 'flag_set', targetType: 'flag', targetId: `flag_ch${padded}_branch_palace`, count: 1, descriptionVi: 'Đóng cờ tông môn phụ.', descriptionEn: 'Lock the side palace flag.' },
    ],
    0.8,
    [{ npcKey: t.hiddenNpc, delta: 6 }],
  );

  return [b1, b2, b3, b4, b5, b6];
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

  /* ── Phase 33.0B — extra hidden h2 (flag gate) + h3 (double gate). ── */

  const tierMult = tierMultiplierFor(t.realmOrder);
  const hiddenBudget = Math.min(cap.hidden, Math.floor(cap.hidden * tierMult));
  const hiddenExp = Math.min(cap.exp, Math.floor(cap.exp * 0.32 * tierMult));
  const flagSecretDoor = `flag_ch${padded}_secret_door`;
  const flagAftermath = `flag_ch${padded}_aftermath`;
  const flagInnerTested = `flag_ch${padded}_inner_tested`;
  const flagSecondaryWitness = `route_ch${padded}_secondary_witness`;
  const flagEchoedMemory = `route_ch${padded}_echoed_memory`;

  const hidden2: Phase33QuestDef = {
    questKey: `q_ch${padded}_hidden_02`,
    kind: 'hidden',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `Cơ duyên Chap ${t.chapNumber} — Cánh cửa bí`,
    titleEn: `Karma Chap ${t.chapNumber} — Secret Door`,
    descriptionVi: `Cánh cửa bí mật tại ${t.region} chỉ mở khi đã hậu sự sạch và bí mật địa phương đã hé lộ.`,
    descriptionEn: `The secret door at ${t.region} opens only after aftermath is done and the local secret is exposed.`,
    giverNpcKey: t.hiddenNpc,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: `q_ch${padded}_main_10`,
    requiredStoryFlags: [flagAftermath, flagSecretDoor],
    requiredAffinityNpcKey: t.hiddenNpc,
    requiredAffinityScore: Math.max(20, t.affinityScore - 10),
    steps: [
      { id: 'step_1', kind: 'explore', targetType: 'region', targetId: t.region, count: 1, descriptionVi: 'Tới cánh cửa bí.', descriptionEn: 'Approach the secret door.' },
      { id: 'step_2', kind: 'collect', targetType: 'item', targetId: t.collectItem, count: 1, descriptionVi: 'Lấy chìa khoá ẩn.', descriptionEn: 'Take the hidden key.' },
      { id: 'step_3', kind: 'flag_set', targetType: 'flag', targetId: flagSecondaryWitness, count: 1, descriptionVi: 'Đóng cờ chứng kiến phụ.', descriptionEn: 'Set the witness flag.' },
    ],
    rewards: {
      linhThach: hiddenBudget,
      exp: hiddenExp,
      congHien: 14,
      items: [{ itemKey: t.hiddenRewardItem, qty: 1, bind: true }],
      storyFlags: [flagSecondaryWitness],
      affinity: [{ npcKey: t.hiddenNpc, delta: 6 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: `Hậu sự sạch + bí mật địa phương + thân ${t.hiddenNpc} mới mở.`,
    hiddenTriggerHintEn: `Open only after aftermath cleared, local secret exposed, and close to ${t.hiddenNpc}.`,
    loreSummaryVi: `Hidden 2 — flag gate kép, mở dialogue node ẩn cho NPC ${t.hiddenNpc}.`,
    loreSummaryEn: `Hidden 2 — double flag gate, opens a hidden dialogue node for ${t.hiddenNpc}.`,
  };

  const hidden3: Phase33QuestDef = {
    questKey: `q_ch${padded}_hidden_03`,
    kind: 'hidden',
    chapKey: t.chapKey,
    volumeKey: t.volumeKey,
    titleVi: `Cơ duyên Chap ${t.chapNumber} — Mảnh ký ức vọng`,
    titleEn: `Karma Chap ${t.chapNumber} — Echoed Memory`,
    descriptionVi: `Khi tâm ma đã thử và đạo tâm vững, một mảnh ký ức của ${t.affinityNpcForHidden} vọng lại.`,
    descriptionEn: `Once the inner demon is tested and the dao heart holds, ${t.affinityNpcForHidden}'s memory echoes back.`,
    giverNpcKey: t.affinityNpcForHidden,
    requiredRealmKey: t.realmKey,
    requiredRealmOrder: t.realmOrder,
    prerequisiteQuestKey: `q_ch${padded}_main_14`,
    requiredStoryFlags: [flagInnerTested, `flag_ch${padded}_dao_heart`],
    requiredAffinityNpcKey: t.affinityNpcForHidden,
    requiredAffinityScore: t.affinityScore + 5,
    steps: [
      { id: 'step_1', kind: 'talk', targetType: 'npc', targetId: t.affinityNpcForHidden, count: 1, descriptionVi: 'Nghe ký ức.', descriptionEn: 'Hear the echo.' },
      { id: 'step_2', kind: 'choice', targetType: 'choice', targetId: `choice_ch${padded}_hidden_03_echo`, count: 1, descriptionVi: 'Lựa chọn lưu hay xoá.', descriptionEn: 'Keep or erase.' },
      { id: 'step_3', kind: 'flag_set', targetType: 'flag', targetId: flagEchoedMemory, count: 1, descriptionVi: 'Đóng cờ ký ức vọng.', descriptionEn: 'Lock the echoed memory flag.' },
    ],
    rewards: {
      linhThach: Math.min(cap.hidden, Math.floor(hiddenBudget * 0.95)),
      exp: Math.min(cap.exp, Math.floor(hiddenExp * 0.95)),
      congHien: 14,
      items: [{ itemKey: t.hiddenRewardItem, qty: 1, bind: true }],
      storyFlags: [flagEchoedMemory],
      affinity: [{ npcKey: t.affinityNpcForHidden, delta: 7 }],
    },
    rewardPolicyKey: t.rewardPolicyKey,
    dailyCap: null,
    weeklyCap: null,
    hiddenTriggerHintVi: `Cần tâm ma đã thử + đạo tâm vững + affinity ${t.affinityNpcForHidden} cao.`,
    hiddenTriggerHintEn: `Needs inner demon tested + dao heart held + high affinity with ${t.affinityNpcForHidden}.`,
    loreSummaryVi: `Hidden 3 — gate sâu nhất, mở mảnh ký ức bản nguyên cho ${t.affinityNpcForHidden}.`,
    loreSummaryEn: `Hidden 3 — deepest gate, unveils a memory shard for ${t.affinityNpcForHidden}.`,
  };

  return [hidden, hidden2, hidden3];
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
    ...branchQuestsFor(template),
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
export function phase33RewardCap(policyKey: Phase33RewardPolicyKey): Phase33RewardCapDef {
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
