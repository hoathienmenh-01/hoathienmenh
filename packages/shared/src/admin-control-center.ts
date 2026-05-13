/**
 * Phase 27.6 — Admin Control Center V2 / Config-Driven LiveOps Admin (catalog).
 *
 * Mở rộng admin foundation (Phase 18.x AdminAuditLog, Phase 15.4 FeatureFlag,
 * Phase 15.5 MaintenanceWindow, Phase 15.6 ConfigVersion, Phase 13.1.B
 * AdminLiveOps, Phase 16.6 AdminEconomySafety) bằng **catalog quyền hạn**
 * và **validator config-driven** để admin vận hành game thật mà không
 * cần sửa code cho thay đổi thường ngày.
 *
 * Module này **pure** — không có I/O, không import Prisma, không phụ thuộc
 * NestJS. Caller (admin-control-center module API + Vue admin views)
 * import constants + helpers ở đây.
 *
 * Triết lý (theo spec Phase 27.6):
 *   - Admin có quyền **bật/tắt content** + **chỉnh lịch** + **chỉnh
 *     reward profile** + **chỉnh drop profile** — TẤT CẢ có validator
 *     server-authoritative chặn cấu hình phá kinh tế.
 *   - Admin KHÔNG có quyền sửa **logic lõi** (combat / power / breakthrough
 *     / alchemy / tower scaling / ledger / anti-cheat / transaction).
 *   - Mọi mutation admin phải ghi `AdminAuditLog` với
 *     `permissionKey` + `riskLevel` + `reason`. Action `HIGH`/`CRITICAL`
 *     cần `confirmText`.
 *   - Per-role limit cho currency adjust + item grant để chặn
 *     SUPPORT_ADMIN cộng/trừ vô hạn.
 *   - Reward / Drop profile validator chặn:
 *       * quantity âm / NaN / vô hạn.
 *       * tier leak (sourceTier T1 rơi reward T9).
 *       * forbidden endgame item (pháp bảo top / công pháp chí tôn /
 *         trang bị huyền thoại trực tiếp).
 *       * Tiên Ngọc nạp grant ngoài flow hợp lệ.
 *       * weekly cap thiếu cho rare material.
 *
 * Phase 27.6 PR foundation gồm:
 *   1. 7 `AdminRole` + 24 `AdminPermission` + role→permissions map.
 *   2. ~25 `AdminActionType` + `RiskLevel` cho audit log.
 *   3. Per-role currency adjust + item grant limits (daily/per-action cap).
 *   4. Forbidden grant item set (extends Phase 27.1–27.5
 *      `FORBIDDEN_REWARD_ITEM_KEYS`).
 *   5. `RewardProfileSpec` + `validateRewardProfile` (anti-P2W).
 *   6. `DropProfileSpec` + `validateDropProfile` + `simulateDropProfile`
 *      (deterministic mô phỏng 1k/10k/100k để admin xem expected vs leak).
 *   7. `ContentStatusSpec` + 15 content type (FARM_MAP, DUNGEON, BOSS,
 *      TRIAL_TOWER, SECT_*, QUEST, NPC, ITEM, METHOD, ARTIFACT, …).
 */

import { FORBIDDEN_REWARD_ITEM_KEYS } from './monetization-systems';

// ---------------------------------------------------------------------------
// 1. Admin roles
// ---------------------------------------------------------------------------

/**
 * Theo spec Phase 27.6 §1. 7 role admin với chuyên môn rõ ràng để chặn
 * SUPPORT cộng tiền lớn, MODERATOR chạm event scheduler, QA_ADMIN bật
 * action production nguy hiểm.
 *
 * Mapping vào `User.role` (Prisma enum `Role = PLAYER|MOD|ADMIN`) hiện
 * tại:
 *   - PLAYER → không có quyền admin.
 *   - MOD    → mapping động qua `AdminPermission` mặc định cho
 *     `MODERATOR` (chat/report/mute/ban nhẹ).
 *   - ADMIN  → mapping động — admin được gán 1 trong 6 role admin V2.
 *     Mặc định `SUPER_ADMIN` (back-compat với guard cũ).
 *
 * Phase 27.6 KHÔNG tạo Prisma enum riêng để tránh phá migration; gán
 * AdminRole V2 cho User.role=ADMIN qua `AdminRoleAssignment` model (sẽ
 * thêm trong PR riêng nếu cần per-user gán). PR foundation chỉ cung cấp
 * pure constants + matrix + helper.
 */
export type AdminRoleKey =
  | 'SUPER_ADMIN'
  | 'OPERATIONS_ADMIN'
  | 'ECONOMY_ADMIN'
  | 'CONTENT_ADMIN'
  | 'SUPPORT_ADMIN'
  | 'MODERATOR'
  | 'QA_ADMIN';

export const ADMIN_ROLE_KEYS: readonly AdminRoleKey[] = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'ECONOMY_ADMIN',
  'CONTENT_ADMIN',
  'SUPPORT_ADMIN',
  'MODERATOR',
  'QA_ADMIN',
] as const;

