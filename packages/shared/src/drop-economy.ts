/**
 * Phase 26.2 — Drop Economy V2 / Realm-Tier Weighted Material Drops.
 *
 * Mục tiêu:
 *   - Người chơi farm map đúng cảnh giới mới ra nguyên liệu hợp lý.
 *   - Quái thường rơi rất ít; elite trung bình thấp; boss/bí cảnh khá hơn
 *     nhưng có daily/weekly cap; world boss/event mới rơi rare/artifact
 *     với weekly/season cap.
 *   - Không lạm phát: `effectiveDropTier = min(playerTier, sourceTier)`.
 *   - Server-authoritative — runtime gọi `rollMaterialDrops` qua
 *     `DropEconomyService`, không trust client.
 *
 * Module này là **pure** + **deterministic**: nhận `rng` để test reproduce
 * được. Catalog tự sinh từ ITEMS metadata (`materialTier`, `materialCategory`,
 * `sourceHint`) đã tồn tại từ Phase 26.1 — không cần redefine.
 */
import type { ElementKey } from './combat';
import type { ItemDef, MaterialCategory, SourceHint } from './items';
import { ITEMS, itemByKey } from './items';
import { REALMS, realmByKey, type RealmDef } from './realms';

// ---------------------------------------------------------------------------
// Enums & types
// ---------------------------------------------------------------------------

/**
 * Loại nguồn rơi runtime. Map từ `MonsterDef.monsterType` (BEAST/HUMANOID/
 * SPIRIT/ELITE/BOSS hiện có trong `combat.ts`) sang phân nhóm drop-economy
 * mới. Caller có thể override bằng `monsterType` field trên monster cụ thể.
 */
export type DropMonsterType =
  | 'NORMAL'
  | 'ELITE'
  | 'BOSS'
  | 'DUNGEON_BOSS'
  | 'WORLD_BOSS'
  | 'EVENT_BOSS';

export const DROP_MONSTER_TYPES: readonly DropMonsterType[] = [
  'NORMAL',
  'ELITE',
  'BOSS',
  'DUNGEON_BOSS',
  'WORLD_BOSS',
  'EVENT_BOSS',
] as const;

/**
 * Nguồn cấp drop — dùng để build drop rule catalog và phân loại reward
 * runtime (combat / dungeon / boss / event / quest / shop).
 */
export type DropSource =
  | 'NORMAL_MONSTER'
  | 'ELITE'
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'DUNGEON'
  | 'BODY_DUNGEON'
  | 'ALCHEMY_DUNGEON'
  | 'MAIN_QUEST'
  | 'DAILY_QUEST'
  | 'EVENT'
  | 'SECT_SHOP'
  | 'NPC_SHOP'
  | 'MARKET'
  | 'AUCTION'
  | 'ADMIN_ONLY';

export const DROP_SOURCES: readonly DropSource[] = [
  'NORMAL_MONSTER',
  'ELITE',
  'BOSS',
  'WORLD_BOSS',
  'DUNGEON',
  'BODY_DUNGEON',
  'ALCHEMY_DUNGEON',
  'MAIN_QUEST',
  'DAILY_QUEST',
  'EVENT',
  'SECT_SHOP',
  'NPC_SHOP',
  'MARKET',
  'AUCTION',
  'ADMIN_ONLY',
] as const;

export type DropRarity =
  | 'COMMON'
  | 'UNCOMMON'
  | 'RARE'
  | 'EPIC'
  | 'LEGENDARY'
  | 'MYTHIC';

export const DROP_RARITIES: readonly DropRarity[] = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
] as const;

/**
 * Drop rule cho 1 material item từ 1 source cụ thể. Catalog tự sinh từ
 * `ITEMS` metadata + balance rules (xem `buildDropRuleCatalog`).
 *
 * Chú ý:
 *   - `baseChance` ∈ [0, 1] — xác suất *bên trong* roll-2 (sau khi đã pass
 *     bước 1 base monster-type drop rate). Caller không pass baseChance
 *     trực tiếp — caller dùng tier weight table + category multiplier.
 *     Field này chỉ để serialize/debug catalog.
 *   - `maxDailyQty` / `maxWeeklyQty`: cap server-side, runtime DropEconomy
 *     service enforce trước khi grant.
 */
export interface MaterialDropRule {
  key: string;
  itemKey: string;
  materialTier: number;
  materialCategory: MaterialCategory;
  rarity: DropRarity;
  minQty: number;
  maxQty: number;
  baseChance: number;
  source: DropSource;
  monsterType?: DropMonsterType;
  dungeonTier?: number;
  minRealmOrder?: number;
  maxRealmOrder?: number;
  maxDailyQty?: number;
  maxWeeklyQty?: number;
  bindOnPickup?: boolean;
  enabled: boolean;
}

/**
 * Snapshot trạng thái player + nguồn drop để roll. Cap usage chỉ snapshot
 * lúc gọi — service xử lý cap atomic ở DB layer, helper này chỉ filter
 * rule khi `dailyUsed` / `weeklyUsed` đã chạm cap.
 */
