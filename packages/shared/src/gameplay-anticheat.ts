/**
 * Phase 16.3 — Gameplay Anti-cheat Deep Detection (shared, pure).
 *
 * Catalog các rule + threshold mà `GameplayAntiCheatService`
 * (apps/api) dùng để rà soát log gameplay (currency / item / dungeon /
 * boss / mission / arena / territory) trong cửa sổ thời gian (1h /
 * 24h). Khác với `economy-anomaly` (Phase 16.6) ở chỗ:
 *
 *   - Economy anomaly tập trung vào **dòng tiền tổng thể** (Σ |delta|
 *     LinhThạch 24h, RewardCap bypass, market price band, admin grant).
 *   - Gameplay anticheat tập trung vào **hành vi farm bất thường** /
 *     **reward source farming** ở từng module gameplay (dungeon /
 *     boss / mission / arena / territory) + EXP gain bất thường +
 *     item gain bất thường + combat result mismatch.
 *
 * Cùng ở `EconomyAnomaly`-style data model nhưng tách bảng riêng
 * `GameplayAnomaly` (Phase 16.3 migration) để không gộp domain.
 *
 * Pure — KHÔNG đọc env, KHÔNG mutate Prisma. Test 100% deterministic.
 *
 * **Source-of-truth balance**: `docs/BALANCE_MODEL.md` §16.3 (Gameplay
 * Anti-cheat) + `docs/SECURITY.md` §Anti-cheat.
 *
 * Chính sách Phase 16.3:
 *   - Detection + reporting only. KHÔNG auto-ban / KHÔNG auto-rollback /
 *     KHÔNG tự trừ tiền / KHÔNG khóa tài khoản.
 *   - Thresholds set conservative — false-positive là chấp nhận được
 *     vì admin xem lại tay; false-negative tệ hơn (player abuse lọt).
 *   - Severity ngữ cảnh (mirror Phase 16.6):
 *     - `INFO` = hoạt động đáng chú ý, có thể là legit (vd nạp lớn).
 *     - `WARN` = vượt ngưỡng "bình thường nhất" — cần admin xem.
 *     - `CRITICAL` = rất khó là legit — admin ưu tiên xử lý ngay.
 */

/**
 * Tag rule (= type) để biết anomaly thuộc nhánh detection nào.
 *
 * Cùng giá trị làm `GameplayAnomaly.type` literal trong DB.
 */
export const GAMEPLAY_ANOMALY_TYPES = [
  /** Character nhận quá nhiều EXP trong 1h (qua cultivation/dungeon/mission tổng hợp). */
  'EXP_GAIN_SPIKE',
  /**
   * Character có Σ delta dương currency (LinhThạch hoặc TienNgoc) vượt
   * ngưỡng trong 1h — phát hiện reward farming nhanh hơn rule 24h của
   * Phase 16.6.
   */
  'CURRENCY_GAIN_SPIKE',
  /** Character nhận quá nhiều item (tổng qtyDelta dương) trong 1h. */
  'ITEM_GAIN_SPIKE',
  /** Character claim quá nhiều `DungeonRun` reward trong 24h. */
  'DUNGEON_REWARD_FARM',
  /** Character nhận quá nhiều boss reward trong 24h (qua ItemLedger/Currency `BOSS_REWARD`). */
  'BOSS_REWARD_FARM',
  /** Character claim quá nhiều `MissionProgress` (period DAILY/WEEKLY) trong 24h. */
  'MISSION_REWARD_FARM',
  /** Character có quá nhiều arena match WIN trong 24h (reward farming nhanh). */
  'ARENA_REWARD_FARM',
  /** Character nhận quá nhiều territory owner reward trong 7 ngày. */
  'TERRITORY_REWARD_SPIKE',
  /**
   * Combat result mismatch — server snapshot vs runtime ledger có
   * disagreement. Reserved cho Phase 16.3 — runtime hook sẽ wire ở
   * follow-up, scanner pure cho phép admin tạo tay nếu cần.
   */
  'COMBAT_RESULT_MISMATCH',
  /**
   * Character chạm RewardCap quá nhiều lần trong 1h (overshoot Phase
   * 16.6 daily detection). Bổ sung cảnh báo real-time hơn.
   */
  'REWARD_CAP_BYPASS_ATTEMPT',
  /**
   * Phase 20.3 — Co-op reward cap (daily/weekly) bị member cố vượt.
   * Wire ở `CoopRewardCapService.checkDailyWeeklyCap` khi reject claim
   * vì cap hit. KHÔNG auto-ban — chỉ ghi event để admin audit.
   */
  'COOP_REWARD_CAP_HIT',
  /**
   * Phase 20.3 — Member bị classify leech risk HIGH sau khi run
   * resolved (contribution + survival + action đều fail ngưỡng). Wire
   * ở `CoopRewardCapService.classifyLeechRisk` khi tier downgrade.
   * KHÔNG auto-ban — chỉ ghi event để admin xem pattern.
   */
  'COOP_LEECH_HIGH',
] as const;
export type GameplayAnomalyType = (typeof GAMEPLAY_ANOMALY_TYPES)[number];

