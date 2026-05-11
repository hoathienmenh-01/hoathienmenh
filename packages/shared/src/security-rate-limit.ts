/**
 * Phase 18.1 — Security Rate Limit + Abuse Protection (shared catalog, pure).
 *
 * Định nghĩa **single source of truth** cho mọi rate-limit policy áp dụng
 * cho API nhạy cảm (auth, shop, market, sect-shop, daily-login, dungeon
 * claim, liveops gift claim, topup, admin mutation). Cùng catalog dùng
 * bởi:
 *   - `RateLimitService` + `RateLimitGuard` ở `apps/api` (enforcement).
 *   - Admin Security Panel ở `apps/web` (hiển thị tên policy + severity).
 *
 * **Pure** — KHÔNG đọc env, KHÔNG mutate state. Test 100% deterministic.
 *
 * Phase 18.1 chính sách:
 *   - Rate-limit là **defense-in-depth** layer trước anti-cheat / WAF /
 *     CDN. Không thay thế các lớp đó.
 *   - **KHÔNG** auto-ban vĩnh viễn (chỉ block tạm thời 5-30 phút theo
 *     severity). Admin có thể lift block sớm qua endpoint riêng.
 *   - **KHÔNG** block healthcheck / readyz / metrics — các route đó
 *     phải nằm ngoài guard.
 *   - **KHÔNG** rate-limit theo character cho gameplay action core
 *     (cultivation tick / breakthrough) ở Phase 18.1 — chỉ áp cho
 *     claim/buy action có ledger impact.
 *
 * Companion docs: `docs/SECURITY.md` §Rate Limit + Abuse Block.
 */

/**
 * Tên các policy bắt buộc phải có. Mỗi key map về 1 `RateLimitPolicy`
 * cấu hình ở `RATE_LIMIT_POLICIES`. Thêm key mới: bổ sung ở danh sách
 * này + thêm entry ở `RATE_LIMIT_POLICIES` (test sẽ enforce parity).
 */
export const RATE_LIMIT_POLICY_KEYS = [
  // ---- Auth ----
  'AUTH_LOGIN',
  'AUTH_REGISTER',
  'AUTH_REFRESH',
  'AUTH_PASSWORD_RESET',
  // ---- Economy ----
  'SHOP_BUY',
  'SECT_SHOP_BUY',
  'MARKET_CREATE_LISTING',
  'MARKET_BUY',
  'DAILY_LOGIN_CLAIM',
  'DUNGEON_CLAIM',
  'LIVEOPS_GIFT_CLAIM',
  'TOPUP_CREATE_ORDER',
  // ---- Admin ----
  'ADMIN_MUTATION',
  'ADMIN_REPORT_VIEW',
  // ---- Social (Phase 19.1.B) ----
  'SOCIAL_FRIEND_REQUEST',
  'SOCIAL_BLOCK_TOGGLE',
  'CHAT_PRIVATE_SEND',
  'CHAT_GROUP_SEND',
  'CHAT_GROUP_CREATE',
  'CHAT_GROUP_MEMBER_ADD',
  // ---- Chat Moderation (Phase 19.2) ----
  'CHAT_REPORT_SUBMIT',
  // ---- Fallback ----
  'PUBLIC_READ',
  'DEFAULT_API',
] as const;

export type RateLimitPolicyKey = (typeof RATE_LIMIT_POLICY_KEYS)[number];

/**
 * Scope = đơn vị đếm hit. Trong runtime guard sẽ derive subject:
 *   - `IP`: từ `req.ip` (đã trust-proxy theo bootstrap-config).
 *   - `USER`: từ `req.userId` (set bởi AuthGuard/AdminGuard).
 *   - `CHARACTER`: từ `req.characterId` (set bởi character context).
 *   - `IP_USER`: hash(IP + userId) — vừa chặn shared-IP abuse, vừa chặn
 *     account-rotation từ 1 IP. Nếu chưa auth, dùng `IP` fallback.
 */
export const RATE_LIMIT_SCOPES = ['IP', 'USER', 'CHARACTER', 'IP_USER'] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

/**
 * Severity = mức độ nghiêm trọng khi vượt policy. Quyết định:
 *   - Bao lâu block subject sau khi vượt (`blockSec`).
 *   - SecurityEvent log severity (`INFO` / `WARN` / `CRITICAL`).
 *
 * Ngưỡng:
 *   - `LOW`: read-only / public, chỉ throttle nhẹ.
 *   - `MEDIUM`: action có cost (currency / cooldown) nhưng không
 *     irreversibly nguy hiểm.
 *   - `HIGH`: auth / topup / admin — abuse có thể lộ credential
 *     hoặc tiêu real money.
 */
