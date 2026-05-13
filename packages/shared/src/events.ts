/**
 * Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2.
 *
 * Mở rộng `liveops-event-scheduler.ts` (Phase 15.1–15.2 — runtime multiplier
 * event như `DOUBLE_DUNGEON_DROP`, `CULTIVATION_EXP_BOOST`) bằng **hệ event
 * gameplay đầy đủ** mà admin có thể tự bật/tắt và TỰ TẠO mới mà không sửa
 * code: token event, rương event, vật phẩm event, shop event, boss event,
 * nhiệm vụ event, ranking event, personal milestone event, preset event.
 *
 * Module này **pure** — không I/O, không import Prisma, không phụ thuộc
 * NestJS. Caller (API service + Vue admin/player view) import constants +
 * helpers ở đây để FE/BE đồng bộ schema + validator.
 *
 * --- Triết lý thiết kế (theo Phase 28.0 spec) -----------------------------
 *
 *   Event chung toàn server → chia bracket theo cảnh giới → nhiệm vụ scale
 *   theo cấp → reward theo tier người chơi → ranking theo bracket riêng →
 *   shop event lọc vật phẩm theo cấp → cap theo ngày/tuần/toàn event.
 *
 *   Công thức bất biến:
 *
 *       rewardTier = min(playerTier, bracketTier, eventMaxTier)
 *
 *   Tier T1–T9 dùng cùng mapping như `drop-economy.realmOrderToMaterialTier`
 *   (Luyện Khí ~ T1; Trúc Cơ ~ T2; Kim Đan ~ T3; ... Thiên Đạo+ ~ T9). Không
 *   tự tạo mapping mới ở module này để giữ invariant cross-system.
 *
 * --- Anti-exploit / Anti-P2W invariants -----------------------------------
 *
 *   1. Người chơi cấp cao vào bracket thấp KHÔNG được tính ranking.
 *   2. Người chơi cấp cao farm event thấp bị giảm token/reward theo
 *      `highLevelLowBracketTokenPenaltyPercent`.
 *   3. Người chơi cấp thấp KHÔNG nhận reward vượt tier (clamp ở
 *      `computeEffectiveRewardTier`).
 *   4. Token event có daily/weekly/event cap (`EventBalancePolicy`).
 *   5. Shop event có purchase limit per period.
 *   6. Rương event có loot table validated — chặn endgame item.
 *   7. Paid reward KHÔNG chứa pháp bảo/công pháp top hoàn chỉnh
 *      (extends `FORBIDDEN_REWARD_ITEM_KEYS` + `ADMIN_FORBIDDEN_GRANT_ITEMS`).
 *   8. Không token farm vô hạn — admin tạo event không có cap → reject.
 *
 *  PR1 scope (foundation):
 *    1. EventType / EventStatus / BracketMode enum + constants.
 *    2. EventDef / EventBracketDef / EventBalancePolicy / EventItemDef /
 *       EventMissionDef / EventShopDef / EventShopItemDef / EventBossDef /
 *       EventRankingDef / PersonalMilestoneEventDef / EventChestLootEntry.
 *    3. 10 default bracket cho realm progression Luyện Khí → Độ Kiếp +
 *       Tiên cảnh extension.
 *    4. Validator pure-fn: validateEventDef / validateEventBracket /
 *       validateEventBalancePolicy / validateEventItem / validateEventReward /
 *       validateEventShop / validateEventMission / validateEventBoss /
 *       validateEventRanking / validateEventChestLootTable.
 *    5. Helper: realmTierForEventBracket / computeEffectiveRewardTier /
 *       computeScoreNormalization / resolveBracketForPlayer /
 *       isHighLevelInLowBracket / computeTokenPenaltyMultiplier.
 *    6. EVENT_ERROR_CODES (21 codes) + EVENT_ADMIN_ACTION_TYPES (subset audit).
 *    7. PRESET_EVENT_TEMPLATES (35 mẫu) — admin pick từ catalog để tạo nhanh.
 *
 *  KHÔNG thuộc PR1:
 *    - Runtime: cron transition state, score finalize, reward grant
 *      (sẽ wire ở PR2 + tích hợp `LedgerService` + `RewardService`).
 *    - Boss event combat hook → PR3 (cần hook vào combat resolver).
 *    - Ranking finalize cron → PR3 (tích hợp `LeaderboardService`).
 */

import {
  realmOrderToMaterialTier,
  effectiveDropTier,
  MIN_MATERIAL_TIER,
  MAX_MATERIAL_TIER,
} from './drop-economy';
import {
  REWARD_QTY_CAP_BY_TIER,
  REWARD_TIER_LEAK_DELTA,
  ADMIN_FORBIDDEN_GRANT_ITEMS,
  isForbiddenAdminGrantItem,
} from './admin-control-center';
import { FORBIDDEN_REWARD_ITEM_KEYS } from './monetization-systems';

// ---------------------------------------------------------------------------
// 1. EventType — phân loại event
// ---------------------------------------------------------------------------

/**
 * 19 loại event chính. Khác `LiveOpsScheduledEventType` (Phase 15.1) ở chỗ:
 *   - `LiveOpsScheduledEventType` = event runtime modifier (boost / discount).
 *   - `EventType` = event gameplay đầy đủ (mission / shop / boss / ranking).
 *
 * Cả 2 cùng tồn tại; admin có thể bật cả 2 cùng lúc. PR1 này chỉ định nghĩa
 * data model — runtime wire qua `event-builder` API module ở PR2+.
 */
export type EventType =
  | 'LOGIN_EVENT'
  | 'DAILY_ACTIVITY_EVENT'
  | 'FARM_EVENT'
  | 'DUNGEON_EVENT'
  | 'BOSS_EVENT'
  | 'WORLD_BOSS_EVENT'
  | 'SECT_EVENT'
  | 'TOWER_EVENT'
  | 'ALCHEMY_EVENT'
  | 'ARTIFACT_EVENT'
  | 'MARKET_EVENT'
  | 'SPENDING_EVENT'
  | 'TOPUP_EVENT'
  | 'SERVER_OPENING_EVENT'
  | 'RETURNING_PLAYER_EVENT'
  | 'REALM_MILESTONE_EVENT'
  | 'BODY_REALM_MILESTONE_EVENT'
  | 'HOLIDAY_EVENT'
  | 'CUSTOM_EVENT';

export const EVENT_TYPES: readonly EventType[] = [
  'LOGIN_EVENT',
  'DAILY_ACTIVITY_EVENT',
  'FARM_EVENT',
  'DUNGEON_EVENT',
  'BOSS_EVENT',
  'WORLD_BOSS_EVENT',
  'SECT_EVENT',
  'TOWER_EVENT',
  'ALCHEMY_EVENT',
  'ARTIFACT_EVENT',
  'MARKET_EVENT',
  'SPENDING_EVENT',
  'TOPUP_EVENT',
  'SERVER_OPENING_EVENT',
  'RETURNING_PLAYER_EVENT',
  'REALM_MILESTONE_EVENT',
  'BODY_REALM_MILESTONE_EVENT',
  'HOLIDAY_EVENT',
  'CUSTOM_EVENT',
] as const;

export function isEventType(s: unknown): s is EventType {
  return (
    typeof s === 'string' && (EVENT_TYPES as readonly string[]).includes(s)
  );
}

/**
 * Event types phải có ranking bracket-aware (ranking thi đấu) — admin tạo
 * `EventRankingDef` cho các loại này thì BẮT BUỘC `bracketMode !== 'NONE'`.
 */
export const EVENT_TYPES_REQUIRE_BRACKET_RANKING: ReadonlySet<EventType> =
  new Set<EventType>([
    'BOSS_EVENT',
    'WORLD_BOSS_EVENT',
    'TOWER_EVENT',
    'ALCHEMY_EVENT',
    'ARTIFACT_EVENT',
    'DUNGEON_EVENT',
    'SECT_EVENT',
  ]);

// ---------------------------------------------------------------------------
// 2. EventStatus lifecycle
// ---------------------------------------------------------------------------

/**
 * Lifecycle (admin-driven, không phải auto-transition như Phase 15.1):
 *
 *   DRAFT → SCHEDULED → ACTIVE → PAUSED ↔ ACTIVE → REWARD_LOCKED →
 *   ENDED → FINALIZED → ARCHIVED
 *
 *   CANCELLED là terminal alt-path (admin huỷ ngay từ DRAFT/SCHEDULED).
 *
 * Lý do tách REWARD_LOCKED khỏi ENDED: admin có thể "đóng băng" reward
 * trước endsAt nếu thấy exploit, nhưng vẫn cho người chơi xem ranking đến
 * khi finalize.
 */
export type EventStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'REWARD_LOCKED'
  | 'ENDED'
  | 'FINALIZED'
  | 'ARCHIVED'
  | 'CANCELLED';

export const EVENT_STATUSES: readonly EventStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'REWARD_LOCKED',
  'ENDED',
  'FINALIZED',
  'ARCHIVED',
  'CANCELLED',
] as const;

/** Status cho phép schedule activate. Chỉ DRAFT mới được activate trực tiếp. */
export const EVENT_STATUSES_SCHEDULABLE: ReadonlySet<EventStatus> =
  new Set<EventStatus>(['DRAFT']);

/** Status cho phép admin activate (manual transition). */
export const EVENT_STATUSES_ACTIVATABLE: ReadonlySet<EventStatus> =
  new Set<EventStatus>(['SCHEDULED', 'PAUSED']);

/** Status cho phép player claim reward / progress mission. */
export const EVENT_STATUSES_PLAYER_ACTIVE: ReadonlySet<EventStatus> =
  new Set<EventStatus>(['ACTIVE']);

/** Status terminal — admin KHÔNG được edit config nữa (chỉ archive). */
export const EVENT_STATUSES_TERMINAL: ReadonlySet<EventStatus> =
  new Set<EventStatus>(['FINALIZED', 'ARCHIVED', 'CANCELLED']);

// ---------------------------------------------------------------------------
// 3. BracketMode — chế độ chia bracket
// ---------------------------------------------------------------------------

/**
 *   - NONE                 — event không chia bracket (vd HOLIDAY_EVENT khi
 *                            ai cũng có thể tham gia / không có ranking).
 *   - REALM_BRACKET        — chia theo `realmOrder` (Luyện Khí / Trúc Cơ /
 *                            ...). Mặc định cho event thi đấu.
 *   - BODY_REALM_BRACKET   — chia theo `bodyRealmOrder` (Luyện Thể).
 *   - PLAYER_TIER_SCALE    — không chia, nhưng reward scale theo player tier
 *                            (admin set min/max reward tier).
 *   - MIXED                — kết hợp realm + body realm; bracket key compose
 *                            (vd `lk_T2_body_T2`). PR1 không support runtime
 *                            wire; lưu enum để forward-compat.
 */