/** Severity literal — dùng làm DB string field, vào `GameplayAnomaly.severity`. */
export const GAMEPLAY_ANOMALY_SEVERITIES = [
  'INFO',
  'WARN',
  'CRITICAL',
] as const;
export type GameplayAnomalySeverity =
  (typeof GAMEPLAY_ANOMALY_SEVERITIES)[number];

/** Status literal — dùng cho `GameplayAnomaly.status`. */
export const GAMEPLAY_ANOMALY_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type GameplayAnomalyStatus = (typeof GAMEPLAY_ANOMALY_STATUSES)[number];

/**
 * `GameplayAnomaly.source` — module gameplay phát ra anomaly.
 *
 * Trùng tên với module thật (`dungeon-run`, `mission`, ...) để admin
 * dễ map về codebase. Unknown source → fail-soft `OTHER` (xem
 * `coerceGameplayAnomalySource`).
 */
export const GAMEPLAY_ANOMALY_SOURCES = [
  'CHARACTER',
  'CURRENCY_LEDGER',
  'ITEM_LEDGER',
  'DUNGEON_RUN',
  'BOSS',
  'MISSION',
  'ARENA',
  'TERRITORY',
  'COMBAT',
  'REWARD_CAP',
  /** Phase 20.3 — Co-op reward cap / weekly season anomaly. */
  'COOP_REWARD',
  'OTHER',
] as const;
export type GameplayAnomalySource = (typeof GAMEPLAY_ANOMALY_SOURCES)[number];

