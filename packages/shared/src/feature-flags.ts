/**
 * Feature Flag DB-backed — Phase 15.4.
 *
 * Mục tiêu:
 *   - Cho phép admin bật/tắt các chức năng quan trọng (Arena, Tribulation
 *     Mini-Battle, Reforge/Enchant, LiveOps event/festival/announcement,
 *     Territory War, Market, Shop/Sect Shop discount runtime) mà KHÔNG
 *     cần redeploy code.
 *   - Cache TTL 30s (Redis ưu tiên, fallback in-memory) — flag đổi có
 *     hiệu lực sau ≤ 30s.
 *   - Default safe value khi flag chưa tồn tại trong DB → enable theo
 *     `defaultEnabled` của catalog (server fail-open cho gameplay flags
 *     chính, fail-closed cho experimental flags).
 *   - Whitelist `public` cho `GET /feature-flags/public` — frontend đọc
 *     biết cần ẩn UI mà KHÔNG leak admin/private flag.
 *
 * Design:
 *   - Catalog hardcode trong shared (đồng bộ FE+BE), không tạo flag tùy ý
 *     ngoài catalog (admin chỉ có thể toggle các key đã khai báo).
 *   - Validator pure-fn `isFeatureFlagKey(s)` — server reject patch với
 *     key ngoài catalog.
 *   - Categories phục vụ filter UI admin panel + telemetry phân loại
 *     (GAMEPLAY/ECONOMY/LIVEOPS/ADMIN/SAFETY).
 *   - `requiresRestart=false` cho mọi flag Phase 15.4 — apply runtime
 *     chỉ qua cache invalidate. Không có flag nào cần restart server.
 *
 * Usage:
 *   - BE: `featureFlagService.isEnabled('ARENA_ENABLED')` trả `true|false`,
 *     fallback default nếu DB row chưa tồn tại / cache lỗi.
 *   - BE runtime guard: throw `FEATURE_DISABLED` (HTTP 403/503) khi flag off.
 *   - FE: `useFeatureFlagsStore().isEnabled('ARENA_ENABLED')` — đọc public
 *     endpoint cache 30s, ẩn/disable UI tương ứng.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Category của feature flag — phục vụ filter UI admin panel và telemetry.
 *   - `GAMEPLAY` — chức năng gameplay chính (Arena, Tribulation, Reforge/Enchant).
 *   - `ECONOMY`  — flag liên quan economy/ledger (Market, Shop discount).
 *   - `LIVEOPS`  — LiveOps systems (event scheduler, festival gift, announcement).
 *   - `ADMIN`    — admin tools (chưa dùng Phase 15.4, reserve cho 15.5+).
 *   - `SAFETY`   — kill switch cho cứu hộ/maintenance (chưa dùng Phase 15.4).
 */
export type FeatureFlagCategory =
  | 'GAMEPLAY'
  | 'ECONOMY'
  | 'LIVEOPS'
  | 'ADMIN'
  | 'SAFETY';

export const FEATURE_FLAG_CATEGORIES: readonly FeatureFlagCategory[] = [
  'GAMEPLAY',
  'ECONOMY',
  'LIVEOPS',
  'ADMIN',
  'SAFETY',
] as const;

