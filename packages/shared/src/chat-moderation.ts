/**
 * Phase 19.2 — Chat Moderation & Report System
 *
 * Shared types + validators cho hệ thống moderation chat. Cùng pattern
 * với Phase 19.1 social shared catalog (deterministic, pure, no runtime
 * dependency).
 *
 * Server-authoritative invariants (test-enforced trong layer service):
 *   - User chỉ report message mà mình có quyền nhìn thấy (member thread
 *     hoặc member group). Non-member → 404 mask.
 *   - Cấm duplicate report cùng `(reporter, message)` qua unique index
 *     trong DB (Prisma).
 *   - Reason invalid → reject `INVALID_INPUT` (chỉ accept enum cố định).
 *   - Details quá dài / chứa control char → sanitize + cap ≤500 ký tự.
 *   - Mute scope quyết định channel nào user bị câm (PRIVATE / GROUP /
 *     WORLD_SECT / ALL).
 *   - ALL_CHAT scope = gộp 3 scope còn lại (service expand thành 3
 *     channel check, hoặc check union ở 1 query duy nhất).
 *
 * FE chỉ dùng constant + DTO ở đây để render — không hard-code literal
 * string status / reason / scope.
 */

// ----------------------------------------------------------------------------
// Enums (mirror Prisma) — single source of truth cho FE + BE catalog.
// ----------------------------------------------------------------------------

export const CHAT_MESSAGE_REPORT_TYPES = ['PRIVATE', 'GROUP'] as const;
export type ChatMessageReportType =
  (typeof CHAT_MESSAGE_REPORT_TYPES)[number];

export const CHAT_MESSAGE_REPORT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'REJECTED',
] as const;
export type ChatMessageReportStatus =
  (typeof CHAT_MESSAGE_REPORT_STATUSES)[number];

/**
 * Lý do report. Server chỉ accept giá trị thuộc enum này. FE render
 * dropdown với i18n key `chatModeration.reportReason.<KEY>`.
 */
export const CHAT_MESSAGE_REPORT_REASONS = [
  'SPAM',
  'HARASSMENT',
  'SCAM',
  'OFFENSIVE',
  'OTHER',
] as const;
export type ChatMessageReportReason =
  (typeof CHAT_MESSAGE_REPORT_REASONS)[number];

/**
 * Scope mute — channel nào user bị câm. `ALL_CHAT` là superset (gộp 3
 * scope còn lại). Khi check enforcement, service phải coi `ALL_CHAT`
 * mute là active cho mọi target scope.
 */
export const CHAT_MUTE_SCOPES = [
  'PRIVATE_CHAT',
  'GROUP_CHAT',
  'WORLD_SECT_CHAT',
  'ALL_CHAT',
] as const;
export type ChatMuteScope = (typeof CHAT_MUTE_SCOPES)[number];

// ----------------------------------------------------------------------------
// Caps & limits.
// ----------------------------------------------------------------------------

export const CHAT_MODERATION_LIMITS = {
  /** Max độ dài `ChatMessageReport.detailsText` (sau sanitize). */
  REPORT_DETAILS_MAX: 500,
  /** Max độ dài `ChatMute.reason` + `hideReason` + `lockReason`. */
  ADMIN_REASON_MAX: 200,
  /** Max độ dài `ChatMessageReport.resolutionNote` (sau sanitize). */
  RESOLUTION_NOTE_MAX: 500,
  /**
   * Default mute durations (ms) admin chọn từ FE. Indefinite mute yêu
   * cầu admin explicit set `expiresAt = null` (không có trong preset).
   */
  MUTE_DURATION_PRESETS_MS: {
    ONE_HOUR: 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
  },
  /** Page size mặc định cho admin list reports. */
  ADMIN_LIST_PAGE_SIZE: 50,
  /** Max items per page admin list reports. */
  ADMIN_LIST_PAGE_MAX: 200,
} as const;

// ----------------------------------------------------------------------------
// Row DTOs (FE consume).
// ----------------------------------------------------------------------------

