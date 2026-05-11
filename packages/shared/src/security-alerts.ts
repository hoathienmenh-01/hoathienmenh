/**
 * Phase 18.3 — Security Audit / Alert Polish (shared, pure).
 *
 * Mục đích:
 *   - Cung cấp **single source of truth** cho phân loại event bảo mật
 *     thành alert (severity/type/source/alertType) — dùng chung BE
 *     (`SecurityAlertService`) và FE (Admin SecurityAlert panel).
 *   - Định nghĩa enum `SecurityAlertSeverity` / `SecurityAlertStatus`
 *     dùng cho UI filter + DB string literal.
 *
 * Pure (no IO, no env, no Date.now). Test-friendly + dùng được FE/BE.
 *
 * Bối cảnh:
 *   - Phase 18.1 + 18.2 đã ghi nhiều loại `SecurityEvent` (rate-limit
 *     violation, login failed, admin forbidden, IP/USER blocked, block
 *     lifted, session created/revoked, refresh-token reused,
 *     suspicious session).
 *   - Phase 18.3 KHÔNG tạo runtime mới — chỉ lớp aggregation + workflow
 *     ack/resolve để admin theo dõi, không auto-ban, không auto-rollback,
 *     không auto-xoá session.
 *   - Fail-soft: nếu BE thấy event type chưa biết → fallback `OTHER` /
 *     `INFO`, không crash.
 *
 * Companion docs: `docs/SECURITY.md` §Security Alert Workflow.
 */

/**
 * Severity của 1 alert. Khớp cột `severity` (string literal) ở DB.
 *
 *   - `INFO` — sự kiện không đáng báo động (rate-limit nhẹ, session
 *     created bình thường, block lifted).
 *   - `WARN` — sự kiện cần để mắt (login failed cao, admin forbidden,
 *     rate-limit medium escalation).
 *   - `CRITICAL` — sự kiện cần xử lý ngay (refresh-token reused, IP
 *     hoặc USER bị block, rate-limit HIGH, suspicious session).
 */
export const SECURITY_ALERT_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export type SecurityAlertSeverity = (typeof SECURITY_ALERT_SEVERITIES)[number];

export function isSecurityAlertSeverity(
  v: unknown,
): v is SecurityAlertSeverity {
  return (
    typeof v === 'string' &&
    (SECURITY_ALERT_SEVERITIES as readonly string[]).includes(v)
  );
}

/**
 * Lifecycle status của alert. Khớp cột `status` (string literal) ở DB.
 *
 *   - `OPEN` — admin chưa xử lý.
 *   - `ACKNOWLEDGED` — admin đã thấy + xác nhận, đang theo dõi (có thể
 *     leo lên RESOLVED hoặc đóng do trùng lặp).
 *   - `RESOLVED` — admin đã xử lý xong + ghi `resolutionNote`.
 *
 * Workflow: OPEN → ACKNOWLEDGED → RESOLVED. Cho phép skip ACK (OPEN
 * → RESOLVED) khi admin xử lý ngay.
 */
export const SECURITY_ALERT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type SecurityAlertStatus = (typeof SECURITY_ALERT_STATUSES)[number];

