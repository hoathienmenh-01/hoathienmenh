/**
 * Phase 16.6 — Economy Anomaly catalog (shared, pure data + helpers).
 *
 * Catalog các rule + threshold mà
 * `apps/api/src/modules/economy/economy-anomaly-scanner.service.ts`
 * dùng để rà soát log economy trong 1 cửa sổ thời gian (24h hoặc 6h).
 *
 * Trộn lẫn shared + runtime nguy hiểm — file này chỉ chứa:
 *   - Type literal `EconomyAnomalySource` (strict enum string).
 *   - Type literal `EconomyAnomalySeverity` (`INFO | WARN | CRITICAL`).
 *   - `ECONOMY_ANOMALY_RULES` snapshot threshold mặc định.
 *   - Helpers `getEconomyAnomalyRule()` / `isEconomyAnomalySource()` /
 *     `isEconomyAnomalySeverity()` / `compareSeverity()`.
 *
 * Pure — KHÔNG đọc env, KHÔNG mutate Prisma. Test 100% deterministic.
 *
 * **Source-of-truth balance**: `docs/BALANCE_MODEL.md` §17 (Economy
 * Anti-cheat) + `docs/ECONOMY_MODEL.md` §Anomaly.
 *
 * Chính sách Phase 16.6:
 *   - Detection + reporting only. KHÔNG auto-ban / KHÔNG auto-rollback.
 *   - Thresholds set conservative — false-positive là chấp nhận được
 *     vì admin xem lại tay; false-negative tệ hơn (player abuse lọt).
 *   - Severity ngữ cảnh:
 *     - `INFO` = hoạt động đáng chú ý, có thể là legit (vd nạp lớn).
 *     - `WARN` = vượt ngưỡng "bình thường nhất" — cần admin xem.
 *     - `CRITICAL` = rất khó là legit — admin ưu tiên xử lý ngay.
 */

/** Tag rule để biết anomaly thuộc nhánh detection nào. */
export const ECONOMY_ANOMALY_SOURCES = [
  /** `scanTopCurrencyDelta24h()` — character có |Σ delta linhThach trong 24h| vượt threshold. */
  'CURRENCY_DELTA_24H',
  /** `scanRareItemGain()` — character nhận quá nhiều item rarity TIEN/THAN trong 24h. */
  'RARE_ITEM_GAIN_24H',
  /** `scanRewardCapBypass()` — số `RewardCapEvent` (cap-reached) trong 24h vượt mức. */
  'REWARD_CAP_BYPASS',
  /** `scanAdminGrantOverLimit()` — admin grant currency vượt threshold (real-time hook). */
  'ADMIN_GRANT_OVER_LIMIT',
  /** `scanMarketOutlier()` — listing post hiện tại có giá ngoài band (gần đây). */
  'MARKET_OUTLIER',
] as const;
export type EconomyAnomalySource = (typeof ECONOMY_ANOMALY_SOURCES)[number];

/** Severity literal — dùng làm DB string field, vào `EconomyAnomaly.severity`. */
export const ECONOMY_ANOMALY_SEVERITIES = [
  'INFO',
  'WARN',
  'CRITICAL',
] as const;
export type EconomyAnomalySeverity =
  (typeof ECONOMY_ANOMALY_SEVERITIES)[number];

/** Status literal — dùng cho `EconomyAnomaly.status` + `EconomyLedgerCheckIssue.status`. */
export const ECONOMY_ISSUE_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type EconomyIssueStatus = (typeof ECONOMY_ISSUE_STATUSES)[number];

export interface EconomyAnomalyRule {
  /** Source key — duy nhất để 1 rule không trùng. */
  readonly source: EconomyAnomalySource;
  /**
   * Ngưỡng cảnh báo (`WARN`) — vượt mức này thì rule trigger.
   * Dùng `bigint` cho currency / count linhThach (tránh overflow), `number` cho count nhỏ.
   * Đơn vị tùy theo rule (xem doc field tương ứng bên dưới).
   */
  readonly warnThreshold: bigint;
  /**
   * Ngưỡng `CRITICAL` — vượt mức này, severity nâng từ `WARN` lên `CRITICAL`.
   * `>= warnThreshold` luôn (đảm bảo bậc thang).
   */
  readonly criticalThreshold: bigint;
  /** Mô tả ngắn — render trong admin panel + log. */
  readonly description: string;
}

