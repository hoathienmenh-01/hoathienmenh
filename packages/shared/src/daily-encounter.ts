/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ
 *
 * Shared catalog defining all possible daily encounters a character can roll
 * into. The API service rolls deterministically from `(characterId, dateKey)`
 * so a character sees the same encounter for the same day, and a fresh
 * encounter the next day.
 *
 * Reward guardrails (audited by `daily-encounter.test.ts`):
 *  - Only `linhThach` ∈ [0, 400] per encounter.
 *  - Only `exp` ∈ [0, 1500] per encounter.
 *  - **NO** `tienNgoc` minted (catalog enforces `tienNgoc = 0`).
 *  - **NO** endgame item / inventory grant (catalog `items: []`).
 *  - Hidden / rare encounters require story flag or realm gate — they do NOT
 *    leak in the regular daily roll until unlocked.
 *  - Choices may shift small affinity / flavour journal entries only — they
 *    MUST NOT change the catalog reward.
 *  - Encounter is **stateless** from the catalog's POV — runtime state lives
 *    in `CharacterDailyEncounter`.
 */
import type { Quality } from './enums';

export const DAILY_ENCOUNTER_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'hidden',
] as const;
export type DailyEncounterRarity = (typeof DAILY_ENCOUNTER_RARITIES)[number];

export const DAILY_ENCOUNTER_TYPES = [
  'stranger_npc',
  'inner_demon',
  'herb_alchemy',
  'ancient_formation',
  'mystery_trader',
  'wounded_cultivator',
  'tiny_secret_realm',
  'minor_boss',
] as const;
export type DailyEncounterType = (typeof DAILY_ENCOUNTER_TYPES)[number];

export const DAILY_ENCOUNTER_REWARD_CAPS = {
  /** Per-encounter linh thạch reward cap (claim amount). */
  linhThachMax: 400,
  /** Per-encounter exp reward cap. */
  expMax: 1500,
  /** Maximum affinity delta a choice can grant. */
  affinityDeltaMax: 5,
} as const;

export interface DailyEncounterRewardDef {
  /** Linh thạch granted on claim (atomic via CurrencyService.applyTx). */
  linhThach: number;
  /** EXP granted on claim. */
  exp: number;
  /** Reserved future field — Tiên Ngọc MUST always be 0 in Phase 34.1. */
  tienNgoc: 0;
  /** Reserved — item grants. Empty in Phase 34.1 (no inventory mutation). */
  items: readonly { itemKey: string; qty: number; bind?: boolean }[];
  /**
   * Reserved — optional NPC affinity bonus. `delta` is clamped to
   * `affinityDeltaMax` at apply time.
   */
  affinityNpcKey?: string;
  affinityDelta?: number;
}

export interface DailyEncounterChoiceDef {
  /** Stable choice id. */
  choiceKey: string;
  /** UI label. */
  labelVi: string;
  labelEn: string;
  /**
   * Optional affinity hint for the choice — same constraints as
   * `rewardProfile.affinityDelta`. Does NOT change the base reward.
   */
  affinityNpcKey?: string;
  affinityDelta?: number;
  /** Free-form flavour text appended to the journal entry. */
  flavourVi?: string;
  flavourEn?: string;
}

export interface DailyEncounterDef {
  /** Stable catalog key (also stored in `CharacterDailyEncounter.encounterKey`). */
  key: string;
  type: DailyEncounterType;
  rarity: DailyEncounterRarity;
  /** Display title. */
  titleVi: string;
  titleEn: string;
  /** Brief intro / journal snippet. */
  descriptionVi: string;
  descriptionEn: string;
  /** Required realm order — encounters above the player realm are excluded. */
  requiredRealmOrder: number;
  /**
   * Optional story flag gate — only roll when the character's storyFlags
   * include EVERY listed flag. Used for hidden chains.
   */
  requiredStoryFlags?: readonly string[];
  /**
   * Optional chapter gate — only roll when Phase 33 chapter progress >= this.
   * Plain ordering hint; service performs the actual lookup.
   */
  requiredChapterOrder?: number;
  /** Reward profile (always linh thạch + exp only, no premium currency). */
  rewardProfile: DailyEncounterRewardDef;
  /** Optional choice tree (max 4 branches). */
  choices?: readonly DailyEncounterChoiceDef[];
  /** Optional cosmetic decoration (UI badge / quality tint). */
  badgeQuality?: Quality;
}

