/**
 * Phase 15.6 — Config Version + Rollback (shared types + safety helpers).
 *
 * Mục tiêu:
 *   - Versioning + audit cho 4 admin-managed config:
 *     `LIVEOPS_EVENT`, `LIVEOPS_ANNOUNCEMENT`, `FEATURE_FLAG`,
 *     `MAINTENANCE_WINDOW`.
 *   - Mỗi mutation từ admin (CREATE/UPDATE/DISABLE/ENABLE/STATUS_RECOMPUTE)
 *     ghi 1 row `ConfigVersion` snapshot before/after.
 *   - Admin xem diff, dry-run rollback, rollback target version.
 *   - Rollback an toàn: `SAFE` / `NEED_CONFIRM` / `BLOCKED` — không gây
 *     double reward, không bật nhầm event đã ENDED, không khoá ngoài
 *     admin trong maintenance.
 *
 * Design:
 *   - Pure-fn ở shared (không I/O):
 *       `isConfigVersionEntityType` / `isConfigVersionAction` /
 *       `isConfigRollbackSafetyLevel` / `isConfigRollbackStatus` —
 *       validate string từ DB hoặc network input.
 *       `sanitizeSnapshot` — strip secret-like field trước khi lưu /
 *       hiển thị (defense-in-depth).
 *       `computeRollbackSafety` — quyết định safety level dựa trên
 *       entity type + target snapshot + current snapshot + extra context
 *       (e.g. event đã có claim).
 *       `diffSnapshots` — JSON-level diff đơn giản (added/removed/changed).
 *   - I/O persistence + service orchestration ở API tier
 *     (`apps/api/src/modules/config-version/*`). Shared không biết DB.
 */

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

/**
 * 4 entity được Phase 15.6 cover. Forward-compat: thêm entity mới
 * (e.g. `SECT_SEASON_CONFIG`) bằng cách extend type + update
 * `CONFIG_VERSION_ENTITY_TYPES`. KHÔNG xoá value cũ — DB row cũ vẫn ref.
 */
export type ConfigVersionEntityType =
  | 'LIVEOPS_EVENT'
  | 'LIVEOPS_ANNOUNCEMENT'
  | 'FEATURE_FLAG'
  | 'MAINTENANCE_WINDOW';

export const CONFIG_VERSION_ENTITY_TYPES: readonly ConfigVersionEntityType[] = [
  'LIVEOPS_EVENT',
  'LIVEOPS_ANNOUNCEMENT',
  'FEATURE_FLAG',
  'MAINTENANCE_WINDOW',
] as const;