export function isFeatureFlagCategory(s: string): s is FeatureFlagCategory {
  return (FEATURE_FLAG_CATEGORIES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * Tập hợp feature flag keys hợp lệ Phase 15.4.
 *
 * Quy ước đặt tên: `<MODULE>_<CAPABILITY>_ENABLED` — đọc rõ ý nghĩa
 * "tính năng X đang bật" (default-true cho hầu hết, default-false cho
 * experimental).
 */
export type FeatureFlagKey =
  | 'ARENA_ENABLED'
  | 'TRIBULATION_MINI_BATTLE_ENABLED'
  | 'EQUIPMENT_REFORGE_ENABLED'
  | 'EQUIPMENT_ENCHANT_ENABLED'
  | 'LIVEOPS_EVENTS_ENABLED'
  | 'LIVEOPS_FESTIVAL_GIFT_ENABLED'
  | 'LIVEOPS_ANNOUNCEMENTS_ENABLED'
  | 'TERRITORY_WAR_ENABLED'
  | 'MARKET_ENABLED'
  | 'SHOP_DISCOUNT_EVENTS_ENABLED'
  | 'SECT_SHOP_DISCOUNT_EVENTS_ENABLED';

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  'ARENA_ENABLED',
  'TRIBULATION_MINI_BATTLE_ENABLED',
  'EQUIPMENT_REFORGE_ENABLED',
  'EQUIPMENT_ENCHANT_ENABLED',
  'LIVEOPS_EVENTS_ENABLED',
  'LIVEOPS_FESTIVAL_GIFT_ENABLED',
  'LIVEOPS_ANNOUNCEMENTS_ENABLED',
  'TERRITORY_WAR_ENABLED',
  'MARKET_ENABLED',
  'SHOP_DISCOUNT_EVENTS_ENABLED',
  'SECT_SHOP_DISCOUNT_EVENTS_ENABLED',
] as const;

export function isFeatureFlagKey(s: string): s is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Catalog định nghĩa từng flag — single source of truth cho cả FE và BE.
 *
 * Fields:
 *   - `key`              — id flag (unique).
 *   - `category`         — phân loại UI/telemetry.
 *   - `defaultEnabled`   — giá trị mặc định khi DB row chưa tồn tại / cache
 *                          lỗi. Phase 15.4 mọi flag default-true (fail-open
 *                          gameplay) — admin chủ động tắt khi cần.
 *   - `descriptionVi`    — mô tả ngắn cho admin UI (tiếng Việt).
 *   - `descriptionEn`    — mô tả ngắn cho admin UI (tiếng Anh).
 *   - `public`           — `true` nếu flag được expose qua
 *                          `GET /feature-flags/public` (FE đọc để gate UI).
 *                          Whitelist conservative — chỉ expose flag FE thật
 *                          sự cần biết.
 *   - `requiresRestart`  — `false` cho mọi flag Phase 15.4 (apply runtime
 *                          qua cache invalidate). Reserve cho 15.5+ nếu có
 *                          flag cần kill connection / restart worker.
 *   - `module`           — module chính chịu trách nhiệm gate (debug/audit).
 */
export interface FeatureFlagDef {
  readonly key: FeatureFlagKey;
  readonly category: FeatureFlagCategory;
  readonly defaultEnabled: boolean;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly public: boolean;
  readonly requiresRestart: boolean;
  readonly module: string;
}

export const FEATURE_FLAG_CATALOG: readonly FeatureFlagDef[] = [
  {
    key: 'ARENA_ENABLED',
    category: 'GAMEPLAY',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt toàn bộ Arena (challenge match, leaderboard).',
    descriptionEn: 'Enable/disable Arena (challenge match, leaderboard).',
    public: true,
    requiresRestart: false,
    module: 'arena',
  },
  {
    key: 'TRIBULATION_MINI_BATTLE_ENABLED',
    category: 'GAMEPLAY',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt Tribulation Mini-Battle (Phase 14.3.E).',
    descriptionEn: 'Enable/disable Tribulation Mini-Battle (Phase 14.3.E).',
    public: true,
    requiresRestart: false,
    module: 'character/tribulation',
  },
  {
    key: 'EQUIPMENT_REFORGE_ENABLED',
    category: 'GAMEPLAY',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt Equipment Reforge (đúc lại trang bị).',
    descriptionEn: 'Enable/disable Equipment Reforge.',
    public: true,
    requiresRestart: false,
    module: 'inventory',
  },
  {
    key: 'EQUIPMENT_ENCHANT_ENABLED',
    category: 'GAMEPLAY',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt Equipment Enchant (phụ chú trang bị).',
    descriptionEn: 'Enable/disable Equipment Enchant.',
    public: true,
    requiresRestart: false,
    module: 'inventory',
  },
  {
    key: 'LIVEOPS_EVENTS_ENABLED',
    category: 'LIVEOPS',
    defaultEnabled: true,
    descriptionVi:
      'Bật/tắt LiveOps Event Scheduler runtime (drop/exp/discount boost).',
    descriptionEn:
      'Enable/disable LiveOps Event Scheduler runtime modifiers.',
    public: true,
    requiresRestart: false,
    module: 'liveops-event-scheduler',
  },
  {
    key: 'LIVEOPS_FESTIVAL_GIFT_ENABLED',
    category: 'LIVEOPS',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt LiveOps Festival Gift claim (one-time reward).',
    descriptionEn: 'Enable/disable LiveOps Festival Gift claim.',
    public: true,
    requiresRestart: false,
    module: 'liveops-event-scheduler',
  },
  {
    key: 'LIVEOPS_ANNOUNCEMENTS_ENABLED',
    category: 'LIVEOPS',
    defaultEnabled: true,
    descriptionVi:
      'Bật/tắt LiveOps Announcement (banner/marquee + WS broadcast).',
    descriptionEn:
      'Enable/disable LiveOps Announcement (banner/marquee + WS broadcast).',
    public: true,
    requiresRestart: false,
    module: 'liveops-announcement',
  },
  {
    key: 'TERRITORY_WAR_ENABLED',
    category: 'GAMEPLAY',
    defaultEnabled: true,
    descriptionVi: 'Bật/tắt Territory War (sect war / contribute hooks).',
    descriptionEn: 'Enable/disable Territory War (sect war / contribute).',
    public: false,
    requiresRestart: false,
    module: 'territory',
  },
  {
    key: 'MARKET_ENABLED',
    category: 'ECONOMY',
    defaultEnabled: true,
    descriptionVi:
      'Bật/tắt Market (player listing/buy). Tắt = read-only nếu UI hỗ trợ.',
    descriptionEn:
      'Enable/disable Market (player listing/buy). Off = read-only when supported.',
    public: true,
    requiresRestart: false,
    module: 'market',
  },
  {
    key: 'SHOP_DISCOUNT_EVENTS_ENABLED',
    category: 'ECONOMY',
    defaultEnabled: true,
    descriptionVi:
      'Bật/tắt Shop discount runtime của LiveOps event (NPC shop).',
    descriptionEn:
      'Enable/disable LiveOps Shop discount runtime (NPC shop).',
    public: false,
    requiresRestart: false,
    module: 'shop',
  },
  {
    key: 'SECT_SHOP_DISCOUNT_EVENTS_ENABLED',
    category: 'ECONOMY',
    defaultEnabled: true,
    descriptionVi:
      'Bật/tắt Sect Shop discount runtime của LiveOps event.',
    descriptionEn:
      'Enable/disable LiveOps Sect Shop discount runtime.',
    public: false,
    requiresRestart: false,
    module: 'sect',
  },
] as const;

// Invariants validated trong test:
//   - `FEATURE_FLAG_CATALOG.length === FEATURE_FLAG_KEYS.length`.
//   - mỗi `key` trong catalog match `FEATURE_FLAG_KEYS`.
//   - mỗi `category` valid `FeatureFlagCategory`.
//   - `key` unique.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trả về definition của flag từ catalog. Throw nếu key không hợp lệ —
 * caller phải validate `isFeatureFlagKey` trước nếu key đến từ user input.
 */
export function getFeatureFlagDef(key: FeatureFlagKey): FeatureFlagDef {
  const def = FEATURE_FLAG_CATALOG.find((d) => d.key === key);
  if (!def) {
    throw new Error(`Feature flag definition missing for key: ${key}`);
  }
  return def;
}

/**
 * Trả về `defaultEnabled` cho flag — dùng khi DB row chưa tồn tại / cache
 * lỗi để fail-open hoặc fail-closed an toàn.
 */
export function getDefaultFeatureFlagEnabled(key: FeatureFlagKey): boolean {
  return getFeatureFlagDef(key).defaultEnabled;
}

/**
 * Whitelist các flag được expose qua `GET /feature-flags/public`.
 * Conservative — chỉ flag FE cần biết để gate UI client-side. Admin/SAFETY
 * flags KHÔNG bao giờ public (giảm bề mặt attack + tránh fingerprint).
 */
export const PUBLIC_FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] =
  FEATURE_FLAG_CATALOG.filter((d) => d.public).map((d) => d.key);

