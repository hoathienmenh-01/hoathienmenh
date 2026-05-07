/**
 * Sect War (Tông Môn Chiến) — Phase 13.1.A core catalog & helpers.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration.
 *
 * Mục tiêu PR (file 13.1.A):
 *   - Định nghĩa Activity catalog (key/points/cap/sourceType/i18n).
 *   - Định nghĩa Reward tier theo rank tuần (1, 2-3, 4-10, participation).
 *   - Helper compute weekKey/season cho timezone-aware Tông Môn Chiến tuần.
 *   - View shapes cho leaderboard / personal status mà API & FE share.
 *
 * Catalog scope (Phase 13.1.A — KHÔNG mở Sect Missions / Sect Shop / admin CMS):
 *   - daily_login              : claim daily login → 5 pts (1/ngày).
 *   - dungeon_clear            : claim DungeonRun → 10 pts (cap 50/ngày).
 *   - boss_participation       : tham gia damage boss → 15 pts (cap 120/tuần).
 *   - boss_top_damage          : rank 1 damage → +25 pts bonus (cap 100/tuần).
 *   - quest_complete           : claim quest → 8 pts (cap 80/tuần).
 *
 * Reward tier philosophy (BALANCE_MODEL.md §weekly):
 *   - Top 1: ~5000 LT + 200 TN — rare reward, ngang ~2 ngày boss top-rank.
 *   - Top 2-3: ~2500 LT + 100 TN.
 *   - Top 4-10: ~1000 LT + 50 TN — participation-tier hợp lý.
 *   - Participation (≥50 pts cá nhân): 200 LT — onboarding, encourage attempt.
 *
 * Anti-abuse:
 *   - Mỗi activity có dailyCap/weeklyCap optional (0 → unlimited).
 *   - Idempotency tracked qua sourceType + sourceId trong runtime
 *     (xem `apps/api/src/modules/sect-war/sect-war.service.ts`).
 *   - Server-authoritative; FE không tự cộng điểm.
 *   - Character không có sect → KHÔNG cộng điểm (skip safely).
 */

import { LIVE_OPS_DEFAULT_TZ, localPartsInTz, utcDateForLocal } from './liveops';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Activity key cho Sect War contribution.
 *
 * Stable string immutable — đừng rename trong DB sau khi production.
 * Nếu thêm activity mới → append, KHÔNG remove (lịch sử migration safe).
 */
export type SectWarActivityKey =
  | 'daily_login'
  | 'dungeon_clear'
  | 'boss_participation'
  | 'boss_top_damage'
  | 'quest_complete';

/**
 * Source type — gắn vào idempotency key cùng `sourceId`.
 *
 * Conv: 1 sourceType ↔ 1 unique entity domain (e.g. `DungeonRun` table id).
 * Cùng (weekKey, sourceType, sourceId, characterId, activityKey) chỉ ghi 1 row.
 */
export type SectWarSourceType =
  | 'DailyLoginClaim'
  | 'DungeonRun'
  | 'WorldBoss'
  | 'Quest';

/**
 * Reward tier key — stable cho persistence + idempotent claim.
 */
export type SectWarRewardTierKey = 'rank_1' | 'rank_2_3' | 'rank_4_10' | 'participation';

export interface SectWarActivityDef {
  /** Activity key — DB stable identifier. */
  readonly key: SectWarActivityKey;
  /** Points cộng cho Sect war mỗi lần trigger. */
  readonly points: number;
  /**
   * Daily cap per character (theo timezone tuần, midnight reset).
   * 0 hoặc undefined = không cap theo ngày.
   */
  readonly dailyCap?: number;
  /**
   * Weekly cap per character (theo weekKey).
   * 0 hoặc undefined = không cap theo tuần.
   */
  readonly weeklyCap?: number;
  /** Source type cho idempotency key. */
  readonly sourceType: SectWarSourceType;
  /** i18n key cho FE render (vd `sectWar.activity.dungeon_clear.label`). */
  readonly labelI18nKey: string;
  /** i18n key cho mô tả ngắn (vd `sectWar.activity.dungeon_clear.desc`). */
  readonly descriptionI18nKey: string;
}