export interface ChatMessageReportRow {
  id: string;
  reporterUserId: string;
  targetUserId: string | null;
  messageType: ChatMessageReportType;
  privateMessageId: string | null;
  groupMessageId: string | null;
  groupId: string | null;
  reason: ChatMessageReportReason;
  detailsText: string | null;
  status: ChatMessageReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

export interface ChatMuteRow {
  id: string;
  userId: string;
  mutedByAdminId: string;
  reason: string;
  scope: ChatMuteScope;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedByAdminId: string | null;
  createdAt: string;
  /**
   * Tính server-side: `revokedAt == null && (expiresAt == null ||
   * expiresAt > now)`. FE đọc field này thay vì tự tính để giữ
   * authoritative source.
   */
  isActive: boolean;
}

/**
 * Trả về cho admin list reports — kèm preview content của message bị
 * report (nếu admin được phép xem). Server quyết định preview có nội
 * dung hay chỉ hash/snippet tuỳ policy `expandPolicy` (Phase 19.2
 * default: full body cho admin, redacted cho mod).
 */
export interface AdminChatReportListItem extends ChatMessageReportRow {
  messagePreview: string | null;
  messageHiddenAt: string | null;
  reporterDisplayName: string | null;
  targetDisplayName: string | null;
}

export interface AdminChatModerationSummary {
  openReports: number;
  acknowledgedReports: number;
  resolvedToday: number;
  mutedUsers: number;
  hiddenMessages: number;
  lockedGroups: number;
}

export interface AdminChatReportListResponse {
  items: AdminChatReportListItem[];
  total: number;
}

export interface AdminChatMuteListResponse {
  items: ChatMuteRow[];
  total: number;
}

// ----------------------------------------------------------------------------
// Validators (pure, no IO).
// ----------------------------------------------------------------------------

export interface ChatModerationValidationOk<T> {
  ok: true;
  value: T;
}

export interface ChatModerationValidationError {
  ok: false;
  code: 'INVALID_INPUT';
  reason: string;
}

export type ChatModerationValidationResult<T> =
  | ChatModerationValidationOk<T>
  | ChatModerationValidationError;

/**
 * Sanitize free-text input (report details / admin reason / resolution
 * note). Steps:
 *   1. Trim hai đầu.
 *   2. Strip control characters (U+0000..U+001F + U+007F..U+009F) —
 *      giữ newline `\n` và tab `\t` cho UX nhập đoạn ngắn.
 *   3. Truncate `max` ký tự (sau strip).
 *
 * Trả về null nếu empty sau sanitize → caller dùng null cho
 * optional field.
 */
export function sanitizeChatModerationText(
  raw: string | null | undefined,
  max: number,
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Strip control chars EXCEPT \n (LF) và \t (HT) — giữ formatting cơ bản.
  // eslint-disable-next-line no-control-regex
  const stripped = trimmed.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
  if (stripped.length === 0) return null;
  const capped = stripped.length > max ? stripped.slice(0, max) : stripped;
  return capped;
}

export function isChatMessageReportReason(
  v: unknown,
): v is ChatMessageReportReason {
  return (
    typeof v === 'string' &&
    (CHAT_MESSAGE_REPORT_REASONS as readonly string[]).includes(v)
  );
}

export function isChatMessageReportType(
  v: unknown,
): v is ChatMessageReportType {
  return (
    typeof v === 'string' &&
    (CHAT_MESSAGE_REPORT_TYPES as readonly string[]).includes(v)
  );
}

export function isChatMessageReportStatus(
  v: unknown,
): v is ChatMessageReportStatus {
  return (
    typeof v === 'string' &&
    (CHAT_MESSAGE_REPORT_STATUSES as readonly string[]).includes(v)
  );
}

export function isChatMuteScope(v: unknown): v is ChatMuteScope {
  return (
    typeof v === 'string' &&
    (CHAT_MUTE_SCOPES as readonly string[]).includes(v)
  );
}

/**
 * Validate report submission payload từ FE. Caller phải gọi trước khi
 * persist. Reject nếu reason invalid hoặc details có raw control char
 * sau sanitize KHÁC text user nhập (FE đã hint user). Service-level
 * thêm rule message exists + member-only — không kiểm ở đây.
 */
export function validateChatReportSubmission(input: {
  messageType: unknown;
  reason: unknown;
  detailsText?: unknown;
}): ChatModerationValidationResult<{
  messageType: ChatMessageReportType;
  reason: ChatMessageReportReason;
  detailsText: string | null;
}> {
  if (!isChatMessageReportType(input.messageType)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'messageType must be PRIVATE or GROUP',
    };
  }
  if (!isChatMessageReportReason(input.reason)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'reason must be one of SPAM, HARASSMENT, SCAM, OFFENSIVE, OTHER',
    };
  }
  const details = sanitizeChatModerationText(
    typeof input.detailsText === 'string' ? input.detailsText : null,
    CHAT_MODERATION_LIMITS.REPORT_DETAILS_MAX,
  );
  return {
    ok: true,
    value: {
      messageType: input.messageType,
      reason: input.reason,
      detailsText: details,
    },
  };
}