export type BracketMode =
  | 'NONE'
  | 'REALM_BRACKET'
  | 'BODY_REALM_BRACKET'
  | 'PLAYER_TIER_SCALE'
  | 'MIXED';

export const BRACKET_MODES: readonly BracketMode[] = [
  'NONE',
  'REALM_BRACKET',
  'BODY_REALM_BRACKET',
  'PLAYER_TIER_SCALE',
  'MIXED',
] as const;

// ---------------------------------------------------------------------------
// 4. EventItemKind — phân nhóm vật phẩm event
// ---------------------------------------------------------------------------

/**
 * Item kind cho event item builder. Khác `ItemKind` ở `items.ts` (item
 * gameplay vĩnh viễn) — đây là vật phẩm có thể "ephemeral", thường
 * `expiresAt` set hoặc bind-on-pickup.
 */
export type EventItemKind =
  | 'EVENT_TOKEN'
  | 'EVENT_TICKET'
  | 'EVENT_CHEST'
  | 'EVENT_QUEST_ITEM'
  | 'EVENT_TITLE'
  | 'EVENT_FRAME'
  | 'EVENT_COSMETIC'
  | 'MATERIAL'
  | 'ALCHEMY_MATERIAL'
  | 'BODY_MATERIAL'
  | 'ARTIFACT_MATERIAL'
  | 'METHOD_FRAGMENT'
  | 'BLUEPRINT_FRAGMENT'
  | 'SWEEP_TICKET';

export const EVENT_ITEM_KINDS: readonly EventItemKind[] = [
  'EVENT_TOKEN',
  'EVENT_TICKET',
  'EVENT_CHEST',
  'EVENT_QUEST_ITEM',
  'EVENT_TITLE',
  'EVENT_FRAME',
  'EVENT_COSMETIC',
  'MATERIAL',
  'ALCHEMY_MATERIAL',
  'BODY_MATERIAL',
  'ARTIFACT_MATERIAL',
  'METHOD_FRAGMENT',
  'BLUEPRINT_FRAGMENT',
  'SWEEP_TICKET',
] as const;

/**
 * 4 nhóm rủi ro item theo spec Phase 28.0 §4.
 *   - A: an toàn (token / ticket / cosmetic / nguyên liệu thường tier thấp)
 *   - B: validate mạnh (nguyên liệu luyện đan / luyện thể / pháp bảo /
 *        mảnh / rương / đan)
 *   - C: quyền cao (công pháp / pháp bảo hoàn chỉnh / trang bị phẩm cao /
 *        đan cực phẩm / nguyên liệu đột phá hiếm)
 *   - D: không cho tạo trực tiếp ở production (top endgame, vô hạn,
 *        item tăng lực chiến trực tiếp quá mạnh)
 */
export type EventItemRiskGroup = 'A' | 'B' | 'C' | 'D';

export const EVENT_ITEM_RISK_GROUP_BY_KIND: Readonly<
  Record<EventItemKind, EventItemRiskGroup>
> = {
  EVENT_TOKEN: 'A',
  EVENT_TICKET: 'A',
  EVENT_QUEST_ITEM: 'A',
  EVENT_TITLE: 'A',
  EVENT_FRAME: 'A',
  EVENT_COSMETIC: 'A',
  SWEEP_TICKET: 'A',
  MATERIAL: 'A',
  ALCHEMY_MATERIAL: 'B',
  BODY_MATERIAL: 'B',
  ARTIFACT_MATERIAL: 'B',
  METHOD_FRAGMENT: 'B',
  BLUEPRINT_FRAGMENT: 'B',
  EVENT_CHEST: 'B',
};

/**
 * Max tier cho phép tạo trực tiếp ở môi trường production (production-safe
 * default). Validator chặn admin tạo item Group A/B vượt tier này nếu không
 * có `allowHighTier=true`. Group C/D bị reject ngay cả khi cờ true (cần
 * SUPER_ADMIN + reason).
 */
export const EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP: Readonly<
  Record<EventItemRiskGroup, number>
> = {
  A: 9,
  B: 7,
  C: 5,
  D: 0,
};

// ---------------------------------------------------------------------------
// 5. EventMissionType
// ---------------------------------------------------------------------------

export type EventMissionType =
  | 'LOGIN'
  | 'FARM_MINUTES'
  | 'KILL_MONSTER'
  | 'CLEAR_DUNGEON'
  | 'CHALLENGE_BOSS'
  | 'KILL_EVENT_BOSS'
  | 'ALCHEMY_CRAFT'
  | 'ARTIFACT_CRAFT'
  | 'TOWER_CLIMB'
  | 'SECT_CONTRIBUTION'
  | 'MARKET_TRADE'
  | 'COMPLETE_DAILY_QUEST'
  | 'COMPLETE_STORY_QUEST'
  | 'SPEND_CURRENCY'
  | 'TOPUP_AMOUNT'
  | 'CUSTOM';

export const EVENT_MISSION_TYPES: readonly EventMissionType[] = [
  'LOGIN',
  'FARM_MINUTES',
  'KILL_MONSTER',
  'CLEAR_DUNGEON',
  'CHALLENGE_BOSS',
  'KILL_EVENT_BOSS',
  'ALCHEMY_CRAFT',
  'ARTIFACT_CRAFT',
  'TOWER_CLIMB',
  'SECT_CONTRIBUTION',
  'MARKET_TRADE',
  'COMPLETE_DAILY_QUEST',
  'COMPLETE_STORY_QUEST',
  'SPEND_CURRENCY',
  'TOPUP_AMOUNT',
  'CUSTOM',
] as const;

export type EventMissionResetType = 'DAILY' | 'WEEKLY' | 'EVENT_ONCE';

export const EVENT_MISSION_RESET_TYPES: readonly EventMissionResetType[] = [
  'DAILY',
  'WEEKLY',
  'EVENT_ONCE',
] as const;

// ---------------------------------------------------------------------------
// 6. EventBossType
// ---------------------------------------------------------------------------

export type EventBossType =
  | 'PERSONAL_EVENT_BOSS'
  | 'BRACKET_EVENT_BOSS'
  | 'WORLD_EVENT_BOSS'
  | 'SECT_EVENT_BOSS'
  | 'HOURLY_EVENT_BOSS';

export const EVENT_BOSS_TYPES: readonly EventBossType[] = [
  'PERSONAL_EVENT_BOSS',
  'BRACKET_EVENT_BOSS',
  'WORLD_EVENT_BOSS',
  'SECT_EVENT_BOSS',
  'HOURLY_EVENT_BOSS',
] as const;

// ---------------------------------------------------------------------------
// 7. EventRankingType
// ---------------------------------------------------------------------------

export type EventRankingType =
  | 'EVENT_SCORE'
  | 'BOSS_DAMAGE'
  | 'TOWER_FLOOR'
  | 'ALCHEMY_SCORE'
  | 'FARM_TOKEN'
  | 'DUNGEON_CLEAR'
  | 'SECT_SCORE'
  | 'MARKET_ACTIVITY';

export const EVENT_RANKING_TYPES: readonly EventRankingType[] = [
  'EVENT_SCORE',
  'BOSS_DAMAGE',
  'TOWER_FLOOR',
  'ALCHEMY_SCORE',
  'FARM_TOKEN',
  'DUNGEON_CLEAR',
  'SECT_SCORE',
  'MARKET_ACTIVITY',
] as const;

// ---------------------------------------------------------------------------
// 8. PersonalEventTriggerType
// ---------------------------------------------------------------------------

export type PersonalEventTriggerType =
  | 'REALM_REACHED'
  | 'BODY_REALM_REACHED'
  | 'JOIN_SECT'
  | 'RETURNING_PLAYER'
  | 'FIRST_DUNGEON_CLEAR'
  | 'FIRST_BOSS_KILL'
  | 'FIRST_ALCHEMY_SUCCESS'
  | 'FIRST_TOWER_MILESTONE';

export const PERSONAL_EVENT_TRIGGER_TYPES: readonly PersonalEventTriggerType[] =
  [
    'REALM_REACHED',
    'BODY_REALM_REACHED',
    'JOIN_SECT',
    'RETURNING_PLAYER',
    'FIRST_DUNGEON_CLEAR',
    'FIRST_BOSS_KILL',
    'FIRST_ALCHEMY_SUCCESS',
    'FIRST_TOWER_MILESTONE',
  ] as const;

// ---------------------------------------------------------------------------
// 9. PaidRewardPolicy
// ---------------------------------------------------------------------------

/**
 *   - FREE_ONLY        — event không có paid track (vd retention).
 *   - PAID_TIER_CAP    — có paid track, nhưng reward tier ≤
 *                        `paidMaxRewardTier` (default 7) — chặn endgame.
 *   - PAID_COSMETIC    — paid track CHỈ cosmetic / title / frame (Group A).
 */
export type PaidRewardPolicy = 'FREE_ONLY' | 'PAID_TIER_CAP' | 'PAID_COSMETIC';

export const PAID_REWARD_POLICIES: readonly PaidRewardPolicy[] = [
  'FREE_ONLY',
  'PAID_TIER_CAP',
  'PAID_COSMETIC',
] as const;

// ---------------------------------------------------------------------------
// 10. Validator caps & patterns
// ---------------------------------------------------------------------------

/** Stable cross-FE/BE event key. Pattern alphanumeric + dash/underscore. */
export const EVENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/;
export const EVENT_NAME_MAX = 80;
export const EVENT_DESCRIPTION_MAX = 800;

/** Window tối thiểu 5 phút (cron 1-phút có thể miss event quá ngắn). */
export const EVENT_MIN_WINDOW_MS = 5 * 60_000;
/** Window tối đa 120 ngày — event mùa dài nhất. */
export const EVENT_MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Daily cap soft ceiling — token event không nên vượt 5000/ngày (chống
 * inflation). Validator warn nếu > 5000, reject nếu > 100000 vô lý.
 */
export const EVENT_TOKEN_DAILY_CAP_SOFT_MAX = 5000;
export const EVENT_TOKEN_DAILY_CAP_HARD_MAX = 100_000;
export const EVENT_TOKEN_WEEKLY_CAP_HARD_MAX = 500_000;
export const EVENT_TOKEN_EVENT_CAP_HARD_MAX = 5_000_000;

/** Reward bracket-tier safety delta: bracket T2 không reward T5+. */
export const EVENT_MAX_REWARD_TIER_DELTA_DEFAULT = 1;
export const EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX = 2;

/** Default penalty cho player cao cấp farm event thấp (50%). */
export const EVENT_HIGH_LEVEL_TOKEN_PENALTY_DEFAULT = 0.5;
/** Min penalty: 10% (admin có thể tăng cho event đặc biệt). */
export const EVENT_HIGH_LEVEL_TOKEN_PENALTY_MIN = 0;
export const EVENT_HIGH_LEVEL_TOKEN_PENALTY_MAX = 0.95;

