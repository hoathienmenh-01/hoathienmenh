/**
 * Phase 20.3 — Co-op Reward Cap / Anti-leech / Weekly Contribution Season
 * (shared catalog).
 *
 * Pure data + deterministic helpers — KHÔNG đọc env / runtime / IO. Runtime
 * apply ở `apps/api/src/modules/coop-reward-cap/coop-reward-cap.service.ts`
 * (Phase 20.3) → wire vào `CoopBossService.claimReward` (Phase 20.2) +
 * `PartyDungeonService.claimReward` (Phase 20.1).
 *
 * Mục tiêu:
 *   - Giới hạn số lần member nhận reward từ co-op boss / party dungeon
 *     theo **ngày** + **tuần** (chống farm bot / multi-account abuse,
 *     chống stack reward vô hạn từ alt run cùng party).
 *   - Anti-leech sâu hơn dựa trên `contributionScore` + `survivalSeconds`
 *     + `actionCount` + participation duration (Phase 20.2 đã clamp raw
 *     damage; phase này phân tier `NONE/LOW/MEDIUM/HIGH` leech risk +
 *     gate reward tier tương ứng).
 *   - Weekly contribution season — tổng hợp boss/dungeon contribution
 *     theo tuần, leaderboard rank, reward tier theo rank → claim 1 lần
 *     mỗi season.
 *
 * Phase 20.3 KHÔNG làm (deferred):
 *   - Auto-ban / auto-rollback reward đã nhận.
 *   - Cross-server leaderboard.
 *   - Matchmaking public / loot bidding.
 *   - Realtime combat engine (Phase 20.2 đã clamp; 20.3+ không đụng).
 *
 * Source-of-truth balance: `docs/BALANCE_MODEL.md` §20.3 +
 * `docs/ECONOMY_MODEL.md` §Co-op Weekly Season.
 */

// ---------------------------------------------------------------------------
// Source enum
// ---------------------------------------------------------------------------

/**
 * Nguồn reward mà cap có hiệu lực. **Cap riêng theo source** — boss
 * cap hết không ảnh hưởng dungeon, dungeon cap hết không ảnh hưởng
 * weekly reward.
 *
 * - `COOP_BOSS` — Phase 20.2 co-op boss `claimReward` (per-run claim).
 * - `PARTY_DUNGEON` — Phase 20.1 party dungeon `claimReward` (per-run
 *   claim).
 *
 * Mỗi source mới CẦN entry trong `COOP_REWARD_CAP_LIMITS.daily/weekly`
 * + invariant test.
 */
export const COOP_REWARD_SOURCES = ['COOP_BOSS', 'PARTY_DUNGEON'] as const;
export type CoopRewardSource = (typeof COOP_REWARD_SOURCES)[number];