export interface DropRollContext {
  playerRealmOrder: number;
  playerBodyRealmOrder?: number;
  sourceTier: number;
  monsterType: DropMonsterType;
  source: DropSource;
  dungeonTier?: number;
  luck?: number;
  /** Daily qty đã grant, key = ruleKey hoặc `${materialCategory}:${materialTier}`. */
  dailyUsed?: ReadonlyMap<string, number>;
  weeklyUsed?: ReadonlyMap<string, number>;
  rng?: () => number;
}

export interface DropRollResult {
  /** Rule key used — caller dùng để track cap usage. */
  ruleKey: string;
  itemKey: string;
  qty: number;
  materialTier: number;
  materialCategory: MaterialCategory;
  rarity: DropRarity;
  source: DropSource;
  chanceUsed: number;
  cappedByDaily?: boolean;
  cappedByWeekly?: boolean;
}

// ---------------------------------------------------------------------------
// Realm → material tier mapping
// ---------------------------------------------------------------------------

/**
 * 9-tier material progression — map từ realm `order` (0..27) sang material
 * tier. Tier 9 là endgame (Thiên Đạo / Bản Nguyên / Hư Không Chí Tôn).
 *
 * Mapping được spec hoá trong `docs/BALANCE_MODEL.md` §26.2. Không tự ý
 * sửa — sẽ phá balance gate.
 */
const REALM_ORDER_TO_MATERIAL_TIER: readonly number[] = [
  1, // 0  phamnhan
  1, // 1  luyenkhi
  2, // 2  truc_co
  3, // 3  kim_dan
  4, // 4  nguyen_anh
  4, // 5  hoa_than
  5, // 6  luyen_hu
  5, // 7  hop_the
  5, // 8  dai_thua
  6, // 9  do_kiep
  6, // 10 nhan_tien
  6, // 11 dia_tien
  6, // 12 thien_tien
  7, // 13 huyen_tien
  7, // 14 kim_tien
  7, // 15 thai_at_kim_tien
  7, // 16 dai_la_kim_tien
  8, // 17 chuan_thanh
  8, // 18 thanh_nhan
  8, // 19 hon_nguyen
  8, // 20 dao_quan
  9, // 21 thien_dao
  9, // 22 ban_nguyen
  9, // 23 huyen_huyen
  9, // 24 vo_thuy
  9, // 25 vo_chung
  9, // 26 vinh_hang
  9, // 27 hu_khong_chi_ton
] as const;

export const MIN_MATERIAL_TIER = 1;
export const MAX_MATERIAL_TIER = 9;

/**
 * Phàm Nhân / Luyện Khí → Tier 1; Trúc Cơ → Tier 2; ...; Thiên Đạo+ → Tier 9.
 *
 * `order < 0` clamp về 1; `order >= 28` clamp về 9 (endgame). Hỗ trợ future
 * realm beyond order 27 mà không crash.
 */
export function realmOrderToMaterialTier(order: number): number {
  if (!Number.isFinite(order) || order <= 0) return MIN_MATERIAL_TIER;
  const idx = Math.min(Math.max(0, Math.floor(order)), REALM_ORDER_TO_MATERIAL_TIER.length - 1);
  return REALM_ORDER_TO_MATERIAL_TIER[idx];
}

/**
 * Body cultivation realm order → material tier. Phase 26.2 dùng cùng mapping
 * như realm chính vì body cultivation cũng có 28 cảnh giới tương ứng (xem
 * `body-cultivation.ts`). Nếu future Phase tách body realm progression
 * riêng, chỉnh hàm này, không chỉnh `realmOrderToMaterialTier`.
 */
export function bodyRealmOrderToMaterialTier(order: number): number {
  return realmOrderToMaterialTier(order);
}

/**
 * `effectiveDropTier = min(playerTier, sourceTier)` — đảm bảo player cao
 * cấp quay lại map thấp **không** biến map thấp thành mỏ nguyên liệu
 * endgame. Đây là **đầu vào duy nhất** của tier weight table — không cộng
 * trừ "luck" hay "bonus" ở đây để phá invariant.
 */
export function effectiveDropTier(playerTier: number, sourceTier: number): number {
  return Math.max(
    MIN_MATERIAL_TIER,
    Math.min(MAX_MATERIAL_TIER, Math.min(playerTier, sourceTier)),
  );
}

/** Khoảng cách tier (signed): `materialTier - playerTier`. */
export function getTierDistance(playerTier: number, materialTier: number): number {
  return materialTier - playerTier;
}

// ---------------------------------------------------------------------------
// Base monster-type drop rate & tier weight tables
// ---------------------------------------------------------------------------

/**
 * Xác suất "có rơi nguyên liệu hay không" cho 1 lần kill — bước 1 của
 * 2-step roll. Phải GIỮ rate thấp để không lạm phát; số liệu hiệu chỉnh ở
 * `BALANCE_MODEL.md` §26.2.
 */
