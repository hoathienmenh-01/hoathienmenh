/**
 * LiveOps Announcement + Broadcast — Phase 15.3.B.
 *
 * Mục tiêu:
 *   - Cho admin tạo announcement (banner / marquee) hiển thị cho người chơi.
 *   - Hỗ trợ severity (INFO / EVENT / WARNING / MAINTENANCE), status
 *     (DRAFT / SCHEDULED / ACTIVE / ENDED / DISABLED) — cùng pattern với
 *     `LiveOpsScheduledEvent` (Phase 15.1–15.2) để recompute idempotent
 *     mỗi 5 phút.
 *   - Khai báo broadcast event type + public-safe payload cho cả
 *     announcement và LiveOpsScheduledEvent (Phase 15.1–15.2).
 *
 * Design:
 *   - Validator pure-fn — dùng được FE + BE. Server-authoritative cap
 *     thông qua `validateLiveOpsAnnouncementInput` (cap title/message,
 *     window, severity, target). Reject HTML/script ký tự nguy hiểm —
 *     payload là plain text, FE render `{{ ... }}` interpolation chứ
 *     không `v-html`.
 *   - Recompute pure-fn `nextLiveOpsAnnouncementStatus` mirror
 *     `nextLiveOpsScheduledEventStatus` để cron 5-phút auto-transition
 *     SCHEDULED→ACTIVE / ACTIVE→ENDED.
 *   - Broadcast public-safe: `LiveOpsBroadcastFrame` chỉ chứa các field
 *     non-sensitive (key, severity, title, message, startsAt, endsAt,
 *     target). KHÔNG bao gồm `createdByAdminId` / `disabledAt` / raw
 *     configJson.
 *
 * Anti-spam design:
 *   - Server chỉ broadcast khi status thực sự transition (SCHEDULED→ACTIVE
 *     hoặc ACTIVE→ENDED). Recompute idempotent — gọi nhiều lần cùng
 *     `now` không gửi duplicate.
 *   - Client-side dismiss state cục bộ (FE) — KHÔNG persist server-side
 *     để giữ stateless. Marquee tự ẩn khi `endsAt` đã qua.
 */

// ---------------------------------------------------------------------------
// Severity / status / target enums
// ---------------------------------------------------------------------------

/**
 * Severity của announcement.
 *   - `INFO`        — thông báo chung (tin tức, cập nhật).
 *   - `EVENT`       — quảng bá event LiveOps (FESTIVAL_GIFT, double drop, …).
 *   - `WARNING`     — cảnh báo (rate-limit, lag, fix gấp).
 *   - `MAINTENANCE` — bảo trì (downtime planned).
 *
 * FE map severity → màu badge / icon:
 *   - INFO        → xanh dương.
 *   - EVENT       → vàng / amber.
 *   - WARNING     → cam / amber-bright.
 *   - MAINTENANCE → đỏ / rose.
 */
export type LiveOpsAnnouncementSeverity =
  | 'INFO'
  | 'EVENT'
  | 'WARNING'
  | 'MAINTENANCE';

export const LIVEOPS_ANNOUNCEMENT_SEVERITIES: readonly LiveOpsAnnouncementSeverity[] = [
  'INFO',
  'EVENT',
  'WARNING',
  'MAINTENANCE',
] as const;

/**
 * Status lifecycle (mirror `LiveOpsScheduledEventStatus`):
 *   `DRAFT` (admin tạo, chưa schedule)
 *     → `SCHEDULED` (admin enable, đợi tới `startsAt`)
 *     → `ACTIVE` (cron transition khi `now ≥ startsAt < endsAt`)
 *     → `ENDED` (cron transition khi `now ≥ endsAt`).
 *   `DISABLED` = admin disable bất kỳ lúc nào (kill switch).
 *
 * Cron 5-phút recompute idempotent:
 *   - SCHEDULED → ACTIVE khi tới `startsAt`.
 *   - ACTIVE    → ENDED khi qua `endsAt`.
 *   - DRAFT/DISABLED không bao giờ tự transition.
 *   - ENDED terminal (không re-activate dù admin sửa window).
 */
export type LiveOpsAnnouncementStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'DISABLED';

export const LIVEOPS_ANNOUNCEMENT_STATUSES: readonly LiveOpsAnnouncementStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'DISABLED',
] as const;

/**
 * Target audience của announcement.
 *   - `ALL`           — public marquee, hiển thị cho mọi viewer
 *     (anonymous + authenticated).
 *   - `AUTHENTICATED` — chỉ user đã đăng nhập (vd thông báo trong-game).
 *   - `ADMIN_ONLY`    — chỉ admin/MOD (vd debug ops note). KHÔNG broadcast
 *     ra public WS room — emit riêng cho admin sockets.
 *
 * Public endpoint `GET /liveops/announcements/active` filter theo
 * caller's auth state; ADMIN_ONLY KHÔNG bao giờ trả cho viewer thường.
 */