export const RATE_LIMIT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RateLimitSeverity = (typeof RATE_LIMIT_SEVERITIES)[number];

export interface RateLimitPolicy {
  readonly key: RateLimitPolicyKey;
  /** Window size in seconds. Sliding window. */
  readonly windowSec: number;
  /** Max requests allowed within window before triggering RATE_LIMITED. */
  readonly maxRequests: number;
  /**
   * Sau khi tích lũy đủ "abuse signal" (vượt policy nhiều lần liên tiếp,
   * config ở `SecurityAbuseService`), subject bị block `blockSec` giây.
   * 0 = không block, chỉ trả 429 nhưng không persist.
   */
  readonly blockSec: number;
  readonly scope: RateLimitScope;
  readonly severity: RateLimitSeverity;
  /** Có phải sensitive policy (auth/topup/admin/economy claim) không? */
  readonly sensitive: boolean;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
}

/**
 * Source-of-truth catalog. Tham số chọn theo nguyên tắc:
 *   - Auth: chặt (5-10 request / 15 phút) vì abuse = brute force.
 *   - Economy claim/buy: vừa (10-30 / phút) — đủ cho legit user spam
 *     UI nhưng chặn bot.
 *   - Admin: vừa per-admin (60 / phút) để không kẹt op khẩn cấp.
 *   - Public read: lỏng (300 / phút).
 *
 * Tất cả tham số được test lock-in (`security-rate-limit.test.ts`) để
 * AI sau không vô ý tăng lên 10× rồi quên.
 */