export function isAdminRoleKey(s: unknown): s is AdminRoleKey {
  return typeof s === 'string' && (ADMIN_ROLE_KEYS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// 2. Admin permissions
// ---------------------------------------------------------------------------

/**
 * Theo spec Phase 27.6 §1 (24 permission key). Mỗi endpoint admin nguy
 * hiểm phải decor `@RequireAdminPermission(<key>)` để bảo vệ
 * fine-grained — không dùng một `@RequireAdmin` chung cho mọi route
 * nguy hiểm.
 */
export type AdminPermissionKey =
  | 'ADMIN_VIEW_DASHBOARD'
  | 'ADMIN_VIEW_PLAYERS'
  | 'ADMIN_EDIT_PLAYER_SUPPORT'
  | 'ADMIN_ADJUST_CURRENCY'
  | 'ADMIN_GRANT_ITEM'
  | 'ADMIN_REVOKE_ITEM'
  | 'ADMIN_VIEW_LEDGER'
  | 'ADMIN_MANAGE_SHOP'
  | 'ADMIN_MANAGE_MONTHLY_CARD'
  | 'ADMIN_MANAGE_BATTLE_PASS'
  | 'ADMIN_MANAGE_GROWTH_FUND'
  | 'ADMIN_MANAGE_FEATURE_FLAGS'
  | 'ADMIN_MANAGE_GAME_CONFIG'
  | 'ADMIN_MANAGE_REWARD_PROFILE'
  | 'ADMIN_MANAGE_DROP_PROFILE'
  | 'ADMIN_MANAGE_MAPS'
  | 'ADMIN_MANAGE_DUNGEONS'
  | 'ADMIN_MANAGE_BOSSES'
  | 'ADMIN_MANAGE_TOWERS'
  | 'ADMIN_MANAGE_SECT_CONTENT'
  | 'ADMIN_MANAGE_EVENTS'
  | 'ADMIN_MANAGE_PVP'
  | 'ADMIN_MANAGE_MAINTENANCE'
  | 'ADMIN_MANAGE_ANNOUNCEMENT'
  /* Phase 30.0 / 32.0 — Market V2 + Codex. */
  | 'ADMIN_MANAGE_MARKET'
  | 'ADMIN_MANAGE_CODEX'
  /* Phase 35.0 — Pet / Linh Thú. */
  | 'ADMIN_MANAGE_PETS'
  | 'ADMIN_VIEW_ANTI_CHEAT'
  | 'ADMIN_RESOLVE_ANTI_CHEAT'
  | 'ADMIN_MODERATE_CHAT'
  | 'ADMIN_BAN_USER'
  | 'ADMIN_MUTE_USER'
  | 'ADMIN_RUN_DEV_TOOLS';

export const ADMIN_PERMISSION_KEYS: readonly AdminPermissionKey[] = [
  'ADMIN_VIEW_DASHBOARD',
  'ADMIN_VIEW_PLAYERS',
  'ADMIN_EDIT_PLAYER_SUPPORT',
  'ADMIN_ADJUST_CURRENCY',
  'ADMIN_GRANT_ITEM',
  'ADMIN_REVOKE_ITEM',
  'ADMIN_VIEW_LEDGER',
  'ADMIN_MANAGE_SHOP',
  'ADMIN_MANAGE_MONTHLY_CARD',
  'ADMIN_MANAGE_BATTLE_PASS',
  'ADMIN_MANAGE_GROWTH_FUND',
  'ADMIN_MANAGE_FEATURE_FLAGS',
  'ADMIN_MANAGE_GAME_CONFIG',
  'ADMIN_MANAGE_REWARD_PROFILE',
  'ADMIN_MANAGE_DROP_PROFILE',
  'ADMIN_MANAGE_MAPS',
  'ADMIN_MANAGE_DUNGEONS',
  'ADMIN_MANAGE_BOSSES',
  'ADMIN_MANAGE_TOWERS',
  'ADMIN_MANAGE_SECT_CONTENT',
  'ADMIN_MANAGE_EVENTS',
  'ADMIN_MANAGE_PVP',
  'ADMIN_MANAGE_MAINTENANCE',
  'ADMIN_MANAGE_ANNOUNCEMENT',
  'ADMIN_MANAGE_MARKET',
  'ADMIN_MANAGE_CODEX',
  'ADMIN_MANAGE_PETS',
  'ADMIN_VIEW_ANTI_CHEAT',
  'ADMIN_RESOLVE_ANTI_CHEAT',
  'ADMIN_MODERATE_CHAT',
  'ADMIN_BAN_USER',
  'ADMIN_MUTE_USER',
  'ADMIN_RUN_DEV_TOOLS',
] as const;

export function isAdminPermissionKey(s: unknown): s is AdminPermissionKey {
  return (
    typeof s === 'string' &&
    (ADMIN_PERMISSION_KEYS as readonly string[]).includes(s)
  );
}

// ---------------------------------------------------------------------------
// 3. Role → permissions matrix (Phase 27.6 §1 spec)
// ---------------------------------------------------------------------------

/**
 * Permission matrix. SUPER_ADMIN ⊇ tất cả. MODERATOR chỉ
 * chat/ban/mute/view dashboard. QA_ADMIN có dev-tool + dashboard nhưng
 * KHÔNG có currency / item / monetization production.
 */
export const ADMIN_ROLE_PERMISSIONS: Readonly<
  Record<AdminRoleKey, readonly AdminPermissionKey[]>
> = {
  SUPER_ADMIN: [...ADMIN_PERMISSION_KEYS],
  OPERATIONS_ADMIN: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_VIEW_LEDGER',
    'ADMIN_MANAGE_FEATURE_FLAGS',
    'ADMIN_MANAGE_GAME_CONFIG',
    'ADMIN_MANAGE_EVENTS',
    'ADMIN_MANAGE_PVP',
    'ADMIN_MANAGE_MAINTENANCE',
    'ADMIN_MANAGE_ANNOUNCEMENT',
    'ADMIN_MANAGE_BOSSES',
    'ADMIN_MANAGE_MARKET',
    'ADMIN_MANAGE_CODEX',
    'ADMIN_MANAGE_PETS',
    'ADMIN_VIEW_ANTI_CHEAT',
  ],
  ECONOMY_ADMIN: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_VIEW_LEDGER',
    'ADMIN_ADJUST_CURRENCY',
    'ADMIN_GRANT_ITEM',
    'ADMIN_REVOKE_ITEM',
    'ADMIN_MANAGE_SHOP',
    'ADMIN_MANAGE_MONTHLY_CARD',
    'ADMIN_MANAGE_BATTLE_PASS',
    'ADMIN_MANAGE_GROWTH_FUND',
    'ADMIN_MANAGE_REWARD_PROFILE',
    'ADMIN_MANAGE_DROP_PROFILE',
    'ADMIN_MANAGE_MARKET',
  ],
  CONTENT_ADMIN: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_MANAGE_MAPS',
    'ADMIN_MANAGE_DUNGEONS',
    'ADMIN_MANAGE_BOSSES',
    'ADMIN_MANAGE_TOWERS',
    'ADMIN_MANAGE_SECT_CONTENT',
    'ADMIN_MANAGE_GAME_CONFIG',
    'ADMIN_MANAGE_CODEX',
  ],
  SUPPORT_ADMIN: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_EDIT_PLAYER_SUPPORT',
    'ADMIN_VIEW_LEDGER',
    // SUPPORT có thể grant nhỏ qua per-role limit dưới
    'ADMIN_ADJUST_CURRENCY',
    'ADMIN_GRANT_ITEM',
  ],
  MODERATOR: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_MODERATE_CHAT',
    'ADMIN_MUTE_USER',
    'ADMIN_BAN_USER',
  ],
  QA_ADMIN: [
    'ADMIN_VIEW_DASHBOARD',
    'ADMIN_VIEW_PLAYERS',
    'ADMIN_RUN_DEV_TOOLS',
    'ADMIN_VIEW_ANTI_CHEAT',
  ],
};

export function getPermissionsForRole(
  role: AdminRoleKey,
): readonly AdminPermissionKey[] {
  return ADMIN_ROLE_PERMISSIONS[role];
}

export function hasAdminPermission(
  role: AdminRoleKey,
  perm: AdminPermissionKey,
): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(perm);
}

// ---------------------------------------------------------------------------
// 4. Action types + risk levels (audit log)
// ---------------------------------------------------------------------------

export type AdminActionType =
  | 'CONFIG_UPDATE'
  | 'FEATURE_FLAG_UPDATE'
  | 'PLAYER_SUPPORT_RESET'
  | 'CURRENCY_ADJUST'
  | 'ITEM_GRANT'
  | 'ITEM_REVOKE'
  | 'SHOP_UPDATE'
  | 'MONTHLY_CARD_UPDATE'
  | 'BATTLE_PASS_UPDATE'
  | 'GROWTH_FUND_UPDATE'
  | 'REWARD_PROFILE_UPDATE'
  | 'REWARD_PROFILE_ACTIVATE'
  | 'REWARD_PROFILE_ROLLBACK'
  | 'DROP_PROFILE_UPDATE'
  | 'DROP_PROFILE_ACTIVATE'
  | 'DROP_PROFILE_ROLLBACK'
  | 'CONTENT_ENABLE'
  | 'CONTENT_DISABLE'
  | 'CONTENT_PAUSE'
  | 'BOSS_PAUSE'
  | 'BOSS_RESET'
  | 'TOWER_SEASON_RESET'
  | 'RANKING_LOCK'
  | 'REFUND'
  | 'BAN_USER'
  | 'MUTE_USER'
  | 'ANTI_CHEAT_RESOLVE'
  | 'MAINTENANCE_START'
  | 'MAINTENANCE_END'
  | 'ANNOUNCEMENT_PUBLISH'
  /* Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2. */
  | 'EVENT_CREATE'
  | 'EVENT_UPDATE'
  | 'EVENT_DELETE'
  | 'EVENT_ACTIVATE'
  | 'EVENT_PAUSE'
  | 'EVENT_LOCK_REWARDS'
  | 'EVENT_FINALIZE'
  | 'EVENT_ARCHIVE'
  | 'EVENT_CANCEL'
  | 'EVENT_BRACKET_UPSERT'
  | 'EVENT_BALANCE_UPSERT'
  | 'EVENT_ITEM_UPSERT'
  | 'EVENT_MISSION_UPSERT'
  | 'EVENT_SHOP_UPSERT'
  | 'EVENT_BOSS_UPSERT'
  | 'EVENT_RANKING_UPSERT'
  | 'EVENT_RANKING_LOCK'
  | 'EVENT_PERSONAL_UPSERT'
  /* Phase 29.0 — PvP Foundation, Arena, Sect War & Territory V1. */
  | 'PVP_FEATURE_FLAG_UPDATE'
  | 'PVP_ANTICHEAT_RESOLVE'
  | 'PVP_BATTLE_INVALIDATE'
  | 'ARENA_SEASON_CREATE'
  | 'ARENA_SEASON_UPDATE'
  | 'ARENA_SEASON_ACTIVATE'
  | 'ARENA_SEASON_FINALIZE'
  | 'ARENA_SEASON_LOCK_REWARDS'
  | 'ARENA_RANKING_LOCK'
  | 'ARENA_REWARD_ROLLBACK'
  | 'SECT_WAR_SEASON_CREATE'
  | 'SECT_WAR_SEASON_UPDATE'
  | 'SECT_WAR_SEASON_ACTIVATE'
  | 'SECT_WAR_SEASON_FINALIZE'
  | 'SECT_WAR_MATCH_LOCK'
  | 'SECT_WAR_MATCH_RESOLVE'
  | 'TERRITORY_UPSERT'
  | 'TERRITORY_ENABLE'
  | 'TERRITORY_DISABLE'
  | 'TERRITORY_RESET_OWNER'
  /* Phase 30.0 — Market V2 / Auction / Sect Treasury / Anti-abuse audit. */
  | 'MARKET_LISTING_LOCK'
  | 'MARKET_LISTING_CANCEL'
  | 'MARKET_AUCTION_LOCK'
  | 'MARKET_AUCTION_CANCEL'
  | 'MARKET_REFUND'
  | 'MARKET_FEE_CONFIG_UPDATE'
  | 'MARKET_ITEM_POLICY_LOCK'
  | 'MARKET_ITEM_POLICY_UNLOCK'
  | 'MARKET_ANOMALY_RESOLVE'
  | 'SECT_TREASURY_LOCK'
  | 'SECT_TREASURY_FORCE_WITHDRAW'
  /* Phase 32.0 — Codex / Bestiary / Guidebook audit. */
  | 'CODEX_REINDEX'
  | 'CODEX_ENTRY_UPDATE'
  | 'CODEX_ENTRY_HIDE'
  | 'CODEX_ENTRY_SHOW'
  | 'CODEX_AUDIT_RESOLVE'
  /* Phase 35.0 — Pet / Linh Thú admin audit. */
  | 'PET_GRANT'
  | 'PET_REVOKE'
  | 'PET_LEVEL_ADJUST'
  | 'PET_STAR_ADJUST'
  | 'PET_EVOLUTION_ADJUST'
  | 'PET_SHARD_ADJUST'
  | 'PET_BOX_RATE_VIEW'
  | 'PET_BOX_LOG_VIEW'
  | 'PET_PITY_RESET'
  | 'PET_LOCK_FORCE'
  | 'PET_UNLOCK_FORCE'
  | 'PET_RENAME_FORCE'
  | 'PET_EQUIP_FORCE'
  | 'PET_UNEQUIP_FORCE'
  | 'PET_SKILL_LEVEL_ADJUST';