export type LiveOpsAnnouncementTarget =
  | 'ALL'
  | 'AUTHENTICATED'
  | 'ADMIN_ONLY';

export const LIVEOPS_ANNOUNCEMENT_TARGETS: readonly LiveOpsAnnouncementTarget[] = [
  'ALL',
  'AUTHENTICATED',
  'ADMIN_ONLY',
] as const;

// ---------------------------------------------------------------------------
// Validator caps
// ---------------------------------------------------------------------------

/** Pattern alphanumeric + dash/underscore, 3–80 chars, alphanumeric đầu/cuối. */
export const LIVEOPS_ANNOUNCEMENT_KEY_PATTERN =
  /^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/;
export const LIVEOPS_ANNOUNCEMENT_TITLE_MAX = 120;
export const LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX = 500;
/** Window tối thiểu 60s — match cron 5-phút (không miss event quá ngắn). */
export const LIVEOPS_ANNOUNCEMENT_MIN_WINDOW_MS = 60_000;
/** Window tối đa 90 ngày — tránh announcement vĩnh viễn. */
export const LIVEOPS_ANNOUNCEMENT_MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export type LiveOpsAnnouncementValidationCode =
  | 'ANNOUNCEMENT_KEY_INVALID'
  | 'ANNOUNCEMENT_SEVERITY_INVALID'
  | 'ANNOUNCEMENT_TARGET_INVALID'
  | 'ANNOUNCEMENT_TITLE_REQUIRED'
  | 'ANNOUNCEMENT_TITLE_TOO_LONG'
  | 'ANNOUNCEMENT_TITLE_UNSAFE'
  | 'ANNOUNCEMENT_MESSAGE_REQUIRED'
  | 'ANNOUNCEMENT_MESSAGE_TOO_LONG'
  | 'ANNOUNCEMENT_MESSAGE_UNSAFE'
  | 'ANNOUNCEMENT_WINDOW_INVALID'
  | 'ANNOUNCEMENT_WINDOW_TOO_SHORT'
  | 'ANNOUNCEMENT_WINDOW_TOO_LONG'
  | 'ANNOUNCEMENT_LOCALE_PARITY';

