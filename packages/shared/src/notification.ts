/**
 * Phase 19.3 — Social Presence & Notification Center shared catalog.
 *
 * Định nghĩa enum + DTO + helper validator + i18n key builders dùng
 * chung FE/BE. Deterministic, server-authoritative, không có runtime
 * dependency ngoài builtin.
 *
 * Server enforce:
 *   - Mỗi user chỉ list / markRead notification của chính mình.
 *   - `titleKey` / `bodyKey` là i18n key deterministic — KHÔNG nhận
 *     free-text user-controlled (chống injection).
 *   - `dataJson` cap depth + length ở service layer; FE không lưu
 *     raw HTML.
 *
 * Out of scope Phase 19.3 (đẩy follow-up): mobile push, email,
 * cross-shard Redis presence, activity feed, notification preferences,
 * subscription-level filter.
 */

export const NOTIFICATION_TYPES = [
  'FRIEND_REQUEST_RECEIVED',
  'FRIEND_REQUEST_ACCEPTED',
  'PRIVATE_MESSAGE_RECEIVED',
  'GROUP_MESSAGE_RECEIVED',
  'GROUP_INVITE_RECEIVED',
  'GROUP_MEMBER_ADDED',
  'CHAT_REPORT_RESOLVED',
  'SECURITY_ALERT_USER',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(v);
}

/**
 * Loại entity gắn vào notification — FE map sang route khi user click.
 * KHÔNG hard-code route ở BE — BE chỉ trả entityType + entityId,
 * FE quyết định điều hướng (vd `FRIEND_REQUEST` → `/social?tab=requests`).
 */