const BASE_MONSTER_TYPE_DROP_RATE: Readonly<Record<DropMonsterType, number>> = {
  NORMAL: 0.03,
  ELITE: 0.13,
  BOSS: 0.4,
  DUNGEON_BOSS: 0.5,
  WORLD_BOSS: 0.75,
  EVENT_BOSS: 0.65,
};

export function getBaseMonsterTypeDropRate(type: DropMonsterType): number {
  return BASE_MONSTER_TYPE_DROP_RATE[type];
}

/**
 * Bước 2 — sau khi đã quyết định "rơi", chọn material tier theo phân phối
 * có trọng số tương đối với `effectiveDropTier`.
 *
 * Index trong tuple đại diện cho offset so với `effectiveDropTier`:
 *   [lower2OrBelow, lower1, sameTier, above1, above2]
 *
 * Tổng weight được normalize trước khi roll — không cần phải sum = 1.0
 * chính xác, nhưng giữ gần 1.0 cho dễ đọc / dễ tinh chỉnh.
 */
export interface TierOffsetWeights {
  lower2OrBelow: number;
  lower1: number;
  sameTier: number;
  above1: number;
  above2: number;
}

const TIER_WEIGHT_TABLES: Readonly<Record<DropMonsterType, TierOffsetWeights>> = {
  NORMAL: { lower2OrBelow: 0.35, lower1: 0.4, sameTier: 0.24, above1: 0.01, above2: 0 },
  ELITE: { lower2OrBelow: 0.2, lower1: 0.35, sameTier: 0.4, above1: 0.05, above2: 0 },
  BOSS: { lower2OrBelow: 0.1, lower1: 0.25, sameTier: 0.55, above1: 0.095, above2: 0.005 },
  DUNGEON_BOSS: { lower2OrBelow: 0.1, lower1: 0.3, sameTier: 0.52, above1: 0.08, above2: 0 },
  WORLD_BOSS: { lower2OrBelow: 0.05, lower1: 0.15, sameTier: 0.55, above1: 0.2, above2: 0.05 },
  EVENT_BOSS: { lower2OrBelow: 0.08, lower1: 0.22, sameTier: 0.5, above1: 0.15, above2: 0.05 },
};

export function getTierOffsetWeights(type: DropMonsterType): TierOffsetWeights {
  return TIER_WEIGHT_TABLES[type];
}

// ---------------------------------------------------------------------------
// Material category multipliers
// ---------------------------------------------------------------------------

/**
 * Hệ số nhân áp lên `baseChance` của rule trong bước 2 — phân biệt
 * Luyện Khí (dễ) vs Luyện Thể (khó hơn) vs Đột Phá (hiếm) vs Pháp Bảo
 * (hiếm nhất).
 *
 * Nguyên tắc:
 *   - ALCHEMY_QI = 1.0 (baseline).
 *   - ALCHEMY_BODY = 0.7 (khó hơn rõ rệt).
 *   - QI_BREAKTHROUGH / BODY_BREAKTHROUGH / TRIBULATION = 0.15..0.3 (hiếm).
 *   - ARTIFACT_CRAFT = 0.05 (hiếm nhất).
 *   - FURNACE_UPGRADE = 0.3.
 *   - EQUIPMENT_CRAFT = 0.65.
 *   - COMBAT_BUFF = 0.4.
 *   - GENERAL = 1.0.
 */
const MATERIAL_CATEGORY_MULTIPLIER: Readonly<Record<MaterialCategory, number>> = {
  ALCHEMY_QI: 1.0,
  ALCHEMY_BODY: 0.7,
  QI_BREAKTHROUGH: 0.3,
  BODY_BREAKTHROUGH: 0.25,
  TRIBULATION: 0.15,
  COMBAT_BUFF: 0.4,
  EQUIPMENT_CRAFT: 0.65,
  ARTIFACT_CRAFT: 0.05,
  FURNACE_UPGRADE: 0.3,
  /**
   * Phase 26.3 — fragment công pháp hiếm hơn alchemy material thường,
   * dễ hơn artifact craft. Multiplier 0.45 + per-tier daily cap đảm bảo
   * fragment endgame không lạm phát (xem `dailyCapFor` / `weeklyCapFor`).
   */
  METHOD_FRAGMENT: 0.45,
  GENERAL: 1.0,
};

export function getMaterialCategoryMultiplier(category: MaterialCategory): number {
  return MATERIAL_CATEGORY_MULTIPLIER[category];
}

// ---------------------------------------------------------------------------
// Source hint → DropSource mapping
// ---------------------------------------------------------------------------

