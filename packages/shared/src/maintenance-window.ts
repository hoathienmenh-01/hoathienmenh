/**
 * Maintenance Window — Phase 15.5.
 *
 * Mục tiêu:
 *   - Cho admin lên lịch bảo trì (SCHEDULED) hoặc bật bảo trì khẩn cấp
 *     (ACTIVE) chặn người chơi thường truy cập game.
 *   - Vẫn cho admin truy cập (`allowAdminBypass`), healthcheck (`allowHealthcheck`),
 *     metrics (`allowMetrics`) — không khoá ngoài admin và observability.
 *   - Frontend đọc qua public endpoint `GET /maintenance/status` để render
 *     overlay/banner.
 *   - Không HTML/script injection — title/message là plain text.
 *
 * Design:
 *   - Catalog ở DB (`MaintenanceWindow`) — admin tạo/sửa/disable; key
 *     unique cho audit.
 *   - Recompute pure-fn `nextMaintenanceWindowStatus` mirror
 *     `nextLiveOpsAnnouncementStatus` — cron 5-phút auto-transition
 *     SCHEDULED→ACTIVE / ACTIVE→ENDED. DRAFT/DISABLED không tự transition.
 *   - Public-safe view (`MaintenanceWindowPublicView`) chỉ chứa:
 *     `active`, `severity`, `target`, `title`, `message`, `startsAt`,
 *     `endsAt`, `serverTime`, `allowAdminBypass`. Strip
 *     `createdByAdminId` / `disabledAt` / `id`.
 *
 * Active selection:
 *   - Có thể có nhiều window ACTIVE cùng lúc (vd 1 SCHEDULED full
 *     lockdown overlap với 1 INFO banner). Server chọn 1 "winner" qua
 *     `pickActiveMaintenanceWindow`:
 *       1. Severity cao nhất thắng (CRITICAL > WARNING > INFO).
 *       2. Tie-break: target nghiêm hơn thắng (FULL_LOCKDOWN >
 *          ALL_PLAYERS > NON_ADMIN_USERS > API_WRITE_ONLY).
 *       3. Tie-break cuối: `endsAt` gần nhất thắng (kết thúc sớm hơn —
 *          tránh banner "lỡ" còn hiển thị quá lâu sau khi window quan
 *          trọng đã end).
 *   - Quy tắc viết rõ ràng + có test bao phủ.
 */

// ---------------------------------------------------------------------------
// Status / Severity / Target enums
// ---------------------------------------------------------------------------

/**
 * Status lifecycle (mirror `LiveOpsAnnouncementStatus`):
 *   `DRAFT` (admin tạo, chưa publish)
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
export type MaintenanceWindowStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'DISABLED';

export const MAINTENANCE_WINDOW_STATUSES: readonly MaintenanceWindowStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'DISABLED',
] as const;

/**
 * Severity của maintenance window.
 *   - `INFO`     — bảo trì nhẹ (vd config tweak, không downtime).
 *   - `WARNING`  — bảo trì có ảnh hưởng nhưng không lockdown (vd write-only block).
 *   - `CRITICAL` — bảo trì nặng (full lockdown, only admin).
 *
 * FE map severity → màu badge:
 *   - INFO     → xanh.
 *   - WARNING  → vàng/cam.
 *   - CRITICAL → đỏ.
 */
export type MaintenanceSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export const MAINTENANCE_SEVERITIES: readonly MaintenanceSeverity[] = [
  'INFO',
  'WARNING',
  'CRITICAL',
] as const;

