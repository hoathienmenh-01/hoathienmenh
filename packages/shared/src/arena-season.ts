/**
 * Phase 14.1.C — Arena Season + ELO + Reward (shared).
 *
 * Pure data + deterministic helpers cho hệ Arena season:
 *   - ELO/rating helpers (logistic Elo, K-factor, clamp, win/loss/draw).
 *   - Season cadence (weekly Asia/Ho_Chi_Minh, mirror Sect War tuần).
 *   - Tier breakpoints (Bronze → Silver → Gold → Diamond → Immortal).
 *   - Reward table per tier — small, season-safe, không phá economy.
 *   - View shapes cho FE consume (current season, leaderboard, my-status,
 *     reward preview, settle result).
 *   - Error codes.
 *
 * KHÔNG runtime / IO / Math.random / DB / Prisma. Mọi runtime logic
 * (settle, mail, ledger) ở `apps/api/src/modules/arena/*`.
 *
 * Out-of-scope (defer Phase 14.1.D Anti-wintrade Detection):
 *   - Pattern detection same-IP / same-device / collusion.
 *   - Smurf detection / placement match.
 *   - Decay / inactivity penalty.
 *   - Cross-server arena.
 *   - Realtime PvP.
 *
 * @module arena-season
 */
import { sectWarWeekKey } from './sect-war';
import {
  ARENA_RATING_CEILING,
  ARENA_RATING_DEFAULT,
  ARENA_RATING_FLOOR,
  type ArenaMatchOutcome,
  type ArenaRatingDelta,
} from './arena';

/* ---------------------------------------------------------------------------
 * Config — timezone + duration
 * ------------------------------------------------------------------------- */

export const ARENA_SEASON_DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/**
 * Phase 14.1.C — Arena season cadence: WEEKLY ISO (mirror Sect War).
 *
 * Stable seasonKey format `arena_${ISO_WEEK_KEY}` (vd `arena_2026-W19`).
 * Server uses `sectWarWeekKey` từ shared để giữ logic timezone đồng nhất —
 * Arena season Monday 00:00 ICT → Monday 00:00 ICT tuần kế.
 *
 * Khi Phase 14.1.D / 14.1.E mở rộng sang monthly, helper sẽ được mở rộng
 * (multi-cadence), nhưng PR này fix weekly để FE/BE đơn giản.
 */
export type ArenaSeasonCadence = 'weekly';
export const ARENA_SEASON_CADENCE: ArenaSeasonCadence = 'weekly';

export interface ArenaSeasonConfig {
  readonly cadence: ArenaSeasonCadence;
  readonly timezone: string;
}

export const ARENA_SEASON_CONFIG: ArenaSeasonConfig = {
  cadence: 'weekly',
  timezone: ARENA_SEASON_DEFAULT_TZ,
};

/* ---------------------------------------------------------------------------
 * ELO config + helpers (deterministic)
 * ------------------------------------------------------------------------- */

/**
 * Phase 14.1.C — ELO config. Standard logistic Elo, base 400.
 *
 *   - `defaultRating`  : rating mặc định khi profile chưa có row (đồng bộ
 *     với `ARENA_RATING_DEFAULT` Phase 14.1.B = 1000).
 *   - `minRating`      : floor — không cho âm.
 *   - `maxRating`      : ceiling — sanity cap.
 *   - `kFactor`        : 32 standard tournament chess K-factor. Phase 14.1.D
 *     có thể tweak per-tier (Glicko-2 candidate) nhưng PR này fix 32.
 *   - `base`           : 400 (Elo logistic base).
 *   - `defenderScale`  : defender chỉ apply 60% K-factor — defender không
 *     proactively attack nên không grind nặng khi offline.
 */
export interface ArenaEloConfig {
  readonly defaultRating: number;
  readonly minRating: number;
  readonly maxRating: number;
  readonly kFactor: number;
  readonly base: number;
  readonly defenderScale: number;
}

export const ARENA_ELO_CONFIG: ArenaEloConfig = {
  defaultRating: ARENA_RATING_DEFAULT,
  minRating: ARENA_RATING_FLOOR,
  maxRating: ARENA_RATING_CEILING,
  kFactor: 32,
  base: 400,
  defenderScale: 0.6,
};

/**
 * Logistic expected score Elo: E_a = 1 / (1 + 10^((R_b - R_a) / base)).
 *
 * Pure: cùng (a, b) → cùng output.
 */
export function arenaEloExpected(
  a: number,
  b: number,
  cfg: ArenaEloConfig = ARENA_ELO_CONFIG,
): number {
  const exp = (b - a) / cfg.base;
  return 1 / (1 + Math.pow(10, exp));
}