const SOURCE_HINT_TO_DROP_SOURCE: Readonly<Partial<Record<SourceHint, DropSource>>> = {
  NORMAL_MONSTER: 'NORMAL_MONSTER',
  ELITE: 'ELITE',
  BOSS: 'BOSS',
  WORLD_BOSS: 'WORLD_BOSS',
  DUNGEON: 'DUNGEON',
  BODY_DUNGEON: 'BODY_DUNGEON',
  QUEST: 'MAIN_QUEST',
  MAIN_QUEST: 'MAIN_QUEST',
  DAILY_QUEST: 'DAILY_QUEST',
  EVENT: 'EVENT',
  SECT_SHOP: 'SECT_SHOP',
  NPC_SHOP: 'NPC_SHOP',
  MARKET: 'MARKET',
  AUCTION: 'AUCTION',
  ADMIN_ONLY: 'ADMIN_ONLY',
};

export function sourceHintToDropSource(hint: SourceHint): DropSource | null {
  return SOURCE_HINT_TO_DROP_SOURCE[hint] ?? null;
}

/**
 * Source nào được phép "roll material drop" trong combat / dungeon flow.
 * Shop / market / quest đi reward path riêng, không qua rollMaterialDrops.
 */
const COMBAT_DROP_SOURCES: readonly DropSource[] = [
  'NORMAL_MONSTER',
  'ELITE',
  'BOSS',
  'WORLD_BOSS',
  'DUNGEON',
  'BODY_DUNGEON',
  'ALCHEMY_DUNGEON',
];

export function isCombatDropSource(source: DropSource): boolean {
  return COMBAT_DROP_SOURCES.includes(source);
}

// ---------------------------------------------------------------------------
// Drop rule catalog — auto-generated from ITEMS metadata
// ---------------------------------------------------------------------------

const RARITY_BY_TIER: readonly DropRarity[] = [
  'COMMON', // tier 1
  'UNCOMMON', // tier 2
  'RARE', // tier 3
  'RARE', // tier 4
  'EPIC', // tier 5
  'EPIC', // tier 6
  'LEGENDARY', // tier 7
  'LEGENDARY', // tier 8
  'MYTHIC', // tier 9
] as const;

function rarityForTier(tier: number): DropRarity {
  const idx = Math.max(0, Math.min(RARITY_BY_TIER.length - 1, tier - 1));
  return RARITY_BY_TIER[idx];
}

/**
 * Base chance heuristic theo source + tier — chỉ dùng cho `baseChance`
 * field debug/serialize, runtime KHÔNG dùng field này (runtime tính
 * realtime qua tier-weight + category-multiplier).
 */
function baseChanceFor(source: DropSource, tier: number, category: MaterialCategory): number {
  const tierFactor = Math.pow(0.78, Math.max(0, tier - 1));
  const categoryMul = getMaterialCategoryMultiplier(category);
  const sourceBase: Record<DropSource, number> = {
    NORMAL_MONSTER: 0.02,
    ELITE: 0.08,
    BOSS: 0.18,
    WORLD_BOSS: 0.3,
    DUNGEON: 0.16,
    BODY_DUNGEON: 0.16,
    ALCHEMY_DUNGEON: 0.16,
    MAIN_QUEST: 0.6,
    DAILY_QUEST: 0.25,
    EVENT: 0.4,
    SECT_SHOP: 0,
    NPC_SHOP: 0,
    MARKET: 0,
    AUCTION: 0,
    ADMIN_ONLY: 0,
  };
  return Math.max(0, sourceBase[source] * tierFactor * categoryMul);
}

/**
 * Số lượng cap daily/weekly cho rare/artifact category — chống farm
 * vô hạn. Số tham khảo, server có thể override qua admin config future.
 */
function dailyCapFor(source: DropSource, tier: number, category: MaterialCategory): number | undefined {
  // Phase 26.4 — Artifact V2 materials. Caps theo source + tier:
  //   - WORLD_BOSS: tier ≤ 4 → 2/day; tier 5–6 → 1/day; tier 7+ → 1/day.
  //   - BOSS: tier ≤ 3 → 2/day; tier 4–6 → 1/day; tier 7+ → 0 (boss thường
  //     không drop endgame artifact mat).
  //   - DUNGEON / BODY_DUNGEON / ALCHEMY_DUNGEON: tier ≤ 3 → 1/day; tier 4+ → 0.
  //   - EVENT: cap riêng theo cấu hình event (vô hiệu hoá daily cap qua undefined → fallback infinite trong event window).
  //   - NORMAL_MONSTER / ELITE: 0 — quái thường không rơi nguyên liệu pháp bảo hiếm.
  if (category === 'ARTIFACT_CRAFT') {
    if (source === 'WORLD_BOSS') {
      if (tier <= 4) return 2;
      return 1;
    }
    if (source === 'BOSS') {
      if (tier <= 3) return 2;
      if (tier <= 6) return 1;
      return 0;
    }
    if (source === 'DUNGEON' || source === 'BODY_DUNGEON' || source === 'ALCHEMY_DUNGEON') {
      return tier <= 3 ? 1 : 0;
    }
    if (source === 'EVENT') return undefined;
    return 0;
  }
  if (category === 'TRIBULATION') return tier >= 5 ? 1 : 3;
  if (category === 'BODY_BREAKTHROUGH') return tier >= 4 ? 2 : 6;
  if (category === 'QI_BREAKTHROUGH') return tier >= 4 ? 2 : 6;
  if (category === 'FURNACE_UPGRADE') return 5;
  // Phase 26.3 — fragment công pháp cap daily theo tier:
  //   tier ≤ 2: 12 mảnh/ngày (starter/cơ bản farm nhanh)
  //   tier 3-5: 6 mảnh/ngày
  //   tier 6-7: 3 mảnh/ngày (boss/dungeon high)
  //   tier 8: 2 mảnh/ngày (world boss/event only)
  //   tier 9: 1 mảnh/ngày (chỉ event hoặc world boss đặc biệt)
  if (category === 'METHOD_FRAGMENT') {
    if (tier >= 9) return 1;
    if (tier >= 8) return 2;
    if (tier >= 6) return 3;
    if (tier >= 3) return 6;
    return 12;
  }
  return undefined;
}