const E = (
  key: string,
  type: DailyEncounterType,
  rarity: DailyEncounterRarity,
  titleVi: string,
  titleEn: string,
  descriptionVi: string,
  descriptionEn: string,
  requiredRealmOrder: number,
  reward: { linhThach: number; exp: number },
  extras: Partial<
    Pick<
      DailyEncounterDef,
      | 'requiredStoryFlags'
      | 'requiredChapterOrder'
      | 'choices'
      | 'badgeQuality'
    >
  > = {},
): DailyEncounterDef => ({
  key,
  type,
  rarity,
  titleVi,
  titleEn,
  descriptionVi,
  descriptionEn,
  requiredRealmOrder,
  rewardProfile: {
    linhThach: reward.linhThach,
    exp: reward.exp,
    tienNgoc: 0,
    items: [],
  },
  ...extras,
});

export const DAILY_ENCOUNTERS: readonly DailyEncounterDef[] = [
  // ── Common (early realm) ─────────────────────────────────────────────────
  E(
    'enc_stranger_woodsman',
    'stranger_npc',
    'common',
    'Tiều phu kỳ lạ',
    'Mysterious Woodsman',
    'Một lão tiều phu mời bạn ngồi uống trà rồi tặng ít linh thạch tiêu vặt.',
    'An old woodsman invites you for tea and gifts you some spare spirit stones.',
    1,
    { linhThach: 30, exp: 80 },
    {
      choices: [
        {
          choiceKey: 'accept_tea',
          labelVi: 'Uống cùng lão',
          labelEn: 'Share the tea',
          flavourVi: 'Bạn lắng nghe lão kể chuyện rừng già.',
          flavourEn: 'You listen to his old-forest tales.',
        },
        {
          choiceKey: 'polite_decline',
          labelVi: 'Cảm tạ rồi đi',
          labelEn: 'Politely decline',
          flavourVi: 'Bạn nhận lễ rồi rời đi.',
          flavourEn: 'You accept the courtesy and depart.',
        },
      ],
    },
  ),
  E(
    'enc_herb_patch',
    'herb_alchemy',
    'common',
    'Khóm linh thảo',
    'Spirit-herb Patch',
    'Một khóm linh thảo mọc tươi tốt bên đường. Hái ít làm dược.',
    'A vibrant spirit-herb patch by the road. Pick a few for alchemy.',
    1,
    { linhThach: 20, exp: 60 },
  ),
  E(
    'enc_mystery_trader_low',
    'mystery_trader',
    'common',
    'Thương nhân bí ẩn',
    'Mystery Trader',
    'Thương nhân áo nâu chìa ra mấy món hàng rẻ. Có thể mua nếu muốn.',
    'A brown-robed trader displays cheap wares. Buy if you wish.',
    2,
    { linhThach: 40, exp: 80 },
  ),

  // ── Uncommon (mid realm) ────────────────────────────────────────────────
  E(
    'enc_wounded_cultivator',
    'wounded_cultivator',
    'uncommon',
    'Tu sĩ bị thương',
    'Wounded Cultivator',
    'Một tu sĩ ngồi gục, máu loang. Bạn có thể tặng đan dược hoặc đi qua.',
    'A cultivator slumps bleeding. You may share an elixir or move on.',
    3,
    { linhThach: 80, exp: 200 },
    {
      choices: [
        {
          choiceKey: 'offer_pill',
          labelVi: 'Tặng đan',
          labelEn: 'Offer pill',
          flavourVi: 'Hắn cảm tạ rồi tặng lại một mảnh ngọc bội.',
          flavourEn: 'He thanks you and gifts back a small jade fragment.',
          affinityNpcKey: 'random_pilgrim',
          affinityDelta: 2,
        },
        {
          choiceKey: 'pass_by',
          labelVi: 'Đi qua',
          labelEn: 'Walk past',
          flavourVi: 'Bạn rời đi trong im lặng.',
          flavourEn: 'You leave in silence.',
        },
      ],
    },
  ),
  E(
    'enc_ancient_formation_pebble',
    'ancient_formation',
    'uncommon',
    'Trận đá cổ',
    'Ancient Stone Array',
    'Một mảng đá xếp theo Ngũ Hành lờ mờ. Giải mã đem lại linh khí.',
    'An array of stones in faint Five-Element pattern. Decoding yields spirit qi.',
    4,
    { linhThach: 100, exp: 240 },
  ),
  E(
    'enc_minor_boss_wolf',
    'minor_boss',
    'uncommon',
    'Sói linh đầu lĩnh',
    'Spirit-wolf Alpha',
    'Một con sói linh hung dữ chặn đường. Chiến hoặc tránh.',
    'A fierce spirit-wolf alpha blocks your path. Fight or evade.',
    4,
    { linhThach: 120, exp: 300 },
    { badgeQuality: 'LINH' },
  ),

  // ── Rare ────────────────────────────────────────────────────────────────
  E(
    'enc_inner_demon_whisper',
    'inner_demon',
    'rare',
    'Tâm ma thì thầm',
    'Whisper of Inner Demon',
    'Tâm ma rỉ tai bạn lời cay nghiệt. Vượt qua củng cố đạo tâm.',
    'Inner demons whisper bitter words. Overcoming strengthens your Dao heart.',
    5,
    { linhThach: 180, exp: 500 },
    { badgeQuality: 'HUYEN' },
  ),
  E(
    'enc_mystery_trader_rare',
    'mystery_trader',
    'rare',
    'Lữ khách viễn xứ',
    'Faraway Pilgrim',
    'Một lữ khách áo trắng bán pháp khí kỳ lạ với giá hời.',
    'A white-robed pilgrim sells rare artifacts at fair prices.',
    6,
    { linhThach: 220, exp: 640 },
    { badgeQuality: 'HUYEN' },
  ),
  E(
    'enc_tiny_secret_realm',
    'tiny_secret_realm',
    'rare',
    'Bí cảnh nhỏ',
    'Tiny Secret Realm',
    'Một khe nứt không gian dẫn vào bí cảnh nhỏ. Có thể tiến vào để nhận linh khí.',
    'A small spatial rift leads to a tiny realm. Enter for a spirit-qi reward.',
    7,
    { linhThach: 260, exp: 800 },
    { badgeQuality: 'HUYEN' },
  ),

  // ── Hidden (gated) ──────────────────────────────────────────────────────
  E(
    'enc_hidden_dao_council',
    'inner_demon',
    'hidden',
    'Tịch dạ vấn đạo',
    'Silent-night Dao Council',
    'Một bóng dáng tiên gia mời bạn vấn đạo. Tâm ma lui xa.',
    'A faded immortal silhouette invites you to a Dao audience. Inner demons recede.',
    8,
    { linhThach: 400, exp: 1500 },
    {
      requiredStoryFlags: ['ch9_intro_done'],
      badgeQuality: 'TIEN',
    },
  ),
  E(
    'enc_hidden_lost_scripture',
    'herb_alchemy',
    'hidden',
    'Trúc đẹp tàn quyển',
    'Lost Bamboo Scripture',
    'Bạn tìm thấy cuộn trúc cổ. Giải mã giúp thấu đạo.',
    'You find an ancient bamboo scripture. Decoding deepens your Dao insight.',
    9,
    { linhThach: 350, exp: 1400 },
    {
      requiredStoryFlags: ['ch10_intro_done'],
      badgeQuality: 'TIEN',
    },
  ),
] as const;