/**
 * Reward grant slice (sub-set của full grant pipeline).
 *
 * Hiện tại Phase 13.1.A chỉ dùng linhThach + tienNgoc (đảm bảo không phá
 * economy). Title/buff/item placeholder cho mở rộng tương lai (Phase 13.1.B+),
 * KHÔNG implement runtime grant trong PR này (xem ECONOMY_MODEL.md).
 */
export interface SectWarRewardGrant {
  readonly linhThach?: number;
  readonly tienNgoc?: number;
  /** Item key trong catalog `items.ts` (kèm qty). KHÔNG dùng trong 13.1.A — placeholder. */
  readonly items?: ReadonlyArray<{ readonly itemKey: string; readonly qty: number }>;
  /** Title key trong catalog `titles.ts`. KHÔNG dùng trong 13.1.A — placeholder. */
  readonly titleKey?: string;
  /** Buff key trong catalog `buffs.ts`. KHÔNG dùng trong 13.1.A — placeholder. */
  readonly buffKey?: string;
}

export interface SectWarRewardTierDef {
  /** Tier key — DB stable identifier. */
  readonly key: SectWarRewardTierKey;
  /** Min rank inclusive (rank của Sect trên leaderboard tuần). */
  readonly minRank: number;
  /** Max rank inclusive (Number.POSITIVE_INFINITY = không cap). */
  readonly maxRank: number;
  /**
   * Tối thiểu personal points để eligible (>=).
   * 0 hoặc undefined = không yêu cầu cá nhân.
   */
  readonly minPersonalPoints?: number;
  /** Reward grant payload. */
  readonly reward: SectWarRewardGrant;
  /** i18n key tier label (vd `sectWar.tier.rank_1.label`). */
  readonly labelI18nKey: string;
  /** i18n key tier description. */
  readonly descriptionI18nKey: string;
}

export interface SectWarSeasonDef {
  /** Stable season key — chuỗi YYYY-Www (ISO week, e.g. `2026-W19`). */
  readonly weekKey: string;
  /** Start UTC ISO của tuần (Monday 00:00 trong timezone). */
  readonly startsAtIso: string;
  /** End UTC ISO của tuần (Monday 00:00 tuần kế trong timezone). */
  readonly endsAtIso: string;
  /** Timezone dùng để compute cutoff. */
  readonly timezone: string;
}

/**
 * Hàng leaderboard tuần — sect aggregate.
 *
 * `sectName` snapshot tại request time để FE render trực tiếp (không cần
 * extra round-trip). `points` là tổng contribution của mọi character thuộc
 * sect đó trong weekKey.
 */
export interface SectWarLeaderboardRow {
  readonly rank: number;
  readonly sectId: string;
  readonly sectName: string;
  readonly points: number;
  readonly contributors: number;
}