/**
 * Target audience của maintenance window. Quy định ai bị chặn bởi
 * middleware khi `status === ACTIVE`.
 *   - `ALL_PLAYERS`     — chặn mọi player (PLAYER + MOD + ADMIN nếu
 *      `allowAdminBypass=false`). Default cho most maintenance.
 *   - `NON_ADMIN_USERS` — chặn PLAYER + MOD (không chặn ADMIN bất kể
 *      `allowAdminBypass`). Dùng khi cần test feature trên prod với
 *      ADMIN account live.
 *   - `API_WRITE_ONLY`  — chỉ chặn write methods (POST/PUT/PATCH/DELETE).
 *      GET vẫn pass — player đọc state nhưng không mutate. Dùng cho
 *      maintenance lúc migrate dữ liệu.
 *   - `FULL_LOCKDOWN`   — chặn TẤT CẢ kể cả admin. ⚠ chỉ dùng khi cần
 *      compliance cứng (vd legal takedown). Override cả `allowAdminBypass`.
 *
 * Healthcheck/metrics/maintenance status route luôn được middleware
 * cho phép qua (nếu flag allow tương ứng) — riêng `FULL_LOCKDOWN` cũng
 * vẫn cho phép healthcheck nếu `allowHealthcheck=true` (giữ K8s probe
 * sống), nhưng admin sẽ KHÔNG bypass.
 */
export type MaintenanceTarget =
  | 'ALL_PLAYERS'
  | 'NON_ADMIN_USERS'
  | 'API_WRITE_ONLY'
  | 'FULL_LOCKDOWN';

export const MAINTENANCE_TARGETS: readonly MaintenanceTarget[] = [
  'ALL_PLAYERS',
  'NON_ADMIN_USERS',
  'API_WRITE_ONLY',
  'FULL_LOCKDOWN',
] as const;

// ---------------------------------------------------------------------------
// Validator caps
// ---------------------------------------------------------------------------

/** Pattern alphanumeric + dash/underscore, 3–80 chars, alphanumeric đầu/cuối. */
export const MAINTENANCE_KEY_PATTERN =
  /^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/;
export const MAINTENANCE_TITLE_MAX = 120;
export const MAINTENANCE_MESSAGE_MAX = 1000;
/** Window tối thiểu 60s — match cron 5-phút (không miss event). */
export const MAINTENANCE_MIN_WINDOW_MS = 60 * 1000;
/** Window tối đa 30 ngày — chống admin set window vĩnh viễn. */
export const MAINTENANCE_MAX_WINDOW_MS = 30 * 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Validator errors
// ---------------------------------------------------------------------------

export type MaintenanceValidationCode =
  | 'MAINTENANCE_KEY_INVALID'
  | 'MAINTENANCE_SEVERITY_INVALID'
  | 'MAINTENANCE_TARGET_INVALID'
  | 'MAINTENANCE_TITLE_REQUIRED'
  | 'MAINTENANCE_TITLE_TOO_LONG'
  | 'MAINTENANCE_TITLE_UNSAFE'
  | 'MAINTENANCE_MESSAGE_REQUIRED'
  | 'MAINTENANCE_MESSAGE_TOO_LONG'
  | 'MAINTENANCE_MESSAGE_UNSAFE'
  | 'MAINTENANCE_LOCALE_PARITY'
  | 'MAINTENANCE_WINDOW_INVALID'
  | 'MAINTENANCE_WINDOW_TOO_SHORT'
  | 'MAINTENANCE_WINDOW_TOO_LONG';

// ---------------------------------------------------------------------------
// Input shape (admin create / update)
// ---------------------------------------------------------------------------

/**
 * Input thô admin gửi qua `POST /admin/maintenance-windows` hoặc PATCH.
 *
 * Locale parity rule (mirror announcement): nếu admin truyền `titleEn`
 * thì cũng phải có `messageEn` (avoid half-translated entry); reverse
 * holds tương tự. Cho phép cả 2 bỏ trống → fallback `titleVi`/`messageVi`
 * ở FE.
 *
 * `allowAdminBypass`/`allowHealthcheck`/`allowMetrics` default `true` ở
 * service layer (Prisma column default) — input không bắt buộc gửi.
 */