export const ADMIN_ACTION_TYPES: readonly AdminActionType[] = [
  'CONFIG_UPDATE',
  'FEATURE_FLAG_UPDATE',
  'PLAYER_SUPPORT_RESET',
  'CURRENCY_ADJUST',
  'ITEM_GRANT',
  'ITEM_REVOKE',
  'SHOP_UPDATE',
  'MONTHLY_CARD_UPDATE',
  'BATTLE_PASS_UPDATE',
  'GROWTH_FUND_UPDATE',
  'REWARD_PROFILE_UPDATE',
  'REWARD_PROFILE_ACTIVATE',
  'REWARD_PROFILE_ROLLBACK',
  'DROP_PROFILE_UPDATE',
  'DROP_PROFILE_ACTIVATE',
  'DROP_PROFILE_ROLLBACK',
  'CONTENT_ENABLE',
  'CONTENT_DISABLE',
  'CONTENT_PAUSE',
  'BOSS_PAUSE',
  'BOSS_RESET',
  'TOWER_SEASON_RESET',
  'RANKING_LOCK',
  'REFUND',
  'BAN_USER',
  'MUTE_USER',
  'ANTI_CHEAT_RESOLVE',
  'MAINTENANCE_START',
  'MAINTENANCE_END',
  'ANNOUNCEMENT_PUBLISH',
  /* Phase 28.0 — Event Builder action audit. */
  'EVENT_CREATE',
  'EVENT_UPDATE',
  'EVENT_DELETE',
  'EVENT_ACTIVATE',
  'EVENT_PAUSE',
  'EVENT_LOCK_REWARDS',
  'EVENT_FINALIZE',
  'EVENT_ARCHIVE',
  'EVENT_CANCEL',
  'EVENT_BRACKET_UPSERT',
  'EVENT_BALANCE_UPSERT',
  'EVENT_ITEM_UPSERT',
  'EVENT_MISSION_UPSERT',
  'EVENT_SHOP_UPSERT',
  'EVENT_BOSS_UPSERT',
  'EVENT_RANKING_UPSERT',
  'EVENT_RANKING_LOCK',
  'EVENT_PERSONAL_UPSERT',
  /* Phase 29.0 — PvP / Arena / Sect War / Territory audit. */
  'PVP_FEATURE_FLAG_UPDATE',
  'PVP_ANTICHEAT_RESOLVE',
  'PVP_BATTLE_INVALIDATE',
  'ARENA_SEASON_CREATE',
  'ARENA_SEASON_UPDATE',
  'ARENA_SEASON_ACTIVATE',
  'ARENA_SEASON_FINALIZE',
  'ARENA_SEASON_LOCK_REWARDS',
  'ARENA_RANKING_LOCK',
  'ARENA_REWARD_ROLLBACK',
  'SECT_WAR_SEASON_CREATE',
  'SECT_WAR_SEASON_UPDATE',
  'SECT_WAR_SEASON_ACTIVATE',
  'SECT_WAR_SEASON_FINALIZE',
  'SECT_WAR_MATCH_LOCK',
  'SECT_WAR_MATCH_RESOLVE',
  'TERRITORY_UPSERT',
  'TERRITORY_ENABLE',
  'TERRITORY_DISABLE',
  'TERRITORY_RESET_OWNER',
  /* Phase 30.0 — Market V2 audit. */
  'MARKET_LISTING_LOCK',
  'MARKET_LISTING_CANCEL',
  'MARKET_AUCTION_LOCK',
  'MARKET_AUCTION_CANCEL',
  'MARKET_REFUND',
  'MARKET_FEE_CONFIG_UPDATE',
  'MARKET_ITEM_POLICY_LOCK',
  'MARKET_ITEM_POLICY_UNLOCK',
  'MARKET_ANOMALY_RESOLVE',
  'SECT_TREASURY_LOCK',
  'SECT_TREASURY_FORCE_WITHDRAW',
  /* Phase 32.0 — Codex audit. */
  'CODEX_REINDEX',
  'CODEX_ENTRY_UPDATE',
  'CODEX_ENTRY_HIDE',
  'CODEX_ENTRY_SHOW',
  'CODEX_AUDIT_RESOLVE',
  /* Phase 35.0 — Pet / Linh Thú audit. */
  'PET_GRANT',
  'PET_REVOKE',
  'PET_LEVEL_ADJUST',
  'PET_STAR_ADJUST',
  'PET_EVOLUTION_ADJUST',
  'PET_SHARD_ADJUST',
  'PET_BOX_RATE_VIEW',
  'PET_BOX_LOG_VIEW',
  'PET_PITY_RESET',
  'PET_LOCK_FORCE',
  'PET_UNLOCK_FORCE',
  'PET_RENAME_FORCE',
  'PET_EQUIP_FORCE',
  'PET_UNEQUIP_FORCE',
  'PET_SKILL_LEVEL_ADJUST',
] as const;

export function isAdminActionType(s: unknown): s is AdminActionType {
  return (
    typeof s === 'string' &&
    (ADMIN_ACTION_TYPES as readonly string[]).includes(s)
  );
}

export type AdminRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const ADMIN_RISK_LEVELS: readonly AdminRiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export function isAdminRiskLevel(s: unknown): s is AdminRiskLevel {
  return (
    typeof s === 'string' &&
    (ADMIN_RISK_LEVELS as readonly string[]).includes(s)
  );
}

/**
 * Mapping mặc định actionType → riskLevel. Audit writer dùng default
 * này nếu caller không override. Default = mức bảo thủ (BAN_USER /
 * REWARD_PROFILE_ACTIVATE = HIGH ngay cả khi delta nhỏ, vì ảnh hưởng
 * tài sản/kinh tế).
 */
