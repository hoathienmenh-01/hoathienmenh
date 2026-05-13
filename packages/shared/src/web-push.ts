/**
 * Phase PWA-1 — PWA Web Push Notifications shared catalog.
 *
 * Pure-function: KHÔNG có Nest / Prisma / `web-push` runtime import ở
 * file này; FE và BE đều dùng được, vitest đơn vị test trực tiếp.
 *
 * Out-of-scope (sẽ wire ở follow-up PR nhỏ, KHÔNG đụng Story Runtime):
 *   - Boss spawn event hook (BossSpawnService).
 *   - Stamina-full BullMQ tick worker hook.
 *   - DailyPushReminderService scheduler.
 *   - Rich push (icon / image / actions).
 *
 * Server enforce:
 *   - Mọi endpoint phải có `https://` scheme; chống open-redirect /
 *     SSRF nếu attacker submit endpoint không phải push gateway.
 *   - `p256dh` / `auth` decode được base64url + length cap.
 *   - Per-type cooldown + quiet hours + per-type prefs gate.
 *   - `PUSH_ENABLED=false` ⇒ short-circuit ở service layer (không
 *     đụng catalog này).
 */

export const WEB_PUSH_NOTIFICATION_TYPES = [
  'BOSS_SPAWN',
  'STAMINA_FULL',
  'MAIL_NEW',
  'DAILY_REMINDER',
] as const;
export type WebPushNotificationType =
  (typeof WEB_PUSH_NOTIFICATION_TYPES)[number];

export function isWebPushNotificationType(
  v: unknown,
): v is WebPushNotificationType {
  return (
    typeof v === 'string' &&
    (WEB_PUSH_NOTIFICATION_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Caps / cooldowns. Static — đổi giá trị ⇒ phải cập nhật test
 * `web-push.test.ts` đi kèm.
 */
export const WEB_PUSH_LIMITS = {
  /** Hard cap endpoint length (Chrome FCM ~ 200, FF mozilla ~ 250, an toàn 2048). */
  ENDPOINT_MAX_CHARS: 2048,
  /** Base64url length cap cho p256dh (88 chars là chuẩn ECDH P-256). */
  P256DH_MAX_CHARS: 200,
  /** Base64url length cap cho auth (16 bytes ⇒ 24 chars; an toàn 100). */
  AUTH_MAX_CHARS: 100,
  /** UserAgent cap. */
  USER_AGENT_MAX_CHARS: 256,
  /** Tổng subscription enabled / user (chống abuse nhiều device giả). */
  PER_USER_SUBSCRIPTION_MAX: 10,
  /** Body cap để khỏi gửi payload dài quá Web Push spec 4096B. */
  PAYLOAD_BODY_MAX_CHARS: 240,
  /** Title cap. */
  PAYLOAD_TITLE_MAX_CHARS: 80,
  /** Failure count vượt → soft-delete subscription. */
  FAILURE_HARD_DELETE_THRESHOLD: 5,
} as const;

/**
 * Cooldown ms per type — service check `lastSentAt + cooldown > now`
 * trước khi enqueue push. Daily reminder = 23h để cron 24h chạy ổn
 * định (tránh drift biên ngày).
 */
export const WEB_PUSH_COOLDOWN_MS: Record<WebPushNotificationType, number> = {
  BOSS_SPAWN: 5 * 60_000,
  STAMINA_FULL: 10 * 60_000,
  MAIL_NEW: 30_000,
  DAILY_REMINDER: 23 * 60 * 60_000,
};

// ---------------------------------------------------------------------------
// Input validators (pure)
// ---------------------------------------------------------------------------

/**
 * Raw push subscription từ FE — đúng shape của `PushSubscription.toJSON()`.
 */
export interface RawPushSubscriptionInput {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  } | null;
  userAgent?: string | null;
}

export interface NormalizedPushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export type WebPushValidationCode =
  | 'PAYLOAD_INVALID'
  | 'ENDPOINT_INVALID'
  | 'ENDPOINT_TOO_LONG'
  | 'P256DH_INVALID'
  | 'AUTH_INVALID'
  | 'USER_AGENT_TOO_LONG';

export interface WebPushValidationResult {
  ok: boolean;
  code?: WebPushValidationCode;
  value?: NormalizedPushSubscriptionInput;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+=*$/;

function isPushEndpoint(v: string): boolean {
  if (!v) return false;
  // Cho phép cả http://localhost (test), prod yêu cầu https://
  return (
    v.startsWith('https://') ||
    v.startsWith('http://localhost') ||
    v.startsWith('http://127.0.0.1')
  );
}

function sanitizeUserAgent(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const stripped = String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!stripped) return null;
  if (stripped.length > WEB_PUSH_LIMITS.USER_AGENT_MAX_CHARS) {
    return stripped.slice(0, WEB_PUSH_LIMITS.USER_AGENT_MAX_CHARS);
  }
  return stripped;
}

export function validatePushSubscriptionInput(
  raw: unknown,
): WebPushValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'PAYLOAD_INVALID' };
  }
  const obj = raw as Partial<RawPushSubscriptionInput>;
  if (typeof obj.endpoint !== 'string' || !obj.endpoint.trim()) {
    return { ok: false, code: 'ENDPOINT_INVALID' };
  }
  const endpoint = obj.endpoint.trim();
  if (!isPushEndpoint(endpoint)) {
    return { ok: false, code: 'ENDPOINT_INVALID' };
  }
  if (endpoint.length > WEB_PUSH_LIMITS.ENDPOINT_MAX_CHARS) {
    return { ok: false, code: 'ENDPOINT_TOO_LONG' };
  }
  const keys = obj.keys ?? null;
  if (!keys || typeof keys !== 'object') {
    return { ok: false, code: 'P256DH_INVALID' };
  }
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  if (
    !p256dh ||
    p256dh.length > WEB_PUSH_LIMITS.P256DH_MAX_CHARS ||
    !BASE64URL_RE.test(p256dh)
  ) {
    return { ok: false, code: 'P256DH_INVALID' };
  }
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
  if (
    !auth ||
    auth.length > WEB_PUSH_LIMITS.AUTH_MAX_CHARS ||
    !BASE64URL_RE.test(auth)
  ) {
    return { ok: false, code: 'AUTH_INVALID' };
  }
  const ua = sanitizeUserAgent(obj.userAgent ?? null);
  if (
    obj.userAgent != null &&
    typeof obj.userAgent === 'string' &&
    obj.userAgent.length > WEB_PUSH_LIMITS.USER_AGENT_MAX_CHARS * 4
  ) {
    // Cực hạn — không sanitize được vì quá dài (chống abuse).
    return { ok: false, code: 'USER_AGENT_TOO_LONG' };
  }
  return {
    ok: true,
    value: { endpoint, p256dh, auth, userAgent: ua },
  };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface WebPushPreferencesView {
  bossSpawnEnabled: boolean;
  staminaFullEnabled: boolean;
  mailEnabled: boolean;
  dailyReminderEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
  updatedAt: string;
}