/** Max purchase limit per period (shop). */
export const EVENT_SHOP_PURCHASE_LIMIT_HARD_MAX = 9999;

/** Paid reward tier cap mặc định cho `PAID_TIER_CAP`. */
export const EVENT_PAID_MAX_REWARD_TIER_DEFAULT = 7;

// ---------------------------------------------------------------------------
// 11. Default bracket catalog (realm progression)
// ---------------------------------------------------------------------------

/**
 * 10 default bracket được seed sẵn để admin dùng nhanh cho event chung. Mỗi
 * bracket map vào dải `realmOrder` của `realms.ts` (đại cảnh giới). Tier tham
 * khảo qua `realmOrderToMaterialTier`.
 *
 *   - Luyện Khí bracket (order 1)            → T1
 *   - Trúc Cơ bracket (order 2)              → T2
 *   - Kim Đan bracket (order 3)              → T3
 *   - Nguyên Anh bracket (order 4)           → T4
 *   - Hóa Thần bracket (order 5)             → T5
 *   - Luyện Hư bracket (order 6)             → T6
 *   - Hợp Thể bracket (order 7)              → T7
 *   - Đại Thừa bracket (order 8)             → T8
 *   - Độ Kiếp bracket (order 9)              → T9
 *   - Tiên cảnh bracket (order 10–12)        → T9 (cap, không leak endgame)
 */
export interface DefaultBracketSpec {
  readonly bracketKey: string;
  readonly name: string;
  readonly minRealmOrder: number;
  readonly maxRealmOrder: number;
  readonly bracketTier: number;
}

export const DEFAULT_BRACKETS: readonly DefaultBracketSpec[] = [
  {
    bracketKey: 'luyen_khi',
    name: 'Luyện Khí',
    minRealmOrder: 1,
    maxRealmOrder: 1,
    bracketTier: 1,
  },
  {
    bracketKey: 'truc_co',
    name: 'Trúc Cơ',
    minRealmOrder: 2,
    maxRealmOrder: 2,
    bracketTier: 2,
  },
  {
    bracketKey: 'kim_dan',
    name: 'Kim Đan',
    minRealmOrder: 3,
    maxRealmOrder: 3,
    bracketTier: 3,
  },
  {
    bracketKey: 'nguyen_anh',
    name: 'Nguyên Anh',
    minRealmOrder: 4,
    maxRealmOrder: 4,
    bracketTier: 4,
  },
  {
    bracketKey: 'hoa_than',
    name: 'Hóa Thần',
    minRealmOrder: 5,
    maxRealmOrder: 5,
    bracketTier: 5,
  },
  {
    bracketKey: 'luyen_hu',
    name: 'Luyện Hư',
    minRealmOrder: 6,
    maxRealmOrder: 6,
    bracketTier: 6,
  },
  {
    bracketKey: 'hop_the',
    name: 'Hợp Thể',
    minRealmOrder: 7,
    maxRealmOrder: 7,
    bracketTier: 7,
  },
  {
    bracketKey: 'dai_thua',
    name: 'Đại Thừa',
    minRealmOrder: 8,
    maxRealmOrder: 8,
    bracketTier: 8,
  },
  {
    bracketKey: 'do_kiep',
    name: 'Độ Kiếp',
    minRealmOrder: 9,
    maxRealmOrder: 9,
    bracketTier: 9,
  },
  {
    bracketKey: 'tien_canh',
    name: 'Tiên cảnh',
    minRealmOrder: 10,
    maxRealmOrder: 27,
    bracketTier: 9,
  },
];

// ---------------------------------------------------------------------------
// 12. Core types
// ---------------------------------------------------------------------------

/**
 * `EventDef` — root catalog của event. Tương ứng row `EventDef` trong DB.
 */
export interface EventDef {
  key: string;
  name: string;
  description: string;
  eventType: EventType;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  /** IANA timezone, default `Asia/Ho_Chi_Minh`. */
  timezone: string;
  bannerUrl?: string | null;
  iconUrl?: string | null;
  /** Internal note, KHÔNG hiển thị cho player. */
  adminNote?: string | null;
  /** Multi-line VI/EN notice cho player (markdown). */
  playerNotice?: string | null;
  /** Hard kill switch; false = không kích hoạt dù status=ACTIVE. */
  enabled: boolean;
  bracketMode: BracketMode;
  /** Link tới `EventItemDef` đóng vai trò token chính (vd `ngoc_xa_lo`). */
  tokenKey?: string | null;
  /** Link tới `EventShopDef.key`. */
  eventShopKey?: string | null;
  /** Group key gom các `EventMissionDef`. */
  missionGroupKey?: string | null;
  /** Group key gom các `EventBossDef`. */
  bossGroupKey?: string | null;
  /** Group key gom các `EventRankingDef`. */
  rankingGroupKey?: string | null;
  /** Link tới `RewardProfile.key` (Phase 27.6) cho main reward pool. */
  rewardProfileKey?: string | null;
  createdBy: string;
  updatedBy: string;
}

/**
 * `EventBracketDef` — bracket cho 1 event cụ thể. Mỗi event có 0..n bracket.
 * Nếu `bracketMode === 'NONE'`, KHÔNG có bracket row nào.
 */
export interface EventBracketDef {
  key: string;
  eventKey: string;
  name: string;
  minRealmOrder: number;
  maxRealmOrder: number;
  minBodyRealmOrder?: number | null;
  maxBodyRealmOrder?: number | null;
  bracketTier: number;
  rewardTierMin: number;
  rewardTierMax: number;
  /** Reward tier tuyệt đối tối đa cho event này (cap toàn cục). */
  eventMaxTier: number;
  rankingEnabled: boolean;
  /** Shop filter — chỉ hiện item tier ≤ shopFilterTier cho bracket này. */
  shopFilterTier: number;
  /** Boss HP/damage multiplier cho bracket (1.0 = baseline). */
  bossPowerMultiplier: number;
  /** Mission target value multiplier (1.0 = baseline). */
  missionScalingMultiplier: number;
  enabled: boolean;
}

/**
 * `EventBalancePolicy` — cap & policy per-event.
 */
export interface EventBalancePolicy {
  eventKey: string;
  maxTokenPerDay: number;
  maxTokenPerWeek: number;
  maxTokenPerEvent: number;
  maxRareRewardPerDay: number;
  maxRareRewardPerWeek: number;
  maxShopRareExchangePerEvent: number;
  allowHighLevelEnterLowBracket: boolean;
  highLevelLowBracketTokenPenaltyPercent: number;
  highLevelLowBracketRankingDisabled: boolean;
  /** Reward tier cap derived from source bracket: `sourceTier + delta`. */
  sourceTierRewardCap: number;
  maxAllowedRewardTierDelta: number;
  paidRewardPolicy: PaidRewardPolicy;
  enabled: boolean;
}

/**
 * `EventItemDef` — định nghĩa item event (token / chest / ticket / cosmetic).
 */
export interface EventItemDef {
  key: string;
  name: string;
  description: string;
  itemKind: EventItemKind;
  /** 1..9 (tier vật phẩm). Cosmetic / token thường = 1. */
  itemTier: number;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  /** Category nhóm tự do (admin set, vd "alchemy_token"). */
  category: string;
  eventKey?: string | null;
  expiresAt?: Date | null;
  tradeable: boolean;
  bindOnPickup: boolean;
  maxStack: number;
  dailyGainCap?: number | null;
  weeklyGainCap?: number | null;
  eventGainCap?: number | null;
  /** Cho phép rơi từ những source nào (BOSS / DUNGEON / SHOP / ...). */
  allowedSources: readonly string[];
  forbiddenSources: readonly string[];
  /** Hint UI hiện cho player (vd "rơi từ Bí cảnh Tốc Chiến"). */
  sourceHint?: string | null;
  lootTableKey?: string | null;
  enabled: boolean;
}

/**
 * `EventMissionDef` — nhiệm vụ event (daily / weekly / event-once).
 */
export interface EventMissionDef {
  key: string;
  eventKey: string;
  bracketKey?: string | null;
  name: string;
  description: string;
  missionType: EventMissionType;
  targetValue: number;
  resetType: EventMissionResetType;
  rewardProfileKey?: string | null;
  scoreAmount: number;
  tokenReward: number;
  enabled: boolean;
}

/**
 * `EventShopDef` — gom các `EventShopItemDef` thuộc cùng shop logical.
 */
export interface EventShopDef {
  key: string;
  eventKey: string;
  name: string;
  tokenCurrencyKey: string;
  startsAt: Date;
  endsAt: Date;
  enabled: boolean;
}

export interface EventShopItemDef {
  key: string;
  shopKey: string;
  itemKey: string;
  /** Snapshot reward JSON (item/qty + optional currency). */
  rewardJson: readonly RewardJsonEntry[];
  priceTokenAmount: number;
  requiredBracketKey?: string | null;
  minRealmOrder?: number | null;
  maxRealmOrder?: number | null;
  purchaseLimitDaily?: number | null;
  purchaseLimitWeekly?: number | null;
  purchaseLimitEvent?: number | null;
  enabled: boolean;
}

/** Reward atom — cùng shape với reward-profile entry. */
export interface RewardJsonEntry {
  kind: 'ITEM' | 'CURRENCY' | 'EXP' | 'COSMETIC' | 'TITLE' | 'TOKEN';
  key: string;
  qty: number;
  itemTier?: number | null;
}

/**
 * `EventBossDef` — boss event runtime spec.
 */
export interface EventBossDef {
  key: string;
  eventKey: string;
  bracketKey?: string | null;
  name: string;
  description: string;
  bossType: EventBossType;
  sourceTier: number;
  bossTier: number;
  recommendedPower: number;
  hpFormulaKey?: string | null;
  scheduleKey?: string | null;
  participationRewardProfileKey?: string | null;
  damageRankingRewardProfileKey?: string | null;
  lastHitRewardProfileKey?: string | null;
  sectRewardProfileKey?: string | null;
  dailyAttempts: number;
  weeklyAttempts?: number | null;
  enabled: boolean;
}

/**
 * `EventRankingDef` — bảng ranking event.
 */
export interface EventRankingDef {
  key: string;
  eventKey: string;
  rankingType: EventRankingType;
  bracketMode: BracketMode;
  bracketKey?: string | null;
  scoreFormulaKey: string;
  rewardProfileKey?: string | null;
  startsAt: Date;
  endsAt: Date;
  finalized: boolean;
  enabled: boolean;
}

/**
 * `PersonalMilestoneEventDef` — event tự mở khi player đạt mốc.
 */