export const DEFAULT_ACTION_RISK: Readonly<Record<AdminActionType, AdminRiskLevel>> = {
  CONFIG_UPDATE: 'MEDIUM',
  FEATURE_FLAG_UPDATE: 'MEDIUM',
  PLAYER_SUPPORT_RESET: 'LOW',
  CURRENCY_ADJUST: 'HIGH',
  ITEM_GRANT: 'HIGH',
  ITEM_REVOKE: 'HIGH',
  SHOP_UPDATE: 'HIGH',
  MONTHLY_CARD_UPDATE: 'HIGH',
  BATTLE_PASS_UPDATE: 'HIGH',
  GROWTH_FUND_UPDATE: 'HIGH',
  REWARD_PROFILE_UPDATE: 'MEDIUM',
  REWARD_PROFILE_ACTIVATE: 'HIGH',
  REWARD_PROFILE_ROLLBACK: 'HIGH',
  DROP_PROFILE_UPDATE: 'MEDIUM',
  DROP_PROFILE_ACTIVATE: 'HIGH',
  DROP_PROFILE_ROLLBACK: 'HIGH',
  CONTENT_ENABLE: 'MEDIUM',
  CONTENT_DISABLE: 'MEDIUM',
  CONTENT_PAUSE: 'MEDIUM',
  BOSS_PAUSE: 'MEDIUM',
  BOSS_RESET: 'HIGH',
  TOWER_SEASON_RESET: 'CRITICAL',
  RANKING_LOCK: 'HIGH',
  REFUND: 'HIGH',
  BAN_USER: 'HIGH',
  MUTE_USER: 'MEDIUM',
  ANTI_CHEAT_RESOLVE: 'MEDIUM',
  MAINTENANCE_START: 'CRITICAL',
  MAINTENANCE_END: 'HIGH',
  ANNOUNCEMENT_PUBLISH: 'LOW',
  /* Phase 28.0 — Event Builder default risk. */
  EVENT_CREATE: 'MEDIUM',
  EVENT_UPDATE: 'MEDIUM',
  EVENT_DELETE: 'HIGH',
  EVENT_ACTIVATE: 'HIGH',
  EVENT_PAUSE: 'MEDIUM',
  EVENT_LOCK_REWARDS: 'HIGH',
  EVENT_FINALIZE: 'HIGH',
  EVENT_ARCHIVE: 'LOW',
  EVENT_CANCEL: 'HIGH',
  EVENT_BRACKET_UPSERT: 'MEDIUM',
  EVENT_BALANCE_UPSERT: 'HIGH',
  EVENT_ITEM_UPSERT: 'MEDIUM',
  EVENT_MISSION_UPSERT: 'MEDIUM',
  EVENT_SHOP_UPSERT: 'MEDIUM',
  EVENT_BOSS_UPSERT: 'MEDIUM',
  EVENT_RANKING_UPSERT: 'MEDIUM',
  EVENT_RANKING_LOCK: 'HIGH',
  EVENT_PERSONAL_UPSERT: 'MEDIUM',
  /* Phase 29.0 — PvP / Arena / Sect War / Territory risk. */
  PVP_FEATURE_FLAG_UPDATE: 'HIGH',
  PVP_ANTICHEAT_RESOLVE: 'MEDIUM',
  PVP_BATTLE_INVALIDATE: 'HIGH',
  ARENA_SEASON_CREATE: 'MEDIUM',
  ARENA_SEASON_UPDATE: 'MEDIUM',
  ARENA_SEASON_ACTIVATE: 'HIGH',
  ARENA_SEASON_FINALIZE: 'HIGH',
  ARENA_SEASON_LOCK_REWARDS: 'HIGH',
  ARENA_RANKING_LOCK: 'HIGH',
  ARENA_REWARD_ROLLBACK: 'CRITICAL',
  SECT_WAR_SEASON_CREATE: 'MEDIUM',
  SECT_WAR_SEASON_UPDATE: 'MEDIUM',
  SECT_WAR_SEASON_ACTIVATE: 'HIGH',
  SECT_WAR_SEASON_FINALIZE: 'HIGH',
  SECT_WAR_MATCH_LOCK: 'HIGH',
  SECT_WAR_MATCH_RESOLVE: 'HIGH',
  TERRITORY_UPSERT: 'MEDIUM',
  TERRITORY_ENABLE: 'MEDIUM',
  TERRITORY_DISABLE: 'MEDIUM',
  TERRITORY_RESET_OWNER: 'HIGH',
  /* Phase 30.0 — Market V2 default risk. */
  MARKET_LISTING_LOCK: 'MEDIUM',
  MARKET_LISTING_CANCEL: 'MEDIUM',
  MARKET_AUCTION_LOCK: 'HIGH',
  MARKET_AUCTION_CANCEL: 'HIGH',
  MARKET_REFUND: 'HIGH',
  MARKET_FEE_CONFIG_UPDATE: 'HIGH',
  MARKET_ITEM_POLICY_LOCK: 'MEDIUM',
  MARKET_ITEM_POLICY_UNLOCK: 'MEDIUM',
  MARKET_ANOMALY_RESOLVE: 'MEDIUM',
  SECT_TREASURY_LOCK: 'MEDIUM',
  SECT_TREASURY_FORCE_WITHDRAW: 'HIGH',
  /* Phase 32.0 — Codex default risk. */
  CODEX_REINDEX: 'MEDIUM',
  CODEX_ENTRY_UPDATE: 'LOW',
  CODEX_ENTRY_HIDE: 'LOW',
  CODEX_ENTRY_SHOW: 'LOW',
  CODEX_AUDIT_RESOLVE: 'LOW',
  /* Phase 35.0 — Pet / Linh Thú default risk. */
  PET_GRANT: 'HIGH',
  PET_REVOKE: 'HIGH',
  PET_LEVEL_ADJUST: 'MEDIUM',
  PET_STAR_ADJUST: 'MEDIUM',
  PET_EVOLUTION_ADJUST: 'HIGH',
  PET_SHARD_ADJUST: 'MEDIUM',
  PET_BOX_RATE_VIEW: 'LOW',
  PET_BOX_LOG_VIEW: 'LOW',
  PET_PITY_RESET: 'HIGH',
  PET_LOCK_FORCE: 'LOW',
  PET_UNLOCK_FORCE: 'LOW',
  PET_RENAME_FORCE: 'LOW',
  PET_EQUIP_FORCE: 'LOW',
  PET_UNEQUIP_FORCE: 'LOW',
  PET_SKILL_LEVEL_ADJUST: 'MEDIUM',
};

export function defaultRiskFor(action: AdminActionType): AdminRiskLevel {
  return DEFAULT_ACTION_RISK[action];
}

/**
 * Action `HIGH`/`CRITICAL` cần `confirmText` (admin gõ confirm string)
 * để chặn click nhầm. Helper trả về `true` nếu cần.
 */
export function actionRequiresConfirmation(risk: AdminRiskLevel): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}

// ---------------------------------------------------------------------------
// 5. Per-role currency adjust + item grant limits
// ---------------------------------------------------------------------------

/**
 * Spec Phase 27.6 §6: chặn SUPPORT cộng/trừ tiền lớn. Per-role cap (đơn
 * vị positive integer, áp cho `abs(amount)`). Currency âm sai hướng
 * (revoke nhưng amount dương cho ITEM_REVOKE, hoặc grant Tiên Ngọc nạp
 * bằng SUPPORT) đều fail.
 */
export type AdminCurrencyKey =
  | 'LINH_THACH'
  | 'TIEN_NGOC'
  | 'TIEN_NGOC_KHOA'
  | 'TRIAL_POINT'
  | 'EVENT_TOKEN'
  | 'CONG_HIEN_TONG_MON';

export const ADMIN_CURRENCY_KEYS: readonly AdminCurrencyKey[] = [
  'LINH_THACH',
  'TIEN_NGOC',
  'TIEN_NGOC_KHOA',
  'TRIAL_POINT',
  'EVENT_TOKEN',
  'CONG_HIEN_TONG_MON',
] as const;

export function isAdminCurrencyKey(s: unknown): s is AdminCurrencyKey {
  return (
    typeof s === 'string' && (ADMIN_CURRENCY_KEYS as readonly string[]).includes(s)
  );
}

/**
 * Tier cap per role × currency (tuyệt đối, mỗi action). Số 0 = role
 * KHÔNG được phép adjust currency này (e.g. SUPPORT không được động
 * Tiên Ngọc nạp).
 */
export const ADMIN_CURRENCY_ADJUST_LIMIT: Readonly<
  Record<AdminRoleKey, Record<AdminCurrencyKey, number>>