function weeklyCapFor(source: DropSource, tier: number, category: MaterialCategory): number | undefined {
  if (source !== 'WORLD_BOSS' && source !== 'EVENT') return undefined;
  if (category === 'ARTIFACT_CRAFT') return Math.max(1, 6 - tier);
  if (category === 'TRIBULATION') return Math.max(2, 10 - tier);
  if (category === 'BODY_BREAKTHROUGH' || category === 'QI_BREAKTHROUGH') return 6;
  // Phase 26.3 — fragment công pháp endgame thêm weekly cap trên world
  // boss/event để chống farm dồn cuối tuần.
  if (category === 'METHOD_FRAGMENT' && tier >= 7) {
    return Math.max(2, 10 - tier);
  }
  return undefined;
}

function qtyRangeFor(tier: number, category: MaterialCategory): [number, number] {
  if (category === 'ARTIFACT_CRAFT') return [1, 1];
  if (category === 'TRIBULATION') return [1, tier >= 6 ? 1 : 2];
  if (category === 'BODY_BREAKTHROUGH' || category === 'QI_BREAKTHROUGH') return [1, tier >= 5 ? 1 : 2];
  // Fragment công pháp — đơn giản: 1 mảnh/lần roll, ngoại trừ tier rất
  // thấp có thể rơi 1-2.
  if (category === 'METHOD_FRAGMENT') return tier <= 2 ? [1, 2] : [1, 1];
  if (tier >= 7) return [1, 2];
  if (tier >= 4) return [1, 3];
  return [1, 4];
}

function minRealmOrderFor(tier: number): number {
  // Cho phép player thấp hơn map 1 cấp vẫn được rơi (ví dụ Trúc Cơ
  // tier 2 thì player luyenkhi order 1 vẫn có cơ hội mini).
  const tierStart = [0, 0, 2, 3, 4, 6, 9, 13, 17, 21];
  return Math.max(0, (tierStart[tier] ?? 0) - 1);
}

export interface DropRuleCatalogStats {
  total: number;
  bySource: Record<DropSource, number>;
  byCategory: Record<MaterialCategory, number>;
  byTier: Record<number, number>;
}

/**
 * Auto-derive drop rule catalog từ `ITEMS` metadata — duyệt mọi item có
 * `materialTier` + `materialCategory` + `sourceHint`, sinh 1 rule per
 * (item, sourceHint) hợp lệ.
 *
 * Item là pill thành phẩm (kind = PILL_*) → KHÔNG sinh rule combat drop
 * (chỉ rơi từ event/boss đặc biệt nếu sourceHint có WORLD_BOSS/EVENT;
 * giữ chance cực thấp). Người chơi tự luyện đan là chính.
 *
 * Phân loại pill: `ItemKind` bắt đầu bằng `PILL_` hoặc `kind === 'PILL_HP'/
 * 'PILL_MP'/'PILL_EXP'`. Vì đan v2 có nhiều biến thể, ta dùng heuristic
 * `materialCategory == null && kind starts with PILL_`.
 */
export function buildDropRuleCatalog(
  items: readonly ItemDef[] = ITEMS,
): readonly MaterialDropRule[] {
  const out: MaterialDropRule[] = [];
  for (const item of items) {
    const tier = item.materialTier;
    const category = item.materialCategory;
    const hints = item.sourceHint;
    if (!tier || !category || !hints || hints.length === 0) continue;

    for (const hint of hints) {
      const source = sourceHintToDropSource(hint);
      if (!source) continue;
      // Shop/market sources → skip combat drop rule (handled by shop runtime).
      if (
        source === 'SECT_SHOP' ||
        source === 'NPC_SHOP' ||
        source === 'MARKET' ||
        source === 'AUCTION' ||
        source === 'ADMIN_ONLY'
      ) {
        continue;
      }
      const [minQty, maxQty] = qtyRangeFor(tier, category);
      const rule: MaterialDropRule = {
        key: `${item.key}__${source}`,
        itemKey: item.key,
        materialTier: tier,
        materialCategory: category,
        rarity: rarityForTier(tier),
        minQty,
        maxQty,
        baseChance: baseChanceFor(source, tier, category),
        source,
        minRealmOrder: minRealmOrderFor(tier),
        bindOnPickup: item.bindOnPickup ?? false,
        enabled: true,
      };
      const dailyCap = dailyCapFor(source, tier, category);
      if (dailyCap !== undefined) rule.maxDailyQty = dailyCap;
      const weeklyCap = weeklyCapFor(source, tier, category);
      if (weeklyCap !== undefined) rule.maxWeeklyQty = weeklyCap;
      out.push(rule);
    }
  }
  return out;
}