export const RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitPolicyKey, RateLimitPolicy>
> = Object.freeze({
  // ---- Auth ----
  AUTH_LOGIN: {
    key: 'AUTH_LOGIN',
    windowSec: 15 * 60,
    maxRequests: 10,
    blockSec: 15 * 60,
    scope: 'IP_USER',
    severity: 'HIGH',
    sensitive: true,
    descriptionVi: 'Giới hạn đăng nhập theo IP+email/account, chống brute force.',
    descriptionEn: 'Login attempts per IP+email/account, anti brute force.',
  },
  AUTH_REGISTER: {
    key: 'AUTH_REGISTER',
    windowSec: 15 * 60,
    maxRequests: 5,
    blockSec: 30 * 60,
    scope: 'IP',
    severity: 'HIGH',
    sensitive: true,
    descriptionVi: 'Giới hạn tạo tài khoản theo IP, chống script đăng ký hàng loạt.',
    descriptionEn: 'Account creation per IP, anti mass register bot.',
  },
  AUTH_REFRESH: {
    key: 'AUTH_REFRESH',
    windowSec: 60,
    maxRequests: 30,
    blockSec: 5 * 60,
    scope: 'IP_USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn refresh token, chống spam refresh.',
    descriptionEn: 'Refresh token spam protection.',
  },
  AUTH_PASSWORD_RESET: {
    key: 'AUTH_PASSWORD_RESET',
    windowSec: 15 * 60,
    maxRequests: 3,
    blockSec: 30 * 60,
    scope: 'IP',
    severity: 'HIGH',
    sensitive: true,
    descriptionVi: 'Giới hạn yêu cầu đặt lại mật khẩu, chống flood email.',
    descriptionEn: 'Password reset request limit, anti email flood.',
  },
  // ---- Economy ----
  SHOP_BUY: {
    key: 'SHOP_BUY',
    windowSec: 60,
    maxRequests: 30,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn mua trong cửa hàng NPC theo tài khoản.',
    descriptionEn: 'NPC shop buy limit per account.',
  },
  SECT_SHOP_BUY: {
    key: 'SECT_SHOP_BUY',
    windowSec: 60,
    maxRequests: 20,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn mua trong tông môn shop theo tài khoản.',
    descriptionEn: 'Sect shop buy limit per account.',
  },
  MARKET_CREATE_LISTING: {
    key: 'MARKET_CREATE_LISTING',
    windowSec: 60,
    maxRequests: 10,
    blockSec: 10 * 60,
    scope: 'CHARACTER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn tạo bài đăng phường thị theo nhân vật.',
    descriptionEn: 'Market listing creation limit per character.',
  },
  MARKET_BUY: {
    key: 'MARKET_BUY',
    windowSec: 60,
    maxRequests: 30,
    blockSec: 10 * 60,
    scope: 'CHARACTER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn mua phường thị theo nhân vật.',
    descriptionEn: 'Market buy limit per character.',
  },
  DAILY_LOGIN_CLAIM: {
    key: 'DAILY_LOGIN_CLAIM',
    windowSec: 60,
    maxRequests: 5,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn nhận thưởng điểm danh — chỉ cần 1 lần/ngày.',
    descriptionEn: 'Daily login claim limit — once per day expected.',
  },
  DUNGEON_CLAIM: {
    key: 'DUNGEON_CLAIM',
    windowSec: 60,
    maxRequests: 20,
    blockSec: 10 * 60,
    scope: 'CHARACTER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn nhận thưởng phụ bản theo nhân vật.',
    descriptionEn: 'Dungeon claim limit per character.',
  },
  LIVEOPS_GIFT_CLAIM: {
    key: 'LIVEOPS_GIFT_CLAIM',
    windowSec: 60,
    maxRequests: 15,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn nhận quà liveops/giftcode theo tài khoản.',
    descriptionEn: 'Liveops/giftcode claim limit per account.',
  },
  TOPUP_CREATE_ORDER: {
    key: 'TOPUP_CREATE_ORDER',
    windowSec: 60 * 60,
    maxRequests: 10,
    blockSec: 60 * 60,
    scope: 'USER',
    severity: 'HIGH',
    sensitive: true,
    descriptionVi: 'Giới hạn tạo đơn nạp theo tài khoản — chống flood QR.',
    descriptionEn: 'Topup order creation per account — anti QR flood.',
  },
  // ---- Admin ----
  ADMIN_MUTATION: {
    key: 'ADMIN_MUTATION',
    windowSec: 60,
    maxRequests: 60,
    blockSec: 5 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn admin mutation theo tài khoản admin.',
    descriptionEn: 'Admin mutation limit per admin account.',
  },
  ADMIN_REPORT_VIEW: {
    key: 'ADMIN_REPORT_VIEW',
    windowSec: 60,
    maxRequests: 120,
    blockSec: 0,
    scope: 'USER',
    severity: 'LOW',
    sensitive: false,
    descriptionVi: 'Giới hạn xem báo cáo admin — chỉ throttle, không block.',
    descriptionEn: 'Admin report view limit — throttle only, no block.',
  },
  // ---- Social (Phase 19.1.B) ----
  // Chống spam friend request: 10 lời mời / phút / tài khoản. Vượt →
  // block 5 phút. Đủ cho legit user (1-2 request/giây) nhưng chặn
  // script gửi hàng loạt.
  SOCIAL_FRIEND_REQUEST: {
    key: 'SOCIAL_FRIEND_REQUEST',
    windowSec: 60,
    maxRequests: 10,
    blockSec: 5 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn gửi lời mời kết bạn theo tài khoản, chống spam friend request.',
    descriptionEn: 'Friend request send limit per account, anti friend request spam.',
  },
  // Chống block/unblock toggle storm: 30 toggle / 10 phút / tài khoản.
  // Vượt → block 10 phút (UX-friendly: legit user hiếm khi cần >30
  // toggle trong 10 phút).
  SOCIAL_BLOCK_TOGGLE: {
    key: 'SOCIAL_BLOCK_TOGGLE',
    windowSec: 10 * 60,
    maxRequests: 30,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn block/unblock toggle theo tài khoản, chống abuse block storm.',
    descriptionEn: 'Block/unblock toggle limit per account, anti block storm abuse.',
  },
  // Chống flood private chat: 30 msg / phút / tài khoản. Vượt → block
  // 5 phút. Phù hợp với UX gõ ~2 msg/giây tối đa.
  CHAT_PRIVATE_SEND: {
    key: 'CHAT_PRIVATE_SEND',
    windowSec: 60,
    maxRequests: 30,
    blockSec: 5 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn gửi tin nhắn riêng theo tài khoản, chống flood chat.',
    descriptionEn: 'Private chat send limit per account, anti chat flood.',
  },
  // Chống flood group chat: 30 msg / phút / tài khoản. Cùng baseline
  // với private (fanout cost cao hơn nhưng client cap cùng số).
  CHAT_GROUP_SEND: {
    key: 'CHAT_GROUP_SEND',
    windowSec: 60,
    maxRequests: 30,
    blockSec: 5 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn gửi tin nhắn nhóm theo tài khoản, chống flood group chat.',
    descriptionEn: 'Group chat send limit per account, anti group chat flood.',
  },
  // Chống mass create group: 10 group / giờ / tài khoản. Legit user
  // hiếm khi tạo >10 group/giờ.
  CHAT_GROUP_CREATE: {
    key: 'CHAT_GROUP_CREATE',
    windowSec: 60 * 60,
    maxRequests: 10,
    blockSec: 30 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn tạo nhóm chat theo tài khoản, chống mass-create group.',
    descriptionEn: 'Group chat creation limit per account, anti mass-create group.',
  },
  // Chống auto-add hàng loạt: 30 thêm thành viên / 10 phút / tài khoản
  // (owner only). GROUP_MEMBER_MAX=30 nên user thường chỉ cần ~30 lần.
  CHAT_GROUP_MEMBER_ADD: {
    key: 'CHAT_GROUP_MEMBER_ADD',
    windowSec: 10 * 60,
    maxRequests: 30,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn add thành viên nhóm theo tài khoản, chống mass-add.',
    descriptionEn: 'Group member add limit per account, anti mass-add abuse.',
  },
  // ---- Chat Moderation (Phase 19.2) ----
  // Chống spam report: 10 report / giờ / tài khoản. Vượt → block 10
  // phút. Legit user hiếm khi report >10 message/giờ; troll abuse
  // report-storm có thể vượt.
  CHAT_REPORT_SUBMIT: {
    key: 'CHAT_REPORT_SUBMIT',
    windowSec: 60 * 60,
    maxRequests: 10,
    blockSec: 10 * 60,
    scope: 'USER',
    severity: 'MEDIUM',
    sensitive: true,
    descriptionVi: 'Giới hạn gửi report tin nhắn theo tài khoản, chống report-storm abuse.',
    descriptionEn: 'Chat report submission limit per account, anti report-storm abuse.',
  },
  // ---- Fallback ----
  PUBLIC_READ: {
    key: 'PUBLIC_READ',
    windowSec: 60,
    maxRequests: 300,
    blockSec: 0,
    scope: 'IP',
    severity: 'LOW',
    sensitive: false,
    descriptionVi: 'Giới hạn endpoint public read theo IP, chống scrape.',
    descriptionEn: 'Public read endpoint limit per IP, anti scrape.',
  },
  DEFAULT_API: {
    key: 'DEFAULT_API',
    windowSec: 60,
    maxRequests: 120,
    blockSec: 0,
    scope: 'IP_USER',
    severity: 'LOW',
    sensitive: false,
    descriptionVi: 'Fallback default cho mọi API chưa có policy riêng.',
    descriptionEn: 'Fallback default for endpoints without specific policy.',
  },
});