export interface WebPushPreferencesPatchInput {
  bossSpawnEnabled?: unknown;
  staminaFullEnabled?: unknown;
  mailEnabled?: unknown;
  dailyReminderEnabled?: unknown;
  quietHoursStart?: unknown;
  quietHoursEnd?: unknown;
  timezone?: unknown;
}

export interface NormalizedWebPushPreferencesPatch {
  bossSpawnEnabled?: boolean;
  staminaFullEnabled?: boolean;
  mailEnabled?: boolean;
  dailyReminderEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string | null;
}

const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TIMEZONE_RE = /^[A-Za-z0-9_+\-/]{1,64}$/;

export function parsePushPreferencesPatch(
  raw: unknown,
): NormalizedWebPushPreferencesPatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as WebPushPreferencesPatchInput;
  const out: NormalizedWebPushPreferencesPatch = {};
  const boolKeys = [
    'bossSpawnEnabled',
    'staminaFullEnabled',
    'mailEnabled',
    'dailyReminderEnabled',
  ] as const;
  for (const k of boolKeys) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return null;
    out[k] = v;
  }
  if ('quietHoursStart' in src) {
    const v = src.quietHoursStart;
    if (v === null) out.quietHoursStart = null;
    else if (typeof v === 'string' && HHMM_RE.test(v.trim())) {
      out.quietHoursStart = v.trim();
    } else return null;
  }
  if ('quietHoursEnd' in src) {
    const v = src.quietHoursEnd;
    if (v === null) out.quietHoursEnd = null;
    else if (typeof v === 'string' && HHMM_RE.test(v.trim())) {
      out.quietHoursEnd = v.trim();
    } else return null;
  }
  if ('timezone' in src) {
    const v = src.timezone;
    if (v === null) out.timezone = null;
    else if (typeof v === 'string' && TIMEZONE_RE.test(v.trim())) {
      out.timezone = v.trim();
    } else return null;
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

export const DEFAULT_WEB_PUSH_PREFERENCES: Omit<
  WebPushPreferencesView,
  'updatedAt'
> = {
  bossSpawnEnabled: true,
  staminaFullEnabled: true,
  mailEnabled: true,
  /** Daily reminder OFF mặc định — opt-in mới nhận. */
  dailyReminderEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: null,
};

// ---------------------------------------------------------------------------
// Anti-spam decision
// ---------------------------------------------------------------------------

export interface PushSendDecisionInput {
  /** Optional — `null` = lần đầu, không có dedupe key. */
  lastSentAtMs?: number | null;
  /** Current time ms (server-side). */
  nowMs: number;
  type: WebPushNotificationType;
  prefs: Pick<
    WebPushPreferencesView,
    | 'bossSpawnEnabled'
    | 'staminaFullEnabled'
    | 'mailEnabled'
    | 'dailyReminderEnabled'
    | 'quietHoursStart'
    | 'quietHoursEnd'
  >;
}

export type PushSendDecision =
  | { ok: true }
  | { ok: false; reason: 'DISABLED' | 'COOLDOWN' | 'QUIET_HOURS' };

function isPrefEnabledForType(
  prefs: PushSendDecisionInput['prefs'],
  type: WebPushNotificationType,
): boolean {
  switch (type) {
    case 'BOSS_SPAWN':
      return prefs.bossSpawnEnabled;
    case 'STAMINA_FULL':
      return prefs.staminaFullEnabled;
    case 'MAIL_NEW':
      return prefs.mailEnabled;
    case 'DAILY_REMINDER':
      return prefs.dailyReminderEnabled;
  }
}

function parseHHMMToMin(v: string | null): number | null {
  if (!v || !HHMM_RE.test(v)) return null;
  const [hh, mm] = v.split(':');
  return Number.parseInt(hh, 10) * 60 + Number.parseInt(mm, 10);
}

/**
 * `start` / `end` đều `HH:mm` (UTC theo `nowMs` — service caller có
 * thể quy đổi timezone trước khi gọi). Hỗ trợ window vắt ngang nửa
 * đêm (e.g. start=22:00, end=06:00 ⇒ chặn 22:00–24:00 + 00:00–06:00).
 */
export function isInQuietHours(
  nowMs: number,
  start: string | null,
  end: string | null,
): boolean {
  const s = parseHHMMToMin(start);
  const e = parseHHMMToMin(end);
  if (s == null || e == null) return false;
  if (s === e) return false;
  const d = new Date(nowMs);
  const minOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (s < e) return minOfDay >= s && minOfDay < e;
  // Wrap-around midnight.
  return minOfDay >= s || minOfDay < e;
}

export function shouldSendPushNotification(
  input: PushSendDecisionInput,
): PushSendDecision {
  const { prefs, type, nowMs, lastSentAtMs } = input;
  if (!isPrefEnabledForType(prefs, type)) {
    return { ok: false, reason: 'DISABLED' };
  }
  if (
    isInQuietHours(nowMs, prefs.quietHoursStart, prefs.quietHoursEnd) &&
    type !== 'BOSS_SPAWN'
  ) {
    // Boss spawn vẫn nhận trong quiet hours (game-critical event); type
    // khác (mail/stamina/daily) tôn trọng quiet hours.
    return { ok: false, reason: 'QUIET_HOURS' };
  }
  if (lastSentAtMs != null && Number.isFinite(lastSentAtMs)) {
    const cd = WEB_PUSH_COOLDOWN_MS[type];
    if (nowMs - lastSentAtMs < cd) {
      return { ok: false, reason: 'COOLDOWN' };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export interface WebPushPayload {
  type: WebPushNotificationType;
  title: string;
  body: string;
  /** Optional deep-link (FE service worker `notificationclick` handler). */
  url?: string | null;
  /** Optional dedupe tag — same tag thay thế notif cũ (per spec). */
  tag?: string | null;
  /** ISO timestamp khi server build payload (debug). */
  ts: string;
}

export function buildWebPushPayload(input: {
  type: WebPushNotificationType;
  title: string;
  body: string;
  url?: string | null;
  tag?: string | null;
  nowIso?: string;
}): WebPushPayload {
  const title = String(input.title ?? '').slice(
    0,
    WEB_PUSH_LIMITS.PAYLOAD_TITLE_MAX_CHARS,
  );
  const body = String(input.body ?? '').slice(
    0,
    WEB_PUSH_LIMITS.PAYLOAD_BODY_MAX_CHARS,
  );
  return {
    type: input.type,
    title,
    body,
    url: input.url ?? null,
    tag: input.tag ?? null,
    ts: input.nowIso ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// View DTO
// ---------------------------------------------------------------------------

export interface WebPushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string | null;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}