/**
 * Default rule snapshot. Per-realm/per-source override không có ở Phase 16.6
 * — tinh chỉnh sau closed beta.
 *
 * **Tuning rationale**:
 *
 * - `CURRENCY_DELTA_24H`: 1_000_000 LT = 1M linh thạch tăng/giảm trong 24h.
 *   Player F2P top-tier farm cultivation+dungeon+mission đầy đủ rơi vào
 *   200-400k/ngày → 1M là gấp 3-5x baseline. CRITICAL 5M = gần như chắc
 *   chắn abuse / exploit / RMT.
 *
 * - `RARE_ITEM_GAIN_24H`: 5 item TIEN+ trong 24h. Boss world drop rate
 *   rare ~ 2-3 lần/tuần — 5 item/ngày = nghi vấn cao. CRITICAL 20.
 *
 * - `REWARD_CAP_BYPASS`: 10 `RewardCapEvent` trong 24h = 10 lần chạm cap.
 *   Player cày rất chăm cũng chỉ chạm 1-2 cap/ngày. CRITICAL 50 = farm bot.
 *
 * - `ADMIN_GRANT_OVER_LIMIT`: 100k LT (player có lý do nạp lớn legit
 *   thường ≤ 50k LT/grant). CRITICAL 1M (rất hiếm gặp legit).
 *
 * - `MARKET_OUTLIER`: 10x giá band — listing post có price ≥ 10x ceiling
 *   của band. CRITICAL 100x.
 */
export const ECONOMY_ANOMALY_RULES: readonly EconomyAnomalyRule[] = [
  {
    source: 'CURRENCY_DELTA_24H',
    warnThreshold: 1_000_000n,
    criticalThreshold: 5_000_000n,
    description: '|Σ delta linhThach| per character trong 24h vượt 1M / 5M',
  },
  {
    source: 'RARE_ITEM_GAIN_24H',
    warnThreshold: 5n,
    criticalThreshold: 20n,
    description:
      'Character nhận ≥ 5 / 20 item rarity TIEN+ (qua ItemLedger) trong 24h',
  },
  {
    source: 'REWARD_CAP_BYPASS',
    warnThreshold: 10n,
    criticalThreshold: 50n,
    description:
      'Character chạm RewardCap 10 / 50 lần trong 24h (farm intensity bất thường)',
  },
  {
    source: 'ADMIN_GRANT_OVER_LIMIT',
    warnThreshold: 100_000n,
    criticalThreshold: 1_000_000n,
    description:
      'Admin grant linhThach |delta| ≥ 100k / 1M (1 grant đơn lẻ)',
  },
  {
    source: 'MARKET_OUTLIER',
    warnThreshold: 10n,
    criticalThreshold: 100n,
    description:
      'Listing post có pricePerUnit ≥ 10x / 100x ceiling của price band',
  },
];

/**
 * Lookup rule theo source. Throw nếu không có (caller phải truyền source
 * hợp lệ — type literal tránh typo).
 *
 * Test verify rule snapshot tồn tại cho mọi source.
 */
export function getEconomyAnomalyRule(
  source: EconomyAnomalySource,
): EconomyAnomalyRule {
  const r = ECONOMY_ANOMALY_RULES.find((x) => x.source === source);
  if (!r) {
    throw new Error(`getEconomyAnomalyRule: missing rule for "${source}"`);
  }
  return r;
}

/** Type-guard cho input từ DB string field. */
export function isEconomyAnomalySource(s: string): s is EconomyAnomalySource {
  return (ECONOMY_ANOMALY_SOURCES as readonly string[]).includes(s);
}

/** Type-guard cho input từ DB string field. */
export function isEconomyAnomalySeverity(
  s: string,
): s is EconomyAnomalySeverity {
  return (ECONOMY_ANOMALY_SEVERITIES as readonly string[]).includes(s);
}

/** Type-guard cho input từ DB string field. */
export function isEconomyIssueStatus(s: string): s is EconomyIssueStatus {
  return (ECONOMY_ISSUE_STATUSES as readonly string[]).includes(s);
}

/**
 * Severity ordering. Ngầm dùng cho filter "≥ severity" trong query
 * + sort UI "CRITICAL trên đầu".
 *
 * Convention: `INFO=0, WARN=1, CRITICAL=2`. So sánh return -1/0/1.
 */
const SEVERITY_RANK: Record<EconomyAnomalySeverity, number> = {
  INFO: 0,
  WARN: 1,
  CRITICAL: 2,
};

/** -1 nếu a < b, 0 nếu bằng, 1 nếu a > b (theo rank). */
export function compareSeverity(
  a: EconomyAnomalySeverity,
  b: EconomyAnomalySeverity,
): number {
  return Math.sign(SEVERITY_RANK[a] - SEVERITY_RANK[b]);
}

/**
 * Suy ra severity từ giá trị value vs rule. Dùng cho scanner / hook.
 * Convention:
 *   - `value < warnThreshold`  → trả `null` (không trigger).
 *   - `warnThreshold ≤ value < criticalThreshold`  → `WARN`.
 *   - `value ≥ criticalThreshold` → `CRITICAL`.
 *
 * Caller không nên ghi `INFO` qua helper này — `INFO` dành cho ngữ cảnh
 * "đáng chú ý nhưng chưa qua warn", set tay khi cần.
 */
export function deriveSeverityForValue(
  value: bigint,
  rule: EconomyAnomalyRule,
): EconomyAnomalySeverity | null {
  const abs = value < 0n ? -value : value;
  if (abs < rule.warnThreshold) return null;
  if (abs >= rule.criticalThreshold) return 'CRITICAL';
  return 'WARN';
}