export function isSecurityAlertStatus(v: unknown): v is SecurityAlertStatus {
  return (
    typeof v === 'string' &&
    (SECURITY_ALERT_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Source = mảng nguồn phát sinh alert. Map sự kiện gốc về group cao
 * hơn để FE có thể filter "kind of issue".
 *
 *   - `RATE_LIMIT`  — RATE_LIMIT_VIOLATION, IP_BLOCKED, USER_BLOCKED,
 *                     BLOCK_LIFTED khi reason là RATE_LIMIT.
 *   - `AUTH`        — LOGIN_FAILED, REGISTER_SPAM, INVALID_TOKEN.
 *   - `SESSION`     — SESSION_CREATED, SESSION_REVOKED,
 *                     REFRESH_TOKEN_REUSED, SESSION_SUSPICIOUS.
 *   - `ADMIN`       — ADMIN_FORBIDDEN.
 *   - `BLOCK`       — IP_BLOCKED, USER_BLOCKED, BLOCK_LIFTED khi
 *                     reason không phải rate-limit (vd LOGIN_FAILED_SPAM).
 *   - `OTHER`       — fallback cho event type chưa biết.
 */
export const SECURITY_ALERT_SOURCES = [
  'RATE_LIMIT',
  'AUTH',
  'SESSION',
  'ADMIN',
  'BLOCK',
  'OTHER',
] as const;
export type SecurityAlertSource = (typeof SECURITY_ALERT_SOURCES)[number];

export function isSecurityAlertSource(v: unknown): v is SecurityAlertSource {
  return (
    typeof v === 'string' &&
    (SECURITY_ALERT_SOURCES as readonly string[]).includes(v)
  );
}

/**
 * Alert type — phân loại chi tiết hơn `source`. FE dùng để hiển thị
 * label/icon. Mỗi alert type map từ 1 hoặc nhiều `SecurityEventType`.
 *
 * Lưu ý: cố tình KHÔNG mirror 1-1 mọi `SecurityEventType` — alert là
 * lớp workflow, một số event ghép vào cùng alert type (vd
 * `IP_BLOCKED` + `USER_BLOCKED` đều thuộc `SUBJECT_BLOCKED`).
 */
export const SECURITY_ALERT_TYPES = [
  'RATE_LIMIT_ABUSE',
  'LOGIN_ABUSE',
  'INVALID_TOKEN',
  'ADMIN_FORBIDDEN',
  'SUBJECT_BLOCKED',
  'BLOCK_LIFTED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_REUSED',
  'SESSION_SUSPICIOUS',
  'OTHER',
] as const;
export type SecurityAlertType = (typeof SECURITY_ALERT_TYPES)[number];

export function isSecurityAlertType(v: unknown): v is SecurityAlertType {
  return (
    typeof v === 'string' &&
    (SECURITY_ALERT_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Filter cho list alert. Tương thích với cursor pagination ở
 * `GET /admin/security/events`.
 *
 * Phía BE: dùng nullable (undefined = không filter). Phía FE: dùng
 * 'ALL' để hiển thị + chuyển thành undefined khi gọi API.
 */
export interface SecurityAlertListFilter {
  severity?: SecurityAlertSeverity;
  status?: SecurityAlertStatus;
  type?: SecurityAlertType;
  source?: SecurityAlertSource;
  /** ISO string. */
  from?: string;
  /** ISO string. */
  to?: string;
  userId?: string;
}

/**
 * Output of `classifySecurityEventForAlert` — fail-soft phân loại 1
 * `SecurityEvent` thành các field alert.
 *
 * `null` nghĩa là event này KHÔNG nên tạo alert (vd `SESSION_CREATED`
 * INFO — quá lớn để track từng cái). Caller (BE) đọc giá trị này để
 * quyết định có persist `SecurityAlert` row hay không.
 */
export interface SecurityAlertClassification {
  alertType: SecurityAlertType;
  severity: SecurityAlertSeverity;
  source: SecurityAlertSource;
}

/**
 * Map `SecurityEvent.type` (string literal trong DB) → alert
 * classification. Fail-soft:
 *
 *   - Type không match → `OTHER` / `INFO` / `OTHER`.
 *   - Severity nếu không truyền hoặc invalid → suy từ alert type
 *     (vd `REFRESH_TOKEN_REUSED` luôn `CRITICAL`).
 *
 * **KHÔNG** quyết định có persist hay không — caller (BE) tự lọc
 * theo policy (vd skip `SESSION_CREATED INFO` để tránh ngập alert).
 * Hàm này chỉ trả về classification thuần.
 *
 * @param eventType  `SecurityEvent.type` (string).
 * @param eventSeverity  `SecurityEvent.severity` (string, có thể là
 *                       `INFO` / `WARN` / `CRITICAL` hoặc invalid).
 */
export function classifySecurityEventForAlert(
  eventType: string,
  eventSeverity?: string | null,
): SecurityAlertClassification {
  // Severity hint: nếu BE đã set sẵn, ưu tiên — nhưng vẫn cho phép
  // alert type override khi semantic mismatch (vd REFRESH_TOKEN_REUSED
  // luôn CRITICAL bất kể caller truyền INFO).
  const sevHint: SecurityAlertSeverity | undefined =
    isSecurityAlertSeverity(eventSeverity) ? eventSeverity : undefined;

  switch (eventType) {
    case 'RATE_LIMIT_VIOLATION':
      return {
        alertType: 'RATE_LIMIT_ABUSE',
        // Rate-limit severity từ BE đáng tin (LOW/MED/HIGH đã ánh xạ
        // sang INFO/WARN/CRITICAL ở SecurityAbuseService.toEventSeverity).
        severity: sevHint ?? 'INFO',
        source: 'RATE_LIMIT',
      };
    case 'LOGIN_FAILED':
      return {
        alertType: 'LOGIN_ABUSE',
        severity: sevHint ?? 'WARN',
        source: 'AUTH',
      };
    case 'REGISTER_SPAM':
      return {
        alertType: 'LOGIN_ABUSE',
        severity: sevHint ?? 'WARN',
        source: 'AUTH',
      };
    case 'INVALID_TOKEN':
      return {
        alertType: 'INVALID_TOKEN',
        severity: sevHint ?? 'WARN',
        source: 'AUTH',
      };
    case 'ADMIN_FORBIDDEN':
      return {
        alertType: 'ADMIN_FORBIDDEN',
        severity: sevHint ?? 'WARN',
        source: 'ADMIN',
      };
    case 'IP_BLOCKED':
    case 'USER_BLOCKED':
      return {
        alertType: 'SUBJECT_BLOCKED',
        // Block là quyết định defensive — CRITICAL bất kể event severity.
        severity: 'CRITICAL',
        source: 'BLOCK',
      };
    case 'BLOCK_LIFTED':
      return {
        alertType: 'BLOCK_LIFTED',
        severity: sevHint ?? 'INFO',
        source: 'BLOCK',
      };
    case 'SESSION_CREATED':
      return {
        alertType: 'SESSION_CREATED',
        severity: sevHint ?? 'INFO',
        source: 'SESSION',
      };
    case 'SESSION_REVOKED':
      return {
        alertType: 'SESSION_REVOKED',
        severity: sevHint ?? 'INFO',
        source: 'SESSION',
      };
    case 'REFRESH_TOKEN_REUSED':
      return {
        alertType: 'REFRESH_TOKEN_REUSED',
        // Refresh token reuse là tín hiệu nguy hiểm — token đã rotate
        // được present lại = tài khoản bị stolen. Luôn CRITICAL.
        severity: 'CRITICAL',
        source: 'SESSION',
      };
    case 'SESSION_SUSPICIOUS':
      return {
        alertType: 'SESSION_SUSPICIOUS',
        severity: sevHint ?? 'WARN',
        source: 'SESSION',
      };
    default:
      // Fail-soft: event type chưa biết → OTHER / INFO. Không throw,
      // không crash caller.
      return {
        alertType: 'OTHER',
        severity: sevHint ?? 'INFO',
        source: 'OTHER',
      };
  }
}

/**
 * Quyết định có nên tự động tạo `SecurityAlert` row cho 1 event hay
 * không. Mục đích: tránh ngập DB với event INFO không cần admin xử
 * lý (vd `SESSION_CREATED` bình thường).
 *
 * Quy tắc Phase 18.3:
 *   - CRITICAL: luôn tạo alert (mọi event CRITICAL — IP/USER blocked,
 *     refresh-token reused, rate-limit HIGH).
 *   - WARN: tạo alert (login failed, admin forbidden, invalid token,
 *     session suspicious, rate-limit MEDIUM).
 *   - INFO: KHÔNG tạo alert mặc định (rate-limit LOW, session created,
 *     block lifted). Admin có thể đọc trực tiếp `SecurityEvent` log
 *     nếu cần.
 *
 * Caller (BE) gọi sau khi `classifySecurityEventForAlert(...)`.
 */
export function shouldCreateAlertForClassification(
  classification: SecurityAlertClassification,
): boolean {
  if (classification.severity === 'CRITICAL') return true;
  if (classification.severity === 'WARN') return true;
  return false;
}

/**
 * Summary cho dashboard admin. Mọi count là snapshot tại generatedAt.
 *
 * Companion endpoint: `GET /admin/security/summary`.
 */
export interface SecurityAlertSummary {
  /** Số alert đang OPEN với severity CRITICAL. */
  openCritical: number;
  /** Số alert đang OPEN với severity WARN. */
  openWarn: number;
  /** Số `SecurityBlock` đang active (chưa lifted + chưa expired). */
  blockedSubjects: number;
  /** Số event `REFRESH_TOKEN_REUSED` trong 24h gần nhất. */
  tokenReuseLast24h: number;
  /** Số event `SESSION_SUSPICIOUS` trong 24h gần nhất. */
  suspiciousSessionsLast24h: number;
  /** Số event `RATE_LIMIT_VIOLATION` trong 24h gần nhất. */
  rateLimitHitsLast24h: number;
  /**
   * Top 5 event CRITICAL gần nhất (theo `createdAt` desc). Mỗi entry
   * chỉ phục vụ render preview — chi tiết đầy đủ vẫn xem
   * `GET /admin/security/events`.
   */
  latestCriticalEvents: SecurityAlertLatestEvent[];
  /** ISO string — thời điểm response generate. */
  generatedAt: string;
}

export interface SecurityAlertLatestEvent {
  id: string;
  type: string;
  severity: SecurityAlertSeverity;
  /** sha256 hex (64 char). Null nếu event không gắn IP. */
  ipHash: string | null;
  userId: string | null;
  createdAt: string;
}

/**
 * Summary của 1 alert row khi serialize ra response (BE → FE).
 *
 * Phase 18.3:
 *   - KHÔNG bao giờ trả raw IP — chỉ `ipHash`.
 *   - KHÔNG trả refresh token / session token raw — chỉ id.
 *   - `detailsJson` đã được BE sanitize ở SecurityAbuseService /
 *     SessionService trước đó; FE không decode thêm.
 */
export interface SecurityAlertSummaryRow {
  id: string;
  type: SecurityAlertType;
  severity: SecurityAlertSeverity;
  status: SecurityAlertStatus;
  source: SecurityAlertSource;
  /** Linked event id (nếu alert phát sinh từ 1 `SecurityEvent`). */
  eventId: string | null;
  relatedUserId: string | null;
  relatedCharacterId: string | null;
  relatedSessionId: string | null;
  /** Sanitized detail từ event (không chứa secret). */
  detailsJson: unknown;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: string | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

/** Response `GET /admin/security/alerts`. */
export interface AdminSecurityAlertsListResponse {
  alerts: SecurityAlertSummaryRow[];
  nextCursor: string | null;
  generatedAt: string;
}

/** Response `POST /admin/security/alerts/:id/ack` + `/resolve`. */
export interface AdminSecurityAlertMutationResponse {
  alert: SecurityAlertSummaryRow;
}

/** Response `GET /admin/security/summary`. */
export interface AdminSecuritySummaryResponse {
  summary: SecurityAlertSummary;
}

/**
 * Max length của `resolutionNote`. Lưu trên DB là TEXT nhưng UI cần
 * cap để tránh admin paste log dài/spam.
 */
export const SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH = 1000;

/**
 * Sanitize note do admin nhập trước khi persist:
 *   - Strip control char (`\u0000`-`\u001F`, `\u007F`).
 *   - Trim trailing whitespace.
 *   - Truncate `SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH`.
 *
 * Return `null` nếu sau sanitize còn empty.
 */
export function sanitizeSecurityAlertNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  const trimmed = stripped.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, SECURITY_ALERT_RESOLUTION_NOTE_MAX_LENGTH);
}

/**
 * Error code cho admin alert endpoints.
 *
 *   - `ALERT_NOT_FOUND` — id không tồn tại.
 *   - `ALERT_ALREADY_RESOLVED` — alert đã ở status RESOLVED, không cho ack
 *     hoặc resolve lại (idempotent — chỉ throw nếu admin cố flip
 *     ngược).
 *   - `MOD_CANNOT_RESOLVE` — MOD không có quyền resolve (chỉ ADMIN).
 *   - `INVALID_NOTE` — resolutionNote rỗng sau khi sanitize.
 *   - `INVALID_INPUT` — generic.
 */
export type SecurityAlertErrorCode =
  | 'ALERT_NOT_FOUND'
  | 'ALERT_ALREADY_RESOLVED'
  | 'MOD_CANNOT_RESOLVE'
  | 'INVALID_NOTE'
  | 'INVALID_INPUT';