export function isConfigVersionEntityType(
  s: string,
): s is ConfigVersionEntityType {
  return (CONFIG_VERSION_ENTITY_TYPES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Action ghi vào `ConfigVersion`:
 *   - `CREATE`            — admin tạo entity mới.
 *   - `UPDATE`            — admin cập nhật field.
 *   - `DISABLE`           — admin tắt (kill switch).
 *   - `ENABLE`            — admin bật lại (Feature Flag toggle on, hoặc
 *     Maintenance/Announcement DISABLED → SCHEDULED).
 *   - `STATUS_RECOMPUTE`  — cron auto transition (SCHEDULED→ACTIVE,
 *     ACTIVE→ENDED). Service chỉ ghi nếu status thật sự đổi để tránh
 *     spam mỗi cron tick.
 *   - `ROLLBACK`          — admin rollback về version cũ (after = target
 *     snapshot). `reason` gồm `from→to` version để audit.
 */
export type ConfigVersionAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DISABLE'
  | 'ENABLE'
  | 'STATUS_RECOMPUTE'
  | 'ROLLBACK';

export const CONFIG_VERSION_ACTIONS: readonly ConfigVersionAction[] = [
  'CREATE',
  'UPDATE',
  'DISABLE',
  'ENABLE',
  'STATUS_RECOMPUTE',
  'ROLLBACK',
] as const;

export function isConfigVersionAction(s: string): s is ConfigVersionAction {
  return (CONFIG_VERSION_ACTIONS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Safety levels
// ---------------------------------------------------------------------------

/**
 * Safety của rollback:
 *   - `SAFE`          — admin có thể apply trực tiếp.
 *   - `NEED_CONFIRM`  — admin phải gửi `confirmPhrase` (default
 *     `CONFIRM_ROLLBACK`) để apply. Hữu ích cho thay đổi rủi ro
 *     vừa phải (rollback flag SAFETY/MARKET, rollback maintenance
 *     CRITICAL, rollback event đã có claim nhưng config không đổi
 *     reward).
 *   - `BLOCKED`       — server từ chối rollback, không cho apply
 *     bất kể confirm. Lý do trả về trong `warnings`.
 */
export type ConfigRollbackSafetyLevel = 'SAFE' | 'NEED_CONFIRM' | 'BLOCKED';

export const CONFIG_ROLLBACK_SAFETY_LEVELS: readonly ConfigRollbackSafetyLevel[] = [
  'SAFE',
  'NEED_CONFIRM',
  'BLOCKED',
] as const;

export function isConfigRollbackSafetyLevel(
  s: string,
): s is ConfigRollbackSafetyLevel {
  return (CONFIG_ROLLBACK_SAFETY_LEVELS as readonly string[]).includes(s);
}

/**
 * Trạng thái của 1 lần rollback (ghi vào `ConfigRollbackRun`):
 *   - `DRY_RUN`  — admin xem preview, KHÔNG mutate.
 *   - `APPLIED`  — admin đã apply và service mutate thành công.
 *   - `BLOCKED`  — server từ chối (safety=BLOCKED hoặc confirm thiếu).
 *   - `FAILED`   — error trong khi apply (DB conflict, validator reject).
 */
export type ConfigRollbackStatus = 'DRY_RUN' | 'APPLIED' | 'BLOCKED' | 'FAILED';

export const CONFIG_ROLLBACK_STATUSES: readonly ConfigRollbackStatus[] = [
  'DRY_RUN',
  'APPLIED',
  'BLOCKED',
  'FAILED',
] as const;

export function isConfigRollbackStatus(s: string): s is ConfigRollbackStatus {
  return (CONFIG_ROLLBACK_STATUSES as readonly string[]).includes(s);
}

/** Default phrase admin phải gửi để confirm rollback `NEED_CONFIRM`. */
export const CONFIG_ROLLBACK_CONFIRM_PHRASE = 'CONFIRM_ROLLBACK' as const;

// ---------------------------------------------------------------------------
// Snapshot type
// ---------------------------------------------------------------------------

/**
 * Snapshot là plain JSON object. Service serialize entity row qua
 * `JSON.parse(JSON.stringify(row))` rồi pass qua `sanitizeSnapshot`
 * trước khi persist.
 */
export type ConfigVersionSnapshot = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Sanitize snapshot
// ---------------------------------------------------------------------------

/**
 * Pattern key bị strip trước khi lưu snapshot:
 *   - chứa `password`, `secret`, `token`, `cookie`, `apiKey` /
 *     `api_key`, `privateKey`, `accessKey` (case-insensitive).
 *   - 4 entity Phase 15.6 không có field như vậy theo schema, nhưng
 *     `sanitizeSnapshot` là defense-in-depth để forward-compat.
 *
 * KHÔNG strip nested object (giữ nguyên cấu trúc) — chỉ key trùng pattern
 * tại bất kỳ depth bị thay bằng `'[REDACTED]'`. Empty array / object giữ
 * nguyên.
 */
const SECRET_KEY_PATTERN =
  /(password|secret|token|cookie|api[_-]?key|private[_-]?key|access[_-]?key|sessionid)/i;

const REDACTED_PLACEHOLDER = '[REDACTED]' as const;

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Recursively walk object/array, replace value of secret-like keys with
 * `'[REDACTED]'`. Pure — không mutate input, return cloned shape.
 */
export function sanitizeSnapshot<T extends Record<string, unknown>>(input: T): T {
  return sanitizeValue(input) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretLikeKey(k)) {
        out[k] = REDACTED_PLACEHOLDER;
      } else {
        out[k] = sanitizeValue(v);
      }
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Diff snapshots
// ---------------------------------------------------------------------------

/**
 * Đơn giản: so 2 object top-level, return `{ key: { before, after } }`
 * cho mọi key có giá trị khác nhau (bao gồm key chỉ xuất hiện 1 bên).
 *
 * Đủ tốt cho admin UI hiển thị diff "field X từ Y → Z" ở Phase 15.6.
 * Phase 15.7+ có thể thay bằng deep diff nếu cần.
 */
export interface ConfigSnapshotDiffEntry {
  readonly before: unknown;
  readonly after: unknown;
}

export function diffSnapshots(
  before: ConfigVersionSnapshot | null,
  after: ConfigVersionSnapshot | null,
): Record<string, ConfigSnapshotDiffEntry> {
  const out: Record<string, ConfigSnapshotDiffEntry> = {};
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const keys = new Set<string>([
    ...Object.keys(beforeObj),
    ...Object.keys(afterObj),
  ]);
  for (const k of keys) {
    const bv = beforeObj[k];
    const av = afterObj[k];
    if (!deepEqual(bv, av)) {
      out[k] = { before: bv ?? null, after: av ?? null };
    }
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object') return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Compute rollback safety
// ---------------------------------------------------------------------------

/**
 * Context chung cho safety checker — caller (API service) pass per
 * entity type. Optional, missing context = an toàn nhất (vd nếu
 * `liveOpsClaimCount` không cung cấp, default = 0 — không có claim).
 */
export interface ConfigRollbackSafetyContext {
  readonly now?: Date;
  /** LIVEOPS_EVENT — số reward claim đã được player redeem. */
  readonly liveOpsEventClaimCount?: number;
  /**
   * Catalog cap hiện tại của event type (nếu rollback config trở về
   * row có multiplier vượt cap mới → BLOCKED).
   */
  readonly liveOpsEventTypeMultiplierMax?: number;
  /**
   * FEATURE_FLAG keys nguy hiểm (rollback NEED_CONFIRM thay vì SAFE).
   * Thường: `MARKET_ENABLED`, `LIVEOPS_EVENTS_ENABLED`,
   * `MAINTENANCE_WINDOW_ENABLED` (forward-compat khi flag tồn tại).
   */
  readonly criticalFeatureFlagKeys?: readonly string[];
}

/**
 * Result của safety check.
 *   - `level`           — SAFE / NEED_CONFIRM / BLOCKED.
 *   - `warnings`        — list warning string hiển thị admin (i18n key).
 *   - `requiresConfirm` — true khi level=NEED_CONFIRM.
 *   - `confirmPhrase`   — phrase admin cần gửi (chỉ set khi requiresConfirm).
 */
export interface ConfigRollbackSafetyResult {
  readonly level: ConfigRollbackSafetyLevel;
  readonly warnings: readonly string[];
  readonly requiresConfirm: boolean;
  readonly confirmPhrase: string | null;
}

const DEFAULT_CRITICAL_FLAGS: readonly string[] = [
  'MARKET_ENABLED',
  'LIVEOPS_EVENTS_ENABLED',
  'LIVEOPS_FESTIVAL_GIFT_ENABLED',
  'LIVEOPS_ANNOUNCEMENTS_ENABLED',
  'TERRITORY_WAR_ENABLED',
  'MAINTENANCE_WINDOW_ENABLED',
];

/**
 * Pure-fn quyết định rollback safety. Không gây side-effect.
 *
 * Rules ngắn gọn (chi tiết trong RUNBOOK):
 *
 *   FEATURE_FLAG:
 *     - Default `SAFE`.
 *     - `NEED_CONFIRM` nếu key ∈ `criticalFeatureFlagKeys` (default
 *       list: MARKET / LIVEOPS_EVENTS / FESTIVAL_GIFT / ANNOUNCEMENTS /
 *       TERRITORY_WAR / MAINTENANCE_WINDOW — flag toàn cục).
 *
 *   LIVEOPS_ANNOUNCEMENT:
 *     - Rollback về snapshot status `ACTIVE` nhưng `endsAt < now` →
 *       `BLOCKED` (announcement đã ENDED không bật lại được).
 *     - Rollback về `DISABLED` từ status khác → `SAFE`.
 *     - Còn lại → `SAFE`.
 *
 *   MAINTENANCE_WINDOW:
 *     - Target snapshot `severity=CRITICAL` hoặc
 *       `target=FULL_LOCKDOWN` → `NEED_CONFIRM` (admin có thể bị khoá
 *       ngoài nếu sai cấu hình).
 *     - Target snapshot `allowAdminBypass=false` → `BLOCKED` (không
 *       được rollback cấu hình khoá admin).
 *     - Rollback maintenance đang `ACTIVE` (current snapshot status =
 *       ACTIVE) → cảnh báo NEED_CONFIRM kèm warning rõ.
 *     - Còn lại → `SAFE`.
 *
 *   LIVEOPS_EVENT:
 *     - `liveOpsEventClaimCount > 0` AND target snapshot `type =
 *       FESTIVAL_GIFT` AND `rewardJson` thay đổi so với current →
 *       `BLOCKED` (sẽ gây double reward / inconsistent claim).
 *     - `liveOpsEventClaimCount > 0` AND target snapshot status ≠
 *       current status → `NEED_CONFIRM` (rollback enable/disable trên
 *       event đã có claim).
 *     - Target snapshot `configJson.multiplier > liveOpsEventTypeMultiplierMax`
 *       → `BLOCKED` (vượt cap balance).
 *     - Rollback về `ACTIVE` nhưng `endsAt <= now` → `BLOCKED` (event
 *       đã hết).
 *     - Còn lại → `SAFE`.
 */
export function computeRollbackSafety(
  entityType: ConfigVersionEntityType,
  targetSnapshot: ConfigVersionSnapshot,
  currentSnapshot: ConfigVersionSnapshot | null,
  context: ConfigRollbackSafetyContext = {},
): ConfigRollbackSafetyResult {
  const warnings: string[] = [];
  const now = context.now ?? new Date();

  switch (entityType) {
    case 'FEATURE_FLAG': {
      const key = stringField(targetSnapshot, 'key');
      const critical =
        context.criticalFeatureFlagKeys ?? DEFAULT_CRITICAL_FLAGS;
      if (key && critical.includes(key)) {
        warnings.push('rollback.warning.featureFlagCritical');
        return needConfirm(warnings);
      }
      return safe();
    }

    case 'LIVEOPS_ANNOUNCEMENT': {
      const status = stringField(targetSnapshot, 'status');
      const endsAtRaw = stringField(targetSnapshot, 'endsAt');
      if (status === 'ACTIVE' && endsAtRaw) {
        const endsAt = new Date(endsAtRaw);
        if (
          !Number.isNaN(endsAt.getTime()) &&
          endsAt.getTime() <= now.getTime()
        ) {
          warnings.push('rollback.warning.announcementEnded');
          return blocked(warnings);
        }
      }
      return safe();
    }

    case 'MAINTENANCE_WINDOW': {
      const allowAdminBypass = booleanField(targetSnapshot, 'allowAdminBypass');
      if (allowAdminBypass === false) {
        warnings.push('rollback.warning.maintenanceLocksOutAdmin');
        return blocked(warnings);
      }
      const severity = stringField(targetSnapshot, 'severity');
      const target = stringField(targetSnapshot, 'target');
      const dangerous =
        severity === 'CRITICAL' || target === 'FULL_LOCKDOWN';
      const currentStatus = currentSnapshot
        ? stringField(currentSnapshot, 'status')
        : null;
      if (currentStatus === 'ACTIVE') {
        warnings.push('rollback.warning.maintenanceCurrentlyActive');
      }
      if (dangerous) {
        warnings.push('rollback.warning.maintenanceCritical');
        return needConfirm(warnings);
      }
      if (currentStatus === 'ACTIVE') {
        return needConfirm(warnings);
      }
      return safe();
    }

    case 'LIVEOPS_EVENT': {
      const claimCount = context.liveOpsEventClaimCount ?? 0;
      const targetType = stringField(targetSnapshot, 'type');
      const currentType = currentSnapshot
        ? stringField(currentSnapshot, 'type')
        : null;
      const targetStatus = stringField(targetSnapshot, 'status');
      const currentStatus = currentSnapshot
        ? stringField(currentSnapshot, 'status')
        : null;
      const targetEndsAtRaw = stringField(targetSnapshot, 'endsAt');
      const targetReward = jsonField(targetSnapshot, 'configJson');
      const currentReward = currentSnapshot
        ? jsonField(currentSnapshot, 'configJson')
        : null;
      const targetMultiplier = numberFromJson(targetReward, 'multiplier');
      const cap = context.liveOpsEventTypeMultiplierMax;

      if (
        cap !== undefined &&
        targetMultiplier !== null &&
        targetMultiplier > cap
      ) {
        warnings.push('rollback.warning.eventMultiplierOverCap');
        return blocked(warnings);
      }

      if (
        claimCount > 0 &&
        (targetType === 'FESTIVAL_GIFT' || currentType === 'FESTIVAL_GIFT')
      ) {
        const beforeRewardJson = currentReward
          ? extractRewardJson(currentReward)
          : null;
        const afterRewardJson = targetReward
          ? extractRewardJson(targetReward)
          : null;
        if (!sameRewardJson(beforeRewardJson, afterRewardJson)) {
          warnings.push('rollback.warning.festivalGiftRewardChanged');
          return blocked(warnings);
        }
      }

      if (targetStatus === 'ACTIVE' && targetEndsAtRaw) {
        const endsAt = new Date(targetEndsAtRaw);
        if (
          !Number.isNaN(endsAt.getTime()) &&
          endsAt.getTime() <= now.getTime()
        ) {
          warnings.push('rollback.warning.eventEnded');
          return blocked(warnings);
        }
      }

      if (claimCount > 0 && targetStatus !== currentStatus) {
        warnings.push('rollback.warning.eventStatusChangeAfterClaims');
        return needConfirm(warnings);
      }

      return safe();
    }

    default: {
      // Forward-compat: unknown entity type → BLOCKED to fail closed.
      warnings.push('rollback.warning.unknownEntityType');
      return blocked(warnings);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function safe(): ConfigRollbackSafetyResult {
  return {
    level: 'SAFE',
    warnings: [],
    requiresConfirm: false,
    confirmPhrase: null,
  };
}

function needConfirm(warnings: string[]): ConfigRollbackSafetyResult {
  return {
    level: 'NEED_CONFIRM',
    warnings,
    requiresConfirm: true,
    confirmPhrase: CONFIG_ROLLBACK_CONFIRM_PHRASE,
  };
}

function blocked(warnings: string[]): ConfigRollbackSafetyResult {
  return {
    level: 'BLOCKED',
    warnings,
    requiresConfirm: false,
    confirmPhrase: null,
  };
}

function stringField(
  snapshot: ConfigVersionSnapshot,
  key: string,
): string | null {
  const v = snapshot[key];
  return typeof v === 'string' ? v : null;
}

function booleanField(
  snapshot: ConfigVersionSnapshot,
  key: string,
): boolean | null {
  const v = snapshot[key];
  return typeof v === 'boolean' ? v : null;
}

function jsonField(
  snapshot: ConfigVersionSnapshot,
  key: string,
): Record<string, unknown> | null {
  const v = snapshot[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function numberFromJson(
  json: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!json) return null;
  const v = json[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function extractRewardJson(
  json: Record<string, unknown>,
): Record<string, unknown> | null {
  const v = json.rewardJson;
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function sameRewardJson(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return deepEqual(a, b);
}

// ---------------------------------------------------------------------------
// Rollback dry-run / apply API contract
// ---------------------------------------------------------------------------

/**
 * Response shared cho cả `dry-run-rollback` và `rollback`. Apply path
 * thêm `appliedVersion` (number) và `newVersionId` (string) — version
 * mới được tạo bởi action `ROLLBACK`.
 */
export interface ConfigRollbackResponse {
  readonly status: ConfigRollbackStatus;
  readonly safetyLevel: ConfigRollbackSafetyLevel;
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly fromVersion: number;
  readonly targetVersion: number;
  readonly changedFields: readonly string[];
  readonly diff: Record<string, ConfigSnapshotDiffEntry>;
  readonly warnings: readonly string[];
  readonly requiresConfirm: boolean;
  readonly confirmPhrase: string | null;
  readonly appliedVersion: number | null;
  readonly newVersionId: string | null;
}