export function isPublicFeatureFlag(key: FeatureFlagKey): boolean {
  return getFeatureFlagDef(key).public;
}

// ---------------------------------------------------------------------------
// API contract types
// ---------------------------------------------------------------------------

/**
 * Admin view — full metadata cho admin panel `GET /admin/feature-flags`.
 */
export interface FeatureFlagAdminView {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
  readonly category: FeatureFlagCategory;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly public: boolean;
  readonly requiresRestart: boolean;
  readonly module: string;
  readonly defaultEnabled: boolean;
  readonly updatedByAdminId: string | null;
  readonly updatedAt: string | null;
}

/**
 * Public view — chỉ key + enabled, KHÔNG expose updatedByAdminId / module
 * / description (tiết kiệm bandwidth + giảm fingerprint).
 */
export interface FeatureFlagPublicView {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
}

/**
 * Error code thống nhất cho runtime gate. Service runtime throw error này
 * khi flag off → controller map 503 Service Unavailable + body
 * `{ error: 'FEATURE_DISABLED', flag: <key> }`.
 *
 * Tại sao 503 thay vì 403:
 *   - 403 = "bạn không có quyền" — sai semantics, đây là tính năng tạm tắt.
 *   - 503 = "service unavailable temporary" — đúng UX (FE có thể retry sau).
 *   - FE map error code → message i18n "Tính năng đang tạm tắt để bảo trì".
 */
export const FEATURE_DISABLED_ERROR_CODE = 'FEATURE_DISABLED' as const;