export interface LiveOpsAnnouncementInput {
  readonly key: string;
  readonly severity: LiveOpsAnnouncementSeverity;
  readonly target: LiveOpsAnnouncementTarget;
  readonly titleVi: string;
  readonly titleEn?: string | null;
  readonly messageVi: string;
  readonly messageEn?: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Reject HTML/script ký tự nguy hiểm. Announcement payload là plain text;
 * FE render bằng `{{ ... }}` interpolation (Vue auto-escape) chứ không
 * `v-html`. Tuy nhiên vẫn guard ở validator để chặn admin lỡ paste HTML
 * markup (vd `<a href=…>`) — UX rõ ràng hơn báo lỗi sớm hơn render xong
 * mới thấy không link được.
 *
 * Heuristic: reject nếu chứa `<` hoặc `>` hoặc `javascript:` hoặc `&#`
 * (HTML entity). Giữ lại các ký tự thường dùng trong i18n (em-dash,
 * em-quote, dấu chấm hỏi, `&` tự thân).
 */
export function isLiveOpsAnnouncementTextSafe(text: string): boolean {
  if (text.includes('<') || text.includes('>')) return false;
  // Match `javascript:` regardless of case + leading whitespace.
  if (/javascript\s*:/i.test(text)) return false;
  // Match HTML entity numeric reference like `&#x3c;` / `&#60;`.
  if (/&#/.test(text)) return false;
  // Match script-ish patterns `data:text/html`, `vbscript:` ...
  if (/\b(?:vbscript|data\s*:\s*text\/html)/i.test(text)) return false;
  return true;
}

function isValidLiveOpsAnnouncementSeverity(
  s: string,
): s is LiveOpsAnnouncementSeverity {
  return (LIVEOPS_ANNOUNCEMENT_SEVERITIES as readonly string[]).includes(s);
}

function isValidLiveOpsAnnouncementTarget(
  s: string,
): s is LiveOpsAnnouncementTarget {
  return (LIVEOPS_ANNOUNCEMENT_TARGETS as readonly string[]).includes(s);
}

export function isValidLiveOpsAnnouncementStatus(
  s: string,
): s is LiveOpsAnnouncementStatus {
  return (LIVEOPS_ANNOUNCEMENT_STATUSES as readonly string[]).includes(s);
}

/**
 * Validate input *trước* khi ghi DB. Trả về `null` nếu pass, hoặc 1
 * error code trong `LiveOpsAnnouncementValidationCode`.
 *
 * Locale parity: nếu admin gửi `titleEn` thì cũng phải có `messageEn`
 * (avoid half-translated entry); reverse holds tương tự. Cho phép
 * cả 2 bỏ trống → fallback `titleVi`/`messageVi` ở FE.
 */
export function validateLiveOpsAnnouncementInput(
  input: LiveOpsAnnouncementInput,
): LiveOpsAnnouncementValidationCode | null {
  if (!LIVEOPS_ANNOUNCEMENT_KEY_PATTERN.test(input.key)) {
    return 'ANNOUNCEMENT_KEY_INVALID';
  }
  if (!isValidLiveOpsAnnouncementSeverity(input.severity)) {
    return 'ANNOUNCEMENT_SEVERITY_INVALID';
  }
  if (!isValidLiveOpsAnnouncementTarget(input.target)) {
    return 'ANNOUNCEMENT_TARGET_INVALID';
  }

  const titleVi = input.titleVi?.trim() ?? '';
  if (titleVi.length === 0) return 'ANNOUNCEMENT_TITLE_REQUIRED';
  if (titleVi.length > LIVEOPS_ANNOUNCEMENT_TITLE_MAX) {
    return 'ANNOUNCEMENT_TITLE_TOO_LONG';
  }
  if (!isLiveOpsAnnouncementTextSafe(titleVi)) {
    return 'ANNOUNCEMENT_TITLE_UNSAFE';
  }

  const messageVi = input.messageVi?.trim() ?? '';
  if (messageVi.length === 0) return 'ANNOUNCEMENT_MESSAGE_REQUIRED';
  if (messageVi.length > LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX) {
    return 'ANNOUNCEMENT_MESSAGE_TOO_LONG';
  }
  if (!isLiveOpsAnnouncementTextSafe(messageVi)) {
    return 'ANNOUNCEMENT_MESSAGE_UNSAFE';
  }

  const titleEn =
    input.titleEn !== undefined && input.titleEn !== null
      ? input.titleEn.trim()
      : '';
  const messageEn =
    input.messageEn !== undefined && input.messageEn !== null
      ? input.messageEn.trim()
      : '';
  if (titleEn.length > 0) {
    if (titleEn.length > LIVEOPS_ANNOUNCEMENT_TITLE_MAX) {
      return 'ANNOUNCEMENT_TITLE_TOO_LONG';
    }
    if (!isLiveOpsAnnouncementTextSafe(titleEn)) {
      return 'ANNOUNCEMENT_TITLE_UNSAFE';
    }
  }
  if (messageEn.length > 0) {
    if (messageEn.length > LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX) {
      return 'ANNOUNCEMENT_MESSAGE_TOO_LONG';
    }
    if (!isLiveOpsAnnouncementTextSafe(messageEn)) {
      return 'ANNOUNCEMENT_MESSAGE_UNSAFE';
    }
  }
  // Locale parity: title-en có thì message-en bắt buộc và ngược lại.
  if ((titleEn.length > 0) !== (messageEn.length > 0)) {
    return 'ANNOUNCEMENT_LOCALE_PARITY';
  }

  const startMs = input.startsAt.getTime();
  const endMs = input.endsAt.getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs
  ) {
    return 'ANNOUNCEMENT_WINDOW_INVALID';
  }
  const windowMs = endMs - startMs;
  if (windowMs < LIVEOPS_ANNOUNCEMENT_MIN_WINDOW_MS) {
    return 'ANNOUNCEMENT_WINDOW_TOO_SHORT';
  }
  if (windowMs > LIVEOPS_ANNOUNCEMENT_MAX_WINDOW_MS) {
    return 'ANNOUNCEMENT_WINDOW_TOO_LONG';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Status transition (idempotent recompute)
// ---------------------------------------------------------------------------

/**
 * `now` trong window `[startsAt, endsAt)` (start inclusive, end exclusive).
 * Pure function — test friendly.
 */
export function isLiveOpsAnnouncementActiveAt(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): boolean {
  const t = now.getTime();
  return t >= startsAt.getTime() && t < endsAt.getTime();
}

/**
 * Compute next status từ current + window:
 *   - DRAFT     → DRAFT     (không tự transition; admin phải POST schedule).
 *   - DISABLED  → DISABLED  (kill switch — không recover tự động).
 *   - SCHEDULED → ACTIVE    nếu `now ≥ startsAt < endsAt`.
 *   - SCHEDULED → ENDED     nếu `now ≥ endsAt` (lỡ schedule quá khứ).
 *   - ACTIVE    → ENDED     nếu `now ≥ endsAt`.
 *   - ENDED     → ENDED     (terminal).
 *
 * Idempotent: gọi nhiều lần với cùng input trả cùng output.
 */
export function nextLiveOpsAnnouncementStatus(
  current: LiveOpsAnnouncementStatus,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): LiveOpsAnnouncementStatus {
  if (current === 'DRAFT' || current === 'DISABLED' || current === 'ENDED') {
    return current;
  }
  const t = now.getTime();
  if (t >= endsAt.getTime()) return 'ENDED';
  if (current === 'SCHEDULED' && t >= startsAt.getTime()) return 'ACTIVE';
  return current;
}

// ---------------------------------------------------------------------------
// Broadcast — public-safe payload
// ---------------------------------------------------------------------------

/**
 * Broadcast event types cho LiveOps WS layer (Phase 15.3.B).
 *
 *   - `ANNOUNCEMENT_ACTIVE`   — announcement chuyển SCHEDULED→ACTIVE.
 *   - `ANNOUNCEMENT_ENDED`    — announcement chuyển ACTIVE→ENDED.
 *   - `LIVEOPS_EVENT_ACTIVE`  — `LiveOpsScheduledEvent` chuyển SCHEDULED→ACTIVE.
 *   - `LIVEOPS_EVENT_ENDED`   — `LiveOpsScheduledEvent` chuyển ACTIVE→ENDED.
 *   - `LIVEOPS_EVENT_UPDATED` — admin update event (vd disable / window
 *     thay đổi). Optional — chỉ emit nếu có UI consume.
 *
 * Frontend listen 5 type này qua channel `liveops:announcement` /
 * `liveops:event` để show toast + refresh panel.
 */
export type LiveOpsBroadcastEventType =
  | 'ANNOUNCEMENT_ACTIVE'
  | 'ANNOUNCEMENT_ENDED'
  | 'LIVEOPS_EVENT_ACTIVE'
  | 'LIVEOPS_EVENT_ENDED'
  | 'LIVEOPS_EVENT_UPDATED';

export const LIVEOPS_BROADCAST_EVENT_TYPES: readonly LiveOpsBroadcastEventType[] = [
  'ANNOUNCEMENT_ACTIVE',
  'ANNOUNCEMENT_ENDED',
  'LIVEOPS_EVENT_ACTIVE',
  'LIVEOPS_EVENT_ENDED',
  'LIVEOPS_EVENT_UPDATED',
] as const;

/**
 * Public-safe view of an announcement broadcasted qua WS. Field
 * `createdByAdminId`/`disabledAt` đều bị strip ở layer tạo payload —
 * không bao giờ lộ admin metadata cho client.
 */
export interface LiveOpsAnnouncementBroadcastPayload {
  readonly type: 'ANNOUNCEMENT_ACTIVE' | 'ANNOUNCEMENT_ENDED';
  readonly key: string;
  readonly severity: LiveOpsAnnouncementSeverity;
  readonly target: LiveOpsAnnouncementTarget;
  readonly title: string;
  readonly message: string;
  readonly titleVi: string;
  readonly titleEn: string | null;
  readonly messageVi: string;
  readonly messageEn: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Public-safe view of a LiveOpsScheduledEvent transition broadcast. Strip
 * raw `configJson` (có thể chứa private data trong tương lai) — chỉ expose:
 *   - `eventKey`, `type`, `title`, `description`, `endsAt`.
 *   - `runtimeSupported` flag (FE biết whether wired).
 *
 * KHÔNG include:
 *   - `createdByAdminId` (admin metadata).
 *   - `configJson` raw (internal multiplier / rewardJson — trả qua endpoint
 *      `GET /liveops/events/active` đã filter public-safe).
 */
export interface LiveOpsEventBroadcastPayload {
  readonly type:
    | 'LIVEOPS_EVENT_ACTIVE'
    | 'LIVEOPS_EVENT_ENDED'
    | 'LIVEOPS_EVENT_UPDATED';
  readonly eventKey: string;
  readonly eventType: string;
  readonly title: string;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly runtimeSupported: boolean;
}

export type LiveOpsBroadcastPayload =
  | LiveOpsAnnouncementBroadcastPayload
  | LiveOpsEventBroadcastPayload;

// ---------------------------------------------------------------------------
// Channel constants
// ---------------------------------------------------------------------------

/** WS channel cho announcement broadcast (FE listen). */
export const LIVEOPS_WS_CHANNEL_ANNOUNCEMENT = 'liveops:announcement';
/** WS channel cho LiveOpsScheduledEvent broadcast (FE listen). */
export const LIVEOPS_WS_CHANNEL_EVENT = 'liveops:event';

/**
 * Helper: pick "best" locale text — prefer `vi` field, fallback to `en`.
 * Use case: payload.title hiển thị ngay khi FE chưa load i18n; FE có thể
 * re-resolve qua `titleVi`/`titleEn` tuỳ active locale.
 */
export function pickLiveOpsAnnouncementText(
  vi: string,
  en: string | null | undefined,
  preferLocale: 'vi' | 'en',
): string {
  if (preferLocale === 'en' && en && en.trim().length > 0) return en;
  return vi;
}