> = {
  SUPER_ADMIN: {
    LINH_THACH: 1_000_000_000,
    TIEN_NGOC: 1_000_000,
    TIEN_NGOC_KHOA: 1_000_000,
    TRIAL_POINT: 1_000_000,
    EVENT_TOKEN: 1_000_000,
    CONG_HIEN_TONG_MON: 1_000_000,
  },
  OPERATIONS_ADMIN: {
    LINH_THACH: 10_000_000,
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 100_000,
    TRIAL_POINT: 100_000,
    EVENT_TOKEN: 100_000,
    CONG_HIEN_TONG_MON: 100_000,
  },
  ECONOMY_ADMIN: {
    LINH_THACH: 100_000_000,
    TIEN_NGOC: 100_000,
    TIEN_NGOC_KHOA: 1_000_000,
    TRIAL_POINT: 1_000_000,
    EVENT_TOKEN: 1_000_000,
    CONG_HIEN_TONG_MON: 1_000_000,
  },
  CONTENT_ADMIN: {
    LINH_THACH: 0,
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 0,
    TRIAL_POINT: 0,
    EVENT_TOKEN: 0,
    CONG_HIEN_TONG_MON: 0,
  },
  SUPPORT_ADMIN: {
    LINH_THACH: 100_000,
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 10_000,
    TRIAL_POINT: 10_000,
    EVENT_TOKEN: 10_000,
    CONG_HIEN_TONG_MON: 10_000,
  },
  MODERATOR: {
    LINH_THACH: 0,
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 0,
    TRIAL_POINT: 0,
    EVENT_TOKEN: 0,
    CONG_HIEN_TONG_MON: 0,
  },
  QA_ADMIN: {
    LINH_THACH: 0,
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 0,
    TRIAL_POINT: 0,
    EVENT_TOKEN: 0,
    CONG_HIEN_TONG_MON: 0,
  },
};

/**
 * Tier cap per role × kind cho item grant. `forbidden` (boolean) =
 * không được grant item nằm trong `ADMIN_FORBIDDEN_GRANT_ITEMS`. Số 0 =
 * role KHÔNG grant được item nào.
 */
export const ADMIN_ITEM_GRANT_LIMIT: Readonly<
  Record<AdminRoleKey, { qtyPerAction: number; allowForbidden: boolean }>
> = {
  SUPER_ADMIN: { qtyPerAction: 999, allowForbidden: true },
  OPERATIONS_ADMIN: { qtyPerAction: 0, allowForbidden: false },
  ECONOMY_ADMIN: { qtyPerAction: 99, allowForbidden: false },
  CONTENT_ADMIN: { qtyPerAction: 0, allowForbidden: false },
  SUPPORT_ADMIN: { qtyPerAction: 10, allowForbidden: false },
  MODERATOR: { qtyPerAction: 0, allowForbidden: false },
  QA_ADMIN: { qtyPerAction: 0, allowForbidden: false },
};

/**
 * Item KHÔNG được phép grant qua admin support tool. Mở rộng
 * `FORBIDDEN_REWARD_ITEM_KEYS` (Phase 27.1–27.5) cộng thêm các
 * artifact/method endgame. SUPER_ADMIN có thể bypass nếu set
 * `allowForbidden=true` (cần `riskLevel=CRITICAL` + confirmText).
 */
export const ADMIN_FORBIDDEN_GRANT_ITEMS: ReadonlySet<string> = new Set([
  ...FORBIDDEN_REWARD_ITEM_KEYS,
  // Pháp bảo cấp cao (Phase 23.5+ T8/T9)
  'phap_bao_tien_huyen_kiem',
  'phap_bao_huyen_thien_an',
  // Pháp bảo material endgame
  'PHAP_BAO_FRAGMENT_T9',
  // Công pháp top hoàn chỉnh
  'METHOD_TIEN_THUONG',
  'METHOD_THIEN_TIEN',
]);

export function isForbiddenAdminGrantItem(itemKey: string): boolean {
  return ADMIN_FORBIDDEN_GRANT_ITEMS.has(itemKey);
}

export type AdminGrantValidationError =
  | 'AMOUNT_NOT_INTEGER'
  | 'AMOUNT_ZERO'
  | 'AMOUNT_NOT_FINITE'
  | 'CURRENCY_UNSUPPORTED'
  | 'CURRENCY_NOT_ALLOWED_FOR_ROLE'
  | 'CURRENCY_AMOUNT_OVER_LIMIT'
  | 'QTY_NOT_POSITIVE_INTEGER'
  | 'QTY_OVER_LIMIT'
  | 'ITEM_FORBIDDEN'
  | 'ITEM_FORBIDDEN_FOR_ROLE'
  | 'REASON_REQUIRED'
  | 'CONFIRM_TEXT_REQUIRED';

export interface AdminCurrencyAdjustInput {
  role: AdminRoleKey;
  currency: AdminCurrencyKey | string;
  amount: number;
  reason: string;
  confirmText?: string;
}

/**
 * Validate hard limits cho currency adjust. KHÔNG check ledger /
 * character balance (đó là việc của service runtime). Trả `null` nếu
 * pass, hoặc lỗi code đầu tiên gặp.
 */
export function validateAdminCurrencyAdjust(
  input: AdminCurrencyAdjustInput,
): AdminGrantValidationError | null {
  if (!Number.isFinite(input.amount)) return 'AMOUNT_NOT_FINITE';
  if (!Number.isInteger(input.amount)) return 'AMOUNT_NOT_INTEGER';
  if (input.amount === 0) return 'AMOUNT_ZERO';
  if (!isAdminCurrencyKey(input.currency)) return 'CURRENCY_UNSUPPORTED';
  const cap = ADMIN_CURRENCY_ADJUST_LIMIT[input.role][input.currency];
  if (cap === 0) return 'CURRENCY_NOT_ALLOWED_FOR_ROLE';
  if (Math.abs(input.amount) > cap) return 'CURRENCY_AMOUNT_OVER_LIMIT';
  if (!input.reason || input.reason.trim().length === 0)
    return 'REASON_REQUIRED';
  // HIGH/CRITICAL action — cần confirmText nếu amount lớn (>50% cap)
  const risk: AdminRiskLevel = DEFAULT_ACTION_RISK.CURRENCY_ADJUST;
  if (
    actionRequiresConfirmation(risk) &&
    Math.abs(input.amount) > cap / 2 &&
    !input.confirmText
  ) {
    return 'CONFIRM_TEXT_REQUIRED';
  }
  return null;
}

export interface AdminItemGrantInput {
  role: AdminRoleKey;
  itemKey: string;
  qty: number;
  reason: string;
  confirmText?: string;
}

export function validateAdminItemGrant(
  input: AdminItemGrantInput,
): AdminGrantValidationError | null {
  if (!Number.isInteger(input.qty) || input.qty <= 0)
    return 'QTY_NOT_POSITIVE_INTEGER';
  const limit = ADMIN_ITEM_GRANT_LIMIT[input.role];
  if (limit.qtyPerAction === 0) return 'QTY_OVER_LIMIT';
  if (input.qty > limit.qtyPerAction) return 'QTY_OVER_LIMIT';
  if (isForbiddenAdminGrantItem(input.itemKey)) {
    if (!limit.allowForbidden) return 'ITEM_FORBIDDEN_FOR_ROLE';
    // SUPER_ADMIN granting forbidden item — bắt buộc confirmText
    if (!input.confirmText) return 'CONFIRM_TEXT_REQUIRED';
  }
  if (!input.reason || input.reason.trim().length === 0)
    return 'REASON_REQUIRED';
  return null;
}

// ---------------------------------------------------------------------------
// 6. Reward profile spec + validator
// ---------------------------------------------------------------------------

/**
 * Loại nguồn reward — match `LiveOpsScheduledEvent` / `RewardProfile`
 * usage. Mỗi reward profile gắn 1 `contentType` + optional `contentKey`
 * (e.g. `BOSS:tien_long_thiet_dao`).
 */
export type RewardProfileContentType =
  | 'FARM_MAP'
  | 'DUNGEON'
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'HOURLY_BOSS'
  | 'EVENT_BOSS'
  | 'TRIAL_TOWER'
  | 'SECT_DUNGEON'
  | 'SECT_BOSS'
  | 'SHOP'
  | 'MONTHLY_CARD'
  | 'BATTLE_PASS'
  | 'GROWTH_FUND'
  | 'QUEST'
  | 'DAILY_LOGIN'
  | 'EVENT'
  | 'MAIL_BROADCAST';