/**
 * Score for an `ATTACKER_WIN` / `DEFENDER_WIN` / `DRAW` outcome from
 * attacker side. Pure.
 */
export function arenaEloScoreAttacker(outcome: ArenaMatchOutcome): number {
  if (outcome === 'ATTACKER_WIN') return 1;
  if (outcome === 'DEFENDER_WIN') return 0;
  return 0.5;
}

/**
 * Compute Elo rating delta cho cả attacker + defender. Trả về integer
 * deltas (Math.round) — giữ rating Int trong DB (Prisma).
 *
 * Defender delta scaled bởi `defenderScale` (default 0.6) để defender
 * offline không bị grind nặng.
 */
export function arenaEloRatingDelta(
  attackerRating: number,
  defenderRating: number,
  outcome: ArenaMatchOutcome,
  cfg: ArenaEloConfig = ARENA_ELO_CONFIG,
): ArenaRatingDelta {
  const ea = arenaEloExpected(attackerRating, defenderRating, cfg);
  const sa = arenaEloScoreAttacker(outcome);
  const rawAttacker = cfg.kFactor * (sa - ea);
  const rawDefender = cfg.kFactor * cfg.defenderScale * (ea - sa);
  return {
    attacker: Math.round(rawAttacker),
    defender: Math.round(rawDefender),
  };
}

/**
 * Apply Elo delta on attackerRating + clamp về `[minRating, maxRating]`.
 * Pure. Dùng trong service khi update profile/standing rating.
 */
export function arenaEloApply(
  rating: number,
  delta: number,
  cfg: ArenaEloConfig = ARENA_ELO_CONFIG,
): number {
  if (!Number.isFinite(rating)) return cfg.defaultRating;
  const next = Math.round(rating + delta);
  if (next < cfg.minRating) return cfg.minRating;
  if (next > cfg.maxRating) return cfg.maxRating;
  return next;
}

/* ---------------------------------------------------------------------------
 * Tier breakpoints
 * ------------------------------------------------------------------------- */

/**
 * Phase 14.1.C — 5 tier (placement bracket cho reward + leaderboard
 * grouping). Stable string key — đừng rename trong DB/migrations.
 *
 * Naming: dùng English style để không trộn lẫn lore tu tiên — Phase 14.1.D
 * có thể đổi sang Phàm/Linh/Huyền/Kim Đan/Tiên tuỳ design. PR 14.1.C giữ
 * generic để không khoá UI.
 */
export type ArenaSeasonTier =
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'DIAMOND'
  | 'IMMORTAL';

export const ARENA_SEASON_TIERS: readonly ArenaSeasonTier[] = [
  'BRONZE',
  'SILVER',
  'GOLD',
  'DIAMOND',
  'IMMORTAL',
];

export interface ArenaSeasonTierDef {
  readonly key: ArenaSeasonTier;
  /** Min rating thuộc tier (inclusive). */
  readonly minRating: number;
  /** Max rating thuộc tier (inclusive). +Infinity cho top tier. */
  readonly maxRating: number;
  /** i18n key cho FE render label. */
  readonly labelI18nKey: string;
}

/**
 * Phase 14.1.C — Tier breakpoints. Bronze cho rating thấp / placement,
 * Immortal cho top. Khoảng 200 rating per tier để curve rộng.
 */
export const ARENA_SEASON_TIER_TABLE: readonly ArenaSeasonTierDef[] = [
  { key: 'BRONZE', minRating: 0, maxRating: 999, labelI18nKey: 'arenaSeason.tier.BRONZE' },
  { key: 'SILVER', minRating: 1000, maxRating: 1199, labelI18nKey: 'arenaSeason.tier.SILVER' },
  { key: 'GOLD', minRating: 1200, maxRating: 1499, labelI18nKey: 'arenaSeason.tier.GOLD' },
  { key: 'DIAMOND', minRating: 1500, maxRating: 1799, labelI18nKey: 'arenaSeason.tier.DIAMOND' },
  {
    key: 'IMMORTAL',
    minRating: 1800,
    maxRating: Number.POSITIVE_INFINITY,
    labelI18nKey: 'arenaSeason.tier.IMMORTAL',
  },
] as const;

/**
 * Pure: rating → tier. Floor < 0 → BRONZE; > top → IMMORTAL.
 */