export function isCoopRewardSource(v: unknown): v is CoopRewardSource {
  return (
    typeof v === 'string' &&
    (COOP_REWARD_SOURCES as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Leech risk
// ---------------------------------------------------------------------------

/**
 * Mức độ leech risk dựa trên contribution metrics sau khi run resolved.
 *
 *   - `NONE` — member đóng góp đầy đủ (contribution ≥ minContributionForReward,
 *     survival ≥ minSurvivalSecondsForReward, action ≥ minActionCountForReward).
 *     Nhận full reward.
 *   - `LOW` — vài chỉ số dưới ngưỡng nhưng vẫn pass cơ bản. Reward
 *     unchanged (informational).
 *   - `MEDIUM` — 1 chỉ số fail nặng (vd survival rất thấp dù boss CLEARED).
 *     Reward tier bị downgrade 1 bậc (HIGH → NORMAL, MVP → HIGH...).
 *   - `HIGH` — leech rõ (contribution gần 0 hoặc survival/action gần 0).
 *     Reward tier downgrade về `LOW`, hoặc nếu base đã `LOW` → SKIPPED
 *     (không tạo claim). KHÔNG auto-ban — chỉ ghi GameplayAnomaly.
 */
export const COOP_LEECH_RISK_LEVELS = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;
export type CoopLeechRiskLevel = (typeof COOP_LEECH_RISK_LEVELS)[number];

export function isCoopLeechRiskLevel(v: unknown): v is CoopLeechRiskLevel {
  return (
    typeof v === 'string' &&
    (COOP_LEECH_RISK_LEVELS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Weekly season
// ---------------------------------------------------------------------------

/**
 * Lifecycle của weekly contribution season.
 *
 *   - `ACTIVE` — đang mở, member ghi contribution (tự động qua
 *     `recordWeeklyContribution` được wire từ Phase 20.2 finishRun +
 *     Phase 20.1 dungeon CLEAR).
 *   - `CLOSED` — vượt `endsAt`, không nhận contribution mới nhưng
 *     chưa settle rank/tier.
 *   - `SETTLED` — admin (hoặc cron) đã `settleWeeklySeason` →
 *     rank/tier snapshot + `CoopWeeklyRewardClaim` PENDING cho top-N.
 */
export const COOP_WEEKLY_SEASON_STATUSES = [
  'ACTIVE',
  'CLOSED',
  'SETTLED',
] as const;
export type CoopWeeklySeasonStatus =
  (typeof COOP_WEEKLY_SEASON_STATUSES)[number];

export function isCoopWeeklySeasonStatus(
  v: unknown,
): v is CoopWeeklySeasonStatus {
  return (
    typeof v === 'string' &&
    (COOP_WEEKLY_SEASON_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Trạng thái claim weekly reward.
 *
 *   - `PENDING` — settle đã tạo, member chưa claim.
 *   - `CLAIMED` — member đã claim, ledger ghi.
 *   - `SKIPPED` — member ngoài top reward tier (NONE) hoặc đã rời.
 *   - `FAILED` — claim attempt fail nội bộ (reserved).
 */
export const COOP_WEEKLY_REWARD_CLAIM_STATUSES = [
  'PENDING',
  'CLAIMED',
  'SKIPPED',
  'FAILED',
] as const;
export type CoopWeeklyRewardClaimStatus =
  (typeof COOP_WEEKLY_REWARD_CLAIM_STATUSES)[number];

export function isCoopWeeklyRewardClaimStatus(
  v: unknown,
): v is CoopWeeklyRewardClaimStatus {
  return (
    typeof v === 'string' &&
    (COOP_WEEKLY_REWARD_CLAIM_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Tier reward weekly dựa trên rank trong season.
 *
 *   - `NONE` — không đủ contribution tối thiểu hoặc rank ngoài top.
 *   - `BRONZE` — top 50% nhưng dưới top 10%.
 *   - `SILVER` — top 10% nhưng không phải top 3.
 *   - `GOLD` — top 3 nhưng không phải #1.
 *   - `LEGEND` — #1 toàn season.
 */
export const COOP_WEEKLY_REWARD_TIERS = [
  'NONE',
  'BRONZE',
  'SILVER',
  'GOLD',
  'LEGEND',
] as const;
export type CoopWeeklyRewardTier = (typeof COOP_WEEKLY_REWARD_TIERS)[number];

export function isCoopWeeklyRewardTier(
  v: unknown,
): v is CoopWeeklyRewardTier {
  return (
    typeof v === 'string' &&
    (COOP_WEEKLY_REWARD_TIERS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Hard caps cho Phase 20.3. Giá trị balance đã calibrate cho người
 * chơi cày 4–6 tiếng/ngày KHÔNG chạm cap (giống pattern
 * `daily-reward-cap` Phase 16.5).
 *
 * - `maxBossClaimsPerDay` = 8 → giả định 1 boss run ~ 15p → 2h play
 *   cho boss daily đã reach cap. Người chơi bình thường ~ 3-4 boss/day.
 * - `maxBossClaimsPerWeek` = 30 → cap weekly để chống farm bot 24/7.
 *   30 boss/week = ~4 boss/day average → đủ cho streak dài.
 * - `maxDungeonClaimsPerDay` = 12 → dungeon run nhanh hơn (~10p) →
 *   12 = 2h play.
 * - `maxDungeonClaimsPerWeek` = 50 → cap weekly cho dungeon.
 * - `minContributionForReward` = 100 → tier `LOW` baseline (Phase 20.2
 *   `minContributionScore` cũng cap ở 100). Dưới → SKIPPED.
 * - `minSurvivalSecondsForReward` = 60 → phải sống ít nhất 1 phút
 *   sau khi join (Phase 20.2 `minSurvivalSeconds=30` cho eligibility
 *   foundation; 20.3 nâng lên 60 cho reward cap path).
 * - `minActionCountForReward` = 3 → phải submit contribution ≥ 3 lần
 *   (cho dù damage 0). Chống AFK leech.
 * - `weeklySeasonTimezone` = `Asia/Ho_Chi_Minh` — reset boundary
 *   thứ Hai 00:00 (ISO week).
 */
export const COOP_REWARD_CAP_LIMITS = {
  maxBossClaimsPerDay: 8,
  maxBossClaimsPerWeek: 30,
  maxDungeonClaimsPerDay: 12,
  maxDungeonClaimsPerWeek: 50,
  minContributionForReward: 100,
  minSurvivalSecondsForReward: 60,
  minActionCountForReward: 3,
  /** Ngưỡng `contributionScore` để được tính vào weekly leaderboard. */
  minWeeklyContributionPointsForLeaderboard: 200,
  /** Top N rank được Legendary tier. */
  weeklyRewardTopRanks: {
    legend: 1,
    gold: 3,
    silver: 10,
  },
  /** Multiplier áp dụng vào `bossContributionScore` để cộng vào weekly points. */
  bossContributionPointMultiplier: 1,
  /** Multiplier áp dụng vào `dungeonContributionScore` (party-dungeon
   * Phase 20.1 hiện luôn CLEAR → ít skill so với boss → 0.5x). */
  dungeonContributionPointMultiplier: 0.5,
  /** Bonus % cho MVP của 1 run cộng thêm vào weekly points. */
  mvpWeeklyBonusPercent: 25,
  /** Min `weeklyContributionPoints` để có rank trong leaderboard. */
  minPointsForRank: 200,
  /** Timezone reset cho daily / weekly. */
  weeklySeasonTimezone: 'Asia/Ho_Chi_Minh',
} as const;

/**
 * Base reward cho weekly tier — server reward grant đi qua
 * `CurrencyService.applyTx` + `InventoryService.grantTx` (ledger first).
 *
 * Số calibrate: 1 boss CLEARED MVP claim ~ 200 linhThach (Phase 20.2).
 * Weekly LEGEND ~ 5× daily MVP = 1000 linhThach. GOLD ~ 600.
 * SILVER ~ 300. BRONZE ~ 100. NONE = 0.
 */
export const COOP_WEEKLY_BASE_REWARD: Readonly<
  Record<CoopWeeklyRewardTier, { linhThach: number; exp: number }>
> = {
  NONE: { linhThach: 0, exp: 0 },
  BRONZE: { linhThach: 100, exp: 200 },
  SILVER: { linhThach: 300, exp: 600 },
  GOLD: { linhThach: 600, exp: 1500 },
  LEGEND: { linhThach: 1000, exp: 3000 },
} as const;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CoopRewardCapCounterDto {
  readonly id: string;
  readonly userId: string;
  readonly characterId: string;
  readonly source: CoopRewardSource;
  readonly dayKey: string;
  readonly weekKey: string;
  readonly claimCount: number;
  /** Tổng linhThach approx (BigInt → number qua best-effort). */
  readonly rewardValueApprox: number;
  readonly updatedAt: string;
}

export interface CoopRewardStatusDto {
  readonly userId: string;
  readonly characterId: string;
  readonly dayKey: string;
  readonly weekKey: string;
  readonly boss: {
    readonly dailyUsed: number;
    readonly dailyLimit: number;
    readonly weeklyUsed: number;
    readonly weeklyLimit: number;
  };
  readonly dungeon: {
    readonly dailyUsed: number;
    readonly dailyLimit: number;
    readonly weeklyUsed: number;
    readonly weeklyLimit: number;
  };
  readonly currentSeasonId: string | null;
  readonly weeklyPoints: number;
  readonly weeklyRank: number | null;
  readonly weeklyRewardTier: CoopWeeklyRewardTier | null;
  readonly weeklyClaimStatus: CoopWeeklyRewardClaimStatus | null;
}

export interface CoopWeeklySeasonDto {
  readonly id: string;
  readonly weekKey: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: CoopWeeklySeasonStatus;
  readonly createdAt: string;
  readonly settledAt: string | null;
}

export interface CoopWeeklyLeaderboardEntryDto {
  readonly seasonId: string;
  readonly userId: string;
  readonly characterId: string;
  readonly displayName: string | null;
  readonly bossContributionPoints: number;
  readonly dungeonContributionPoints: number;
  readonly totalPoints: number;
  readonly rank: number | null;
  readonly rewardTier: CoopWeeklyRewardTier | null;
}

export interface CoopWeeklyRewardClaimDto {
  readonly id: string;
  readonly seasonId: string;
  readonly userId: string;
  readonly characterId: string;
  readonly rewardTier: CoopWeeklyRewardTier;
  readonly rewardJson: { linhThach?: number; exp?: number };
  readonly status: CoopWeeklyRewardClaimStatus;
  readonly claimedAt: string | null;
  readonly createdAt: string;
}

export interface CoopWeeklyLeaderboardResponse {
  readonly seasonId: string;
  readonly weekKey: string;
  readonly entries: ReadonlyArray<CoopWeeklyLeaderboardEntryDto>;
  readonly total: number;
}

export interface CoopRewardAdminSummaryDto {
  readonly currentSeason: CoopWeeklySeasonDto | null;
  readonly activeCapCounters24h: number;
  readonly capExceededAttempts24h: number;
  readonly highLeechCount24h: number;
  readonly settledSeasons: number;
}

// ---------------------------------------------------------------------------
// Helpers — Day/Week key (deterministic)
// ---------------------------------------------------------------------------

/**
 * Build day key `YYYY-MM-DD` theo timezone Asia/Ho_Chi_Minh
 * (UTC+7 offset, không có DST). Deterministic — cùng input → cùng
 * output ở mọi platform. Dùng làm composite key cho
 * `CoopRewardCapCounter.dayKey` + `dayBucket` ở runtime.
 *
 * KHÔNG dùng `Intl.DateTimeFormat` để giảm phụ thuộc ICU runtime
 * (Phase 16.5 daily-login dùng raw offset add).
 */
export function buildCoopRewardDayKey(date: Date): string {
  const offsetMs = 7 * 60 * 60 * 1000; // UTC+7
  const shifted = new Date(date.getTime() + offsetMs);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build ISO week key `YYYY-Www` theo timezone Asia/Ho_Chi_Minh.
 * Reset boundary thứ Hai 00:00. Dùng cho weekly cap counter +
 * `CoopWeeklyContributionSeason.weekKey`.
 *
 * Tính ISO week qua algo W. Stürner — tránh dùng Intl/Date library.
 */
export function buildCoopRewardWeekKey(date: Date): string {
  const offsetMs = 7 * 60 * 60 * 1000; // UTC+7
  const shifted = new Date(date.getTime() + offsetMs);
  // Algo ISO-8601: find Thursday of current week → year = year of that Thursday.
  const dayOfWeek = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay(); // 1..7, Mon=1
  const thursday = new Date(shifted);
  thursday.setUTCDate(shifted.getUTCDate() + (4 - dayOfWeek));
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const jan1DayOfWeek = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  // Calculate week number = floor((thursday - jan1 of isoYear, adjusted to first ISO Thursday) / 7) + 1
  const firstThursday = new Date(jan1);
  firstThursday.setUTCDate(jan1.getUTCDate() + (4 - jan1DayOfWeek));
  const diffMs = thursday.getTime() - firstThursday.getTime();
  const weekNum = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Reverse helper: build `Date` (UTC) cho thứ Hai 00:00 local của 1 weekKey.
 * Dùng cho `season.startsAt` khi tạo season cron.
 */
export function buildWeekStartDate(weekKey: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) {
    throw new Error(`Invalid weekKey: ${weekKey}`);
  }
  const isoYear = Number(match[1]);
  const weekNum = Number(match[2]);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayOfWeek = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4DayOfWeek - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  // Subtract 7h to get UTC instant for local 00:00 Asia/Ho_Chi_Minh (UTC+7).
  monday.setUTCHours(monday.getUTCHours() - 7);
  return monday;
}

/**
 * `endsAt` = `startsAt` + 7 ngày - 1ms. Inclusive cuối tuần.
 */
export function buildWeekEndDate(weekKey: string): Date {
  const start = buildWeekStartDate(weekKey);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}

// ---------------------------------------------------------------------------
// Helpers — Cap gate
// ---------------------------------------------------------------------------

/**
 * Check liệu member còn quyền claim reward cho `source` tại thời điểm
 * hiện tại dựa trên counter snapshot. Pure — caller chịu trách nhiệm
 * lookup counter + tăng counter sau khi claim thành công.
 *
 * Trả `{ ok: false, code }` với `code`:
 *   - `DAILY_CAP_REACHED` — `claimCountToday >= daily cap`.
 *   - `WEEKLY_CAP_REACHED` — `claimCountThisWeek >= weekly cap`.
 *   - `INVALID_SOURCE` — source không trong enum (caller bug).
 */
export function canClaimCoopRewardWithinCap(input: {
  source: CoopRewardSource;
  dailyClaims: number;
  weeklyClaims: number;
}):
  | { ok: true }
  | { ok: false; code: 'DAILY_CAP_REACHED' | 'WEEKLY_CAP_REACHED' | 'INVALID_SOURCE' } {
  if (!isCoopRewardSource(input.source)) {
    return { ok: false, code: 'INVALID_SOURCE' };
  }
  const dailyLimit =
    input.source === 'COOP_BOSS'
      ? COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay
      : COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerDay;
  const weeklyLimit =
    input.source === 'COOP_BOSS'
      ? COOP_REWARD_CAP_LIMITS.maxBossClaimsPerWeek
      : COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerWeek;
  if (input.dailyClaims >= dailyLimit) {
    return { ok: false, code: 'DAILY_CAP_REACHED' };
  }
  if (input.weeklyClaims >= weeklyLimit) {
    return { ok: false, code: 'WEEKLY_CAP_REACHED' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers — Leech risk
// ---------------------------------------------------------------------------

/**
 * Phân tier leech risk dựa trên contribution metrics. Server-only
 * (run sau finishRun / dungeon CLEAR; client chỉ preview informational).
 *
 * Logic — đếm số "fail" trên 3 chỉ số:
 *   - contribution < `minContributionForReward`
 *   - survival < `minSurvivalSecondsForReward`
 *   - action < `minActionCountForReward`
 *
 * 0 fail → NONE. 1 fail → LOW. 2 fail → MEDIUM. 3 fail → HIGH.
 *
 * Edge: nếu contribution score = 0 nhưng survival/action ổn → vẫn LOW
 * (có thể là support build chuyên buff team). Server-authoritative —
 * KHÔNG hard-reject.
 */
export function classifyCoopLeechRisk(input: {
  contributionScore: number;
  survivalSeconds: number;
  actionCount: number;
}): CoopLeechRiskLevel {
  let fails = 0;
  if (input.contributionScore < COOP_REWARD_CAP_LIMITS.minContributionForReward) {
    fails += 1;
  }
  if (input.survivalSeconds < COOP_REWARD_CAP_LIMITS.minSurvivalSecondsForReward) {
    fails += 1;
  }
  if (input.actionCount < COOP_REWARD_CAP_LIMITS.minActionCountForReward) {
    fails += 1;
  }
  if (fails === 0) return 'NONE';
  if (fails === 1) return 'LOW';
  if (fails === 2) return 'MEDIUM';
  return 'HIGH';
}

// ---------------------------------------------------------------------------
// Helpers — Weekly points
// ---------------------------------------------------------------------------

/**
 * Tính weekly contribution points từ 1 run hoàn thành.
 *
 *   weeklyPoints = bossContributionScore * bossMultiplier
 *                + dungeonContributionScore * dungeonMultiplier
 *                + (mvp ? bossContributionScore * mvpBonusPct/100 : 0)
 *
 * Server-authoritative — client preview chỉ informational.
 * Pure / deterministic.
 */
export function computeWeeklyContributionPoints(input: {
  bossContributionScore: number;
  dungeonContributionScore: number;
  isMvp: boolean;
}): number {
  const base =
    input.bossContributionScore *
      COOP_REWARD_CAP_LIMITS.bossContributionPointMultiplier +
    input.dungeonContributionScore *
      COOP_REWARD_CAP_LIMITS.dungeonContributionPointMultiplier;
  const mvpBonus = input.isMvp
    ? (input.bossContributionScore *
        COOP_REWARD_CAP_LIMITS.mvpWeeklyBonusPercent) /
      100
    : 0;
  return Math.floor(base + mvpBonus);
}

/**
 * Map rank trong leaderboard → weekly reward tier.
 *
 *   rank = 1 → LEGEND.
 *   rank ≤ 3 → GOLD.
 *   rank ≤ 10 → SILVER.
 *   rank > 10 AND totalPoints ≥ minPointsForRank → BRONZE.
 *   else → NONE.
 *
 * `rank` 1-indexed. `null` rank (không đủ minPointsForRank) → NONE.
 */
export function classifyWeeklyRewardTier(input: {
  rank: number | null;
  totalPoints: number;
}): CoopWeeklyRewardTier {
  if (input.rank === null) return 'NONE';
  if (input.totalPoints < COOP_REWARD_CAP_LIMITS.minPointsForRank) {
    return 'NONE';
  }
  if (input.rank <= COOP_REWARD_CAP_LIMITS.weeklyRewardTopRanks.legend) {
    return 'LEGEND';
  }
  if (input.rank <= COOP_REWARD_CAP_LIMITS.weeklyRewardTopRanks.gold) {
    return 'GOLD';
  }
  if (input.rank <= COOP_REWARD_CAP_LIMITS.weeklyRewardTopRanks.silver) {
    return 'SILVER';
  }
  return 'BRONZE';
}

/**
 * Build reward JSON cho 1 weekly tier — lookup từ `COOP_WEEKLY_BASE_REWARD`.
 */
export function computeWeeklyReward(tier: CoopWeeklyRewardTier): {
  readonly linhThach: number;
  readonly exp: number;
} {
  return COOP_WEEKLY_BASE_REWARD[tier];
}

/**
 * Build ref id for ledger refType `CoopWeeklyRewardClaim`. Includes
 * seasonId + characterId để idempotent với CurrencyLedger ref unique
 * constraint (Phase 11).
 */
export function buildCoopWeeklyRewardRefId(input: {
  seasonId: string;
  characterId: string;
}): string {
  return `coop-weekly:${input.seasonId}:${input.characterId}`;
}

/**
 * Pre-claim gate cho weekly reward. Idempotent — wrapper bao quanh
 * CAS DB layer.
 */
export function canClaimCoopWeeklyReward(input: {
  seasonStatus: CoopWeeklySeasonStatus;
  rewardTier: CoopWeeklyRewardTier;
  rewardStatus: CoopWeeklyRewardClaimStatus;
}):
  | { ok: true }
  | { ok: false; code: 'SEASON_NOT_SETTLED' | 'TIER_NONE' | 'ALREADY_CLAIMED' | 'SKIPPED' } {
  if (input.seasonStatus !== 'SETTLED') {
    return { ok: false, code: 'SEASON_NOT_SETTLED' };
  }
  if (input.rewardTier === 'NONE') {
    return { ok: false, code: 'TIER_NONE' };
  }
  if (input.rewardStatus === 'CLAIMED') {
    return { ok: false, code: 'ALREADY_CLAIMED' };
  }
  if (input.rewardStatus === 'SKIPPED') {
    return { ok: false, code: 'SKIPPED' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reward tier downgrade by leech risk
// ---------------------------------------------------------------------------

/**
 * Áp leech risk downgrade lên reward tier per-run (Phase 20.2
 * `CoopBossContributionTier` literal: NONE/LOW/NORMAL/HIGH/MVP).
 *
 * Logic:
 *   - HIGH leech → downgrade về `'LOW'`. (Nếu tier vốn `'LOW'` →
 *     SKIPPED reserved trong caller.)
 *   - MEDIUM leech → downgrade 1 bậc (MVP→HIGH, HIGH→NORMAL, NORMAL→LOW,
 *     LOW→LOW).
 *   - LOW / NONE → giữ nguyên.
 *
 * Generic literal type — caller pass tier label, đảm bảo
 * compatible với `CoopBossContributionTier`.
 */
export function applyLeechRiskDowngrade<
  T extends 'NONE' | 'LOW' | 'NORMAL' | 'HIGH' | 'MVP',
>(input: { tier: T; leechRisk: CoopLeechRiskLevel }): T {
  const order: ReadonlyArray<T> = [
    'NONE',
    'LOW',
    'NORMAL',
    'HIGH',
    'MVP',
  ] as T[];
  const idx = order.indexOf(input.tier);
  if (idx < 0) return input.tier;
  if (input.leechRisk === 'HIGH') {
    // Clamp down to LOW (idx=1) except NONE (idx=0) stays.
    return idx === 0 ? input.tier : order[1];
  }
  if (input.leechRisk === 'MEDIUM') {
    // Downgrade 1 bậc but never below LOW (idx=1).
    return idx <= 1 ? input.tier : order[idx - 1];
  }
  return input.tier;
}