export interface PersonalMilestoneEventDef {
  key: string;
  name: string;
  description: string;
  triggerType: PersonalEventTriggerType;
  /** Vd: realmOrder=2 cho trigger=REALM_REACHED Trúc Cơ. */
  triggerValue: number;
  durationDays: number;
  bracketTier: number;
  missionGroupKey?: string | null;
  rewardProfileKey?: string | null;
  enabled: boolean;
}

/**
 * `EventChestLootEntry` — 1 entry trong loot table của chest event.
 *   `weight` cho weighted random; tổng weight không cần = 1 — service
 *   normalize.
 */
export interface EventChestLootEntry {
  itemKey: string;
  itemTier: number;
  weight: number;
  /** Reward tier policy cap; service clamp về min(playerTier, itemTier). */
  isRare: boolean;
  qtyMin: number;
  qtyMax: number;
}

// ---------------------------------------------------------------------------
// 13. Helpers — bracket / tier / score
// ---------------------------------------------------------------------------

/**
 * Map realm order → bracket tier dùng cho event. Đồng nhất với
 * `drop-economy.realmOrderToMaterialTier`.
 */
export function realmTierForEventBracket(realmOrder: number): number {
  return realmOrderToMaterialTier(realmOrder);
}

/**
 * Công thức bất biến của Phase 28.0:
 *
 *     rewardTier = min(playerTier, bracketTier, eventMaxTier)
 *
 * Clamp về [1, 9].
 */
export function computeEffectiveRewardTier(
  playerTier: number,
  bracketTier: number,
  eventMaxTier: number,
): number {
  const t = Math.min(playerTier, bracketTier, eventMaxTier);
  return Math.max(MIN_MATERIAL_TIER, Math.min(MAX_MATERIAL_TIER, Math.floor(t)));
}

/**
 * Tìm bracket phù hợp cho player. Trả về null nếu không bracket nào match —
 * caller xử lý fallback (vd cho player vào shared/no-bracket event).
 */
export function resolveBracketForPlayer<
  T extends Pick<
    EventBracketDef,
    'key' | 'minRealmOrder' | 'maxRealmOrder' | 'enabled'
  >,
>(brackets: readonly T[], playerRealmOrder: number): T | null {
  for (const b of brackets) {
    if (!b.enabled) continue;
    if (
      playerRealmOrder >= b.minRealmOrder &&
      playerRealmOrder <= b.maxRealmOrder
    ) {
      return b;
    }
  }
  return null;
}

/**
 * Player được tính là "cao cấp vào bracket thấp" khi `realmOrder > maxRealmOrder`
 * của bracket họ đang tham gia.
 */
export function isHighLevelInLowBracket(
  playerRealmOrder: number,
  bracketMaxRealmOrder: number,
): boolean {
  return playerRealmOrder > bracketMaxRealmOrder;
}

/**
 * Multiplier áp lên token/reward khi player cao cấp tham gia bracket thấp.
 * Trả 1.0 khi không penalty; 0..1 khi giảm.
 */
export function computeTokenPenaltyMultiplier(
  playerRealmOrder: number,
  bracketMaxRealmOrder: number,
  highLevelPenaltyPercent: number,
): number {
  if (!isHighLevelInLowBracket(playerRealmOrder, bracketMaxRealmOrder)) {
    return 1;
  }
  const clamped = Math.max(
    EVENT_HIGH_LEVEL_TOKEN_PENALTY_MIN,
    Math.min(EVENT_HIGH_LEVEL_TOKEN_PENALTY_MAX, highLevelPenaltyPercent),
  );
  return 1 - clamped;
}

/**
 * Score normalization theo tier delta (theo spec Phase 28.0 §9).
 *
 *   - Cùng tier             → 100
 *   - Thấp hơn 1 tier       → 50
 *   - Thấp hơn 2 tier       → 10
 *   - Thấp hơn ≥ 3 tier     → 0
 *   - Cao hơn (content cao hơn player) → tính thấp 30 để tránh exploit
 *     "1 lần kill T9 = 1000 điểm".
 */
export function computeScoreNormalization(
  contentTier: number,
  playerTier: number,
): number {
  const delta = contentTier - playerTier;
  if (delta === 0) return 100;
  if (delta === -1) return 50;
  if (delta === -2) return 10;
  if (delta <= -3) return 0;
  if (delta === 1) return 30;
  if (delta === 2) return 10;
  return 0;
}

/**
 * Helper `effectiveDropTier` re-export — admin UI dùng cho preview.
 */
export const eventEffectiveDropTier = effectiveDropTier;

// ---------------------------------------------------------------------------
// 14. Error codes
// ---------------------------------------------------------------------------

export type EventErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_NOT_ACTIVE'
  | 'EVENT_NOT_SCHEDULED'
  | 'EVENT_PAUSED'
  | 'EVENT_REWARD_LOCKED'
  | 'EVENT_ENDED'
  | 'EVENT_VALIDATION_FAILED'
  | 'EVENT_BRACKET_NOT_FOUND'
  | 'EVENT_BRACKET_MISMATCH'
  | 'EVENT_ITEM_INVALID'
  | 'EVENT_REWARD_INVALID'
  | 'EVENT_SHOP_LIMIT_REACHED'
  | 'EVENT_TOKEN_CAP_REACHED'
  | 'EVENT_MISSION_NOT_FOUND'
  | 'EVENT_MISSION_NOT_COMPLETED'
  | 'EVENT_MISSION_ALREADY_CLAIMED'
  | 'EVENT_RANKING_NOT_FINALIZED'
  | 'EVENT_PERSONAL_NOT_TRIGGERED'
  | 'EVENT_PERSONAL_EXPIRED'
  | 'EVENT_ADMIN_PERMISSION_DENIED'
  | 'EVENT_ADMIN_REASON_REQUIRED';

export const EVENT_ERROR_CODES: readonly EventErrorCode[] = [
  'EVENT_NOT_FOUND',
  'EVENT_NOT_ACTIVE',
  'EVENT_NOT_SCHEDULED',
  'EVENT_PAUSED',
  'EVENT_REWARD_LOCKED',
  'EVENT_ENDED',
  'EVENT_VALIDATION_FAILED',
  'EVENT_BRACKET_NOT_FOUND',
  'EVENT_BRACKET_MISMATCH',
  'EVENT_ITEM_INVALID',
  'EVENT_REWARD_INVALID',
  'EVENT_SHOP_LIMIT_REACHED',
  'EVENT_TOKEN_CAP_REACHED',
  'EVENT_MISSION_NOT_FOUND',
  'EVENT_MISSION_NOT_COMPLETED',
  'EVENT_MISSION_ALREADY_CLAIMED',
  'EVENT_RANKING_NOT_FINALIZED',
  'EVENT_PERSONAL_NOT_TRIGGERED',
  'EVENT_PERSONAL_EXPIRED',
  'EVENT_ADMIN_PERMISSION_DENIED',
  'EVENT_ADMIN_REASON_REQUIRED',
] as const;

export function isEventErrorCode(s: unknown): s is EventErrorCode {
  return (
    typeof s === 'string' &&
    (EVENT_ERROR_CODES as readonly string[]).includes(s)
  );
}

// ---------------------------------------------------------------------------
// 15. Audit action types (admin event-builder)
// ---------------------------------------------------------------------------

export type EventAdminActionType =
  | 'EVENT_CREATE'
  | 'EVENT_UPDATE'
  | 'EVENT_VALIDATE'
  | 'EVENT_SCHEDULE'
  | 'EVENT_ACTIVATE'
  | 'EVENT_PAUSE'
  | 'EVENT_LOCK_REWARDS'
  | 'EVENT_END'
  | 'EVENT_FINALIZE'
  | 'EVENT_ARCHIVE'
  | 'EVENT_CANCEL'
  | 'EVENT_BRACKET_UPSERT'
  | 'EVENT_BALANCE_UPSERT'
  | 'EVENT_ITEM_UPSERT'
  | 'EVENT_MISSION_UPSERT'
  | 'EVENT_SHOP_UPSERT'
  | 'EVENT_SHOP_ITEM_UPSERT'
  | 'EVENT_BOSS_UPSERT'
  | 'EVENT_RANKING_UPSERT'
  | 'EVENT_PERSONAL_UPSERT';

export const EVENT_ADMIN_ACTION_TYPES: readonly EventAdminActionType[] = [
  'EVENT_CREATE',
  'EVENT_UPDATE',
  'EVENT_VALIDATE',
  'EVENT_SCHEDULE',
  'EVENT_ACTIVATE',
  'EVENT_PAUSE',
  'EVENT_LOCK_REWARDS',
  'EVENT_END',
  'EVENT_FINALIZE',
  'EVENT_ARCHIVE',
  'EVENT_CANCEL',
  'EVENT_BRACKET_UPSERT',
  'EVENT_BALANCE_UPSERT',
  'EVENT_ITEM_UPSERT',
  'EVENT_MISSION_UPSERT',
  'EVENT_SHOP_UPSERT',
  'EVENT_SHOP_ITEM_UPSERT',
  'EVENT_BOSS_UPSERT',
  'EVENT_RANKING_UPSERT',
  'EVENT_PERSONAL_UPSERT',
] as const;

/** Action HIGH risk yêu cầu `reason` non-empty + (optional) confirmText. */
export const EVENT_ADMIN_ACTION_REQUIRE_REASON: ReadonlySet<EventAdminActionType> =
  new Set<EventAdminActionType>([
    'EVENT_ACTIVATE',
    'EVENT_LOCK_REWARDS',
    'EVENT_END',
    'EVENT_FINALIZE',
    'EVENT_ARCHIVE',
    'EVENT_CANCEL',
    'EVENT_BALANCE_UPSERT',
  ]);

// ---------------------------------------------------------------------------
// 16. Validators
// ---------------------------------------------------------------------------