/**
 * Sensitive policy list — auto-derived từ catalog. Dùng để Admin Panel
 * hiển thị warning + để `SecurityAbuseService` quyết định có persist
 * `SecurityEvent` row hay không (LOW policy chỉ throttle, không log
 * spam DB).
 */
export const SENSITIVE_RATE_LIMIT_POLICIES: readonly RateLimitPolicyKey[] =
  Object.freeze(
    RATE_LIMIT_POLICY_KEYS.filter((k) => RATE_LIMIT_POLICIES[k].sensitive),
  );

export function getRateLimitPolicy(key: RateLimitPolicyKey): RateLimitPolicy {
  const p = RATE_LIMIT_POLICIES[key];
  if (!p) throw new Error(`unknown rate-limit policy: ${String(key)}`);
  return p;
}

export function isRateLimitPolicyKey(v: unknown): v is RateLimitPolicyKey {
  return (
    typeof v === 'string' &&
    (RATE_LIMIT_POLICY_KEYS as readonly string[]).includes(v)
  );
}

export function isRateLimitScope(v: unknown): v is RateLimitScope {
  return (
    typeof v === 'string' && (RATE_LIMIT_SCOPES as readonly string[]).includes(v)
  );
}

export function isRateLimitSeverity(v: unknown): v is RateLimitSeverity {
  return (
    typeof v === 'string' &&
    (RATE_LIMIT_SEVERITIES as readonly string[]).includes(v)
  );
}

export function isSensitivePolicy(key: RateLimitPolicyKey): boolean {
  return RATE_LIMIT_POLICIES[key].sensitive;
}

export interface RateLimitPolicyValidationIssue {
  policy: RateLimitPolicyKey;
  field: 'windowSec' | 'maxRequests' | 'blockSec' | 'scope' | 'severity';
  message: string;
}