export const REWARD_PROFILE_CONTENT_TYPES: readonly RewardProfileContentType[] =
  [
    'FARM_MAP',
    'DUNGEON',
    'BOSS',
    'WORLD_BOSS',
    'HOURLY_BOSS',
    'EVENT_BOSS',
    'TRIAL_TOWER',
    'SECT_DUNGEON',
    'SECT_BOSS',
    'SHOP',
    'MONTHLY_CARD',
    'BATTLE_PASS',
    'GROWTH_FUND',
    'QUEST',
    'DAILY_LOGIN',
    'EVENT',
    'MAIL_BROADCAST',
  ] as const;

export function isRewardProfileContentType(
  s: unknown,
): s is RewardProfileContentType {
  return (
    typeof s === 'string' &&
    (REWARD_PROFILE_CONTENT_TYPES as readonly string[]).includes(s)
  );
}

export type RewardEntryKind =
  | 'item'
  | 'currency'
  | 'exp'
  | 'bodyExp'
  | 'alchemyExp'
  | 'trialPoint'
  | 'sectContribution'
  | 'cosmetic'
  | 'entitlement'
  | 'sweepTicket';

export const REWARD_ENTRY_KINDS: readonly RewardEntryKind[] = [
  'item',
  'currency',
  'exp',
  'bodyExp',
  'alchemyExp',
  'trialPoint',
  'sectContribution',
  'cosmetic',
  'entitlement',
  'sweepTicket',
] as const;

export function isRewardEntryKind(s: unknown): s is RewardEntryKind {
  return (
    typeof s === 'string' && (REWARD_ENTRY_KINDS as readonly string[]).includes(s)
  );
}

export interface RewardProfileEntry {
  kind: RewardEntryKind;
  key: string;
  qty: number;
  /** Tier nội tại (1..9) — nếu áp dụng. Reward T1 từ source T1 OK. */
  itemTier?: number;
  /** Probability weight 0..1, default 1 (always grant). */
  weight?: number;
}

/** Cap rule per ngày/tuần để chặn lạm phát. */
export interface RewardProfileCapRule {
  /** Tổng số entry rewards/ngày cho character. 0 = không cap. */
  dailyCount?: number;
  /** Tổng qty rewards/ngày. */
  dailyQty?: number;
  weeklyCount?: number;
  weeklyQty?: number;
}

export interface RewardProfileSpec {
  key: string;
  name: string;
  description?: string;
  contentType: RewardProfileContentType;
  contentKey?: string;
  /** Tier 1..9, dùng để check tier leak (reward không quá source). */
  sourceTier: number;
  rewards: readonly RewardProfileEntry[];
  cap?: RewardProfileCapRule;
  active: boolean;
  version: number;
}

/** Sai cấu hình reward profile — KHÔNG cho phép activate. */
export type RewardProfileValidationError =
  | 'KEY_INVALID'
  | 'NAME_INVALID'
  | 'SOURCE_TIER_INVALID'
  | 'CONTENT_TYPE_INVALID'
  | 'REWARDS_EMPTY'
  | 'REWARD_KIND_INVALID'
  | 'REWARD_KEY_INVALID'
  | 'REWARD_QTY_INVALID'
  | 'REWARD_QTY_OVER_TIER_CAP'
  | 'REWARD_WEIGHT_INVALID'
  | 'TIER_LEAK_FORBIDDEN'
  | 'FORBIDDEN_ITEM'
  | 'TIEN_NGOC_GRANT_FORBIDDEN'
  | 'CAP_NEGATIVE'
  | 'WEEKLY_CAP_REQUIRED_FOR_RARE';

export interface RewardProfileValidationIssue {
  code: RewardProfileValidationError;
  index?: number;
  detail?: string;
}

/**
 * Max qty per reward entry theo `itemTier`. Tier càng cao càng hiếm.
 * Reward không khai báo `itemTier` (currency/exp/cosmetic) bypass.
 */
export const REWARD_QTY_CAP_BY_TIER: Readonly<Record<number, number>> = {
  1: 100,
  2: 60,
  3: 30,
  4: 20,
  5: 10,
  6: 6,
  7: 3,
  8: 2,
  9: 1,
};

/**
 * Cho phép `effectiveRewardTier <= sourceTier + delta`. Default delta=0
 * (T1 không rơi T2). SUPER_ADMIN có thể tuỳ chỉnh per profile (TODO PR
 * tiếp).
 */
export const REWARD_TIER_LEAK_DELTA = 0;

/**
 * Currency cấm grant qua reward profile (phải đi qua flow nạp / refund
 * thay vì admin set reward). Tiên Ngọc nạp (TIEN_NGOC) chỉ được issue
 * qua TopupOrder.
 */
export const REWARD_PROFILE_FORBIDDEN_CURRENCY: ReadonlySet<string> = new Set([
  'TIEN_NGOC',
  'tienNgoc',
]);