export function arenaSeasonTierFor(rating: number): ArenaSeasonTier {
  if (!Number.isFinite(rating)) return 'BRONZE';
  for (const def of ARENA_SEASON_TIER_TABLE) {
    if (rating >= def.minRating && rating <= def.maxRating) return def.key;
  }
  return 'BRONZE';
}

export function arenaSeasonTierDef(tier: ArenaSeasonTier): ArenaSeasonTierDef {
  const found = ARENA_SEASON_TIER_TABLE.find((t) => t.key === tier);
  if (!found) return ARENA_SEASON_TIER_TABLE[0];
  return found;
}

/* ---------------------------------------------------------------------------
 * Season key + window helpers
 * ------------------------------------------------------------------------- */

/**
 * Build seasonKey từ ISO week key. Stable string, không reuse cross-year.
 * Format `arena_<isoWeekKey>` — vd `arena_2026-W19`.
 */
export function arenaSeasonKeyForWeek(weekKey: string): string {
  return `arena_${weekKey}`;
}

/**
 * Tính seasonKey hiện tại theo `now`. Mirror cadence Sect War tuần ICT.
 */
export function arenaCurrentSeasonKey(
  now: Date,
  timezone: string = ARENA_SEASON_DEFAULT_TZ,
): string {
  return arenaSeasonKeyForWeek(sectWarWeekKey(now, timezone));
}

/**
 * Season status enum — mirror Prisma ArenaSeason.status.
 *
 *   - ACTIVE  : đang diễn ra; settle chưa chạy.
 *   - SETTLED : settle đã chạy → reward đã được mail (idempotent).
 *   - ARCHIVED: archived state cho UI history (Phase 14.1.D+ optional).
 */
export type ArenaSeasonStatus = 'ACTIVE' | 'SETTLED' | 'ARCHIVED';
export const ARENA_SEASON_STATUSES: readonly ArenaSeasonStatus[] = [
  'ACTIVE',
  'SETTLED',
  'ARCHIVED',
];

/* ---------------------------------------------------------------------------
 * Reward table
 * ------------------------------------------------------------------------- */

/**
 * Phase 14.1.C — Reward grant slice cho 1 tier. Mirror shape mail reward.
 *
 * Phase 14.1.C giữ scale economy-safe:
 *   - Bronze   : 200 LT — onboarding.
 *   - Silver   : 500 LT + 5 huyet_chi_dan.
 *   - Gold     : 1000 LT + 10 huyet_chi_dan.
 *   - Diamond  : 2000 LT + 5 linh_lo_dan + 20 TN.
 *   - Immortal : 5000 LT + 10 linh_lo_dan + 50 TN.
 *
 * Tổng LT cao nhất ~5k Linh Thạch — dưới 1 lần boss top-rank weekly để
 * không inflate economy. Items đều là consumables phổ biến (catalog
 * `items.ts`) không khoá content. Title/cosmetic defer Phase 14.1.D
 * vì pattern title chưa stable cho arena.
 */
export interface ArenaSeasonRewardItem {
  readonly itemKey: string;
  readonly qty: number;
}

export interface ArenaSeasonReward {
  readonly linhThach: number;
  readonly tienNgoc: number;
  readonly exp: number;
  readonly items: readonly ArenaSeasonRewardItem[];
}

export interface ArenaSeasonRewardTableEntry {
  readonly tier: ArenaSeasonTier;
  readonly reward: ArenaSeasonReward;
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
}

export const ARENA_SEASON_REWARD_TABLE: readonly ArenaSeasonRewardTableEntry[] = [
  {
    tier: 'BRONZE',
    reward: { linhThach: 200, tienNgoc: 0, exp: 0, items: [] },
    labelI18nKey: 'arenaSeason.tier.BRONZE',
    descriptionI18nKey: 'arenaSeason.reward.BRONZE.desc',
  },
  {
    tier: 'SILVER',
    reward: {
      linhThach: 500,
      tienNgoc: 0,
      exp: 0,
      items: [{ itemKey: 'huyet_chi_dan', qty: 5 }],
    },
    labelI18nKey: 'arenaSeason.tier.SILVER',
    descriptionI18nKey: 'arenaSeason.reward.SILVER.desc',
  },
  {
    tier: 'GOLD',
    reward: {
      linhThach: 1000,
      tienNgoc: 0,
      exp: 0,
      items: [{ itemKey: 'huyet_chi_dan', qty: 10 }],
    },
    labelI18nKey: 'arenaSeason.tier.GOLD',
    descriptionI18nKey: 'arenaSeason.reward.GOLD.desc',
  },
  {
    tier: 'DIAMOND',
    reward: {
      linhThach: 2000,
      tienNgoc: 20,
      exp: 0,
      items: [{ itemKey: 'linh_lo_dan', qty: 5 }],
    },
    labelI18nKey: 'arenaSeason.tier.DIAMOND',
    descriptionI18nKey: 'arenaSeason.reward.DIAMOND.desc',
  },
  {
    tier: 'IMMORTAL',
    reward: {
      linhThach: 5000,
      tienNgoc: 50,
      exp: 0,
      items: [{ itemKey: 'linh_lo_dan', qty: 10 }],
    },
    labelI18nKey: 'arenaSeason.tier.IMMORTAL',
    descriptionI18nKey: 'arenaSeason.reward.IMMORTAL.desc',
  },
] as const;