export interface GameplayAnomalyRule {
  /** Type key — duy nhất để 1 rule không trùng. */
  readonly type: GameplayAnomalyType;
  /** Module gameplay đặt rule (default source). */
  readonly source: GameplayAnomalySource;
  /**
   * Ngưỡng cảnh báo (`WARN`) — vượt mức này thì rule trigger. Dùng
   * `bigint` để tránh overflow currency / EXP lớn; số count item
   * /reward dùng `bigint` để đồng nhất kiểu.
   */
  readonly warnThreshold: bigint;
  /**
   * Ngưỡng `CRITICAL` — `>= warnThreshold` luôn (đảm bảo bậc thang).
   */
  readonly criticalThreshold: bigint;
  /**
   * Cửa sổ thời gian mặc định (ms) — caller có thể override. Khai báo
   * ở rule để admin biết "rule này tính trong bao lâu".
   */
  readonly windowMs: number;
  /** Mô tả ngắn — render trong admin panel + log. */
  readonly description: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/**
 * Default rule snapshot. Per-realm override không có ở Phase 16.3
 * — tinh chỉnh sau closed beta.
 *
 * **Tuning rationale**:
 *
 * - `EXP_GAIN_SPIKE` (1h): 50_000 EXP/h. Cultivation auto-tu rate
 *   ~ vài chục → vài trăm EXP/phút (theo realm + method). Spike 50k+
 *   trong 1h = farm dungeon liên tục bất thường. CRITICAL 500k/h.
 *
 * - `CURRENCY_GAIN_SPIKE` (1h): 200_000 LinhThạch gain (dương) trong
 *   1h. Player F2P farm dày vẫn rơi 30-80k/h. 200k/h = nghi vấn cao,
 *   CRITICAL 1M/h.
 *
 * - `ITEM_GAIN_SPIKE` (1h): 100 item gain (Σ qtyDelta dương) trong 1h.
 *   Boss/dungeon thường drop 1-3 item / encounter; 100+ = farm bất
 *   thường. CRITICAL 500.
 *
 * - `DUNGEON_REWARD_FARM` (24h): 20 dungeon claim/ngày. Player cày
 *   dày cũng chỉ 5-10/ngày (stamina + dailyLimit gate). 20+ = nghi
 *   vấn. CRITICAL 50.
 *
 * - `BOSS_REWARD_FARM` (24h): 15 boss reward grant/ngày. Boss spawn
 *   rate hạn chế (multi-region 1 boss / region / window). 15+ =
 *   abuse spawn / multi-account. CRITICAL 40.
 *
 * - `MISSION_REWARD_FARM` (24h): 30 mission claim/ngày. Daily 8-10 +
 *   weekly 4-5 + ONCE chain. 30+ = exploit reset. CRITICAL 80.
 *
 * - `ARENA_REWARD_FARM` (24h): 30 arena WIN/ngày (qua ArenaMatch
 *   winner). Daily challenge limit + season rank gate thường 5-10
 *   win/ngày. 30+ = wintrade. CRITICAL 80.
 *
 * - `TERRITORY_REWARD_SPIKE` (7d): 10 territory reward grant/tuần.
 *   Region weekly cycle thường 1-2/region. 10+ trong 7d = đa
 *   region. CRITICAL 30.
 *
 * - `COMBAT_RESULT_MISMATCH` (1h): >0 (1+) mismatch trong 1h sẽ flag
 *   ngay — không có baseline legitimate cho mismatch. CRITICAL 5.
 *
 * - `REWARD_CAP_BYPASS_ATTEMPT` (1h): 5 RewardCapEvent/h. Player cày
 *   dày chạm cap 1-2 lần/ngày — 5+/h là farm bot. CRITICAL 20.
 */
export const GAMEPLAY_ANOMALY_RULES: readonly GameplayAnomalyRule[] = [
  {
    type: 'EXP_GAIN_SPIKE',
    source: 'CHARACTER',
    warnThreshold: 50_000n,
    criticalThreshold: 500_000n,
    windowMs: ONE_HOUR_MS,
    description: 'Character nhận ≥ 50k / 500k EXP trong 1h.',
  },
  {
    type: 'CURRENCY_GAIN_SPIKE',
    source: 'CURRENCY_LEDGER',
    warnThreshold: 200_000n,
    criticalThreshold: 1_000_000n,
    windowMs: ONE_HOUR_MS,
    description:
      'Character có Σ delta linhThach dương ≥ 200k / 1M trong 1h.',
  },
  {
    type: 'ITEM_GAIN_SPIKE',
    source: 'ITEM_LEDGER',
    warnThreshold: 100n,
    criticalThreshold: 500n,
    windowMs: ONE_HOUR_MS,
    description: 'Character nhận ≥ 100 / 500 item (Σ qtyDelta dương) trong 1h.',
  },
  {
    type: 'DUNGEON_REWARD_FARM',
    source: 'DUNGEON_RUN',
    warnThreshold: 20n,
    criticalThreshold: 50n,
    windowMs: ONE_DAY_MS,
    description: 'Character claim ≥ 20 / 50 DungeonRun trong 24h.',
  },
  {
    type: 'BOSS_REWARD_FARM',
    source: 'BOSS',
    warnThreshold: 15n,
    criticalThreshold: 40n,
    windowMs: ONE_DAY_MS,
    description:
      'Character nhận ≥ 15 / 40 boss reward grant (ledger reason BOSS_REWARD) trong 24h.',
  },
  {
    type: 'MISSION_REWARD_FARM',
    source: 'MISSION',
    warnThreshold: 30n,
    criticalThreshold: 80n,
    windowMs: ONE_DAY_MS,
    description: 'Character claim ≥ 30 / 80 mission reward trong 24h.',
  },
  {
    type: 'ARENA_REWARD_FARM',
    source: 'ARENA',
    warnThreshold: 30n,
    criticalThreshold: 80n,
    windowMs: ONE_DAY_MS,
    description: 'Character có ≥ 30 / 80 ArenaMatch WIN trong 24h.',
  },
  {
    type: 'TERRITORY_REWARD_SPIKE',
    source: 'TERRITORY',
    warnThreshold: 10n,
    criticalThreshold: 30n,
    windowMs: ONE_WEEK_MS,
    description:
      'Character nhận ≥ 10 / 30 TerritoryOwnerRewardGrant trong 7 ngày.',
  },
  {
    type: 'COMBAT_RESULT_MISMATCH',
    source: 'COMBAT',
    warnThreshold: 1n,
    criticalThreshold: 5n,
    windowMs: ONE_HOUR_MS,
    description:
      'Character có ≥ 1 / 5 mismatch giữa combat snapshot và ledger trong 1h.',
  },
  {
    type: 'REWARD_CAP_BYPASS_ATTEMPT',
    source: 'REWARD_CAP',
    warnThreshold: 5n,
    criticalThreshold: 20n,
    windowMs: ONE_HOUR_MS,
    description: 'Character chạm RewardCap ≥ 5 / 20 lần trong 1h.',
  },
  {
    type: 'COOP_REWARD_CAP_HIT',
    source: 'COOP_REWARD',
    warnThreshold: 3n,
    criticalThreshold: 10n,
    windowMs: ONE_HOUR_MS,
    description:
      'User chạm Co-op reward cap (daily/weekly) ≥ 3 / 10 lần trong 1h.',
  },
  {
    type: 'COOP_LEECH_HIGH',
    source: 'COOP_REWARD',
    warnThreshold: 2n,
    criticalThreshold: 6n,
    windowMs: ONE_DAY_MS,
    description:
      'User bị classify leech risk HIGH ≥ 2 / 6 lần trong 24h (co-op boss/dungeon).',
  },
];

/**
 * Lookup rule theo type. Throw nếu không có (caller phải truyền type
 * hợp lệ — type literal tránh typo).
 *
 * Test verify rule snapshot tồn tại cho mọi type.
 */
export function getGameplayAnomalyRule(
  type: GameplayAnomalyType,
): GameplayAnomalyRule {
  const r = GAMEPLAY_ANOMALY_RULES.find((x) => x.type === type);
  if (!r) {
    throw new Error(`getGameplayAnomalyRule: missing rule for "${type}"`);
  }
  return r;
}

/** Type-guard cho input từ DB string field. */
export function isGameplayAnomalyType(s: string): s is GameplayAnomalyType {
  return (GAMEPLAY_ANOMALY_TYPES as readonly string[]).includes(s);
}

/** Type-guard cho input từ DB string field. */
export function isGameplayAnomalySeverity(
  s: string,
): s is GameplayAnomalySeverity {
  return (GAMEPLAY_ANOMALY_SEVERITIES as readonly string[]).includes(s);
}

/** Type-guard cho input từ DB string field. */
export function isGameplayAnomalyStatus(
  s: string,
): s is GameplayAnomalyStatus {
  return (GAMEPLAY_ANOMALY_STATUSES as readonly string[]).includes(s);
}

/** Type-guard cho input từ DB string field. */
export function isGameplayAnomalySource(
  s: string,
): s is GameplayAnomalySource {
  return (GAMEPLAY_ANOMALY_SOURCES as readonly string[]).includes(s);
}

/**
 * Fail-soft coerce — caller truyền source không match catalog (vd
 * legacy data, source mới chưa thêm) → trả về `'OTHER'` thay vì
 * throw. Scanner / classifier dùng để KHÔNG crash khi gặp source
 * lạ.
 */
export function coerceGameplayAnomalySource(
  s: string | null | undefined,
): GameplayAnomalySource {
  if (!s) return 'OTHER';
  return isGameplayAnomalySource(s) ? s : 'OTHER';
}

/**
 * Severity ordering. Ngầm dùng cho filter "≥ severity" trong query
 * + sort UI "CRITICAL trên đầu".
 *
 * Convention: `INFO=0, WARN=1, CRITICAL=2`. So sánh return -1/0/1.
 */
const SEVERITY_RANK: Record<GameplayAnomalySeverity, number> = {
  INFO: 0,
  WARN: 1,
  CRITICAL: 2,
};

/** -1 nếu a < b, 0 nếu bằng, 1 nếu a > b (theo rank). */
export function compareGameplaySeverity(
  a: GameplayAnomalySeverity,
  b: GameplayAnomalySeverity,
): number {
  return Math.sign(SEVERITY_RANK[a] - SEVERITY_RANK[b]);
}

/**
 * Suy ra severity từ giá trị `value` vs `rule`. Dùng cho scanner / hook.
 * Convention:
 *   - `|value| < warnThreshold`  → trả `null` (không trigger).
 *   - `warnThreshold ≤ |value| < criticalThreshold`  → `WARN`.
 *   - `|value| ≥ criticalThreshold` → `CRITICAL`.
 *
 * Caller không nên ghi `INFO` qua helper này — `INFO` dành cho ngữ cảnh
 * "đáng chú ý nhưng chưa qua warn", set tay khi cần.
 */
export function classifyGameplaySeverity(
  value: bigint,
  rule: GameplayAnomalyRule,
): GameplayAnomalySeverity | null {
  const abs = value < 0n ? -value : value;
  if (abs < rule.warnThreshold) return null;
  if (abs >= rule.criticalThreshold) return 'CRITICAL';
  return 'WARN';
}

// ---------- Per-type pure classifiers (sugar wrappers) ----------

/** Sugar: classify EXP gain spike trong window. */
export function classifyExpGainSpike(
  totalExpGained: bigint,
): GameplayAnomalySeverity | null {
  return classifyGameplaySeverity(
    totalExpGained,
    getGameplayAnomalyRule('EXP_GAIN_SPIKE'),
  );
}

/** Sugar: classify currency gain spike (LinhThạch) trong window. */
export function classifyCurrencyGainSpike(
  totalPositiveDelta: bigint,
): GameplayAnomalySeverity | null {
  return classifyGameplaySeverity(
    totalPositiveDelta,
    getGameplayAnomalyRule('CURRENCY_GAIN_SPIKE'),
  );
}

/** Sugar: classify item gain spike trong window. */
export function classifyItemGainSpike(
  totalQtyGained: bigint,
): GameplayAnomalySeverity | null {
  return classifyGameplaySeverity(
    totalQtyGained,
    getGameplayAnomalyRule('ITEM_GAIN_SPIKE'),
  );
}

/** Sugar: classify reward farm pattern theo type cụ thể. */
export function classifyRewardFarmPattern(
  type:
    | 'DUNGEON_REWARD_FARM'
    | 'BOSS_REWARD_FARM'
    | 'MISSION_REWARD_FARM'
    | 'ARENA_REWARD_FARM'
    | 'TERRITORY_REWARD_SPIKE',
  count: bigint,
): GameplayAnomalySeverity | null {
  return classifyGameplaySeverity(count, getGameplayAnomalyRule(type));
}

/**
 * Build deterministic windowKey cho 1 anomaly. Caller truyền:
 *   - `type` — type rule (xác định window kind).
 *   - `now` — thời điểm scan (UTC).
 *   - `windowMs` — override (optional). Mặc định lấy từ rule.
 *
 * Format:
 *   - `1h` window: `'1h:YYYY-MM-DDTHH'` (hourly bucket UTC).
 *   - `24h` window: `'24h:YYYY-MM-DD'` (daily bucket UTC).
 *   - `7d` window: `'7d:YYYY-Www'` (ISO week UTC).
 *   - fallback: `'<ms>ms:<timestampFloor>'`.
 *
 * Idempotency: cùng `(type, characterId, windowKey)` chỉ tạo 1 row
 * trong DB. Re-scan trong cùng window → upsert noop.
 */
export function buildGameplayAnomalyWindowKey(args: {
  type: GameplayAnomalyType;
  now: Date;
  windowMs?: number;
}): string {
  const rule = getGameplayAnomalyRule(args.type);
  const windowMs = args.windowMs ?? rule.windowMs;
  if (windowMs === ONE_HOUR_MS) return formatHourlyBucket(args.now);
  if (windowMs === ONE_DAY_MS) return formatDailyBucket(args.now);
  if (windowMs === ONE_WEEK_MS) return formatWeeklyBucket(args.now);
  // Fallback — bucket theo floor(now / windowMs).
  const floor = Math.floor(args.now.getTime() / windowMs) * windowMs;
  return `${windowMs}ms:${floor}`;
}

function formatHourlyBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `1h:${y}-${m}-${d}T${h}`;
}

function formatDailyBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `24h:${y}-${m}-${d}`;
}

/**
 * ISO week bucket: `'7d:YYYY-Www'` theo UTC. Dùng đơn giản
 * (Thursday-based ISO 8601): tuần chứa thứ năm là tuần của năm
 * tương ứng. Test verify boundary 2026-01-01.
 */
function formatWeeklyBucket(now: Date): string {
  // Algorithm theo ISO 8601 — copy từ MDN.
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayNumber = (target.getUTCDay() + 6) % 7; // Monday=0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );
  return `7d:${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
