/**
 * Phase 14.1.D — Arena Anti-Wintrade Detection (shared rules + helpers).
 *
 * Pure config + helpers. Mọi value có thể override qua env runtime ở
 * service-side (xem `apps/api/src/modules/arena/arena-anti-wintrade.service.ts`).
 * Module này KHÔNG IO, KHÔNG `Math.random` — test 100% deterministic.
 *
 * Chính sách Phase 14.1.D:
 *   - Detection + reporting only. KHÔNG auto-ban. KHÔNG auto-rollback.
 *   - Không chặn người chơi tiếp tục đánh Arena chỉ vì có WARN alert.
 *   - Threshold conservative — hạn chế false-positive với người chơi
 *     thực sự cày Arena, nhưng đủ nhạy để admin xem khi có pattern bất
 *     thường (cày qua lại, win-rate ~100%, rating spike).
 *
 * Severity ngữ cảnh:
 *   - INFO     : đáng để ý, nhiều khả năng legit (vd 2 người bạn rủ nhau).
 *   - WARN     : vượt ngưỡng baseline — admin nên xem.
 *   - CRITICAL : rất khó là legit — admin ưu tiên xử lý.
 *
 * Source-of-truth balance: `docs/BALANCE_MODEL.md` §Arena Anti-Wintrade
 * + `docs/ECONOMY_MODEL.md` §Anti-cheat playbook.
 *
 * @module arena-anti-wintrade
 */

/* ---------------------------------------------------------------------------
 * Severity / status / type
 * ------------------------------------------------------------------------- */

export const ARENA_WINTRADE_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export type ArenaWintradeSeverity = (typeof ARENA_WINTRADE_SEVERITIES)[number];

export function isArenaWintradeSeverity(
  value: unknown,
): value is ArenaWintradeSeverity {
  return (
    typeof value === 'string' &&
    (ARENA_WINTRADE_SEVERITIES as readonly string[]).includes(value)
  );
}

export const ARENA_WINTRADE_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type ArenaWintradeStatus = (typeof ARENA_WINTRADE_STATUSES)[number];