export interface MaintenanceWindowInput {
  readonly key: string;
  readonly severity: MaintenanceSeverity;
  readonly target: MaintenanceTarget;
  readonly titleVi: string;
  readonly titleEn: string | null;
  readonly messageVi: string;
  readonly messageEn: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly allowAdminBypass?: boolean;
  readonly allowHealthcheck?: boolean;
  readonly allowMetrics?: boolean;
}

// ---------------------------------------------------------------------------
// Validator pure-fn
// ---------------------------------------------------------------------------

/**
 * Reject ký tự nguy hiểm để chống XSS:
 *   - `<` / `>`  — element tag.
 *   - `&lt;` / `&gt;` literal — admin paste-encoded.
 *   - `javascript:` URI — link payload.
 *   - control char (`\x00`–`\x1F` trừ `\n` `\r` `\t`).
 *
 * Cho phép emoji/unicode bình thường.
 */
export function isMaintenanceTextSafe(s: string): boolean {
  if (s.length === 0) return false;
  if (/[<>]/.test(s)) return false;
  if (/&lt;|&gt;|javascript:/i.test(s)) return false;
  // Reject control chars except \n \r \t.
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
    if (c === 0x7f) return false;
  }
  return true;
}

export function isValidMaintenanceSeverity(
  s: string,
): s is MaintenanceSeverity {
  return (MAINTENANCE_SEVERITIES as readonly string[]).includes(s);
}

export function isValidMaintenanceTarget(
  s: string,
): s is MaintenanceTarget {
  return (MAINTENANCE_TARGETS as readonly string[]).includes(s);
}

export function isValidMaintenanceWindowStatus(
  s: string,
): s is MaintenanceWindowStatus {
  return (MAINTENANCE_WINDOW_STATUSES as readonly string[]).includes(s);
}

/**
 * Validate input *trước* khi ghi DB. Trả về `null` nếu pass, hoặc 1
 * code trong `MaintenanceValidationCode`.
 */