export type EventValidationCode =
  | 'EVENT_KEY_INVALID'
  | 'EVENT_NAME_REQUIRED'
  | 'EVENT_NAME_TOO_LONG'
  | 'EVENT_DESC_TOO_LONG'
  | 'EVENT_TYPE_INVALID'
  | 'EVENT_STATUS_INVALID'
  | 'EVENT_WINDOW_INVALID'
  | 'EVENT_WINDOW_TOO_SHORT'
  | 'EVENT_WINDOW_TOO_LONG'
  | 'EVENT_BRACKET_MODE_INVALID'
  | 'EVENT_TIMEZONE_INVALID'
  | 'BRACKET_KEY_INVALID'
  | 'BRACKET_RANGE_INVALID'
  | 'BRACKET_TIER_INVALID'
  | 'BRACKET_REWARD_TIER_LEAK'
  | 'BRACKET_EVENT_MAX_TIER_INVALID'
  | 'BRACKET_MULTIPLIER_INVALID'
  | 'BALANCE_TOKEN_CAP_INVALID'
  | 'BALANCE_TOKEN_CAP_HARD_MAX'
  | 'BALANCE_DELTA_INVALID'
  | 'BALANCE_PENALTY_INVALID'
  | 'BALANCE_PAID_POLICY_INVALID'
  | 'ITEM_KIND_INVALID'
  | 'ITEM_KEY_INVALID'
  | 'ITEM_TIER_INVALID'
  | 'ITEM_TIER_TOO_HIGH_FOR_GROUP'
  | 'ITEM_GROUP_FORBIDDEN'
  | 'ITEM_EXPIRY_REQUIRED'
  | 'ITEM_CAP_REQUIRED'
  | 'ITEM_SOURCE_HINT_REQUIRED'
  | 'ITEM_STACK_INVALID'
  | 'REWARD_QTY_INVALID'
  | 'REWARD_QTY_EXCEEDS_TIER_CAP'
  | 'REWARD_TIER_INVALID'
  | 'REWARD_TIER_EXCEEDS_BRACKET'
  | 'REWARD_FORBIDDEN_ITEM'
  | 'REWARD_FORBIDDEN_CURRENCY'
  | 'SHOP_PRICE_INVALID'
  | 'SHOP_PURCHASE_LIMIT_INVALID'
  | 'SHOP_PURCHASE_LIMIT_MISSING_FOR_RARE'
  | 'SHOP_REWARD_INVALID'
  | 'MISSION_TARGET_INVALID'
  | 'MISSION_RESET_INVALID'
  | 'MISSION_SCORE_INVALID'
  | 'MISSION_TYPE_INVALID'
  | 'BOSS_TYPE_INVALID'
  | 'BOSS_TIER_INVALID'
  | 'BOSS_ATTEMPTS_INVALID'
  | 'RANKING_TYPE_INVALID'
  | 'RANKING_BRACKET_REQUIRED'
  | 'RANKING_FORMULA_INVALID'
  | 'CHEST_LOOT_WEIGHT_INVALID'
  | 'CHEST_LOOT_TIER_LEAK'
  | 'CHEST_LOOT_FORBIDDEN_ITEM'
  | 'PERSONAL_TRIGGER_INVALID'
  | 'PERSONAL_DURATION_INVALID';

export interface EventValidationError {
  code: EventValidationCode;
  field?: string;
  index?: number;
  detail?: string;
}

export interface EventValidationResult {
  ok: boolean;
  errors: readonly EventValidationError[];
  warnings: readonly EventValidationError[];
}

function ok(): EventValidationResult {
  return { ok: true, errors: [], warnings: [] };
}

function fail(
  errors: EventValidationError[],
  warnings: EventValidationError[] = [],
): EventValidationResult {
  return { ok: errors.length === 0, errors, warnings };
}

const VALID_TIMEZONE_PATTERN = /^[A-Za-z]+\/[A-Za-z_+\-/0-9]+$/;

export function validateEventDef(
  input: Partial<EventDef> & {
    key?: string;
    name?: string;
    eventType?: string;
    status?: string;
    startsAt?: Date | string;
    endsAt?: Date | string;
    bracketMode?: string;
    timezone?: string;
  },
): EventValidationResult {
  const errors: EventValidationError[] = [];

  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'EVENT_KEY_INVALID', field: 'key' });
  }
  if (!input.name || input.name.trim().length === 0) {
    errors.push({ code: 'EVENT_NAME_REQUIRED', field: 'name' });
  } else if (input.name.length > EVENT_NAME_MAX) {
    errors.push({ code: 'EVENT_NAME_TOO_LONG', field: 'name' });
  }
  if (input.description && input.description.length > EVENT_DESCRIPTION_MAX) {
    errors.push({ code: 'EVENT_DESC_TOO_LONG', field: 'description' });
  }
  if (!input.eventType || !isEventType(input.eventType)) {
    errors.push({ code: 'EVENT_TYPE_INVALID', field: 'eventType' });
  }
  if (input.status && !(EVENT_STATUSES as readonly string[]).includes(input.status)) {
    errors.push({ code: 'EVENT_STATUS_INVALID', field: 'status' });
  }
  if (
    input.bracketMode &&
    !(BRACKET_MODES as readonly string[]).includes(input.bracketMode)
  ) {
    errors.push({ code: 'EVENT_BRACKET_MODE_INVALID', field: 'bracketMode' });
  }
  if (
    input.timezone &&
    !VALID_TIMEZONE_PATTERN.test(input.timezone) &&
    input.timezone !== 'UTC'
  ) {
    errors.push({ code: 'EVENT_TIMEZONE_INVALID', field: 'timezone' });
  }

  const startMs = toMs(input.startsAt);
  const endMs = toMs(input.endsAt);
  if (startMs === null || endMs === null) {
    errors.push({ code: 'EVENT_WINDOW_INVALID', field: 'startsAt' });
  } else {
    if (endMs <= startMs) {
      errors.push({ code: 'EVENT_WINDOW_INVALID', field: 'endsAt' });
    } else {
      const win = endMs - startMs;
      if (win < EVENT_MIN_WINDOW_MS) {
        errors.push({ code: 'EVENT_WINDOW_TOO_SHORT', field: 'endsAt' });
      }
      if (win > EVENT_MAX_WINDOW_MS) {
        errors.push({ code: 'EVENT_WINDOW_TOO_LONG', field: 'endsAt' });
      }
    }
  }

  return fail(errors);
}

function toMs(v: Date | string | undefined | null): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

export function validateEventBracket(
  input: Partial<EventBracketDef> & { key?: string; eventKey?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'BRACKET_KEY_INVALID', field: 'key' });
  }
  if (!input.eventKey || !EVENT_KEY_PATTERN.test(input.eventKey)) {
    errors.push({ code: 'BRACKET_KEY_INVALID', field: 'eventKey' });
  }
  const min = input.minRealmOrder;
  const max = input.maxRealmOrder;
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max < min ||
    max > 27
  ) {
    errors.push({ code: 'BRACKET_RANGE_INVALID', field: 'minRealmOrder' });
  }
  const tier = input.bracketTier;
  if (
    typeof tier !== 'number' ||
    !Number.isFinite(tier) ||
    tier < MIN_MATERIAL_TIER ||
    tier > MAX_MATERIAL_TIER
  ) {
    errors.push({ code: 'BRACKET_TIER_INVALID', field: 'bracketTier' });
  }
  if (
    typeof input.rewardTierMin === 'number' &&
    typeof input.rewardTierMax === 'number'
  ) {
    if (input.rewardTierMin > input.rewardTierMax) {
      errors.push({ code: 'BRACKET_REWARD_TIER_LEAK', field: 'rewardTierMin' });
    }
    if (
      typeof tier === 'number' &&
      input.rewardTierMax >
        tier + EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX
    ) {
      errors.push({
        code: 'BRACKET_REWARD_TIER_LEAK',
        field: 'rewardTierMax',
        detail: `rewardTierMax ${input.rewardTierMax} > bracketTier ${tier} + ${EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX}`,
      });
    }
  }
  if (typeof input.eventMaxTier === 'number') {
    if (
      input.eventMaxTier < MIN_MATERIAL_TIER ||
      input.eventMaxTier > MAX_MATERIAL_TIER
    ) {
      errors.push({
        code: 'BRACKET_EVENT_MAX_TIER_INVALID',
        field: 'eventMaxTier',
      });
    }
  }
  if (typeof input.bossPowerMultiplier === 'number') {
    if (
      input.bossPowerMultiplier < 0.1 ||
      input.bossPowerMultiplier > 50 ||
      !Number.isFinite(input.bossPowerMultiplier)
    ) {
      errors.push({
        code: 'BRACKET_MULTIPLIER_INVALID',
        field: 'bossPowerMultiplier',
      });
    }
  }
  if (typeof input.missionScalingMultiplier === 'number') {
    if (
      input.missionScalingMultiplier < 0.1 ||
      input.missionScalingMultiplier > 50 ||
      !Number.isFinite(input.missionScalingMultiplier)
    ) {
      errors.push({
        code: 'BRACKET_MULTIPLIER_INVALID',
        field: 'missionScalingMultiplier',
      });
    }
  }
  return fail(errors);
}

export function validateEventBalancePolicy(
  input: Partial<EventBalancePolicy> & { eventKey?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.eventKey || !EVENT_KEY_PATTERN.test(input.eventKey)) {
    errors.push({ code: 'BRACKET_KEY_INVALID', field: 'eventKey' });
  }
  for (const f of [
    'maxTokenPerDay',
    'maxTokenPerWeek',
    'maxTokenPerEvent',
  ] as const) {
    const v = input[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push({ code: 'BALANCE_TOKEN_CAP_INVALID', field: f });
    }
  }
  if (
    typeof input.maxTokenPerDay === 'number' &&
    input.maxTokenPerDay > EVENT_TOKEN_DAILY_CAP_HARD_MAX
  ) {
    errors.push({ code: 'BALANCE_TOKEN_CAP_HARD_MAX', field: 'maxTokenPerDay' });
  }
  if (
    typeof input.maxTokenPerWeek === 'number' &&
    input.maxTokenPerWeek > EVENT_TOKEN_WEEKLY_CAP_HARD_MAX
  ) {
    errors.push({ code: 'BALANCE_TOKEN_CAP_HARD_MAX', field: 'maxTokenPerWeek' });
  }
  if (
    typeof input.maxTokenPerEvent === 'number' &&
    input.maxTokenPerEvent > EVENT_TOKEN_EVENT_CAP_HARD_MAX
  ) {
    errors.push({ code: 'BALANCE_TOKEN_CAP_HARD_MAX', field: 'maxTokenPerEvent' });
  }
  if (
    typeof input.maxAllowedRewardTierDelta === 'number' &&
    (input.maxAllowedRewardTierDelta < 0 ||
      input.maxAllowedRewardTierDelta > EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX)
  ) {
    errors.push({ code: 'BALANCE_DELTA_INVALID', field: 'maxAllowedRewardTierDelta' });
  }
  if (
    typeof input.highLevelLowBracketTokenPenaltyPercent === 'number' &&
    (input.highLevelLowBracketTokenPenaltyPercent <
      EVENT_HIGH_LEVEL_TOKEN_PENALTY_MIN ||
      input.highLevelLowBracketTokenPenaltyPercent >
        EVENT_HIGH_LEVEL_TOKEN_PENALTY_MAX)
  ) {
    errors.push({
      code: 'BALANCE_PENALTY_INVALID',
      field: 'highLevelLowBracketTokenPenaltyPercent',
    });
  }
  if (
    input.paidRewardPolicy &&
    !(PAID_REWARD_POLICIES as readonly string[]).includes(input.paidRewardPolicy)
  ) {
    errors.push({ code: 'BALANCE_PAID_POLICY_INVALID', field: 'paidRewardPolicy' });
  }
  return fail(errors);
}