export function arenaSeasonRewardFor(tier: ArenaSeasonTier): ArenaSeasonReward {
  const entry = ARENA_SEASON_REWARD_TABLE.find((e) => e.tier === tier);
  if (!entry) return ARENA_SEASON_REWARD_TABLE[0].reward;
  return entry.reward;
}

/**
 * Validate reward slice — pure invariant guard. Trả về true nếu reward
 * không âm + items qty positive + itemKey non-empty. Server gọi trong
 * test guard và optional sanity-check khi load catalog.
 */
export function isArenaSeasonRewardValid(reward: ArenaSeasonReward): boolean {
  if (!Number.isFinite(reward.linhThach) || reward.linhThach < 0) return false;
  if (!Number.isFinite(reward.tienNgoc) || reward.tienNgoc < 0) return false;
  if (!Number.isFinite(reward.exp) || reward.exp < 0) return false;
  for (const it of reward.items) {
    if (!it.itemKey || typeof it.itemKey !== 'string') return false;
    if (!Number.isFinite(it.qty) || it.qty <= 0) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------
 * View shapes
 * ------------------------------------------------------------------------- */

export interface ArenaSeasonView {
  readonly seasonKey: string;
  readonly status: ArenaSeasonStatus;
  readonly startsAtIso: string;
  readonly endsAtIso: string;
  readonly settledAtIso: string | null;
  readonly cadence: ArenaSeasonCadence;
  readonly timezone: string;
}

export interface ArenaLeaderboardEntry {
  readonly rank: number;
  readonly characterId: string;
  readonly characterName: string;
  readonly rating: number;
  readonly tier: ArenaSeasonTier;
  readonly wins: number;
  readonly losses: number;
  readonly sectName: string | null;
}

export interface ArenaLeaderboardView {
  readonly seasonKey: string;
  readonly entries: readonly ArenaLeaderboardEntry[];
  readonly total: number;
}

export interface ArenaMyStandingView {
  readonly seasonKey: string;
  readonly characterId: string;
  readonly rating: number;
  readonly tier: ArenaSeasonTier;
  readonly wins: number;
  readonly losses: number;
  readonly rank: number | null;
}

export interface ArenaSeasonRewardPreviewEntry {
  readonly tier: ArenaSeasonTier;
  readonly reward: ArenaSeasonReward;
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
}

export interface ArenaSeasonRewardPreviewView {
  readonly seasonKey: string;
  readonly tiers: readonly ArenaSeasonRewardPreviewEntry[];
}

export interface ArenaSeasonSettleSummary {
  readonly seasonKey: string;
  readonly settledAtIso: string;
  /** Số participants có ít nhất 1 row standing trong season. */
  readonly participants: number;
  /** Số reward grant đã tạo (mới + đã có sẵn — same row idempotent). */
  readonly grants: number;
  /** Số reward grant mới (chưa có ở settle trước → mail được tạo). */
  readonly newGrants: number;
}

/* ---------------------------------------------------------------------------
 * Error codes
 * ------------------------------------------------------------------------- */

export type ArenaSeasonErrorCode =
  | 'NO_CHARACTER'
  | 'SEASON_NOT_FOUND'
  | 'SEASON_NOT_ACTIVE'
  | 'SEASON_ALREADY_SETTLED'
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ADMIN_ONLY';

export const ARENA_SEASON_ERROR_CODES: readonly ArenaSeasonErrorCode[] = [
  'NO_CHARACTER',
  'SEASON_NOT_FOUND',
  'SEASON_NOT_ACTIVE',
  'SEASON_ALREADY_SETTLED',
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'ADMIN_ONLY',
];

export function isArenaSeasonErrorCode(value: unknown): value is ArenaSeasonErrorCode {
  return (
    typeof value === 'string' &&
    (ARENA_SEASON_ERROR_CODES as readonly string[]).includes(value)
  );
}