/**
 * Validate admin mute payload. Caller phải gọi trước khi persist.
 * Reject:
 *   - scope không thuộc enum.
 *   - reason empty sau sanitize.
 *   - expiresAt trong quá khứ (nếu set).
 */
export function validateChatMutePayload(
  input: {
    scope: unknown;
    reason: unknown;
    expiresAt?: unknown;
  },
  now: Date,
): ChatModerationValidationResult<{
  scope: ChatMuteScope;
  reason: string;
  expiresAt: Date | null;
}> {
  if (!isChatMuteScope(input.scope)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'scope must be PRIVATE_CHAT, GROUP_CHAT, WORLD_SECT_CHAT, or ALL_CHAT',
    };
  }
  const reason = sanitizeChatModerationText(
    typeof input.reason === 'string' ? input.reason : null,
    CHAT_MODERATION_LIMITS.ADMIN_REASON_MAX,
  );
  if (!reason) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      reason: 'reason must be non-empty after sanitize',
    };
  }
  let expiresAt: Date | null = null;
  if (input.expiresAt !== null && input.expiresAt !== undefined) {
    if (typeof input.expiresAt !== 'string' && !(input.expiresAt instanceof Date)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        reason: 'expiresAt must be ISO date string, Date, or null',
      };
    }
    const d =
      input.expiresAt instanceof Date
        ? input.expiresAt
        : new Date(input.expiresAt as string);
    if (Number.isNaN(d.getTime())) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        reason: 'expiresAt is not a valid date',
      };
    }
    if (d.getTime() <= now.getTime()) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        reason: 'expiresAt must be in the future',
      };
    }
    expiresAt = d;
  }
  return {
    ok: true,
    value: { scope: input.scope, reason, expiresAt },
  };
}

/**
 * Mute active = chưa revoke VÀ (chưa expire HOẶC expiresAt null).
 * Pure helper dùng cho cả service enforcement (Postgres NOW()) lẫn FE
 * status badge.
 */
export function isChatMuteActive(
  mute: { expiresAt: Date | null | string; revokedAt: Date | null | string },
  now: Date,
): boolean {
  if (mute.revokedAt) return false;
  if (!mute.expiresAt) return true;
  const exp =
    typeof mute.expiresAt === 'string'
      ? new Date(mute.expiresAt)
      : mute.expiresAt;
  return exp.getTime() > now.getTime();
}

/**
 * Mute scope `ALL_CHAT` cover mọi target scope. Bảng quyết định:
 *   target  | active scope = target | active ALL_CHAT
 *   PRIVATE | true                  | true
 *   GROUP   | true                  | true
 *   WS      | true                  | true
 *   ALL     | true                  | true
 */
export function muteScopeApplies(
  active: ChatMuteScope,
  target: ChatMuteScope,
): boolean {
  if (active === 'ALL_CHAT') return true;
  // active != ALL_CHAT here — non-ALL active không cover ALL target.
  if (target === 'ALL_CHAT') return false;
  return active === target;
}

/**
 * Placeholder text hiển thị cho user khi message bị soft-hide. Server
 * render khi `hiddenAt != null`. FE component có thể i18n key thay vì
 * dùng literal này — nhưng API client default trả về literal cho
 * backward compat (read-once flow).
 */
export const CHAT_HIDDEN_MESSAGE_PLACEHOLDER = '[hidden by moderator]';