export function validateEventItem(
  input: Partial<EventItemDef> & { key?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (
    !input.itemKind ||
    !(EVENT_ITEM_KINDS as readonly string[]).includes(input.itemKind)
  ) {
    errors.push({ code: 'ITEM_KIND_INVALID', field: 'itemKind' });
  }
  const tier = input.itemTier;
  if (
    typeof tier !== 'number' ||
    !Number.isFinite(tier) ||
    tier < MIN_MATERIAL_TIER ||
    tier > MAX_MATERIAL_TIER
  ) {
    errors.push({ code: 'ITEM_TIER_INVALID', field: 'itemTier' });
  }
  if (input.itemKind) {
    const group = EVENT_ITEM_RISK_GROUP_BY_KIND[input.itemKind];
    if (group === 'D') {
      errors.push({ code: 'ITEM_GROUP_FORBIDDEN', field: 'itemKind' });
    } else if (
      group &&
      typeof tier === 'number' &&
      tier > EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP[group]
    ) {
      errors.push({
        code: 'ITEM_TIER_TOO_HIGH_FOR_GROUP',
        field: 'itemTier',
        detail: `group ${group} max tier ${EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP[group]}`,
      });
    }
  }

  // ephemeral kinds need expiresAt
  const ephemeralKinds: ReadonlySet<EventItemKind> = new Set<EventItemKind>([
    'EVENT_TOKEN',
    'EVENT_TICKET',
    'EVENT_QUEST_ITEM',
    'EVENT_CHEST',
  ]);
  if (
    input.itemKind &&
    ephemeralKinds.has(input.itemKind) &&
    !input.expiresAt &&
    !input.eventKey
  ) {
    errors.push({ code: 'ITEM_EXPIRY_REQUIRED', field: 'expiresAt' });
  }

  // tokens require dailyGainCap
  if (input.itemKind === 'EVENT_TOKEN') {
    const hasCap =
      (typeof input.dailyGainCap === 'number' && input.dailyGainCap > 0) ||
      (typeof input.weeklyGainCap === 'number' && input.weeklyGainCap > 0) ||
      (typeof input.eventGainCap === 'number' && input.eventGainCap > 0);
    if (!hasCap) {
      errors.push({ code: 'ITEM_CAP_REQUIRED', field: 'dailyGainCap' });
    }
  }

  if (!input.sourceHint || input.sourceHint.trim().length === 0) {
    errors.push({ code: 'ITEM_SOURCE_HINT_REQUIRED', field: 'sourceHint' });
  }

  if (
    typeof input.maxStack === 'number' &&
    (input.maxStack < 1 || input.maxStack > 1_000_000)
  ) {
    errors.push({ code: 'ITEM_STACK_INVALID', field: 'maxStack' });
  }

  return fail(errors);
}

export interface EventRewardContext {
  bracketTier: number;
  eventMaxTier: number;
  sourceTier: number;
  paidRewardPolicy?: PaidRewardPolicy;
  maxAllowedRewardTierDelta?: number;
}

export function validateEventReward(
  reward: RewardJsonEntry,
  ctx: EventRewardContext,
  index = 0,
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!reward.key || reward.key.length < 1) {
    errors.push({ code: 'REWARD_TIER_INVALID', field: 'key', index });
  }
  if (!Number.isFinite(reward.qty) || reward.qty <= 0 || reward.qty > 1_000_000) {
    errors.push({ code: 'REWARD_QTY_INVALID', field: 'qty', index });
  }
  // Forbidden items
  if (
    reward.kind === 'ITEM' &&
    (FORBIDDEN_REWARD_ITEM_KEYS.has(reward.key) ||
      ADMIN_FORBIDDEN_GRANT_ITEMS.has(reward.key) ||
      isForbiddenAdminGrantItem(reward.key))
  ) {
    errors.push({ code: 'REWARD_FORBIDDEN_ITEM', field: 'key', index });
  }
  // TIEN_NGOC (real-money currency) — never grant via event reward
  if (reward.kind === 'CURRENCY' && reward.key === 'TIEN_NGOC') {
    errors.push({ code: 'REWARD_FORBIDDEN_CURRENCY', field: 'key', index });
  }
  // Paid policy enforcement
  if (
    ctx.paidRewardPolicy === 'PAID_COSMETIC' &&
    !(reward.kind === 'COSMETIC' || reward.kind === 'TITLE' || reward.kind === 'TOKEN')
  ) {
    errors.push({
      code: 'REWARD_FORBIDDEN_ITEM',
      field: 'kind',
      index,
      detail: 'paid policy COSMETIC only',
    });
  }
  // Tier checks
  const tier =
    typeof reward.itemTier === 'number' && Number.isFinite(reward.itemTier)
      ? Math.floor(reward.itemTier)
      : null;
  if (tier !== null) {
    if (tier < MIN_MATERIAL_TIER || tier > MAX_MATERIAL_TIER) {
      errors.push({ code: 'REWARD_TIER_INVALID', field: 'itemTier', index });
    } else {
      const delta = ctx.maxAllowedRewardTierDelta ?? EVENT_MAX_REWARD_TIER_DELTA_DEFAULT;
      const cap = Math.min(
        ctx.eventMaxTier,
        Math.min(ctx.bracketTier, ctx.sourceTier) + delta,
      );
      if (tier > cap) {
        errors.push({
          code: 'REWARD_TIER_EXCEEDS_BRACKET',
          field: 'itemTier',
          index,
          detail: `tier ${tier} > cap ${cap}`,
        });
      }
      const qtyCap = REWARD_QTY_CAP_BY_TIER[tier];
      if (typeof qtyCap === 'number' && reward.qty > qtyCap) {
        errors.push({
          code: 'REWARD_QTY_EXCEEDS_TIER_CAP',
          field: 'qty',
          index,
          detail: `qty ${reward.qty} > qtyCap ${qtyCap} for tier ${tier}`,
        });
      }
    }
  }
  return fail(errors);
}

export function validateEventRewardList(
  rewards: readonly RewardJsonEntry[],
  ctx: EventRewardContext,
): EventValidationResult {
  const errors: EventValidationError[] = [];
  rewards.forEach((r, i) => {
    const res = validateEventReward(r, ctx, i);
    errors.push(...res.errors);
  });
  return fail(errors);
}

export function validateEventShop(
  input: Partial<EventShopDef> & { key?: string; eventKey?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (!input.eventKey || !EVENT_KEY_PATTERN.test(input.eventKey)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'eventKey' });
  }
  if (!input.tokenCurrencyKey || input.tokenCurrencyKey.trim().length === 0) {
    errors.push({ code: 'SHOP_PRICE_INVALID', field: 'tokenCurrencyKey' });
  }
  const sMs = toMs(input.startsAt);
  const eMs = toMs(input.endsAt);
  if (sMs === null || eMs === null || eMs <= sMs) {
    errors.push({ code: 'EVENT_WINDOW_INVALID', field: 'startsAt' });
  }
  return fail(errors);
}

export function validateEventShopItem(
  input: Partial<EventShopItemDef> & { key?: string },
  ctx: EventRewardContext,
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (
    typeof input.priceTokenAmount !== 'number' ||
    !Number.isFinite(input.priceTokenAmount) ||
    input.priceTokenAmount < 0
  ) {
    errors.push({ code: 'SHOP_PRICE_INVALID', field: 'priceTokenAmount' });
  }
  // Rare items require purchase limit
  const rewards = input.rewardJson ?? [];
  let hasRare = false;
  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i];
    if (typeof r.itemTier === 'number' && r.itemTier >= 6) hasRare = true;
    const v = validateEventReward(r, ctx, i);
    errors.push(...v.errors);
  }
  if (hasRare) {
    const hasLimit =
      (typeof input.purchaseLimitDaily === 'number' &&
        input.purchaseLimitDaily > 0) ||
      (typeof input.purchaseLimitWeekly === 'number' &&
        input.purchaseLimitWeekly > 0) ||
      (typeof input.purchaseLimitEvent === 'number' &&
        input.purchaseLimitEvent > 0);
    if (!hasLimit) {
      errors.push({
        code: 'SHOP_PURCHASE_LIMIT_MISSING_FOR_RARE',
        field: 'purchaseLimitEvent',
      });
    }
  }
  for (const f of [
    'purchaseLimitDaily',
    'purchaseLimitWeekly',
    'purchaseLimitEvent',
  ] as const) {
    const v = input[f];
    if (typeof v === 'number') {
      if (v < 0 || v > EVENT_SHOP_PURCHASE_LIMIT_HARD_MAX) {
        errors.push({ code: 'SHOP_PURCHASE_LIMIT_INVALID', field: f });
      }
    }
  }
  return fail(errors);
}

export function validateEventMission(
  input: Partial<EventMissionDef> & { key?: string; eventKey?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (!input.eventKey || !EVENT_KEY_PATTERN.test(input.eventKey)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'eventKey' });
  }
  if (
    !input.missionType ||
    !(EVENT_MISSION_TYPES as readonly string[]).includes(input.missionType)
  ) {
    errors.push({ code: 'MISSION_TYPE_INVALID', field: 'missionType' });
  }
  if (
    typeof input.targetValue !== 'number' ||
    !Number.isFinite(input.targetValue) ||
    input.targetValue <= 0 ||
    input.targetValue > 1_000_000
  ) {
    errors.push({ code: 'MISSION_TARGET_INVALID', field: 'targetValue' });
  }
  if (
    !input.resetType ||
    !(EVENT_MISSION_RESET_TYPES as readonly string[]).includes(input.resetType)
  ) {
    errors.push({ code: 'MISSION_RESET_INVALID', field: 'resetType' });
  }
  if (
    typeof input.scoreAmount === 'number' &&
    (input.scoreAmount < 0 || input.scoreAmount > 100_000)
  ) {
    errors.push({ code: 'MISSION_SCORE_INVALID', field: 'scoreAmount' });
  }
  if (
    typeof input.tokenReward === 'number' &&
    (input.tokenReward < 0 || input.tokenReward > EVENT_TOKEN_DAILY_CAP_HARD_MAX)
  ) {
    errors.push({ code: 'MISSION_SCORE_INVALID', field: 'tokenReward' });
  }
  return fail(errors);
}