/**
 * Built-in catalog snapshot — generated once from ITEMS. Caller có thể
 * call `buildDropRuleCatalog(customItems)` nếu cần override (test).
 */
export const DROP_RULE_CATALOG: readonly MaterialDropRule[] = buildDropRuleCatalog();

const RULE_BY_KEY = new Map<string, MaterialDropRule>(
  DROP_RULE_CATALOG.map((r) => [r.key, r]),
);

export function getMaterialDropRule(key: string): MaterialDropRule | undefined {
  return RULE_BY_KEY.get(key);
}

export function summarizeDropCatalog(
  catalog: readonly MaterialDropRule[] = DROP_RULE_CATALOG,
): DropRuleCatalogStats {
  const bySource = Object.fromEntries(DROP_SOURCES.map((s) => [s, 0])) as Record<
    DropSource,
    number
  >;
  const categories: MaterialCategory[] = [
    'ALCHEMY_QI',
    'ALCHEMY_BODY',
    'QI_BREAKTHROUGH',
    'BODY_BREAKTHROUGH',
    'TRIBULATION',
    'COMBAT_BUFF',
    'EQUIPMENT_CRAFT',
    'ARTIFACT_CRAFT',
    'FURNACE_UPGRADE',
    'METHOD_FRAGMENT',
    'GENERAL',
  ];
  const byCategory = Object.fromEntries(categories.map((c) => [c, 0])) as Record<
    MaterialCategory,
    number
  >;
  const byTier: Record<number, number> = {};
  for (const rule of catalog) {
    bySource[rule.source]++;
    byCategory[rule.materialCategory]++;
    byTier[rule.materialTier] = (byTier[rule.materialTier] ?? 0) + 1;
  }
  return { total: catalog.length, bySource, byCategory, byTier };
}

// ---------------------------------------------------------------------------
// 2-step roll
// ---------------------------------------------------------------------------

function defaultRng(rng?: () => number): () => number {
  return rng ?? Math.random;
}

/**
 * Bước 1: roll xem có rơi nguyên liệu nào không.
 * Trả `true` nếu vượt qua "have any drop" gate.
 *
 * Luck (nếu có) cộng nhẹ vào rate: `effective = base * (1 + clamp(luck, 0, 0.5))`.
 * Cap luck contribution để không bị abuse, chi tiết ở
 * `BALANCE_MODEL.md` §26.2.
 */
export function rollHasMaterialDrop(
  monsterType: DropMonsterType,
  rng: () => number = Math.random,
  luck = 0,
): boolean {
  const baseRate = getBaseMonsterTypeDropRate(monsterType);
  const luckBonus = Math.max(0, Math.min(0.5, luck));
  const effective = Math.min(1, baseRate * (1 + luckBonus));
  return rng() < effective;
}

/**
 * Bước 2: chọn target material tier theo `tier weight table` xung quanh
 * `effectiveDropTier`. Trả tier nguyên (clamp [1, 9]).
 */
export function rollMaterialTier(
  monsterType: DropMonsterType,
  effDropTier: number,
  rng: () => number = Math.random,
): number {
  const weights = getTierOffsetWeights(monsterType);
  const buckets: Array<{ tier: number; weight: number }> = [
    { tier: Math.max(MIN_MATERIAL_TIER, effDropTier - 2), weight: weights.lower2OrBelow },
    { tier: Math.max(MIN_MATERIAL_TIER, effDropTier - 1), weight: weights.lower1 },
    { tier: effDropTier, weight: weights.sameTier },
    { tier: Math.min(MAX_MATERIAL_TIER, effDropTier + 1), weight: weights.above1 },
    { tier: Math.min(MAX_MATERIAL_TIER, effDropTier + 2), weight: weights.above2 },
  ];
  const total = buckets.reduce((acc, b) => acc + Math.max(0, b.weight), 0);
  if (total <= 0) return effDropTier;
  let r = rng() * total;
  for (const b of buckets) {
    r -= Math.max(0, b.weight);
    if (r <= 0) return b.tier;
  }
  return buckets[buckets.length - 1].tier;
}

/**
 * Lọc rule khớp source + tier + monster realm range + cap availability.
 */