export function validateRewardProfile(
  spec: RewardProfileSpec,
): RewardProfileValidationIssue[] {
  const issues: RewardProfileValidationIssue[] = [];

  if (!spec.key || spec.key.length < 2 || spec.key.length > 80) {
    issues.push({ code: 'KEY_INVALID' });
  }
  if (!spec.name || spec.name.length < 2 || spec.name.length > 120) {
    issues.push({ code: 'NAME_INVALID' });
  }
  if (
    !Number.isInteger(spec.sourceTier) ||
    spec.sourceTier < 1 ||
    spec.sourceTier > 9
  ) {
    issues.push({ code: 'SOURCE_TIER_INVALID' });
  }
  if (!isRewardProfileContentType(spec.contentType)) {
    issues.push({ code: 'CONTENT_TYPE_INVALID' });
  }
  if (spec.rewards.length === 0) {
    issues.push({ code: 'REWARDS_EMPTY' });
  }

  let hasRareItem = false;

  spec.rewards.forEach((r, i) => {
    if (!isRewardEntryKind(r.kind)) {
      issues.push({ code: 'REWARD_KIND_INVALID', index: i });
      return;
    }
    if (!r.key || r.key.length < 1 || r.key.length > 100) {
      issues.push({ code: 'REWARD_KEY_INVALID', index: i });
      return;
    }
    if (!Number.isFinite(r.qty) || !Number.isInteger(r.qty) || r.qty <= 0) {
      issues.push({ code: 'REWARD_QTY_INVALID', index: i });
      return;
    }
    if (r.weight !== undefined) {
      if (!Number.isFinite(r.weight) || r.weight < 0 || r.weight > 1) {
        issues.push({ code: 'REWARD_WEIGHT_INVALID', index: i });
      }
    }
    if (r.kind === 'item') {
      if (ADMIN_FORBIDDEN_GRANT_ITEMS.has(r.key)) {
        issues.push({ code: 'FORBIDDEN_ITEM', index: i, detail: r.key });
      }
      if (r.itemTier !== undefined) {
        if (
          !Number.isInteger(r.itemTier) ||
          r.itemTier < 1 ||
          r.itemTier > 9
        ) {
          issues.push({
            code: 'REWARD_QTY_OVER_TIER_CAP',
            index: i,
            detail: 'itemTier out of [1..9]',
          });
          return;
        }
        const cap = REWARD_QTY_CAP_BY_TIER[r.itemTier];
        if (cap !== undefined && r.qty > cap) {
          issues.push({
            code: 'REWARD_QTY_OVER_TIER_CAP',
            index: i,
            detail: `tier ${r.itemTier} qty=${r.qty} > cap ${cap}`,
          });
        }
        if (
          Number.isInteger(spec.sourceTier) &&
          spec.sourceTier >= 1 &&
          spec.sourceTier <= 9 &&
          r.itemTier > spec.sourceTier + REWARD_TIER_LEAK_DELTA
        ) {
          issues.push({
            code: 'TIER_LEAK_FORBIDDEN',
            index: i,
            detail: `source T${spec.sourceTier} cannot reward T${r.itemTier}`,
          });
        }
        if (r.itemTier >= 7) hasRareItem = true;
      }
    }
    if (r.kind === 'currency') {
      if (REWARD_PROFILE_FORBIDDEN_CURRENCY.has(r.key)) {
        issues.push({ code: 'TIEN_NGOC_GRANT_FORBIDDEN', index: i });
      }
    }
  });

  if (spec.cap) {
    const c = spec.cap;
    for (const key of ['dailyCount', 'dailyQty', 'weeklyCount', 'weeklyQty'] as const) {
      const v = c[key];
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
        issues.push({ code: 'CAP_NEGATIVE', detail: key });
      }
    }
  }

  // Rare item T7+ bắt buộc có weekly cap để chặn farm vô hạn
  if (hasRareItem) {
    const weekly = spec.cap?.weeklyCount ?? spec.cap?.weeklyQty;
    if (!weekly || weekly <= 0) {
      issues.push({ code: 'WEEKLY_CAP_REQUIRED_FOR_RARE' });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 7. Drop profile spec + validator + simulator
// ---------------------------------------------------------------------------

export type DropProfileSourceType =
  | 'NORMAL_MONSTER'
  | 'ELITE_MONSTER'
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'EVENT_BOSS'
  | 'DUNGEON'
  | 'TRIAL_TOWER'
  | 'SECT_DUNGEON';

export const DROP_PROFILE_SOURCE_TYPES: readonly DropProfileSourceType[] = [
  'NORMAL_MONSTER',
  'ELITE_MONSTER',
  'BOSS',
  'WORLD_BOSS',
  'EVENT_BOSS',
  'DUNGEON',
  'TRIAL_TOWER',
  'SECT_DUNGEON',
] as const;

export function isDropProfileSourceType(s: unknown): s is DropProfileSourceType {
  return (
    typeof s === 'string' &&
    (DROP_PROFILE_SOURCE_TYPES as readonly string[]).includes(s)
  );
}

export type DropMaterialCategory =
  | 'GENERAL'
  | 'ALCHEMY'
  | 'REFINE'
  | 'ARTIFACT_CRAFT'
  | 'GEM'
  | 'COSMETIC';

export const DROP_MATERIAL_CATEGORIES: readonly DropMaterialCategory[] = [
  'GENERAL',
  'ALCHEMY',
  'REFINE',
  'ARTIFACT_CRAFT',
  'GEM',
  'COSMETIC',
] as const;

export function isDropMaterialCategory(s: unknown): s is DropMaterialCategory {
  return (
    typeof s === 'string' &&
    (DROP_MATERIAL_CATEGORIES as readonly string[]).includes(s)
  );
}

export interface DropProfileItemWeight {
  itemKey: string;
  /** Tier 1..9, dùng để check tier leak. */
  tier: number;
  /** Weight tương đối trong pool. >0. */
  weight: number;
  /** Khả năng `rare` (T7+ artifact). Hiển thị riêng trong simulation. */
  rare?: boolean;
}

export interface DropProfileCapRule {
  /** Số rare/ngày. */
  dailyRare?: number;
  /** Số rare/tuần. */
  weeklyRare?: number;
  /** Số drop/ngày tổng (anti-farm). */
  dailyTotal?: number;
}

export interface DropProfileSpec {
  key: string;
  name: string;
  description?: string;
  sourceType: DropProfileSourceType;
  sourceTier: number;
  materialCategory?: DropMaterialCategory;
  /** Chance roll baseline (0..1). */
  baseRate: number;
  /** Chance ra rare (0..1). Phải <= baseRate * 0.5 (rare strictly hiếm). */
  rareRate: number;
  items: readonly DropProfileItemWeight[];
  cap?: DropProfileCapRule;
  active: boolean;
  version: number;
}

export type DropProfileValidationError =
  | 'KEY_INVALID'
  | 'NAME_INVALID'
  | 'SOURCE_TIER_INVALID'
  | 'SOURCE_TYPE_INVALID'
  | 'BASE_RATE_INVALID'
  | 'RARE_RATE_INVALID'
  | 'RARE_RATE_TOO_HIGH'
  | 'MATERIAL_CATEGORY_INVALID'
  | 'ITEMS_EMPTY'
  | 'ITEM_KEY_INVALID'
  | 'ITEM_TIER_INVALID'
  | 'ITEM_WEIGHT_INVALID'
  | 'ITEM_FORBIDDEN'
  | 'TIER_LEAK_FORBIDDEN'
  | 'NORMAL_MONSTER_RARE_TIER_FORBIDDEN'
  | 'ARTIFACT_RARE_HIGHER_THAN_ALCHEMY'
  | 'WEEKLY_CAP_REQUIRED_FOR_RARE';

export interface DropProfileValidationIssue {
  code: DropProfileValidationError;
  index?: number;
  detail?: string;
}

/**
 * Max rare tier (T) cho từng sourceType. Vd: `NORMAL_MONSTER` không
 * được rơi rare T7+ (anti-leak farm). `ELITE` cho phép T6. `BOSS` T8.
 * `WORLD_BOSS` / `EVENT_BOSS` T9.
 */
export const DROP_SOURCE_MAX_TIER: Readonly<Record<DropProfileSourceType, number>> = {
  NORMAL_MONSTER: 4,
  ELITE_MONSTER: 6,
  BOSS: 8,
  WORLD_BOSS: 9,
  EVENT_BOSS: 9,
  DUNGEON: 7,
  TRIAL_TOWER: 8,
  SECT_DUNGEON: 7,
};

/** Cho phép `effectiveDropTier <= sourceTier + delta` (default 0). */
export const DROP_TIER_LEAK_DELTA = 0;

export const DROP_RARE_RATE_MAX = 0.25;

export function validateDropProfile(
  spec: DropProfileSpec,
): DropProfileValidationIssue[] {
  const issues: DropProfileValidationIssue[] = [];

  if (!spec.key || spec.key.length < 2 || spec.key.length > 80) {
    issues.push({ code: 'KEY_INVALID' });
  }
  if (!spec.name || spec.name.length < 2 || spec.name.length > 120) {
    issues.push({ code: 'NAME_INVALID' });
  }
  if (
    !Number.isInteger(spec.sourceTier) ||
    spec.sourceTier < 1 ||
    spec.sourceTier > 9
  ) {
    issues.push({ code: 'SOURCE_TIER_INVALID' });
  }
  if (!isDropProfileSourceType(spec.sourceType)) {
    issues.push({ code: 'SOURCE_TYPE_INVALID' });
  }
  if (
    !Number.isFinite(spec.baseRate) ||
    spec.baseRate < 0 ||
    spec.baseRate > 1
  ) {
    issues.push({ code: 'BASE_RATE_INVALID' });
  }
  if (
    !Number.isFinite(spec.rareRate) ||
    spec.rareRate < 0 ||
    spec.rareRate > 1
  ) {
    issues.push({ code: 'RARE_RATE_INVALID' });
  }
  if (spec.rareRate > DROP_RARE_RATE_MAX) {
    issues.push({ code: 'RARE_RATE_TOO_HIGH' });
  }
  if (
    spec.materialCategory !== undefined &&
    !isDropMaterialCategory(spec.materialCategory)
  ) {
    issues.push({ code: 'MATERIAL_CATEGORY_INVALID' });
  }
  if (spec.items.length === 0) {
    issues.push({ code: 'ITEMS_EMPTY' });
  }

  const maxTierForSource = isDropProfileSourceType(spec.sourceType)
    ? DROP_SOURCE_MAX_TIER[spec.sourceType]
    : 9;

  let hasRare = false;

  spec.items.forEach((item, i) => {
    if (!item.itemKey || item.itemKey.length < 1 || item.itemKey.length > 100) {
      issues.push({ code: 'ITEM_KEY_INVALID', index: i });
      return;
    }
    if (
      !Number.isInteger(item.tier) ||
      item.tier < 1 ||
      item.tier > 9
    ) {
      issues.push({ code: 'ITEM_TIER_INVALID', index: i });
      return;
    }
    if (
      !Number.isFinite(item.weight) ||
      item.weight <= 0 ||
      item.weight > 1_000_000
    ) {
      issues.push({ code: 'ITEM_WEIGHT_INVALID', index: i });
      return;
    }
    if (ADMIN_FORBIDDEN_GRANT_ITEMS.has(item.itemKey)) {
      issues.push({ code: 'ITEM_FORBIDDEN', index: i, detail: item.itemKey });
    }
    if (Number.isInteger(spec.sourceTier)) {
      if (item.tier > spec.sourceTier + DROP_TIER_LEAK_DELTA) {
        issues.push({
          code: 'TIER_LEAK_FORBIDDEN',
          index: i,
          detail: `source T${spec.sourceTier} cannot drop T${item.tier}`,
        });
      }
    }
    if (item.tier > maxTierForSource) {
      if (spec.sourceType === 'NORMAL_MONSTER' && item.tier >= 5) {
        issues.push({
          code: 'NORMAL_MONSTER_RARE_TIER_FORBIDDEN',
          index: i,
          detail: `normal monster cannot drop T${item.tier}`,
        });
      } else {
        issues.push({
          code: 'TIER_LEAK_FORBIDDEN',
          index: i,
          detail: `${spec.sourceType} max tier ${maxTierForSource}, got T${item.tier}`,
        });
      }
    }
    if (item.rare) hasRare = true;
  });

  if (spec.materialCategory === 'ARTIFACT_CRAFT') {
    // Artifact material phải hiếm hơn alchemy ⇒ rareRate <= 0.05
    if (spec.rareRate > 0.05) {
      issues.push({ code: 'ARTIFACT_RARE_HIGHER_THAN_ALCHEMY' });
    }
  }

  if (hasRare || spec.rareRate > 0) {
    const weekly = spec.cap?.weeklyRare;
    if (!weekly || weekly <= 0) {
      issues.push({ code: 'WEEKLY_CAP_REQUIRED_FOR_RARE' });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 8. Drop profile simulator (deterministic, pure)
// ---------------------------------------------------------------------------

export interface DropSimulationResult {
  trials: number;
  totalDrops: number;
  rareDrops: number;
  perItem: Record<string, number>;
  perTier: Record<number, number>;
  expectedRareRate: number;
  expectedDropRate: number;
  tierLeakCount: number;
  warnings: readonly string[];
}

/**
 * Mulberry32 — deterministic 32-bit PRNG dùng cho drop simulator, không
 * phụ thuộc `Math.random`. Caller pass seed để reproduce. Tách khỏi
 * `combat-rng.SeededRng` để admin simulator không đụng combat RNG
 * chain (mỗi caller có RNG cô lập, tránh side-effect cross-module).
 */
export function createAdminSimulatorRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mô phỏng drop profile theo spec Phase 27.6 §9. Pure + deterministic
 * khi pass seed. Returns expected vs actual drop counts, rare counts,
 * tier leak count + warning text cho admin.
 *
 * Kết quả phục vụ admin: chạy 1k/10k/100k để xem profile có expected
 * normal range không.
 */
export function simulateDropProfile(
  spec: DropProfileSpec,
  trials: number,
  seed = 42,
): DropSimulationResult {
  const rng = createAdminSimulatorRng(seed);
  const perItem: Record<string, number> = {};
  const perTier: Record<number, number> = {};
  let totalDrops = 0;
  let rareDrops = 0;
  let tierLeakCount = 0;

  const totalWeight = spec.items.reduce((sum, it) => sum + it.weight, 0);
  const rareWeight = spec.items
    .filter((it) => it.rare)
    .reduce((sum, it) => sum + it.weight, 0);

  for (let t = 0; t < trials; t++) {
    // Roll base
    if (rng() >= spec.baseRate) continue;
    // Pick item by weight
    let pick = rng() * totalWeight;
    let chosen: DropProfileItemWeight | undefined;
    for (const item of spec.items) {
      pick -= item.weight;
      if (pick <= 0) {
        chosen = item;
        break;
      }
    }
    if (!chosen) chosen = spec.items[spec.items.length - 1];
    if (!chosen) continue;

    // Apply rare gate
    if (chosen.rare && rng() >= spec.rareRate) continue;

    totalDrops++;
    if (chosen.rare) rareDrops++;
    perItem[chosen.itemKey] = (perItem[chosen.itemKey] ?? 0) + 1;
    perTier[chosen.tier] = (perTier[chosen.tier] ?? 0) + 1;
    if (chosen.tier > spec.sourceTier + DROP_TIER_LEAK_DELTA) {
      tierLeakCount++;
    }
  }

  const warnings: string[] = [];
  if (rareWeight > 0 && spec.rareRate > DROP_RARE_RATE_MAX) {
    warnings.push(
      `rareRate ${spec.rareRate} > max ${DROP_RARE_RATE_MAX}; reduce to avoid inflation`,
    );
  }
  if (
    spec.sourceType === 'NORMAL_MONSTER' &&
    rareDrops / Math.max(trials, 1) > 0.005
  ) {
    warnings.push(
      `normal monster rare drop rate ${(rareDrops / trials).toFixed(4)} > 0.5% expected`,
    );
  }
  if (
    spec.materialCategory === 'ARTIFACT_CRAFT' &&
    rareDrops / Math.max(trials, 1) > 0.01
  ) {
    warnings.push(
      `ARTIFACT_CRAFT rare ${(rareDrops / trials).toFixed(4)} > 1%; expected hiếm hơn alchemy`,
    );
  }
  if (tierLeakCount > 0) {
    warnings.push(
      `tier leak detected ${tierLeakCount}/${trials}; validator should block before activate`,
    );
  }

  return {
    trials,
    totalDrops,
    rareDrops,
    perItem,
    perTier,
    expectedRareRate: rareDrops / Math.max(trials, 1),
    expectedDropRate: totalDrops / Math.max(trials, 1),
    tierLeakCount,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 9. Content status spec
// ---------------------------------------------------------------------------

export type ContentStatusType =
  | 'FARM_MAP'
  | 'DUNGEON'
  | 'DAILY_FARM'
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'HOURLY_BOSS'
  | 'EVENT_BOSS'
  | 'SECT_BOSS'
  | 'SECT_DUNGEON'
  | 'TRIAL_TOWER'
  | 'QUEST'
  | 'NPC'
  | 'ITEM'
  | 'RECIPE'
  | 'METHOD'
  | 'ARTIFACT';

export const CONTENT_STATUS_TYPES: readonly ContentStatusType[] = [
  'FARM_MAP',
  'DUNGEON',
  'DAILY_FARM',
  'BOSS',
  'WORLD_BOSS',
  'HOURLY_BOSS',
  'EVENT_BOSS',
  'SECT_BOSS',
  'SECT_DUNGEON',
  'TRIAL_TOWER',
  'QUEST',
  'NPC',
  'ITEM',
  'RECIPE',
  'METHOD',
  'ARTIFACT',
] as const;

export function isContentStatusType(s: unknown): s is ContentStatusType {
  return (
    typeof s === 'string' &&
    (CONTENT_STATUS_TYPES as readonly string[]).includes(s)
  );
}

export interface ContentStatusSpec {
  contentType: ContentStatusType;
  contentKey: string;
  enabled: boolean;
  paused: boolean;
  disableReward: boolean;
  disableClaim: boolean;
  message?: string;
}

export type ContentStatusValidationError =
  | 'CONTENT_TYPE_INVALID'
  | 'CONTENT_KEY_INVALID'
  | 'MESSAGE_TOO_LONG'
  | 'PAUSE_WITHOUT_ENABLED'
  | 'DISABLE_REWARD_WITHOUT_ENABLED';

export function validateContentStatus(
  spec: ContentStatusSpec,
): ContentStatusValidationError[] {
  const issues: ContentStatusValidationError[] = [];
  if (!isContentStatusType(spec.contentType)) {
    issues.push('CONTENT_TYPE_INVALID');
  }
  if (
    !spec.contentKey ||
    spec.contentKey.length < 1 ||
    spec.contentKey.length > 120
  ) {
    issues.push('CONTENT_KEY_INVALID');
  }
  if (spec.message !== undefined && spec.message.length > 1000) {
    issues.push('MESSAGE_TOO_LONG');
  }
  if (!spec.enabled && spec.paused) {
    issues.push('PAUSE_WITHOUT_ENABLED');
  }
  if (!spec.enabled && spec.disableReward) {
    issues.push('DISABLE_REWARD_WITHOUT_ENABLED');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 10. Overview snapshot type (admin dashboard)
// ---------------------------------------------------------------------------

export interface AdminOverviewSnapshot {
  totalUsers: number;
  activeUsersToday: number;
  activeCharacters: number;
  newUsersToday: number;
  currencyMintedTodayLinhThach: string;
  currencySpentTodayLinhThach: string;
  rareDropsToday: number;
  farmSessionsToday: number;
  dungeonRunsToday: number;
  bossKillsToday: number;
  towerAttemptsToday: number;
  battlePassActiveSeason: string | null;
  monthlyCardActiveCount: number;
  suspiciousEventsCount: number;
  pendingTopupsCount: number;
  activeFeatureFlags: number;
  activeEvents: number;
  maintenanceStatus: 'NONE' | 'SCHEDULED' | 'ACTIVE';
  generatedAt: string;
}