export function isArenaWintradeStatus(
  value: unknown,
): value is ArenaWintradeStatus {
  return (
    typeof value === 'string' &&
    (ARENA_WINTRADE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Loại alert. 1 detection rule → 1 type. Type là DB string,
 * KHÔNG renamed về sau (sẽ phá idempotency `unique(type, windowKey,...)`).
 */
export const ARENA_WINTRADE_TYPES = [
  /** scanRepeatedOpponentPairs — 1 cặp attacker↔defender đánh quá nhiều lần. */
  'REPEATED_OPPONENT_PAIR',
  /** scanReciprocalWinLossPattern — 2 character thay phiên thắng nhau. */
  'RECIPROCAL_WIN_LOSS',
  /** scanRatingGainSpike — rating tăng quá nhanh trong cửa sổ ngắn. */
  'RATING_GAIN_SPIKE',
  /** scanRewardFarmPattern — character liên tục target cùng defender → hưởng reward. */
  'REWARD_FARM_PATTERN',
  /** scanSeasonSuspiciousActors — high win-rate + low diversity opponent. */
  'SEASON_SUSPICIOUS_ACTOR',
] as const;
export type ArenaWintradeType = (typeof ARENA_WINTRADE_TYPES)[number];

export function isArenaWintradeType(value: unknown): value is ArenaWintradeType {
  return (
    typeof value === 'string' &&
    (ARENA_WINTRADE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Reward eligibility flag — service settle có thể đọc khi player có
 * CRITICAL alert OPEN trong season. Phase 14.1.D KHÔNG gating settle
 * theo flag này (chính sách "alert trước, xử lý thủ công sau"); dùng
 * cho Phase 14.1.E+ hoặc admin tooling chấm reward review.
 */
export const ARENA_WINTRADE_REWARD_ELIGIBILITY = [
  'NORMAL',
  'REVIEW_REQUIRED',
] as const;
export type ArenaWintradeRewardEligibility =
  (typeof ARENA_WINTRADE_REWARD_ELIGIBILITY)[number];

/* ---------------------------------------------------------------------------
 * Rule config
 * ------------------------------------------------------------------------- */

/**
 * Rule snapshot mặc định. Phase 14.1.D thresholds chọn conservative:
 * baseline 1 cặp player legit hiếm khi hit. Service-side có thể đọc env
 * `ARENA_ANTI_WINTRADE_*` để override 1 vài giá trị (xem
 * `apps/api/src/modules/arena/arena-anti-wintrade.service.ts`).
 *
 * **Tuning rationale**:
 *
 * - `repeatedOpponentWindowHours = 24`: cửa sổ rolling 24h cho rule
 *   "đánh cùng đối thủ". Đủ rộng để gom pattern liên ngày, đủ hẹp để
 *   không gom 1 năm legit.
 *
 * - `maxMatchesSameOpponentPerWindow = 5`: trong 24h cùng 1 cặp đánh
 *   ≥ 5 trận → WARN. Player F2P hiếm khi gặp lại cùng defender 5 lần
 *   trong 24h vì opponent pool rotate.
 *
 * - `criticalRepeatedMatchesPerWindow = 12`: ≥ 12 trận cùng cặp/24h
 *   gần như chắc chắn collusion.
 *
 * - `reciprocalMatchThreshold = 4`: A→B win + B→A win ≥ 4 lượt swap.
 *   Pattern "qua lại" tự nhiên rất hiếm vì 1 attacker phải target
 *   defender riêng → swap ≥ 4 → đáng nghi.
 *
 * - `criticalReciprocalMatches = 8`.
 *
 * - `suspiciousWinRateThreshold = 0.95`: 95% win-rate trong window
 *   khi ≥ `minMatchesForWinRate` mới trigger (tránh small-sample 1/1).
 *
 * - `minMatchesForWinRate = 10`: ≥ 10 match mới đánh giá win-rate.
 *
 * - `ratingGainSpikeThreshold = 200`: rating tăng ≥ 200 trong
 *   `ratingGainSpikeWindowHours = 6h` = nghi ngờ. Player legit Glicko-2
 *   K=32 hiếm khi >150/6h.
 *
 * - `criticalRatingGainSpike = 400`: ≥ 400/6h gần chắc chắn farm.
 *
 * - `rewardFarmDistinctOpponentsMin = 3`: nếu trong window đánh ≥ N
 *   trận mà opponent diversity < threshold, flag farm. Phase 14.1.D
 *   coi minDistinctOpponents=3 cho 10 trận.
 *
 * - `seasonHighWinRateOpponentDiversity = 5`: trong season, nếu win-rate
 *   ≥ threshold + opponent pool < 5, mark suspicious actor.
 */
export interface ArenaAntiWintradeRules {
  /** Rolling window (giờ) cho repeated opponent + reciprocal + rating spike subscan. */
  readonly repeatedOpponentWindowHours: number;
  /** ≥ N trận cùng cặp attacker↔defender trong window → WARN. */
  readonly maxMatchesSameOpponentPerWindow: number;
  /** ≥ N trận cùng cặp → CRITICAL. */
  readonly criticalRepeatedMatchesPerWindow: number;
  /** ≥ N lượt swap A→B win + B→A win → reciprocal pattern WARN. */
  readonly reciprocalMatchThreshold: number;
  /** ≥ N lượt swap → CRITICAL. */
  readonly criticalReciprocalMatches: number;
  /** Win-rate threshold (0..1) cho `SEASON_SUSPICIOUS_ACTOR` trong window. */
  readonly suspiciousWinRateThreshold: number;
  /** Tối thiểu N match mới đánh giá win-rate (tránh 1/1 = 100%). */
  readonly minMatchesForWinRate: number;
  /** Cửa sổ tính rating spike (giờ). */
  readonly ratingGainSpikeWindowHours: number;
  /** Δ rating ≥ N trong window → WARN. */
  readonly ratingGainSpikeThreshold: number;
  /** Δ rating ≥ N trong window → CRITICAL. */
  readonly criticalRatingGainSpike: number;
  /** ≥ N trận trong window mà distinctOpponents < threshold → farm WARN. */
  readonly rewardFarmMatchesMin: number;
  /** distinctOpponents < N với rewardFarmMatchesMin trận → farm WARN. */
  readonly rewardFarmDistinctOpponentsMin: number;
  /** Season-scope distinct opponents tối thiểu trước khi flag suspicious actor. */
  readonly seasonSuspiciousMinDistinctOpponents: number;
  /** Season-scope tối thiểu match mới đánh giá. */
  readonly seasonSuspiciousMinMatches: number;
}

export const ARENA_ANTI_WINTRADE_RULES: ArenaAntiWintradeRules = {
  repeatedOpponentWindowHours: 24,
  maxMatchesSameOpponentPerWindow: 5,
  criticalRepeatedMatchesPerWindow: 12,
  reciprocalMatchThreshold: 4,
  criticalReciprocalMatches: 8,
  suspiciousWinRateThreshold: 0.95,
  minMatchesForWinRate: 10,
  ratingGainSpikeWindowHours: 6,
  ratingGainSpikeThreshold: 200,
  criticalRatingGainSpike: 400,
  rewardFarmMatchesMin: 8,
  rewardFarmDistinctOpponentsMin: 3,
  seasonSuspiciousMinDistinctOpponents: 5,
  seasonSuspiciousMinMatches: 12,
};

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/**
 * Compare 2 severity (`INFO` < `WARN` < `CRITICAL`).
 * Trả về `-1`, `0`, `1`.
 */
export function compareArenaWintradeSeverity(
  a: ArenaWintradeSeverity,
  b: ArenaWintradeSeverity,
): -1 | 0 | 1 {
  const order: Record<ArenaWintradeSeverity, number> = {
    INFO: 0,
    WARN: 1,
    CRITICAL: 2,
  };
  const da = order[a];
  const db = order[b];
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

/**
 * Quy đổi count → severity dựa trên (warn, critical) threshold pair.
 * Nếu `count >= critical` → `CRITICAL`. Nếu `count >= warn` → `WARN`.
 * Ngược lại trả `null` (chưa đủ trigger).
 */
export function severityForCount(
  count: number,
  warn: number,
  critical: number,
): ArenaWintradeSeverity | null {
  if (count >= critical) return 'CRITICAL';
  if (count >= warn) return 'WARN';
  return null;
}

/**
 * Build deterministic `windowKey` cho 1 rule scan.
 *
 * Format: `<type>:<periodKey>` — `periodKey` nên là ISO date hoặc bucket
 * dựa trên `now`. Caller (service) tự derive bucket; helper chỉ ghép
 * string. Idempotent — same args → same key.
 *
 * Ví dụ:
 *   - `arenaWintradeWindowKey('REPEATED_OPPONENT_PAIR', '24h:2026-05-09')`
 *     → `'REPEATED_OPPONENT_PAIR:24h:2026-05-09'`
 */
export function arenaWintradeWindowKey(
  type: ArenaWintradeType,
  periodKey: string,
): string {
  if (typeof periodKey !== 'string' || periodKey.length === 0) {
    throw new Error('arenaWintradeWindowKey: periodKey must be non-empty');
  }
  return `${type}:${periodKey}`;
}

/**
 * Build pair key đối xứng cho 1 cặp character (sort lexicographically).
 * Đảm bảo (A,B) và (B,A) có cùng key — dùng cho dedupe rule
 * `RECIPROCAL_WIN_LOSS` (rule này đánh giá cặp không hướng).
 */
export function arenaWintradePairKey(a: string, b: string): string {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new Error('arenaWintradePairKey: ids must be strings');
  }
  if (a === b) {
    throw new Error('arenaWintradePairKey: ids must be different');
  }
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Default rolling period key cho `now` — lấy date YYYY-MM-DD UTC, không
 * phụ thuộc tz. Caller có thể truyền `tz` riêng nếu cần (vd
 * `Asia/Ho_Chi_Minh` cho metric daily).
 */
export function arenaWintradePeriodKey(
  now: Date,
  hours: number,
): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('arenaWintradePeriodKey: invalid now');
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('arenaWintradePeriodKey: hours must be positive');
  }
  const day = now.toISOString().slice(0, 10);
  // Round-down hour bucket (vd window 6h → block 0..3) — tăng cardinality
  // cho rule chạy sub-daily.
  if (hours >= 24) return `${hours}h:${day}`;
  const hour = now.getUTCHours();
  const block = Math.floor(hour / hours) * hours;
  const blockStr = block.toString().padStart(2, '0');
  return `${hours}h:${day}T${blockStr}`;
}

/**
 * Validate `ArenaAntiWintradeRules` snapshot — used by tests + service to
 * fail fast nếu env override nào đó âm/0.
 */
export function assertArenaAntiWintradeRulesValid(
  rules: ArenaAntiWintradeRules,
): void {
  const positive: Array<keyof ArenaAntiWintradeRules> = [
    'repeatedOpponentWindowHours',
    'maxMatchesSameOpponentPerWindow',
    'criticalRepeatedMatchesPerWindow',
    'reciprocalMatchThreshold',
    'criticalReciprocalMatches',
    'minMatchesForWinRate',
    'ratingGainSpikeWindowHours',
    'ratingGainSpikeThreshold',
    'criticalRatingGainSpike',
    'rewardFarmMatchesMin',
    'rewardFarmDistinctOpponentsMin',
    'seasonSuspiciousMinDistinctOpponents',
    'seasonSuspiciousMinMatches',
  ];
  for (const key of positive) {
    const v = rules[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(
        `arena-anti-wintrade: ${key} must be positive number, got ${String(v)}`,
      );
    }
  }
  if (
    rules.suspiciousWinRateThreshold <= 0 ||
    rules.suspiciousWinRateThreshold > 1
  ) {
    throw new Error(
      `arena-anti-wintrade: suspiciousWinRateThreshold must be in (0,1], got ${rules.suspiciousWinRateThreshold}`,
    );
  }
  if (
    rules.criticalRepeatedMatchesPerWindow <
    rules.maxMatchesSameOpponentPerWindow
  ) {
    throw new Error(
      'arena-anti-wintrade: criticalRepeatedMatchesPerWindow must be >= maxMatchesSameOpponentPerWindow',
    );
  }
  if (rules.criticalReciprocalMatches < rules.reciprocalMatchThreshold) {
    throw new Error(
      'arena-anti-wintrade: criticalReciprocalMatches must be >= reciprocalMatchThreshold',
    );
  }
  if (rules.criticalRatingGainSpike < rules.ratingGainSpikeThreshold) {
    throw new Error(
      'arena-anti-wintrade: criticalRatingGainSpike must be >= ratingGainSpikeThreshold',
    );
  }
}