export function validateEventBoss(
  input: Partial<EventBossDef> & { key?: string; eventKey?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (
    !input.bossType ||
    !(EVENT_BOSS_TYPES as readonly string[]).includes(input.bossType)
  ) {
    errors.push({ code: 'BOSS_TYPE_INVALID', field: 'bossType' });
  }
  if (
    typeof input.sourceTier !== 'number' ||
    input.sourceTier < MIN_MATERIAL_TIER ||
    input.sourceTier > MAX_MATERIAL_TIER
  ) {
    errors.push({ code: 'BOSS_TIER_INVALID', field: 'sourceTier' });
  }
  if (
    typeof input.bossTier !== 'number' ||
    input.bossTier < MIN_MATERIAL_TIER ||
    input.bossTier > MAX_MATERIAL_TIER
  ) {
    errors.push({ code: 'BOSS_TIER_INVALID', field: 'bossTier' });
  }
  if (
    typeof input.bossTier === 'number' &&
    typeof input.sourceTier === 'number' &&
    input.bossTier > input.sourceTier + REWARD_TIER_LEAK_DELTA
  ) {
    errors.push({
      code: 'BOSS_TIER_INVALID',
      field: 'bossTier',
      detail: `bossTier ${input.bossTier} > sourceTier ${input.sourceTier} + leakDelta ${REWARD_TIER_LEAK_DELTA}`,
    });
  }
  if (
    typeof input.dailyAttempts === 'number' &&
    (input.dailyAttempts < 0 || input.dailyAttempts > 100)
  ) {
    errors.push({ code: 'BOSS_ATTEMPTS_INVALID', field: 'dailyAttempts' });
  }
  return fail(errors);
}

export function validateEventRanking(
  input: Partial<EventRankingDef> & {
    key?: string;
    eventType?: EventType;
  },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (
    !input.rankingType ||
    !(EVENT_RANKING_TYPES as readonly string[]).includes(input.rankingType)
  ) {
    errors.push({ code: 'RANKING_TYPE_INVALID', field: 'rankingType' });
  }
  if (
    !input.bracketMode ||
    !(BRACKET_MODES as readonly string[]).includes(input.bracketMode)
  ) {
    errors.push({ code: 'EVENT_BRACKET_MODE_INVALID', field: 'bracketMode' });
  }
  if (
    input.eventType &&
    EVENT_TYPES_REQUIRE_BRACKET_RANKING.has(input.eventType) &&
    (!input.bracketMode || input.bracketMode === 'NONE')
  ) {
    errors.push({
      code: 'RANKING_BRACKET_REQUIRED',
      field: 'bracketMode',
      detail: `event type ${input.eventType} requires non-NONE bracketMode`,
    });
  }
  if (!input.scoreFormulaKey || input.scoreFormulaKey.length === 0) {
    errors.push({ code: 'RANKING_FORMULA_INVALID', field: 'scoreFormulaKey' });
  }
  return fail(errors);
}

export function validateEventChestLootTable(
  entries: readonly EventChestLootEntry[],
  ctx: EventRewardContext,
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!entries || entries.length === 0) {
    errors.push({ code: 'CHEST_LOOT_WEIGHT_INVALID', field: 'entries' });
    return fail(errors);
  }
  let totalWeight = 0;
  entries.forEach((e, i) => {
    if (!Number.isFinite(e.weight) || e.weight <= 0) {
      errors.push({ code: 'CHEST_LOOT_WEIGHT_INVALID', field: 'weight', index: i });
    } else {
      totalWeight += e.weight;
    }
    if (
      typeof e.itemTier !== 'number' ||
      e.itemTier < MIN_MATERIAL_TIER ||
      e.itemTier > MAX_MATERIAL_TIER
    ) {
      errors.push({ code: 'CHEST_LOOT_TIER_LEAK', field: 'itemTier', index: i });
    } else {
      const delta = ctx.maxAllowedRewardTierDelta ?? EVENT_MAX_REWARD_TIER_DELTA_DEFAULT;
      const cap = Math.min(
        ctx.eventMaxTier,
        Math.min(ctx.bracketTier, ctx.sourceTier) + delta,
      );
      if (e.itemTier > cap) {
        errors.push({
          code: 'CHEST_LOOT_TIER_LEAK',
          field: 'itemTier',
          index: i,
          detail: `tier ${e.itemTier} > cap ${cap}`,
        });
      }
    }
    if (
      FORBIDDEN_REWARD_ITEM_KEYS.has(e.itemKey) ||
      ADMIN_FORBIDDEN_GRANT_ITEMS.has(e.itemKey)
    ) {
      errors.push({
        code: 'CHEST_LOOT_FORBIDDEN_ITEM',
        field: 'itemKey',
        index: i,
      });
    }
    if (e.qtyMin <= 0 || e.qtyMax < e.qtyMin || e.qtyMax > 10_000) {
      errors.push({ code: 'CHEST_LOOT_WEIGHT_INVALID', field: 'qtyMax', index: i });
    }
  });
  if (totalWeight <= 0) {
    errors.push({ code: 'CHEST_LOOT_WEIGHT_INVALID', field: 'entries' });
  }
  return fail(errors);
}

export function validateEventPersonalMilestone(
  input: Partial<PersonalMilestoneEventDef> & { key?: string },
): EventValidationResult {
  const errors: EventValidationError[] = [];
  if (!input.key || !EVENT_KEY_PATTERN.test(input.key)) {
    errors.push({ code: 'ITEM_KEY_INVALID', field: 'key' });
  }
  if (
    !input.triggerType ||
    !(PERSONAL_EVENT_TRIGGER_TYPES as readonly string[]).includes(
      input.triggerType,
    )
  ) {
    errors.push({ code: 'PERSONAL_TRIGGER_INVALID', field: 'triggerType' });
  }
  if (
    typeof input.triggerValue !== 'number' ||
    !Number.isFinite(input.triggerValue) ||
    input.triggerValue < 0
  ) {
    errors.push({ code: 'PERSONAL_TRIGGER_INVALID', field: 'triggerValue' });
  }
  if (
    typeof input.durationDays !== 'number' ||
    input.durationDays <= 0 ||
    input.durationDays > 90
  ) {
    errors.push({ code: 'PERSONAL_DURATION_INVALID', field: 'durationDays' });
  }
  if (
    typeof input.bracketTier !== 'number' ||
    input.bracketTier < MIN_MATERIAL_TIER ||
    input.bracketTier > MAX_MATERIAL_TIER
  ) {
    errors.push({ code: 'BRACKET_TIER_INVALID', field: 'bracketTier' });
  }
  return fail(errors);
}

// ---------------------------------------------------------------------------
// 17. Preset event templates
// ---------------------------------------------------------------------------

/**
 * Mỗi preset là 1 "stub" cho admin dùng `POST /admin/events` `fromTemplate`
 * tạo nhanh. Template KHÔNG bao gồm runtime config chi tiết (mission/shop/
 * boss/ranking) — admin tự thêm sau.
 */
export interface EventTemplate {
  templateKey: string;
  name: string;
  description: string;
  eventType: EventType;
  bracketMode: BracketMode;
  defaultDurationDays: number;
  /** Suggested bracket scope từ default catalog (subset of bracketKey). */
  suggestedBrackets: readonly string[];
  /** Suggested paid policy. */
  suggestedPaidPolicy: PaidRewardPolicy;
  /** Suggested mission group name (admin có thể đổi). */
  suggestedMissionGroupKey: string;
}