export interface SectWarLeaderboardView {
  readonly weekKey: string;
  readonly rows: ReadonlyArray<SectWarLeaderboardRow>;
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Activity catalog — stable order: daily_login → dungeon → boss participation
 * → boss top damage → quest. Đừng đảo trừ khi cần thiết để FE/test snapshot
 * không bị break.
 */
export const SECT_WAR_ACTIVITIES: readonly SectWarActivityDef[] = [
  {
    key: 'daily_login',
    points: 5,
    dailyCap: 5,
    weeklyCap: 35,
    sourceType: 'DailyLoginClaim',
    labelI18nKey: 'sectWar.activity.daily_login.label',
    descriptionI18nKey: 'sectWar.activity.daily_login.desc',
  },
  {
    key: 'dungeon_clear',
    points: 10,
    dailyCap: 50,
    weeklyCap: 250,
    sourceType: 'DungeonRun',
    labelI18nKey: 'sectWar.activity.dungeon_clear.label',
    descriptionI18nKey: 'sectWar.activity.dungeon_clear.desc',
  },
  {
    key: 'boss_participation',
    points: 15,
    weeklyCap: 120,
    sourceType: 'WorldBoss',
    labelI18nKey: 'sectWar.activity.boss_participation.label',
    descriptionI18nKey: 'sectWar.activity.boss_participation.desc',
  },
  {
    key: 'boss_top_damage',
    points: 25,
    weeklyCap: 100,
    sourceType: 'WorldBoss',
    labelI18nKey: 'sectWar.activity.boss_top_damage.label',
    descriptionI18nKey: 'sectWar.activity.boss_top_damage.desc',
  },
  {
    key: 'quest_complete',
    points: 8,
    weeklyCap: 80,
    sourceType: 'Quest',
    labelI18nKey: 'sectWar.activity.quest_complete.label',
    descriptionI18nKey: 'sectWar.activity.quest_complete.desc',
  },
];

/**
 * Reward tier catalog — stable order: rank_1, rank_2_3, rank_4_10, participation.
 *
 * Eligibility rules:
 *   - rank_1 / rank_2_3 / rank_4_10: sect rank match; personal points không yêu cầu.
 *   - participation: sect rank > 10 (or any) BUT personal points ≥ 50.
 *
 * Phase 13.1.A: chỉ dùng linhThach + tienNgoc (an toàn economy). Title/buff
 * giữ placeholder cho 13.1.B+.
 */
export const SECT_WAR_REWARD_TIERS: readonly SectWarRewardTierDef[] = [
  {
    key: 'rank_1',
    minRank: 1,
    maxRank: 1,
    reward: { linhThach: 5000, tienNgoc: 200 },
    labelI18nKey: 'sectWar.tier.rank_1.label',
    descriptionI18nKey: 'sectWar.tier.rank_1.desc',
  },
  {
    key: 'rank_2_3',
    minRank: 2,
    maxRank: 3,
    reward: { linhThach: 2500, tienNgoc: 100 },
    labelI18nKey: 'sectWar.tier.rank_2_3.label',
    descriptionI18nKey: 'sectWar.tier.rank_2_3.desc',
  },
  {
    key: 'rank_4_10',
    minRank: 4,
    maxRank: 10,
    reward: { linhThach: 1000, tienNgoc: 50 },
    labelI18nKey: 'sectWar.tier.rank_4_10.label',
    descriptionI18nKey: 'sectWar.tier.rank_4_10.desc',
  },
  {
    key: 'participation',
    minRank: 1,
    maxRank: Number.POSITIVE_INFINITY,
    minPersonalPoints: 50,
    reward: { linhThach: 200 },
    labelI18nKey: 'sectWar.tier.participation.label',
    descriptionI18nKey: 'sectWar.tier.participation.desc',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Default timezone — match LiveOps + Mission reset (Asia/Ho_Chi_Minh).
 *
 * Override qua API runtime nếu cần (e.g. process.env.SECT_WAR_TZ) — nhưng
 * default phải sync với gameplay loop để tránh boundary edge case.
 */
export const SECT_WAR_DEFAULT_TZ = LIVE_OPS_DEFAULT_TZ;

/**
 * Lookup activity definition theo key. Trả undefined nếu không tồn tại
 * (KHÔNG throw — caller decide).
 */
export function sectWarActivityByKey(
  key: string,
): SectWarActivityDef | undefined {
  return SECT_WAR_ACTIVITIES.find((a) => a.key === key);
}

/**
 * Lookup reward tier theo rank + personal points.
 *
 * Logic:
 *   1. Match tier có (minRank ≤ rank ≤ maxRank) AND
 *      (minPersonalPoints undefined OR personalPoints ≥ minPersonalPoints).
 *   2. Trả tier đầu tiên match (catalog order quyết định priority).
 *   3. Trả undefined nếu không có tier phù hợp.
 *
 * Note: Catalog đặt rank-based tier trước participation tier nên rank cao
 * (1, 2-3, 4-10) sẽ match rank tier trước; rank > 10 fall through tới
 * participation (yêu cầu ≥50 personal points).
 */
export function sectWarRewardTierForRank(
  rank: number,
  personalPoints: number,
): SectWarRewardTierDef | undefined {
  if (!Number.isFinite(rank) || rank < 1) return undefined;
  for (const tier of SECT_WAR_REWARD_TIERS) {
    if (rank < tier.minRank) continue;
    if (rank > tier.maxRank) continue;
    if (
      tier.minPersonalPoints !== undefined &&
      personalPoints < tier.minPersonalPoints
    ) {
      continue;
    }
    return tier;
  }
  return undefined;
}

/**
 * Compute ISO week key cho timestamp `now` trong `timezone`.
 *
 * Convention:
 *   - Tuần bắt đầu Monday 00:00 (ISO 8601, getISOWeek standard).
 *   - Format `YYYY-Www` (vd `2026-W19` cho tuần ISO #19 năm 2026).
 *   - Stable cho mọi giờ trong cùng tuần (test invariance).
 *
 * Ví dụ Asia/Ho_Chi_Minh:
 *   - 2026-05-04 00:00 ICT (Monday) → `2026-W19`.
 *   - 2026-05-10 23:59 ICT (Sunday) → `2026-W19`.
 *   - 2026-05-11 00:00 ICT (Monday) → `2026-W20`.
 */
export function sectWarWeekKey(
  now: Date,
  timezone: string = SECT_WAR_DEFAULT_TZ,
): string {
  const parts = localPartsInTz(now, timezone);
  // ISO week: Monday=1..Sunday=7. JS dayOfWeek (Sunday=0..Saturday=6) → ISO.
  const isoDow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;
  // Tính ngày Thursday cùng tuần (ISO week định nghĩa qua Thursday).
  // Local date object cho parts.year/month/day (UTC arith — tz đã apply).
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dt = new Date(utc);
  dt.setUTCDate(dt.getUTCDate() + 4 - isoDow); // Thursday cùng tuần.
  const weekYear = dt.getUTCFullYear();
  // Đầu năm: 1/1 weekYear. Tuần 1 chứa 4/1 (ISO định nghĩa).
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const yearStartDow = yearStart.getUTCDay() === 0 ? 7 : yearStart.getUTCDay();
  // Thursday đầu năm = 1/1 + (4 - yearStartDow) days.
  const firstThursday = new Date(yearStart);
  firstThursday.setUTCDate(yearStart.getUTCDate() + (4 - yearStartDow));
  // Diff days giữa dt (Thursday) và firstThursday → tuần index.
  const diffMs = dt.getTime() - firstThursday.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  const weekNum = Math.floor(diffDays / 7) + 1;
  const weekStr = String(weekNum).padStart(2, '0');
  return `${weekYear}-W${weekStr}`;
}

/**
 * Compute season metadata cho weekKey hiện tại — start/end timestamps phục vụ
 * FE countdown + API claim window guard.
 *
 * Rule:
 *   - `startsAtIso` = Monday 00:00 trong `timezone` của tuần.
 *   - `endsAtIso`   = Monday 00:00 trong `timezone` của tuần kế (exclusive).
 *
 * Dùng `localPartsInTz` + `utcDateForLocal` từ liveops để giữ timezone
 * compute consistency với LiveOps slot start.
 */
export function currentSectWarSeason(
  now: Date,
  timezone: string = SECT_WAR_DEFAULT_TZ,
): SectWarSeasonDef {
  const parts = localPartsInTz(now, timezone);
  const isoDow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;
  // Monday cùng tuần (đã ở local timezone).
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dt = new Date(utc);
  dt.setUTCDate(dt.getUTCDate() - (isoDow - 1));
  const mondayY = dt.getUTCFullYear();
  const mondayM = dt.getUTCMonth() + 1;
  const mondayD = dt.getUTCDate();
  const startsAt = utcDateForLocal(mondayY, mondayM, mondayD, 0, 0, timezone);
  // Monday tuần kế.
  const next = new Date(dt);
  next.setUTCDate(next.getUTCDate() + 7);
  const endsAt = utcDateForLocal(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timezone,
  );
  return {
    weekKey: sectWarWeekKey(now, timezone),
    startsAtIso: startsAt.toISOString(),
    endsAtIso: endsAt.toISOString(),
    timezone,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Validation (catalog invariants — runtime check + test guard)
// ────────────────────────────────────────────────────────────────────────

export type SectWarValidationCode =
  | 'INVALID_KEY'
  | 'INVALID_POINTS'
  | 'INVALID_DAILY_CAP'
  | 'INVALID_WEEKLY_CAP'
  | 'INVALID_TIER_RANK'
  | 'INVALID_TIER_REWARD'
  | 'INVALID_TIER_PERSONAL_POINTS';

/**
 * Validate SectWarActivityDef.
 *
 * Rules:
 *   - key ∈ SectWarActivityKey enum (test invariant).
 *   - points > 0.
 *   - dailyCap (nếu có) ≥ points.
 *   - weeklyCap (nếu có) ≥ points; nếu có cả daily + weekly → weeklyCap ≥ dailyCap.
 *
 * Trả null = pass; trả code = fail.
 */
export function validateSectWarActivity(
  def: SectWarActivityDef,
): SectWarValidationCode | null {
  if (!/^[a-z][a-z0-9_]*$/.test(def.key)) return 'INVALID_KEY';
  if (!Number.isFinite(def.points) || def.points <= 0) return 'INVALID_POINTS';
  if (def.dailyCap !== undefined) {
    if (!Number.isFinite(def.dailyCap) || def.dailyCap < def.points) {
      return 'INVALID_DAILY_CAP';
    }
  }
  if (def.weeklyCap !== undefined) {
    if (!Number.isFinite(def.weeklyCap) || def.weeklyCap < def.points) {
      return 'INVALID_WEEKLY_CAP';
    }
    if (
      def.dailyCap !== undefined &&
      def.weeklyCap < def.dailyCap
    ) {
      return 'INVALID_WEEKLY_CAP';
    }
  }
  return null;
}

/**
 * Validate SectWarRewardTierDef.
 *
 * Rules:
 *   - minRank ≥ 1.
 *   - maxRank ≥ minRank (POSITIVE_INFINITY OK).
 *   - reward có ít nhất 1 grant (linhThach > 0 OR tienNgoc > 0 OR items.length>0
 *     OR titleKey OR buffKey).
 *   - minPersonalPoints (nếu có) ≥ 0.
 */
export function validateSectWarRewardTier(
  def: SectWarRewardTierDef,
): SectWarValidationCode | null {
  if (!Number.isFinite(def.minRank) || def.minRank < 1) return 'INVALID_TIER_RANK';
  if (def.maxRank < def.minRank) return 'INVALID_TIER_RANK';
  if (
    def.minPersonalPoints !== undefined &&
    (!Number.isFinite(def.minPersonalPoints) || def.minPersonalPoints < 0)
  ) {
    return 'INVALID_TIER_PERSONAL_POINTS';
  }
  const r = def.reward;
  const hasLinhThach = (r.linhThach ?? 0) > 0;
  const hasTienNgoc = (r.tienNgoc ?? 0) > 0;
  const hasItems = (r.items?.length ?? 0) > 0;
  const hasTitle = !!r.titleKey;
  const hasBuff = !!r.buffKey;
  if (!hasLinhThach && !hasTienNgoc && !hasItems && !hasTitle && !hasBuff) {
    return 'INVALID_TIER_REWARD';
  }
  return null;
}

/**
 * Tổng hợp ước lượng max points/character/tuần — tham chiếu BALANCE_MODEL.
 * KHÔNG enforce runtime; helper docs.
 */
export function sectWarTheoreticalMaxPointsPerWeek(): number {
  let total = 0;
  for (const a of SECT_WAR_ACTIVITIES) {
    if (a.weeklyCap !== undefined) {
      total += a.weeklyCap;
    } else if (a.dailyCap !== undefined) {
      total += a.dailyCap * 7;
    } else {
      // unlimited — cộng heuristic 1000 (catalog audit guard).
      total += 1000;
    }
  }
  return total;
}