export const NOTIFICATION_ENTITY_TYPES = [
  'FRIEND_REQUEST',
  'PRIVATE_THREAD',
  'GROUP_CHAT',
  'CHAT_REPORT',
  'SECURITY_ALERT',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export function isNotificationEntityType(
  v: unknown,
): v is NotificationEntityType {
  return (
    typeof v === 'string' &&
    (NOTIFICATION_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Caps / limits enforce ở service layer + FE preview.
 */
export const NOTIFICATION_LIMITS = {
  /** Cap số entry trả về 1 lần `listNotifications`. */
  LIST_PAGE_MAX: 50,
  /** Default page size cho list. */
  LIST_PAGE_DEFAULT: 20,
  /** Cap text length sanitize cho mọi text field trong `dataJson`. */
  DATA_TEXT_MAX: 200,
  /**
   * Bell badge cap (FE hiển thị "99+" nếu vượt). Server vẫn trả số
   * thật trong `count`, FE clamp display.
   */
  BELL_BADGE_DISPLAY_CAP: 99,
} as const;

/**
 * Presence status truyền lên FE. KHÔNG có 'AWAY' trong Phase 19.3
 * (theo prompt: chỉ online/offline cơ bản + lastSeenAt). Có thể mở
 * rộng `IDLE` sau qua heartbeat tracking.
 */
export const PRESENCE_STATUSES = ['ONLINE', 'OFFLINE'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export function isPresenceStatus(v: unknown): v is PresenceStatus {
  return (
    typeof v === 'string' &&
    (PRESENCE_STATUSES as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * Server response cho 1 notification row. `dataJson` đã sanitize +
 * unknown shape; FE đọc theo `type` để biết schema cụ thể.
 */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  titleKey: string;
  bodyKey: string;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  /**
   * Server-sanitized params for i18n render. FE phải treat as unknown
   * và validate trước khi pass vào v-html / dynamic rendering. Default
   * pattern: object `{ key: scalar }` (string | number | boolean).
   */
  dataJson: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface NotificationListResponse {
  notifications: NotificationRow[];
  total: number;
  unreadCount: number;
}

export interface NotificationUnreadCountResponse {
  unreadCount: number;
}

export interface NotificationMarkReadResponse {
  notification: NotificationRow;
  unreadCount: number;
}

export interface NotificationMarkAllReadResponse {
  updated: number;
  unreadCount: number;
}

/**
 * Presence query response: 1 entry per requested userId, kể cả khi
 * user không tồn tại (server trả `online=false`, `lastSeenAt=null`).
 *
 * Privacy:
 *   - KHÔNG trả IP, sessionId, socket id, user-agent.
 *   - `lastSeenAt` rounded server-side (vd cắt second/minute) trong
 *     `formatLastSeenForDisplay` — Phase 19.3 chưa fuzz, gốc raw cũng
 *     không tiết lộ thông tin nhạy.
 *   - User đã block viewer → server trả status `OFFLINE` +
 *     `lastSeenAt=null` (không leak presence cho người đã block).
 */
export interface PresenceRow {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

export interface PresenceQueryResponse {
  presences: PresenceRow[];
}

// ---------------------------------------------------------------------------
// WS broadcast payloads
// ---------------------------------------------------------------------------

/**
 * Phase 19.3 — `notification:new` payload. Server emit qua
 * `RealtimeService.emitToUser(userId, 'notification:new', ...)` ngay
 * sau khi insert notification thành công, nếu user đang online. Khi
 * user offline, KHÔNG emit (REST poll fallback đảm bảo state cuối).
 */
export interface NotificationCreatedBroadcastPayload {
  notification: NotificationRow;
  unreadCount: number;
}

/**
 * Phase 19.3 — `notification:unread-count` payload. Server emit khi
 * mark read / mark all read để FE đồng bộ badge. Có thể đẩy thêm khi
 * có notification mới (đã include trong `:new`).
 */
export interface NotificationUnreadCountBroadcastPayload {
  unreadCount: number;
}

/**
 * Phase 19.3 — `presence:update` payload. Server emit khi user
 * connect / disconnect socket. Receiver scope:
 *   - Phase 19.3 đơn giản: emit tới mọi friend của user changed,
 *     không broadcast public.
 *   - Future: emit tới group members khi user GROUP CHAT chuyển trạng
 *     thái (out-of-scope Phase 19.3).
 *
 * Server KHÔNG emit khi target đã block viewer → privacy preserved.
 */
export interface PresenceUpdateBroadcastPayload {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers — i18n key + sanitize
// ---------------------------------------------------------------------------

/**
 * Build i18n title key cho 1 notification type. Pattern dùng chung
 * cho cả FE/BE để giảm drift:
 *   `notification.<type>.title` (e.g. `notification.FRIEND_REQUEST_RECEIVED.title`).
 *
 * FE register key tương ứng trong `i18n/vi.json` + `en.json`.
 */
export function notificationTitleKey(type: NotificationType): string {
  return `notification.${type}.title`;
}

export function notificationBodyKey(type: NotificationType): string {
  return `notification.${type}.body`;
}

/**
 * Sanitize 1 text value cho `dataJson`. Trim, strip control chars
 * (cùng pattern `sanitizeChatModerationText`), cap length.
 *
 * Trả về null nếu input null/empty sau sanitize.
 */
export function sanitizeNotificationText(
  raw: string | null | undefined,
  maxLen = NOTIFICATION_LIMITS.DATA_TEXT_MAX,
): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!stripped) return null;
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen);
}

/**
 * Sanitize `dataJson` object trước khi persist. Pattern:
 *   - Loại bỏ key không phải scalar (string | number | boolean | null).
 *   - Trim + cap string values.
 *   - Cap max 12 key (FE render limit + sanity).
 *   - Strip key reserved (`password`, `token`, `secret`, `ip`,
 *     `cookie`) để chống leak ngay cả khi caller bug.
 */
const RESERVED_DATA_KEYS = new Set<string>([
  'password',
  'token',
  'secret',
  'ip',
  'cookie',
  'session',
  'authorization',
]);

export function sanitizeNotificationData(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(raw)) {
    if (count >= 12) break;
    if (typeof rawKey !== 'string') continue;
    const key = rawKey.trim();
    if (!key || key.length > 64) continue;
    if (RESERVED_DATA_KEYS.has(key.toLowerCase())) continue;
    if (rawVal === null) {
      out[key] = null;
      count += 1;
      continue;
    }
    if (typeof rawVal === 'string') {
      const v = sanitizeNotificationText(rawVal);
      if (v === null) continue;
      out[key] = v;
      count += 1;
      continue;
    }
    if (typeof rawVal === 'number') {
      if (!Number.isFinite(rawVal)) continue;
      out[key] = rawVal;
      count += 1;
      continue;
    }
    if (typeof rawVal === 'boolean') {
      out[key] = rawVal;
      count += 1;
      continue;
    }
    // Skip nested object/array — service phải flatten trước khi gọi.
  }
  return out;
}

/**
 * Format unread count cho bell badge. Trả về:
 *   - `''` (rỗng) nếu count <= 0.
 *   - `'<n>'` nếu count <= 99.
 *   - `'99+'` nếu count > 99.
 */
export function formatBellBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count > NOTIFICATION_LIMITS.BELL_BADGE_DISPLAY_CAP) {
    return `${NOTIFICATION_LIMITS.BELL_BADGE_DISPLAY_CAP}+`;
  }
  return String(Math.floor(count));
}