/**
 * Pure validator — chạy trong test để bảo vệ tham số khỏi regression
 * (ví dụ ai đó vô ý set `maxRequests=10000` rồi vô hiệu hóa rate-limit).
 */
export function validateRateLimitPolicy(
  p: RateLimitPolicy,
): RateLimitPolicyValidationIssue[] {
  const issues: RateLimitPolicyValidationIssue[] = [];
  if (!Number.isInteger(p.windowSec) || p.windowSec <= 0) {
    issues.push({
      policy: p.key,
      field: 'windowSec',
      message: 'windowSec phải là integer > 0',
    });
  }
  if (p.windowSec > 24 * 60 * 60) {
    issues.push({
      policy: p.key,
      field: 'windowSec',
      message: 'windowSec phải <= 24h để tránh memory bloat sliding window',
    });
  }
  if (!Number.isInteger(p.maxRequests) || p.maxRequests <= 0) {
    issues.push({
      policy: p.key,
      field: 'maxRequests',
      message: 'maxRequests phải là integer > 0',
    });
  }
  if (p.maxRequests > 10_000) {
    issues.push({
      policy: p.key,
      field: 'maxRequests',
      message: 'maxRequests > 10000 ~ tắt rate-limit, không cho phép',
    });
  }
  if (!Number.isInteger(p.blockSec) || p.blockSec < 0) {
    issues.push({
      policy: p.key,
      field: 'blockSec',
      message: 'blockSec phải là integer >= 0',
    });
  }
  if (p.blockSec > 24 * 60 * 60) {
    issues.push({
      policy: p.key,
      field: 'blockSec',
      message: 'blockSec phải <= 24h để tránh ban "vĩnh viễn" lén lút',
    });
  }
  if (!isRateLimitScope(p.scope)) {
    issues.push({
      policy: p.key,
      field: 'scope',
      message: `scope không hợp lệ: ${String(p.scope)}`,
    });
  }
  if (!isRateLimitSeverity(p.severity)) {
    issues.push({
      policy: p.key,
      field: 'severity',
      message: `severity không hợp lệ: ${String(p.severity)}`,
    });
  }
  return issues;
}

/**
 * Normalize subject ID để build Redis key. Trim + lowercase email/IP,
 * giữ nguyên cuid/uuid. Không hash ở đây — hash tách ra `IpHashService`
 * ở runtime layer (cần env salt).
 */
export function normalizeRateLimitSubject(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (s.length === 0) return '';
  return s.toLowerCase();
}

/**
 * Build canonical Redis key cho rate-limit counter. Format:
 *   `ratelimit:{policy}:{scope}:{subject}`
 *
 * Bucket / timestamp được Redis sliding window xử lý qua ZSET, không
 * cần encode vào key. Test lock-in để guarantee format stable.
 */
export function buildRateLimitKey(
  policy: RateLimitPolicyKey,
  scope: RateLimitScope,
  subject: string,
): string {
  const norm = normalizeRateLimitSubject(subject);
  return `ratelimit:${policy}:${scope}:${norm || 'unknown'}`;
}

/**
 * Build canonical Redis key cho abuse-block status. Format:
 *   `abuse:block:{type}:{subjectHash}`
 *
 * `type` = `IP` hoặc `USER`. `subjectHash` đã hash từ IpHashService
 * trước khi gọi. Test lock-in để guarantee format stable.
 */
export function buildAbuseBlockKey(
  type: 'IP' | 'USER',
  subjectHash: string,
): string {
  const norm = normalizeRateLimitSubject(subjectHash);
  return `abuse:block:${type}:${norm || 'unknown'}`;
}

/**
 * Bucket label cho UI hiển thị. Không phải severity — đây là phân loại
 * theo nhóm chức năng.
 */
export type RateLimitPolicyGroup =
  | 'AUTH'
  | 'ECONOMY'
  | 'ADMIN'
  | 'PUBLIC'
  | 'SOCIAL';

export function getRateLimitPolicyGroup(
  key: RateLimitPolicyKey,
): RateLimitPolicyGroup {
  if (key.startsWith('AUTH_')) return 'AUTH';
  if (key.startsWith('ADMIN_')) return 'ADMIN';
  if (key === 'PUBLIC_READ' || key === 'DEFAULT_API') return 'PUBLIC';
  if (key.startsWith('SOCIAL_') || key.startsWith('CHAT_')) return 'SOCIAL';
  return 'ECONOMY';
}