export function validateMaintenanceWindowInput(
  input: MaintenanceWindowInput,
): MaintenanceValidationCode | null {
  if (!MAINTENANCE_KEY_PATTERN.test(input.key)) {
    return 'MAINTENANCE_KEY_INVALID';
  }
  if (!isValidMaintenanceSeverity(input.severity)) {
    return 'MAINTENANCE_SEVERITY_INVALID';
  }
  if (!isValidMaintenanceTarget(input.target)) {
    return 'MAINTENANCE_TARGET_INVALID';
  }

  const titleVi = input.titleVi?.trim() ?? '';
  if (titleVi.length === 0) return 'MAINTENANCE_TITLE_REQUIRED';
  if (titleVi.length > MAINTENANCE_TITLE_MAX) {
    return 'MAINTENANCE_TITLE_TOO_LONG';
  }
  if (!isMaintenanceTextSafe(titleVi)) {
    return 'MAINTENANCE_TITLE_UNSAFE';
  }

  const messageVi = input.messageVi?.trim() ?? '';
  if (messageVi.length === 0) return 'MAINTENANCE_MESSAGE_REQUIRED';
  if (messageVi.length > MAINTENANCE_MESSAGE_MAX) {
    return 'MAINTENANCE_MESSAGE_TOO_LONG';
  }
  if (!isMaintenanceTextSafe(messageVi)) {
    return 'MAINTENANCE_MESSAGE_UNSAFE';
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
    if (titleEn.length > MAINTENANCE_TITLE_MAX) {
      return 'MAINTENANCE_TITLE_TOO_LONG';
    }
    if (!isMaintenanceTextSafe(titleEn)) {
      return 'MAINTENANCE_TITLE_UNSAFE';
    }
  }
  if (messageEn.length > 0) {
    if (messageEn.length > MAINTENANCE_MESSAGE_MAX) {
      return 'MAINTENANCE_MESSAGE_TOO_LONG';
    }
    if (!isMaintenanceTextSafe(messageEn)) {
      return 'MAINTENANCE_MESSAGE_UNSAFE';
    }
  }
  // Locale parity: title-en có thì message-en bắt buộc và ngược lại.
  if ((titleEn.length > 0) !== (messageEn.length > 0)) {
    return 'MAINTENANCE_LOCALE_PARITY';
  }

  const startMs = input.startsAt.getTime();
  const endMs = input.endsAt.getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs
  ) {
    return 'MAINTENANCE_WINDOW_INVALID';
  }
  const windowMs = endMs - startMs;
  if (windowMs < MAINTENANCE_MIN_WINDOW_MS) {
    return 'MAINTENANCE_WINDOW_TOO_SHORT';
  }
  if (windowMs > MAINTENANCE_MAX_WINDOW_MS) {
    return 'MAINTENANCE_WINDOW_TOO_LONG';
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
export function isMaintenanceWindowActiveAt(
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
export function nextMaintenanceWindowStatus(
  current: MaintenanceWindowStatus,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): MaintenanceWindowStatus {
  if (current === 'DRAFT' || current === 'DISABLED' || current === 'ENDED') {
    return current;
  }
  const t = now.getTime();
  if (t >= endsAt.getTime()) return 'ENDED';
  if (current === 'SCHEDULED' && t >= startsAt.getTime()) return 'ACTIVE';
  return current;
}

// ---------------------------------------------------------------------------
// Active selection (multi-window picker)
// ---------------------------------------------------------------------------

/** Numeric severity rank — higher wins. */
export function maintenanceSeverityRank(s: MaintenanceSeverity): number {
  switch (s) {
    case 'INFO':
      return 1;
    case 'WARNING':
      return 2;
    case 'CRITICAL':
      return 3;
  }
}

/** Numeric target severity rank — stricter wins. */
export function maintenanceTargetRank(t: MaintenanceTarget): number {
  switch (t) {
    case 'API_WRITE_ONLY':
      return 1;
    case 'NON_ADMIN_USERS':
      return 2;
    case 'ALL_PLAYERS':
      return 3;
    case 'FULL_LOCKDOWN':
      return 4;
  }
}

export interface MaintenanceWindowSelectorRow {
  readonly key: string;
  readonly status: MaintenanceWindowStatus;
  readonly severity: MaintenanceSeverity;
  readonly target: MaintenanceTarget;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Pick "winner" window khi có nhiều ACTIVE row cùng lúc.
 *
 * Rule (deterministic):
 *   1. Lọc chỉ các row ACTIVE và còn trong window `[startsAt, endsAt)` tại `now`.
 *   2. Sort:
 *      a. severity DESC (CRITICAL > WARNING > INFO).
 *      b. target stricter (FULL_LOCKDOWN > ALL_PLAYERS > NON_ADMIN_USERS > API_WRITE_ONLY).
 *      c. `endsAt` ASC (sớm hơn thắng — banner sắp hết hiển thị trước, tránh override quá lâu).
 *      d. `key` ASC (tie-break ổn định cho test).
 *   3. Trả phần tử đầu, hoặc `null` nếu không có row ACTIVE.
 */
export function pickActiveMaintenanceWindow<
  T extends MaintenanceWindowSelectorRow,
>(rows: readonly T[], now: Date): T | null {
  const t = now.getTime();
  const active = rows.filter(
    (r) =>
      r.status === 'ACTIVE' &&
      r.startsAt.getTime() <= t &&
      r.endsAt.getTime() > t,
  );
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => {
    const sevA = maintenanceSeverityRank(a.severity);
    const sevB = maintenanceSeverityRank(b.severity);
    if (sevA !== sevB) return sevB - sevA;
    const tgtA = maintenanceTargetRank(a.target);
    const tgtB = maintenanceTargetRank(b.target);
    if (tgtA !== tgtB) return tgtB - tgtA;
    const endA = a.endsAt.getTime();
    const endB = b.endsAt.getTime();
    if (endA !== endB) return endA - endB;
    return a.key.localeCompare(b.key);
  });
  return sorted[0] ?? null;
}

// ---------------------------------------------------------------------------
// Admin / public views
// ---------------------------------------------------------------------------

/**
 * Admin view full metadata (`GET /admin/maintenance-windows`). Gồm
 * `createdByAdminId` + `disabledAt` để admin audit.
 */
export interface MaintenanceWindowAdminView {
  readonly id: string;
  readonly key: string;
  readonly status: MaintenanceWindowStatus;
  readonly severity: MaintenanceSeverity;
  readonly target: MaintenanceTarget;
  readonly titleVi: string;
  readonly titleEn: string | null;
  readonly messageVi: string;
  readonly messageEn: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allowAdminBypass: boolean;
  readonly allowHealthcheck: boolean;
  readonly allowMetrics: boolean;
  readonly createdByAdminId: string | null;
  readonly disabledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Public view trả từ `GET /maintenance/status`.
 *
 * KHÔNG bao gồm:
 *   - `id` / `createdByAdminId` (admin metadata).
 *   - `disabledAt` (admin audit).
 *   - `allowHealthcheck` / `allowMetrics` (internal middleware config —
 *     không leak attack surface).
 *
 * BAO GỒM:
 *   - `active` boolean — true nếu có ACTIVE window và `now` trong window.
 *   - `severity` / `target` / `title{Vi,En}` / `message{Vi,En}` —
 *     để FE render overlay/banner.
 *   - `startsAt` / `endsAt` — để FE đếm ngược.
 *   - `serverTime` — để FE đối chiếu drift đồng hồ client.
 *   - `allowAdminBypass` — để FE biết có nên ẩn nút admin login không
 *     (nếu false → cũng ẩn admin login).
 */
export interface MaintenanceWindowPublicView {
  readonly active: boolean;
  readonly severity: MaintenanceSeverity | null;
  readonly target: MaintenanceTarget | null;
  readonly titleVi: string | null;
  readonly titleEn: string | null;
  readonly messageVi: string | null;
  readonly messageEn: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly serverTime: string;
  readonly allowAdminBypass: boolean;
}

// ---------------------------------------------------------------------------
// Locale picker
// ---------------------------------------------------------------------------

/**
 * Pick `vi` / `en` text với fallback `vi`. Cùng pattern với
 * `pickLiveOpsAnnouncementText` — share helper lý tưởng nhưng giữ độc
 * lập để tránh circular imports phía test.
 */
export function pickMaintenanceText(
  vi: string,
  en: string | null,
  locale: 'vi' | 'en',
): string {
  if (locale === 'en' && en !== null && en.length > 0) return en;
  return vi;
}

// ---------------------------------------------------------------------------
// Error code shared FE/BE
// ---------------------------------------------------------------------------

/**
 * Error code thống nhất khi middleware chặn request:
 *   - `MAINTENANCE_ACTIVE` — game đang bảo trì, response gồm
 *     `title`/`message`/`endsAt` để FE render overlay.
 *
 * FE map error code → render `MaintenanceView`. Player nhấn refresh chỉ
 * thoát khi server hết maintenance.
 */
export const MAINTENANCE_BLOCK_ERROR_CODE = 'MAINTENANCE_ACTIVE' as const;
export type MaintenanceBlockErrorCode = typeof MAINTENANCE_BLOCK_ERROR_CODE;

/**
 * Body envelope error trả khi middleware chặn — mirror `AllExceptionsFilter`
 * envelope. FE đọc `error.code === 'MAINTENANCE_ACTIVE'` rồi extract
 * `error.meta` để render.
 */
export interface MaintenanceBlockErrorPayload {
  readonly code: MaintenanceBlockErrorCode;
  readonly message: string;
  readonly meta: {
    readonly severity: MaintenanceSeverity;
    readonly target: MaintenanceTarget;
    readonly titleVi: string;
    readonly titleEn: string | null;
    readonly messageVi: string;
    readonly messageEn: string | null;
    readonly endsAt: string;
    readonly serverTime: string;
  };
}
