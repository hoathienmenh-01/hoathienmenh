/**
 * Phase 18.2 — Session Management Hardening shared types.
 *
 * Source-of-truth cho FE/BE share types cho:
 *   - User-facing endpoint list/revoke session của chính user.
 *   - Admin-facing endpoint list/revoke session ở Security panel.
 *   - Refresh token rotation + reuse-detection event payload.
 *
 * Bối cảnh:
 *   - Phase R1 + Phase 18.1 đã có `RefreshToken` (jti + argon2 hash +
 *     rotatedFromId) + `SecurityEvent` (string `type`). Phase 18.2
 *     thêm `UserSession` row đại diện 1 "device login" group nhiều
 *     `RefreshToken` cùng family, để:
 *       - admin/user xem được các phiên đăng nhập đang active.
 *       - khi detect refresh token reuse → revoke cả session
 *         (mọi refresh token con) + emit `REFRESH_TOKEN_REUSED` event.
 *       - cho phép revoke 1 session cụ thể mà không phải logout toàn bộ.
 *
 * Privacy:
 *   - `ipHash` (sha256 với env salt) — KHÔNG bao giờ trả raw IP.
 *   - `userAgent` được sanitize (truncate, strip control char) trước
 *     khi persist.
 *   - `refreshTokenHash` KHÔNG bao giờ xuất hiện trong response/log.
 */

/**
 * Lý do session được revoke. Lưu cùng row để admin/user debug.
 *
 *   - `USER_LOGOUT` — user nhấn logout / logout-all hoặc revoke 1 session.
 *   - `ADMIN_REVOKE` — admin revoke từ panel.
 *   - `REFRESH_REUSED` — detect refresh token đã rotate được dùng lại
 *     → defensive revoke toàn bộ session family.
 *   - `PASSWORD_CHANGED` — change-password hoặc reset-password flow.
 *   - `EXPIRED` — `expiresAt` đã qua (mark khi list).
 *   - `SUSPICIOUS` — phát hiện hành vi bất thường (vd login bất thường
 *     ở mức cơ bản); Phase 18.2 reserve cho phase sau wire heuristic.
 */
export const SESSION_REVOKE_REASONS = [
  'USER_LOGOUT',
  'ADMIN_REVOKE',
  'REFRESH_REUSED',
  'PASSWORD_CHANGED',
  'EXPIRED',
  'SUSPICIOUS',
] as const;

export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export function isSessionRevokeReason(v: unknown): v is SessionRevokeReason {
  return (
    typeof v === 'string' &&
    (SESSION_REVOKE_REASONS as readonly string[]).includes(v)
  );
}

/**
 * Filter status cho list session.
 *
 *   - `ACTIVE` — `revokedAt IS NULL AND expiresAt > now()`.
 *   - `REVOKED` — `revokedAt IS NOT NULL`.
 *   - `EXPIRED` — `revokedAt IS NULL AND expiresAt <= now()`.
 *   - `ALL` — không filter.
 */
export const SESSION_STATUS_FILTERS = [
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
  'ALL',
] as const;

export type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];

export function isSessionStatusFilter(v: unknown): v is SessionStatusFilter {
  return (
    typeof v === 'string' &&
    (SESSION_STATUS_FILTERS as readonly string[]).includes(v)
  );
}

/**
 * Computed status của 1 session khi serialize ra response.
 * Không phải column DB — tính từ `revokedAt` + `expiresAt` tại thời
 * điểm read.
 */
export type SessionComputedStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export function computeSessionStatus(args: {
  revokedAt: Date | string | null;
  expiresAt: Date | string;
  now?: Date;
}): SessionComputedStatus {
  if (args.revokedAt) return 'REVOKED';
  const exp =
    args.expiresAt instanceof Date
      ? args.expiresAt
      : new Date(args.expiresAt);
  const now = args.now ?? new Date();
  if (exp.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

/**
 * Summary 1 session để render ở FE (user account + admin panel).
 *
 * KHÔNG include refresh token hash, JWT, IP raw.
 */
export interface UserSessionSummary {
  id: string;
  userId: string;
  /** sha256(salt || ip). `null` nếu IP không capture được (vd test). */
  ipHash: string | null;
  /** Sanitized UA (truncate ≤256 chars). `null` nếu request không gửi UA. */
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: SessionRevokeReason | null;
  /** Admin/user id thực hiện revoke; null nếu chưa revoke / hết hạn tự nhiên. */
  revokedById: string | null;
  suspicious: boolean;
  /** Computed at read time (KHÔNG persist). */
  status: SessionComputedStatus;
  /** True nếu session này được dùng để gọi request hiện tại. */
  current: boolean;
}

/**
 * Response `GET /_auth/sessions` — list session của chính user.
 */
export interface UserSessionsListResponse {
  sessions: UserSessionSummary[];
  generatedAt: string;
}

/**
 * Response `DELETE /_auth/sessions/:id` — revoke 1 session.
 */
export interface UserSessionRevokeResponse {
  session: UserSessionSummary;
}

/**
 * Response `GET /admin/security/sessions` — admin list session.
 *
 * Cursor pagination giống `GET /admin/security/events` để consistent.
 */
export interface AdminSessionsListResponse {
  sessions: UserSessionSummary[];
  nextCursor: string | null;
  generatedAt: string;
}

/**
 * Response `POST /admin/security/sessions/:id/revoke`.
 */
export interface AdminSessionRevokeResponse {
  session: UserSessionSummary;
}

/**
 * Error code chung cho session API (user + admin).
 *
 *   - `SESSION_NOT_FOUND` — id không tồn tại HOẶC không thuộc user
 *     (user route phải mask 404 để chống enumeration).
 *   - `SESSION_FORBIDDEN` — user thử revoke session người khác (route
 *     user). Admin route KHÔNG dùng code này — dùng `ADMIN_ONLY` 403
 *     theo standard.
 *   - `SESSION_ALREADY_REVOKED` — idempotent: revoke 2 lần một session
 *     đã revoke → vẫn 200 nhưng status REVOKED. KHÔNG throw; reserved
 *     cho test assertion.
 */
export type SessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_FORBIDDEN'
  | 'SESSION_ALREADY_REVOKED';

/**
 * Max length của `userAgent` lưu xuống DB.
 *
 * Hầu hết UA real-world ≤180 char; 256 đủ buffer cho mobile + ngôn ngữ.
 * Cap để tránh DB row quá lớn khi header bị spam bot inject.
 */
export const USER_AGENT_MAX_LENGTH = 256;

/**
 * Sanitize UA string trước khi persist.
 *
 *   - Strip control char (`\u0000`-`\u001F`, `\u007F`).
 *   - Trim trailing whitespace.
 *   - Truncate `USER_AGENT_MAX_LENGTH`.
 *
 * Return `null` nếu sau sanitize còn empty (vd UA toàn whitespace).
 */
export function sanitizeUserAgent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  const trimmed = stripped.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, USER_AGENT_MAX_LENGTH);
}