export const PRESET_EVENT_TEMPLATES: readonly EventTemplate[] = [
  // Retention
  {
    templateKey: 'login_7_days',
    name: 'Đăng Nhập 7 Ngày',
    description: 'Đăng nhập liên tục 7 ngày nhận token + cosmetic.',
    eventType: 'LOGIN_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 7,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'login_daily',
  },
  {
    templateKey: 'tu_tien_moi_ngay',
    name: 'Tu Tiên Mỗi Ngày',
    description: 'Hoàn thành nhiệm vụ tu luyện ngày.',
    eventType: 'DAILY_ACTIVITY_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'daily_activity_v1',
  },
  {
    templateKey: 'farm_60_phut',
    name: 'Farm 60 Phút',
    description: 'Farm map cùng cấp 60 phút mỗi ngày.',
    eventType: 'FARM_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['luyen_khi', 'truc_co', 'kim_dan', 'nguyen_anh'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'farm_event_v1',
  },
  {
    templateKey: 'bi_canh_ngay',
    name: 'Bí Cảnh Ngày',
    description: 'Hoàn thành bí cảnh mỗi ngày.',
    eventType: 'DUNGEON_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['truc_co', 'kim_dan', 'nguyen_anh', 'hoa_than'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'dungeon_daily',
  },
  {
    templateKey: 'boss_ca_nhan_ngay',
    name: 'Boss Cá Nhân Ngày',
    description: 'Đánh bại boss cá nhân scale theo cảnh giới.',
    eventType: 'BOSS_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: [
      'luyen_khi',
      'truc_co',
      'kim_dan',
      'nguyen_anh',
      'hoa_than',
    ],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'boss_daily',
  },
  // Milestone realm
  {
    templateKey: 'luyen_khi_nhap_dao',
    name: 'Luyện Khí Nhập Đạo',
    description: 'Event cá nhân Luyện Khí Nhập Đạo 7 ngày.',
    eventType: 'REALM_MILESTONE_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 7,
    suggestedBrackets: ['luyen_khi'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_luyen_khi',
  },
  {
    templateKey: 'truc_co_tan_lo',
    name: 'Trúc Cơ Tân Lộ',
    description: 'Event cá nhân Trúc Cơ Tân Lộ 7 ngày.',
    eventType: 'REALM_MILESTONE_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 7,
    suggestedBrackets: ['truc_co'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_truc_co',
  },
  {
    templateKey: 'kim_dan_khai_dao',
    name: 'Kim Đan Khai Đạo',
    description: 'Event cá nhân Kim Đan Khai Đạo 10 ngày.',
    eventType: 'REALM_MILESTONE_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 10,
    suggestedBrackets: ['kim_dan'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_kim_dan',
  },
  {
    templateKey: 'nguyen_anh_xuat_the',
    name: 'Nguyên Anh Xuất Thế',
    description: 'Event cá nhân Nguyên Anh Xuất Thế 10 ngày.',
    eventType: 'REALM_MILESTONE_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 10,
    suggestedBrackets: ['nguyen_anh'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_nguyen_anh',
  },
  {
    templateKey: 'hoa_than_khai_vuc',
    name: 'Hóa Thần Khai Vực',
    description: 'Event cá nhân Hóa Thần Khai Vực 14 ngày.',
    eventType: 'REALM_MILESTONE_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 14,
    suggestedBrackets: ['hoa_than'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_hoa_than',
  },
  {
    templateKey: 'luyen_the_dot_pha',
    name: 'Luyện Thể Đột Phá',
    description: 'Event cá nhân Luyện Thể Đột Phá theo body realm.',
    eventType: 'BODY_REALM_MILESTONE_EVENT',
    bracketMode: 'BODY_REALM_BRACKET',
    defaultDurationDays: 10,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'milestone_luyen_the',
  },
  // Competitive
  {
    templateKey: 'luyen_dan_dai_hoi',
    name: 'Luyện Đan Đại Hội',
    description: 'Cuộc thi luyện đan toàn server theo bracket.',
    eventType: 'ALCHEMY_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: [
      'truc_co',
      'kim_dan',
      'nguyen_anh',
      'hoa_than',
      'luyen_hu',
    ],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'alchemy_contest',
  },
  {
    templateKey: 'dang_tien_thap_mua',
    name: 'Đăng Tiên Tháp Mùa',
    description: 'Mùa leo tháp Đăng Tiên Tháp.',
    eventType: 'TOWER_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 21,
    suggestedBrackets: [
      'truc_co',
      'kim_dan',
      'nguyen_anh',
      'hoa_than',
      'luyen_hu',
      'hop_the',
    ],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'tower_season',
  },
  {
    templateKey: 'san_boss_tranh_phong',
    name: 'Săn Boss Tranh Phong',
    description: 'Săn boss tranh top damage theo bracket.',
    eventType: 'BOSS_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: [
      'kim_dan',
      'nguyen_anh',
      'hoa_than',
      'luyen_hu',
      'hop_the',
    ],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'boss_hunt',
  },
  {
    templateKey: 'bi_canh_toc_chien',
    name: 'Bí Cảnh Tốc Chiến',
    description: 'Clear bí cảnh nhanh nhất theo bracket.',
    eventType: 'DUNGEON_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'dungeon_speedrun',
  },
  {
    templateKey: 'cong_phap_linh_ngo',
    name: 'Công Pháp Lĩnh Ngộ',
    description: 'Sự kiện học/nâng cấp công pháp.',
    eventType: 'CUSTOM_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 10,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'PAID_TIER_CAP',
    suggestedMissionGroupKey: 'method_event',
  },
  {
    templateKey: 'phap_bao_ren_luyen',
    name: 'Pháp Bảo Rèn Luyện',
    description: 'Sự kiện luyện chế pháp bảo.',
    eventType: 'ARTIFACT_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 10,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than', 'luyen_hu'],
    suggestedPaidPolicy: 'PAID_TIER_CAP',
    suggestedMissionGroupKey: 'artifact_event',
  },
  // Sect
  {
    templateKey: 'tong_mon_dong_tam',
    name: 'Tông Môn Đồng Tâm',
    description: 'Hoạt động đoàn kết tông môn.',
    eventType: 'SECT_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 14,
    suggestedBrackets: ['truc_co', 'kim_dan', 'nguyen_anh'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'sect_unity',
  },
  {
    templateKey: 'thu_ho_linh_mach',
    name: 'Thủ Hộ Linh Mạch',
    description: 'Thủ hộ linh mạch tông môn.',
    eventType: 'SECT_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'sect_guard',
  },
  {
    templateKey: 'tong_mon_boss_tuan',
    name: 'Tông Môn Boss Tuần',
    description: 'Boss tông môn tuần.',
    eventType: 'SECT_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than', 'luyen_hu'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'sect_boss_weekly',
  },
  {
    templateKey: 'tong_mon_cong_hien',
    name: 'Tông Môn Cống Hiến',
    description: 'Đóng góp tông môn lũy điểm.',
    eventType: 'SECT_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'sect_contribution',
  },
  {
    templateKey: 'tong_mon_tranh_ba',
    name: 'Tông Môn Tranh Bá',
    description: 'Cuộc thi tông môn tranh bá.',
    eventType: 'SECT_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 14,
    suggestedBrackets: ['nguyen_anh', 'hoa_than', 'luyen_hu', 'hop_the'],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'sect_war_event',
  },
  // World
  {
    templateKey: 'ma_trieu_xam_lan',
    name: 'Ma Triều Xâm Lấn',
    description: 'Ma triều xâm lấn toàn server theo bracket.',
    eventType: 'WORLD_BOSS_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than', 'luyen_hu'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'world_invasion',
  },
  {
    templateKey: 'yeu_thu_cong_thanh',
    name: 'Yêu Thú Công Thành',
    description: 'Yêu thú tấn công thành.',
    eventType: 'WORLD_BOSS_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 7,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'world_beast_siege',
  },
  {
    templateKey: 'thien_kiep_di_bien',
    name: 'Thiên Kiếp Dị Biến',
    description: 'Thiên kiếp dị biến vùng cao.',
    eventType: 'WORLD_BOSS_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 5,
    suggestedBrackets: ['nguyen_anh', 'hoa_than', 'luyen_hu', 'hop_the'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'world_tribulation_event',
  },
  {
    templateKey: 'linh_mach_bao_phat',
    name: 'Linh Mạch Bạo Phát',
    description: 'Linh mạch bạo phát farm cùng cấp.',
    eventType: 'FARM_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 5,
    suggestedBrackets: ['luyen_khi', 'truc_co', 'kim_dan', 'nguyen_anh'],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'world_ley_burst',
  },
  {
    templateKey: 'co_dong_phu_khai_mo',
    name: 'Cổ Động Phủ Khai Mở',
    description: 'Cổ động phủ khai mở thám hiểm.',
    eventType: 'DUNGEON_EVENT',
    bracketMode: 'REALM_BRACKET',
    defaultDurationDays: 10,
    suggestedBrackets: ['kim_dan', 'nguyen_anh', 'hoa_than', 'luyen_hu'],
    suggestedPaidPolicy: 'PAID_TIER_CAP',
    suggestedMissionGroupKey: 'world_ancient_cave',
  },
  // Holiday
  {
    templateKey: 'tet_nguyen_dan',
    name: 'Tết Nguyên Đán',
    description: 'Lễ Tết Nguyên Đán.',
    eventType: 'HOLIDAY_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'holiday_tet',
  },
  {
    templateKey: 'trung_thu',
    name: 'Trung Thu',
    description: 'Lễ Trung Thu.',
    eventType: 'HOLIDAY_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 10,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'holiday_trung_thu',
  },
  {
    templateKey: 'le_khai_server',
    name: 'Lễ Khai Server',
    description: 'Lễ khai mở server.',
    eventType: 'SERVER_OPENING_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'server_opening',
  },
  {
    templateKey: 'mung_cap_nhat',
    name: 'Mừng Cập Nhật',
    description: 'Mừng phiên bản cập nhật.',
    eventType: 'HOLIDAY_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 7,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'patch_celebration',
  },
  {
    templateKey: 'sinh_nhat_server',
    name: 'Sinh Nhật Server',
    description: 'Sinh nhật server.',
    eventType: 'HOLIDAY_EVENT',
    bracketMode: 'NONE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'PAID_COSMETIC',
    suggestedMissionGroupKey: 'server_birthday',
  },
  // Returning
  {
    templateKey: 'tro_lai_tien_do',
    name: 'Trở Lại Tiên Đồ',
    description: 'Player quay lại sau 14+ ngày.',
    eventType: 'RETURNING_PLAYER_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'returning_v1',
  },
  {
    templateKey: 'bay_ngay_hoi_quy',
    name: 'Bảy Ngày Hồi Quy',
    description: 'Player quay lại 7 ngày.',
    eventType: 'RETURNING_PLAYER_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 7,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'returning_7d',
  },
  {
    templateKey: 'dao_huu_tai_xuat',
    name: 'Đạo Hữu Tái Xuất',
    description: 'Đạo hữu mời player quay lại.',
    eventType: 'RETURNING_PLAYER_EVENT',
    bracketMode: 'PLAYER_TIER_SCALE',
    defaultDurationDays: 14,
    suggestedBrackets: [],
    suggestedPaidPolicy: 'FREE_ONLY',
    suggestedMissionGroupKey: 'returning_referral',
  },
];

export function findEventTemplate(
  templateKey: string,
): EventTemplate | undefined {
  return PRESET_EVENT_TEMPLATES.find((t) => t.templateKey === templateKey);
}

// ---------------------------------------------------------------------------
// 18. Default balance policy factory
// ---------------------------------------------------------------------------

/**
 * Tạo `EventBalancePolicy` default cho 1 event mới — service có thể dùng
 * khi admin chưa set policy. Caller chịu trách nhiệm gắn `eventKey`.
 */
export function defaultEventBalancePolicy(
  eventKey: string,
  options: Partial<EventBalancePolicy> = {},
): EventBalancePolicy {
  return {
    eventKey,
    maxTokenPerDay: 1000,
    maxTokenPerWeek: 5000,
    maxTokenPerEvent: 20000,
    maxRareRewardPerDay: 2,
    maxRareRewardPerWeek: 5,
    maxShopRareExchangePerEvent: 10,
    allowHighLevelEnterLowBracket: true,
    highLevelLowBracketTokenPenaltyPercent:
      EVENT_HIGH_LEVEL_TOKEN_PENALTY_DEFAULT,
    highLevelLowBracketRankingDisabled: true,
    sourceTierRewardCap: MAX_MATERIAL_TIER,
    maxAllowedRewardTierDelta: EVENT_MAX_REWARD_TIER_DELTA_DEFAULT,
    paidRewardPolicy: 'FREE_ONLY',
    enabled: true,
    ...options,
  };
}

// ---------------------------------------------------------------------------
// 19. Public summary types — cho FE player list
// ---------------------------------------------------------------------------

/** Strip nội bộ admin (adminNote, createdBy) — chỉ trả public-safe fields. */
export interface PublicEventSummary {
  key: string;
  name: string;
  description: string;
  eventType: EventType;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  bannerUrl?: string | null;
  iconUrl?: string | null;
  playerNotice?: string | null;
  bracketMode: BracketMode;
  tokenKey?: string | null;
  eventShopKey?: string | null;
  enabled: boolean;
  /** Bracket player đang tham gia (resolve runtime). */
  myBracketKey?: string | null;
  /** Tier reward cap effective cho player (sau khi áp công thức min). */
  myEffectiveRewardTier?: number | null;
  /** Còn bao nhiêu ms. */
  msRemaining: number;
}

export function publicEventSummary(
  e: EventDef,
  myCtx?: {
    bracketKey?: string | null;
    bracketTier?: number;
    playerTier?: number;
  },
  nowMs = Date.now(),
): PublicEventSummary {
  const startMs = e.startsAt.getTime();
  const endMs = e.endsAt.getTime();
  const msRemaining = Math.max(0, endMs - nowMs);
  let myEffectiveRewardTier: number | null = null;
  if (myCtx?.bracketTier && myCtx?.playerTier) {
    myEffectiveRewardTier = computeEffectiveRewardTier(
      myCtx.playerTier,
      myCtx.bracketTier,
      MAX_MATERIAL_TIER,
    );
  }
  return {
    key: e.key,
    name: e.name,
    description: e.description,
    eventType: e.eventType,
    status: e.status,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    bannerUrl: e.bannerUrl ?? null,
    iconUrl: e.iconUrl ?? null,
    playerNotice: e.playerNotice ?? null,
    bracketMode: e.bracketMode,
    tokenKey: e.tokenKey ?? null,
    eventShopKey: e.eventShopKey ?? null,
    enabled: e.enabled,
    myBracketKey: myCtx?.bracketKey ?? null,
    myEffectiveRewardTier,
    msRemaining,
  };
}