function filterCandidateRules(
  rules: readonly MaterialDropRule[],
  ctx: DropRollContext,
  targetTier: number,
): MaterialDropRule[] {
  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.source !== ctx.source) return false;
    if (rule.materialTier !== targetTier) return false;
    if (rule.minRealmOrder !== undefined && ctx.playerRealmOrder < rule.minRealmOrder) {
      return false;
    }
    if (rule.maxRealmOrder !== undefined && ctx.playerRealmOrder > rule.maxRealmOrder) {
      return false;
    }
    if (rule.maxDailyQty !== undefined && ctx.dailyUsed) {
      const used = ctx.dailyUsed.get(rule.key) ?? 0;
      if (used >= rule.maxDailyQty) return false;
    }
    if (rule.maxWeeklyQty !== undefined && ctx.weeklyUsed) {
      const used = ctx.weeklyUsed.get(rule.key) ?? 0;
      if (used >= rule.maxWeeklyQty) return false;
    }
    return true;
  });
}

/**
 * Roll 1 lần — trả về `DropRollResult | null` (null = không rơi gì hoặc
 * không có rule khớp).
 *
 * Chú ý: hàm này deterministic theo `rng`. Caller (DropEconomyService)
 * pass seeded RNG cho test reproducible.
 */
export function rollDropEconomyMaterial(
  ctx: DropRollContext,
  rules: readonly MaterialDropRule[] = DROP_RULE_CATALOG,
): DropRollResult | null {
  const rng = defaultRng(ctx.rng);
  if (!isCombatDropSource(ctx.source)) return null;

  // Step 1 — have drop?
  if (!rollHasMaterialDrop(ctx.monsterType, rng, ctx.luck ?? 0)) return null;

  // Step 2 — pick target tier (effectiveDropTier = min(player, source)).
  const playerTier = realmOrderToMaterialTier(ctx.playerRealmOrder);
  const effTier = effectiveDropTier(playerTier, ctx.sourceTier);
  const targetTier = rollMaterialTier(ctx.monsterType, effTier, rng);

  // Step 3 — pick rule weighted by `baseChance * categoryMultiplier`.
  const candidates = filterCandidateRules(rules, ctx, targetTier);
  if (candidates.length === 0) return null;

  const weighted = candidates.map((rule) => ({
    rule,
    weight:
      Math.max(1e-6, rule.baseChance) *
      getMaterialCategoryMultiplier(rule.materialCategory),
  }));
  const total = weighted.reduce((acc, w) => acc + w.weight, 0);
  let r = rng() * total;
  let chosen = weighted[0].rule;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) {
      chosen = w.rule;
      break;
    }
  }

  // Step 4 — qty within [min, max]; cap qty by remaining daily/weekly.
  let qty = Math.floor(rng() * (chosen.maxQty - chosen.minQty + 1)) + chosen.minQty;
  let cappedByDaily = false;
  let cappedByWeekly = false;
  if (chosen.maxDailyQty !== undefined && ctx.dailyUsed) {
    const remaining = Math.max(0, chosen.maxDailyQty - (ctx.dailyUsed.get(chosen.key) ?? 0));
    if (qty > remaining) {
      qty = remaining;
      cappedByDaily = true;
    }
  }
  if (chosen.maxWeeklyQty !== undefined && ctx.weeklyUsed) {
    const remaining = Math.max(0, chosen.maxWeeklyQty - (ctx.weeklyUsed.get(chosen.key) ?? 0));
    if (qty > remaining) {
      qty = remaining;
      cappedByWeekly = true;
    }
  }
  if (qty <= 0) return null;

  return {
    ruleKey: chosen.key,
    itemKey: chosen.itemKey,
    qty,
    materialTier: chosen.materialTier,
    materialCategory: chosen.materialCategory,
    rarity: chosen.rarity,
    source: chosen.source,
    chanceUsed: chosen.baseChance,
    cappedByDaily: cappedByDaily || undefined,
    cappedByWeekly: cappedByWeekly || undefined,
  };
}

/**
 * Roll nhiều lần (default 1) cho 1 encounter. Caller có thể request
 * `count > 1` cho boss (`rollMaterialDrops(ctx, rules, 3)`). Mỗi lần
 * roll độc lập — không stack drop rate.
 */