/** Encounter index by key (O(1) lookup). */
export function dailyEncounterByKey(key: string): DailyEncounterDef | undefined {
  return DAILY_ENCOUNTERS.find((e) => e.key === key);
}

/**
 * List all encounters available to a character given its realm + story-flag
 * snapshot. Hidden encounters require ALL their `requiredStoryFlags` to be
 * present. Used by the roller to build the candidate pool.
 */
export function dailyEncountersAvailableFor(opts: {
  realmOrder: number;
  storyFlags?: ReadonlySet<string>;
  chapterOrder?: number;
}): DailyEncounterDef[] {
  const flags = opts.storyFlags ?? new Set<string>();
  return DAILY_ENCOUNTERS.filter((e) => {
    if (e.requiredRealmOrder > opts.realmOrder) return false;
    if (e.requiredChapterOrder && opts.chapterOrder !== undefined) {
      if (opts.chapterOrder < e.requiredChapterOrder) return false;
    }
    if (e.requiredStoryFlags && e.requiredStoryFlags.length > 0) {
      for (const f of e.requiredStoryFlags) {
        if (!flags.has(f)) return false;
      }
    }
    return true;
  });
}

/**
 * Deterministic encounter roller. Given a stable seed `(characterId, dateKey)`
 * derives an index into the available pool. The same `(seed, pool)` always
 * returns the same encounter, so re-reading the same day is idempotent.
 *
 * Falls back to the first common encounter if no candidates match.
 */
export function rollDailyEncounter(opts: {
  seed: string;
  realmOrder: number;
  storyFlags?: ReadonlySet<string>;
  chapterOrder?: number;
}): DailyEncounterDef {
  const pool = dailyEncountersAvailableFor(opts);
  if (pool.length === 0) {
    return DAILY_ENCOUNTERS[0]!;
  }
  // Simple FNV-1a hash → integer index. Deterministic, no Math.random.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < opts.seed.length; i++) {
    h ^= opts.seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const idx = h % pool.length;
  return pool[idx]!;
}