export function rollDropEconomyMaterials(
  ctx: DropRollContext,
  rules: readonly MaterialDropRule[] = DROP_RULE_CATALOG,
  count = 1,
): DropRollResult[] {
  const out: DropRollResult[] = [];
  const carryDaily = new Map<string, number>(ctx.dailyUsed ?? new Map());
  const carryWeekly = new Map<string, number>(ctx.weeklyUsed ?? new Map());
  for (let i = 0; i < count; i++) {
    const result = rollDropEconomyMaterial(
      { ...ctx, dailyUsed: carryDaily, weeklyUsed: carryWeekly },
      rules,
    );
    if (!result) continue;
    out.push(result);
    carryDaily.set(result.ruleKey, (carryDaily.get(result.ruleKey) ?? 0) + result.qty);
    carryWeekly.set(result.ruleKey, (carryWeekly.get(result.ruleKey) ?? 0) + result.qty);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source hint for UI — surface "farm ở đâu" cho recipe missing material
// ---------------------------------------------------------------------------

export interface MaterialSourceHintEntry {
  source: DropSource;
  rarity: DropRarity;
  monsterType?: DropMonsterType;
  dungeonTier?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  /** Display label vi/en map qua i18n key. */
  labelKey: string;
}

const SOURCE_LABEL_KEY: Record<DropSource, string> = {
  NORMAL_MONSTER: 'alchemy.source.normalMonster',
  ELITE: 'alchemy.source.elite',
  BOSS: 'alchemy.source.boss',
  WORLD_BOSS: 'alchemy.source.worldBoss',
  DUNGEON: 'alchemy.source.dungeon',
  BODY_DUNGEON: 'alchemy.source.bodyDungeon',
  ALCHEMY_DUNGEON: 'alchemy.source.alchemyDungeon',
  MAIN_QUEST: 'alchemy.source.mainQuest',
  DAILY_QUEST: 'alchemy.source.dailyQuest',
  EVENT: 'alchemy.source.event',
  SECT_SHOP: 'alchemy.source.sectShop',
  NPC_SHOP: 'alchemy.source.npcShop',
  MARKET: 'alchemy.source.market',
  AUCTION: 'alchemy.source.auction',
  ADMIN_ONLY: 'alchemy.source.adminOnly',
};

/**
 * Trả về danh sách nguồn tốt nhất cho 1 item — dùng để render
 * `sourceHint` ở Alchemy UI khi player thiếu nguyên liệu.
 */
export function getMaterialSourceHints(
  itemKey: string,
  catalog: readonly MaterialDropRule[] = DROP_RULE_CATALOG,
): MaterialSourceHintEntry[] {
  const item = itemByKey(itemKey);
  if (!item) return [];
  const matched = catalog.filter((r) => r.itemKey === itemKey && r.enabled);
  const ranked = matched.slice().sort((a, b) => {
    // Source priority: WORLD_BOSS > BOSS > DUNGEON* > ELITE > NORMAL.
    const sortOrder: Record<DropSource, number> = {
      WORLD_BOSS: 0,
      BOSS: 1,
      DUNGEON: 2,
      BODY_DUNGEON: 2,
      ALCHEMY_DUNGEON: 2,
      ELITE: 3,
      NORMAL_MONSTER: 4,
      EVENT: 1,
      MAIN_QUEST: 5,
      DAILY_QUEST: 5,
      SECT_SHOP: 6,
      NPC_SHOP: 6,
      MARKET: 7,
      AUCTION: 7,
      ADMIN_ONLY: 9,
    };
    return sortOrder[a.source] - sortOrder[b.source] || b.baseChance - a.baseChance;
  });

  return ranked.map((rule) => ({
    source: rule.source,
    rarity: rule.rarity,
    dailyLimit: rule.maxDailyQty,
    weeklyLimit: rule.maxWeeklyQty,
    labelKey: SOURCE_LABEL_KEY[rule.source],
  }));
}

// ---------------------------------------------------------------------------
// Helpers used by services
// ---------------------------------------------------------------------------

/**
 * Suy ra `DropMonsterType` từ legacy `MonsterDef.monsterType`
 * (BEAST/HUMANOID/SPIRIT/ELITE/BOSS). Không thay đổi catalog cũ.
 */
export function inferDropMonsterType(
  legacyType: 'BEAST' | 'HUMANOID' | 'SPIRIT' | 'ELITE' | 'BOSS' | undefined,
): DropMonsterType {
  if (legacyType === 'ELITE') return 'ELITE';
  if (legacyType === 'BOSS') return 'BOSS';
  return 'NORMAL';
}

/**
 * Suy ra `sourceTier` cho 1 monster nếu monster không có metadata
 * realm/dungeon — dùng `level` heuristic: level 1-9 → tier 1, 10-25 → 2,
 * 26-40 → 3, 41-60 → 4, 61-80 → 5, 81-120 → 6, 121-180 → 7, 181-250 → 8,
 * > 250 → 9.
 */
export function inferSourceTierFromLevel(level: number): number {
  if (level <= 9) return 1;
  if (level <= 25) return 2;
  if (level <= 40) return 3;
  if (level <= 60) return 4;
  if (level <= 80) return 5;
  if (level <= 120) return 6;
  if (level <= 180) return 7;
  if (level <= 250) return 8;
  return 9;
}

/** Helper: realm key → material tier (chuỗi → number) cho convenience caller. */
export function realmKeyToMaterialTier(realmKey: string): number {
  const realm: RealmDef | undefined = realmByKey(realmKey);
  return realm ? realmOrderToMaterialTier(realm.order) : MIN_MATERIAL_TIER;
}

export function realmOrderForKey(realmKey: string): number {
  return realmByKey(realmKey)?.order ?? 0;
}

/** Re-export realms for convenience consumers. */
export const _DROP_ECONOMY_REALMS = REALMS;
