/**
 * Phase 26.4 — Artifact / Pháp Bảo Crafting V2.
 *
 * Hệ pháp bảo crafting full server-authoritative. Sống **song song** với
 * hệ Phase 23.5/23.7 (`phap-bao.ts` / `phap-bao-progression.ts`) qua model
 * Prisma riêng `CharacterArtifactV2` + slot riêng `MAIN_ARTIFACT_V2..` —
 * KHÔNG đụng `InventoryItem.equippedSlot` (ARTIFACT_1..3) của hệ cũ.
 *
 * Trục mới:
 *   - 9 tier (`Phàm Khí` → `Chí Tôn Pháp Bảo`).
 *   - 6 grade (`HA_PHAM` → `DAO_VAN`).
 *   - 10 type (`FLYING_SWORD` → `GOURD`).
 *   - 8 element (Ngũ hành + `NONE` + `MIXED` + `HON_NGUYEN`).
 *   - 4 hướng nâng cấp: level (linhThach + exp material), star (mảnh +
 *     fail nhẹ), refine (substat unlock), awaken (kỹ năng pháp bảo).
 *
 * Tất cả cap/đường cong nằm trong file này để dễ tinh chỉnh + test. KHÔNG
 * import từ `phap-bao.ts` để 2 hệ độc lập (phép đo balance riêng).
 */

import type { ElementKey } from './combat';
import type { Quality, EquipSlot } from './enums';

// ─────────────────────────────────────────────────────────────────────
// Tier — 9 cấp pháp bảo V2.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ArtifactTierDef {
  tier: ArtifactTier;
  nameVi: string;
  nameEn: string;
  /**
   * Realm order tối thiểu (player.realmKey.order + 1) để craft pháp bảo
   * tier này. Cũng dùng cho `canEquipArtifact`.
   */
  minRealmOrder: number;
  /**
   * `realmOrder` của player ↔ artifact tier khuyến nghị (`tier` = ceil
   * `realmOrder / 3.2`).
   */
  recommendedRealmOrder: number;
  /** Multiplier base power scale theo tier. */
  baseScale: number;
}

export const ARTIFACT_TIERS: readonly ArtifactTierDef[] = [
  { tier: 1, nameVi: 'Phàm Khí', nameEn: 'Mortal Vessel', minRealmOrder: 1, recommendedRealmOrder: 2, baseScale: 1.0 },
  { tier: 2, nameVi: 'Linh Khí', nameEn: 'Spirit Vessel', minRealmOrder: 3, recommendedRealmOrder: 5, baseScale: 1.6 },
  { tier: 3, nameVi: 'Huyền Khí', nameEn: 'Mystic Vessel', minRealmOrder: 6, recommendedRealmOrder: 8, baseScale: 2.4 },
  { tier: 4, nameVi: 'Địa Bảo', nameEn: 'Earthly Treasure', minRealmOrder: 9, recommendedRealmOrder: 11, baseScale: 3.6 },
  { tier: 5, nameVi: 'Thiên Bảo', nameEn: 'Heavenly Treasure', minRealmOrder: 12, recommendedRealmOrder: 14, baseScale: 5.4 },
  { tier: 6, nameVi: 'Tiên Khí', nameEn: 'Immortal Vessel', minRealmOrder: 15, recommendedRealmOrder: 17, baseScale: 8.0 },
  { tier: 7, nameVi: 'Thần Khí', nameEn: 'Divine Vessel', minRealmOrder: 18, recommendedRealmOrder: 21, baseScale: 12.0 },
  { tier: 8, nameVi: 'Đạo Khí', nameEn: 'Dao Vessel', minRealmOrder: 22, recommendedRealmOrder: 25, baseScale: 18.0 },
  { tier: 9, nameVi: 'Chí Tôn Pháp Bảo', nameEn: 'Supreme Artifact', minRealmOrder: 26, recommendedRealmOrder: 28, baseScale: 26.0 },
] as const;

const TIER_DEF_BY_TIER = new Map<ArtifactTier, ArtifactTierDef>(
  ARTIFACT_TIERS.map((t) => [t.tier, t]),
);

export function getArtifactTierDef(tier: number): ArtifactTierDef | undefined {
  return TIER_DEF_BY_TIER.get(tier as ArtifactTier);
}

export function getArtifactTierName(tier: number): string {
  return getArtifactTierDef(tier)?.nameVi ?? `Tier ${tier}`;
}

export function artifactTierForRealmOrder(realmOrder: number): ArtifactTier {
  if (realmOrder <= 0) return 1;
  for (let i = ARTIFACT_TIERS.length - 1; i >= 0; i--) {
    if (realmOrder >= ARTIFACT_TIERS[i].minRealmOrder) return ARTIFACT_TIERS[i].tier;
  }
  return 1;
}

// ─────────────────────────────────────────────────────────────────────
// Grade — 6 phẩm chất.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactGrade =
  | 'HA_PHAM'
  | 'TRUNG_PHAM'
  | 'THUONG_PHAM'
  | 'CUC_PHAM'
  | 'LINH_VAN'
  | 'DAO_VAN';

export const ARTIFACT_GRADES: readonly ArtifactGrade[] = [
  'HA_PHAM',
  'TRUNG_PHAM',
  'THUONG_PHAM',
  'CUC_PHAM',
  'LINH_VAN',
  'DAO_VAN',
] as const;

const ARTIFACT_GRADE_MULTIPLIER: Readonly<Record<ArtifactGrade, number>> = {
  HA_PHAM: 0.85,
  TRUNG_PHAM: 1.0,
  THUONG_PHAM: 1.15,
  CUC_PHAM: 1.3,
  LINH_VAN: 1.45,
  DAO_VAN: 1.6,
};

export function artifactGradeMultiplier(grade: ArtifactGrade): number {
  return ARTIFACT_GRADE_MULTIPLIER[grade];
}

const ARTIFACT_GRADE_ORDER: Readonly<Record<ArtifactGrade, number>> = {
  HA_PHAM: 0,
  TRUNG_PHAM: 1,
  THUONG_PHAM: 2,
  CUC_PHAM: 3,
  LINH_VAN: 4,
  DAO_VAN: 5,
};

export function artifactGradeOrder(grade: ArtifactGrade): number {
  return ARTIFACT_GRADE_ORDER[grade];
}

// ─────────────────────────────────────────────────────────────────────
// Type — 10 loại pháp bảo.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactType =
  | 'FLYING_SWORD'
  | 'CAULDRON'
  | 'BELL'
  | 'SEAL'
  | 'BANNER'
  | 'MIRROR'
  | 'PEARL'
  | 'ARMOR'
  | 'RING'
  | 'GOURD';

export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  'FLYING_SWORD',
  'CAULDRON',
  'BELL',
  'SEAL',
  'BANNER',
  'MIRROR',
  'PEARL',
  'ARMOR',
  'RING',
  'GOURD',
] as const;

// ─────────────────────────────────────────────────────────────────────
// Element — 5 Ngũ Hành + 3 đặc biệt.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactElement =
  | ElementKey
  | 'NONE'
  | 'MIXED'
  | 'HON_NGUYEN';

export const ARTIFACT_ELEMENTS: readonly ArtifactElement[] = [
  'kim',
  'moc',
  'thuy',
  'hoa',
  'tho',
  'NONE',
  'MIXED',
  'HON_NGUYEN',
] as const;

// ─────────────────────────────────────────────────────────────────────
// Equip slot V2 — 5 slot.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactEquipSlot =
  | 'MAIN_ARTIFACT_V2'
  | 'DEFENSE_ARTIFACT_V2'
  | 'SUPPORT_ARTIFACT_V2'
  | 'ALCHEMY_ARTIFACT_V2'
  | 'SPECIAL_ARTIFACT_V2';

export const ARTIFACT_EQUIP_SLOTS: readonly ArtifactEquipSlot[] = [
  'MAIN_ARTIFACT_V2',
  'DEFENSE_ARTIFACT_V2',
  'SUPPORT_ARTIFACT_V2',
  'ALCHEMY_ARTIFACT_V2',
  'SPECIAL_ARTIFACT_V2',
] as const;

/**
 * Loại pháp bảo → slot mặc định (slot chính của type).
 */
const ARTIFACT_TYPE_DEFAULT_SLOT: Readonly<Record<ArtifactType, ArtifactEquipSlot>> = {
  FLYING_SWORD: 'MAIN_ARTIFACT_V2',
  SEAL: 'MAIN_ARTIFACT_V2',
  ARMOR: 'DEFENSE_ARTIFACT_V2',
  BELL: 'DEFENSE_ARTIFACT_V2',
  BANNER: 'SUPPORT_ARTIFACT_V2',
  MIRROR: 'SUPPORT_ARTIFACT_V2',
  PEARL: 'SUPPORT_ARTIFACT_V2',
  CAULDRON: 'ALCHEMY_ARTIFACT_V2',
  GOURD: 'ALCHEMY_ARTIFACT_V2',
  RING: 'SPECIAL_ARTIFACT_V2',
};

export function defaultSlotForArtifactType(type: ArtifactType): ArtifactEquipSlot {
  return ARTIFACT_TYPE_DEFAULT_SLOT[type];
}

/**
 * Loại pháp bảo → slot được phép equip (sắp xếp theo ưu tiên).
 * Mỗi type có 1–2 slot hợp lệ; UI hiển thị toàn bộ.
 */
const ARTIFACT_TYPE_ALLOWED_SLOTS: Readonly<Record<ArtifactType, readonly ArtifactEquipSlot[]>> = {
  FLYING_SWORD: ['MAIN_ARTIFACT_V2'],
  SEAL: ['MAIN_ARTIFACT_V2'],
  ARMOR: ['DEFENSE_ARTIFACT_V2'],
  BELL: ['DEFENSE_ARTIFACT_V2'],
  BANNER: ['SUPPORT_ARTIFACT_V2'],
  MIRROR: ['SUPPORT_ARTIFACT_V2'],
  PEARL: ['SUPPORT_ARTIFACT_V2'],
  CAULDRON: ['ALCHEMY_ARTIFACT_V2'],
  GOURD: ['ALCHEMY_ARTIFACT_V2', 'SPECIAL_ARTIFACT_V2'],
  RING: ['SPECIAL_ARTIFACT_V2'],
};

export function allowedSlotsForArtifactType(type: ArtifactType): readonly ArtifactEquipSlot[] {
  return ARTIFACT_TYPE_ALLOWED_SLOTS[type];
}

// ─────────────────────────────────────────────────────────────────────
// Source — nguồn rơi pháp bảo / nguyên liệu.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactSource =
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'DUNGEON'
  | 'EVENT'
  | 'QUEST'
  | 'CRAFT'
  | 'SECT_SHOP'
  | 'ADMIN_ONLY';

// ─────────────────────────────────────────────────────────────────────
// Stat shape.
// ─────────────────────────────────────────────────────────────────────

/**
 * Mọi stat artifact V2 có thể cộng. Field optional; field không khai báo
 * không cộng vào snapshot. Bonus cuối ((`baseStats + level × perLevelStats +
 * star × perStarStats + sub × subStat) × gradeMultiplier`) cap qua
 * `ARTIFACT_BONUS_CAPS`.
 */
export interface ArtifactStatBlock {
  atk?: number;
  def?: number;
  hpMax?: number;
  mpMax?: number;
  spirit?: number;
  speed?: number;
  crit?: number;
  elementalAtkBonus?: Partial<Record<ElementKey, number>>;
  elementResist?: Partial<Record<ElementKey, number>>;
  /** % giảm sát thương boss (cap tổng `BOSS_DMG_REDUCTION_CAP`). */
  bossDamageReductionPct?: number;
  /** % bonus EXP tu khí (cap tổng `CULTIVATION_BONUS_CAP`). */
  cultivationRateBonusPct?: number;
  /** % bonus EXP luyện thể (cap tổng `BODY_CULTIVATION_BONUS_CAP`). */
  bodyCultivationRateBonusPct?: number;
  /** % bonus success rate luyện đan (cap tổng `ALCHEMY_BONUS_CAP`). */
  alchemySuccessRateBonusPct?: number;
  /** % bonus drop rate (cap tổng `DROP_BONUS_CAP`). */
  dropRateBonusPct?: number;
  /** % bonus luck (cap tổng `LUCK_BONUS_CAP`). */
  luckBonusPct?: number;
  /** Giảm thiệt hại đột phá vượt kiếp (cap tổng). */
  tribulationSupportBonusPct?: number;
}

/**
 * Cap tổng (sum across all equipped artifact V2) per stat. Combat path
 * sẽ enforce clamp ở `clampArtifactV2Snapshot`.
 */
export const ARTIFACT_BONUS_CAPS = {
  /** % flat bonus, cap mềm — combat KHÔNG clamp `atk` flat (đã capped qua tier scale). */
  cultivationRateBonusPct: 8,
  bodyCultivationRateBonusPct: 8,
  alchemySuccessRateBonusPct: 5,
  dropRateBonusPct: 5,
  luckBonusPct: 8,
  bossDamageReductionPct: 12,
  tribulationSupportBonusPct: 6,
  /** Tổng elementalAtkBonus across all artifacts cap theo từng hệ. */
  elementalAtkBonusPerElement: 0.08,
  /** Tổng elementResist across all artifacts cap theo từng hệ. */
  elementResistPerElement: 0.18,
  critPct: 12,
  speedPct: 12,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Blueprint / Recipe.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactBlueprintInput {
  itemKey: string;
  qty: number;
}

export interface ArtifactBlueprintDef {
  /** Khoá blueprint (unique). */
  key: string;
  /** Khoá pháp bảo sẽ ra (khớp `ArtifactDef.key`). */
  artifactKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  artifactType: ArtifactType;
  artifactElement: ArtifactElement;
  artifactTier: ArtifactTier;
  requiredRealmOrder: number;
  requiredBodyRealmOrder?: number;
  requiredAlchemyLevel?: number;
  /** Nguồn unlock blueprint (gợi ý UI). */
  sourceHint: readonly ArtifactSource[];
  /** Item + qty cần consume khi craft (success hay fail đều consume). */
  inputs: readonly ArtifactBlueprintInput[];
  linhThachCost: number;
  /** Base success rate (0..1). Có thể bonus theo cảnh giới/lò. */
  successRate: number;
  /**
   * Bảng trọng số grade khi craft success. Tổng có thể != 1, helper
   * sẽ normalize. Grade > `maxGrade` sẽ bị clamp.
   */
  possibleGrades: Readonly<Partial<Record<ArtifactGrade, number>>>;
  maxGrade: ArtifactGrade;
  bindOnCraft: boolean;
  enabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Artifact def (catalog).
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactSubStatPool {
  kind: keyof ArtifactStatBlock;
  /** Min..max value khi roll substat. Áp dụng cho refine. */
  min: number;
  max: number;
  weight: number;
}

export interface ArtifactSkillDef {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  /** Awaken level tối thiểu để unlock skill này. */
  unlockAwakenLevel: number;
  /** Cooldown skill — chỉ là metadata UI, combat chưa wire. */
  cooldownSeconds: number;
}

export interface ArtifactDef {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi: string;
  type: ArtifactType;
  element: ArtifactElement;
  tier: ArtifactTier;
  requiredRealmOrder: number;
  /** Stat tại level 1, star 0, refine 0, awaken 0, grade TRUNG_PHAM. */
  baseStats: ArtifactStatBlock;
  /** Stat cộng thêm mỗi level (level 1 → maxLevel). */
  perLevelStats: ArtifactStatBlock;
  /** Stat cộng thêm mỗi sao. */
  perStarStats: ArtifactStatBlock;
  /** Pool substat khi refine (mỗi refine level mở/upgrade 1 substat). */
  subStatPool: readonly ArtifactSubStatPool[];
  /** Skill pháp bảo (1–3 skill, unlock theo awaken). */
  skillPool: readonly ArtifactSkillDef[];
  sourceHint: readonly ArtifactSource[];
  enabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Upgrade caps.
// ─────────────────────────────────────────────────────────────────────

const TIER_MAX_LEVEL: Readonly<Record<ArtifactTier, number>> = {
  1: 10,
  2: 15,
  3: 20,
  4: 25,
  5: 30,
  6: 35,
  7: 40,
  8: 45,
  9: 50,
};

const TIER_MAX_STAR: Readonly<Record<ArtifactTier, number>> = {
  1: 3,
  2: 4,
  3: 5,
  4: 6,
  5: 7,
  6: 8,
  7: 9,
  8: 10,
  9: 12,
};

const TIER_MAX_REFINE: Readonly<Record<ArtifactTier, number>> = {
  1: 3,
  2: 4,
  3: 5,
  4: 6,
  5: 7,
  6: 8,
  7: 9,
  8: 10,
  9: 12,
};

const TIER_MAX_AWAKEN: Readonly<Record<ArtifactTier, number>> = {
  1: 0,
  2: 1,
  3: 2,
  4: 2,
  5: 3,
  6: 3,
  7: 4,
  8: 4,
  9: 5,
};

export function maxLevelForArtifactTier(tier: ArtifactTier): number {
  return TIER_MAX_LEVEL[tier];
}
export function maxStarForArtifactTier(tier: ArtifactTier): number {
  return TIER_MAX_STAR[tier];
}
export function maxRefineForArtifactTier(tier: ArtifactTier): number {
  return TIER_MAX_REFINE[tier];
}
export function maxAwakenForArtifactTier(tier: ArtifactTier): number {
  return TIER_MAX_AWAKEN[tier];
}

// ─────────────────────────────────────────────────────────────────────
// Materials (auto-generated item keys).
// ─────────────────────────────────────────────────────────────────────

export function artifactEmbryoKey(tier: ArtifactTier): string {
  return `phoi_phap_bao_t${tier}`;
}
export function artifactBlueprintItemKey(tier: ArtifactTier): string {
  return `ban_ve_phap_bao_t${tier}`;
}
export function artifactBossCoreKey(tier: ArtifactTier): string {
  return `boss_core_t${tier}`;
}
export function artifactRefineStoneKey(tier: ArtifactTier): string {
  return `refine_stone_t${tier}`;
}
export function artifactAwakenCoreKey(tier: ArtifactTier): string {
  return `awaken_core_t${tier}`;
}
export function artifactSpiritEssenceKey(tier: ArtifactTier): string {
  return `spirit_essence_t${tier}`;
}
export function artifactElementalEssenceKey(tier: ArtifactTier): string {
  return `ngu_hanh_tinh_hoa_t${tier}`;
}

/**
 * Tier-specific equipment-craft style material (`linh_thiet`, `huyen_thiet`
 * v.v. — auto-generated lite ore cho craft V2).
 */
export function artifactOreKey(tier: ArtifactTier): string {
  return `artifact_ore_t${tier}`;
}

export interface ArtifactMaterialDef {
  key: string;
  nameVi: string;
  nameEn: string;
  tier: ArtifactTier;
  /**
   * Loại nguyên liệu — phân theo độ hiếm. EQUIPMENT_CRAFT_LIKE = lite,
   * có thể drop từ DUNGEON/BOSS với cap thường. ARTIFACT_CRAFT_RARE =
   * hiếm, drop chủ yếu từ BOSS/WORLD_BOSS với cap chặt.
   */
  rarity: 'COMMON' | 'RARE' | 'ENDGAME';
  /** Map vào `MaterialCategory` của `items.ts`. */
  itemMaterialCategory: 'EQUIPMENT_CRAFT' | 'ARTIFACT_CRAFT';
  sourceHint: readonly ArtifactSource[];
  /** Có cho trade chợ tự do không? Tier 8–9 endgame KHÔNG cho. */
  marketTradeable: boolean;
  bindOnPickup: boolean;
  price: number;
}

function tierPriceCurve(tier: ArtifactTier, base: number): number {
  return Math.round(base * Math.pow(2.6, tier - 1));
}

/**
 * Catalog nguyên liệu pháp bảo V2 — auto-derived theo tier 1..9 ×
 * (embryo / blueprint-item / boss_core / refine_stone / awaken_core /
 * spirit_essence / elemental_essence / artifact_ore).
 */
export const ARTIFACT_MATERIAL_CATALOG: readonly ArtifactMaterialDef[] = (() => {
  const out: ArtifactMaterialDef[] = [];
  for (const td of ARTIFACT_TIERS) {
    const t = td.tier;
    const endgame = t >= 8;
    const rareTier = t >= 4;
    const commonRarity: ArtifactMaterialDef['rarity'] = rareTier ? 'RARE' : 'COMMON';
    const rareCat: ArtifactMaterialDef['itemMaterialCategory'] = rareTier
      ? 'ARTIFACT_CRAFT'
      : 'EQUIPMENT_CRAFT';
    out.push({
      key: artifactEmbryoKey(t),
      nameVi: `Phôi Pháp Bảo ${td.nameVi}`,
      nameEn: `${td.nameEn} Embryo`,
      tier: t,
      rarity: commonRarity,
      itemMaterialCategory: rareCat,
      sourceHint: rareTier ? ['BOSS', 'WORLD_BOSS', 'DUNGEON'] : ['BOSS', 'DUNGEON'],
      marketTradeable: !endgame,
      bindOnPickup: endgame,
      price: tierPriceCurve(t, 200),
    });
    out.push({
      key: artifactBlueprintItemKey(t),
      nameVi: `Bản Vẽ ${td.nameVi}`,
      nameEn: `${td.nameEn} Blueprint`,
      tier: t,
      rarity: endgame ? 'ENDGAME' : rareTier ? 'RARE' : 'COMMON',
      itemMaterialCategory: rareTier ? 'ARTIFACT_CRAFT' : 'EQUIPMENT_CRAFT',
      sourceHint: endgame
        ? ['WORLD_BOSS', 'EVENT']
        : rareTier
          ? ['BOSS', 'WORLD_BOSS', 'EVENT', 'QUEST']
          : ['BOSS', 'DUNGEON', 'QUEST'],
      marketTradeable: false,
      bindOnPickup: true,
      price: tierPriceCurve(t, 320),
    });
    out.push({
      key: artifactOreKey(t),
      nameVi: `Linh Thiết Bí ${td.nameVi}`,
      nameEn: `${td.nameEn} Mystic Ore`,
      tier: t,
      rarity: rareTier ? 'RARE' : 'COMMON',
      itemMaterialCategory: rareTier ? 'ARTIFACT_CRAFT' : 'EQUIPMENT_CRAFT',
      sourceHint: rareTier ? ['BOSS', 'WORLD_BOSS', 'DUNGEON'] : ['DUNGEON', 'BOSS'],
      marketTradeable: !endgame,
      bindOnPickup: false,
      price: tierPriceCurve(t, 90),
    });
    out.push({
      key: artifactElementalEssenceKey(t),
      nameVi: `Ngũ Hành Tinh Hoa ${td.nameVi}`,
      nameEn: `${td.nameEn} Elemental Essence`,
      tier: t,
      rarity: rareTier ? 'RARE' : 'COMMON',
      itemMaterialCategory: rareTier ? 'ARTIFACT_CRAFT' : 'EQUIPMENT_CRAFT',
      sourceHint: rareTier ? ['BOSS', 'WORLD_BOSS'] : ['BOSS', 'DUNGEON'],
      marketTradeable: !endgame,
      bindOnPickup: false,
      price: tierPriceCurve(t, 140),
    });
    out.push({
      key: artifactBossCoreKey(t),
      nameVi: `Lõi Yêu ${td.nameVi}`,
      nameEn: `${td.nameEn} Boss Core`,
      tier: t,
      rarity: endgame ? 'ENDGAME' : 'RARE',
      itemMaterialCategory: 'ARTIFACT_CRAFT',
      sourceHint: endgame ? ['WORLD_BOSS'] : ['BOSS', 'WORLD_BOSS'],
      marketTradeable: false,
      bindOnPickup: true,
      price: tierPriceCurve(t, 220),
    });
    out.push({
      key: artifactRefineStoneKey(t),
      nameVi: `Luyện Hóa Thạch ${td.nameVi}`,
      nameEn: `${td.nameEn} Refining Stone`,
      tier: t,
      rarity: endgame ? 'ENDGAME' : 'RARE',
      itemMaterialCategory: 'ARTIFACT_CRAFT',
      sourceHint: endgame ? ['WORLD_BOSS', 'EVENT'] : ['BOSS', 'DUNGEON', 'WORLD_BOSS'],
      marketTradeable: !endgame,
      bindOnPickup: false,
      price: tierPriceCurve(t, 260),
    });
    out.push({
      key: artifactAwakenCoreKey(t),
      nameVi: `Thức Tỉnh Nguyên Hồn ${td.nameVi}`,
      nameEn: `${td.nameEn} Awakening Core`,
      tier: t,
      rarity: endgame ? 'ENDGAME' : 'RARE',
      itemMaterialCategory: 'ARTIFACT_CRAFT',
      sourceHint: endgame ? ['WORLD_BOSS', 'EVENT'] : ['BOSS', 'WORLD_BOSS'],
      marketTradeable: false,
      bindOnPickup: true,
      price: tierPriceCurve(t, 380),
    });
    out.push({
      key: artifactSpiritEssenceKey(t),
      nameVi: `Linh Tính Tinh Hoa ${td.nameVi}`,
      nameEn: `${td.nameEn} Spirit Essence`,
      tier: t,
      rarity: endgame ? 'ENDGAME' : 'RARE',
      itemMaterialCategory: 'ARTIFACT_CRAFT',
      sourceHint: endgame ? ['WORLD_BOSS', 'EVENT'] : ['BOSS', 'WORLD_BOSS', 'EVENT'],
      marketTradeable: false,
      bindOnPickup: true,
      price: tierPriceCurve(t, 320),
    });
  }
  return out;
})();

const ARTIFACT_MATERIAL_BY_KEY = new Map<string, ArtifactMaterialDef>(
  ARTIFACT_MATERIAL_CATALOG.map((m) => [m.key, m]),
);

export function getArtifactMaterialByKey(key: string): ArtifactMaterialDef | undefined {
  return ARTIFACT_MATERIAL_BY_KEY.get(key);
}

export function isArtifactMaterialKey(key: string): boolean {
  return ARTIFACT_MATERIAL_BY_KEY.has(key);
}

// ─────────────────────────────────────────────────────────────────────
// Catalog pháp bảo V2 — 36 entries (4 mỗi tier × 9 tier).
// ─────────────────────────────────────────────────────────────────────

function tierBaseStats(tier: ArtifactTier, type: ArtifactType): ArtifactStatBlock {
  const td = getArtifactTierDef(tier)!;
  const s = td.baseScale;
  switch (type) {
    case 'FLYING_SWORD':
      return { atk: Math.round(16 * s), spirit: Math.round(2 * s), crit: 0.02 };
    case 'CAULDRON':
      return {
        def: Math.round(8 * s),
        hpMax: Math.round(40 * s),
        alchemySuccessRateBonusPct: tier >= 3 ? 0.5 + 0.3 * (tier - 3) : 0,
      };
    case 'BELL':
      return {
        def: Math.round(12 * s),
        hpMax: Math.round(30 * s),
        bossDamageReductionPct: 0.8 + 0.4 * (tier - 1),
      };
    case 'SEAL':
      return { atk: Math.round(14 * s), spirit: Math.round(3 * s), bossDamageReductionPct: 0.5 };
    case 'BANNER':
      return { atk: Math.round(6 * s), def: Math.round(6 * s), spirit: Math.round(4 * s) };
    case 'MIRROR':
      return { def: Math.round(10 * s), spirit: Math.round(3 * s) };
    case 'PEARL':
      return {
        hpMax: Math.round(50 * s),
        mpMax: Math.round(40 * s),
        cultivationRateBonusPct: tier >= 2 ? 0.5 + 0.3 * (tier - 2) : 0,
      };
    case 'ARMOR':
      return {
        def: Math.round(20 * s),
        hpMax: Math.round(80 * s),
        bodyCultivationRateBonusPct: tier >= 3 ? 0.5 + 0.2 * (tier - 3) : 0,
      };
    case 'RING':
      return {
        spirit: Math.round(3 * s),
        luckBonusPct: 0.5 + 0.3 * (tier - 1),
        dropRateBonusPct: 0.3 + 0.2 * (tier - 1),
      };
    case 'GOURD':
      return {
        hpMax: Math.round(35 * s),
        mpMax: Math.round(35 * s),
        spirit: Math.round(2 * s),
      };
    default:
      return { atk: Math.round(4 * s) };
  }
}

function tierPerLevelStats(tier: ArtifactTier, type: ArtifactType): ArtifactStatBlock {
  const td = getArtifactTierDef(tier)!;
  const s = td.baseScale;
  switch (type) {
    case 'FLYING_SWORD':
    case 'SEAL':
      return { atk: Math.max(2, Math.round(s)), spirit: 1 };
    case 'CAULDRON':
    case 'ARMOR':
    case 'BELL':
      return { def: Math.max(1, Math.round(s)), hpMax: Math.max(4, Math.round(4 * s)) };
    case 'MIRROR':
      return { def: Math.max(1, Math.round(s)), spirit: 1 };
    case 'PEARL':
    case 'GOURD':
      return { hpMax: Math.max(3, Math.round(3 * s)), mpMax: Math.max(3, Math.round(3 * s)) };
    case 'BANNER':
      return {
        atk: Math.max(1, Math.round(0.5 * s)),
        def: Math.max(1, Math.round(0.5 * s)),
        spirit: 1,
      };
    case 'RING':
      return { spirit: 1 };
    default:
      return { atk: 1 };
  }
}

function tierPerStarStats(tier: ArtifactTier, type: ArtifactType): ArtifactStatBlock {
  const baseLevel = tierPerLevelStats(tier, type);
  // Each star ≈ 5x the per-level bonus.
  return {
    atk: baseLevel.atk ? baseLevel.atk * 5 : undefined,
    def: baseLevel.def ? baseLevel.def * 5 : undefined,
    hpMax: baseLevel.hpMax ? baseLevel.hpMax * 5 : undefined,
    mpMax: baseLevel.mpMax ? baseLevel.mpMax * 5 : undefined,
    spirit: baseLevel.spirit ? baseLevel.spirit * 5 : undefined,
  };
}

function tierSubStatPool(tier: ArtifactTier, type: ArtifactType): readonly ArtifactSubStatPool[] {
  const td = getArtifactTierDef(tier)!;
  const s = td.baseScale;
  const pool: ArtifactSubStatPool[] = [
    { kind: 'atk', min: Math.max(1, Math.round(0.5 * s)), max: Math.max(2, Math.round(1.5 * s)), weight: 3 },
    { kind: 'def', min: Math.max(1, Math.round(0.5 * s)), max: Math.max(2, Math.round(1.5 * s)), weight: 3 },
    { kind: 'hpMax', min: Math.max(2, Math.round(2 * s)), max: Math.max(4, Math.round(6 * s)), weight: 3 },
    { kind: 'spirit', min: 1, max: Math.max(2, Math.round(0.5 * s)), weight: 2 },
    { kind: 'speed', min: 1, max: 2, weight: 1 },
    { kind: 'crit', min: 1, max: 2, weight: 1 },
  ];
  if (type === 'BELL' || type === 'SEAL' || type === 'ARMOR') {
    pool.push({ kind: 'bossDamageReductionPct', min: 1, max: 2, weight: 1 });
  }
  if (type === 'PEARL' || type === 'BANNER') {
    pool.push({ kind: 'cultivationRateBonusPct', min: 1, max: 2, weight: 1 });
  }
  if (type === 'ARMOR') {
    pool.push({ kind: 'bodyCultivationRateBonusPct', min: 1, max: 2, weight: 1 });
  }
  if (type === 'CAULDRON' || type === 'GOURD') {
    pool.push({ kind: 'alchemySuccessRateBonusPct', min: 1, max: 1, weight: 1 });
  }
  if (type === 'RING') {
    pool.push({ kind: 'luckBonusPct', min: 1, max: 2, weight: 2 });
    pool.push({ kind: 'dropRateBonusPct', min: 1, max: 1, weight: 1 });
  }
  return pool;
}

function tierSkillPool(tier: ArtifactTier, type: ArtifactType): readonly ArtifactSkillDef[] {
  const maxAw = maxAwakenForArtifactTier(tier);
  if (maxAw <= 0) return [];
  const out: ArtifactSkillDef[] = [];
  const typeSkillsVi: Record<ArtifactType, [string, string]> = {
    FLYING_SWORD: ['Kiếm Khí Trảm', 'Phá Giáp'],
    CAULDRON: ['Đan Hỏa Ổn Định', 'Hộ Thân Đỉnh Khí'],
    BELL: ['Trấn Hồn', 'Tĩnh Tâm'],
    SEAL: ['Trấn Áp', 'Phong Ấn'],
    BANNER: ['Chiến Ý', 'Tụ Linh'],
    MIRROR: ['Phản Chiếu', 'Phá Ảo'],
    PEARL: ['Linh Châu Hộ Mệnh', 'Tụ Linh'],
    ARMOR: ['Kim Thân Hộ Thể', 'Kiếp Lôi Kháng'],
    RING: ['Cơ Duyên', 'Nạp Vật'],
    GOURD: ['Dưỡng Đan', 'Hỏa Hồ'],
  };
  const typeSkillsEn: Record<ArtifactType, [string, string]> = {
    FLYING_SWORD: ['Sword Aura Slash', 'Armor Piercing'],
    CAULDRON: ['Steady Pill Fire', 'Cauldron Aegis'],
    BELL: ['Soul Suppression', 'Calm Mind'],
    SEAL: ['Suppression', 'Seal'],
    BANNER: ['Battle Will', 'Spirit Gather'],
    MIRROR: ['Reflection', 'Illusion Break'],
    PEARL: ['Spirit Pearl Guardian', 'Spirit Gather'],
    ARMOR: ['Golden Body Protection', 'Tribulation Resist'],
    RING: ['Fortune', 'Storage'],
    GOURD: ['Pill Nurture', 'Fire Gourd'],
  };
  const [n1Vi, n2Vi] = typeSkillsVi[type];
  const [n1En, n2En] = typeSkillsEn[type];
  out.push({
    key: `art_skill_${type.toLowerCase()}_a`,
    nameVi: n1Vi,
    nameEn: n1En,
    descriptionVi: `Hiệu ứng passive ${n1Vi} (cường hóa nhẹ).`,
    descriptionEn: `Passive effect ${n1En} (light boost).`,
    unlockAwakenLevel: 1,
    cooldownSeconds: 45,
  });
  if (maxAw >= 2) {
    out.push({
      key: `art_skill_${type.toLowerCase()}_b`,
      nameVi: n2Vi,
      nameEn: n2En,
      descriptionVi: `Hiệu ứng passive ${n2Vi} (mạnh hơn, yêu cầu thức tỉnh).`,
      descriptionEn: `Passive effect ${n2En} (stronger, requires awakening).`,
      unlockAwakenLevel: 2,
      cooldownSeconds: 60,
    });
  }
  return out;
}

interface ArtifactSpec {
  key: string;
  nameVi: string;
  nameEn: string;
  type: ArtifactType;
  element: ArtifactElement;
  tier: ArtifactTier;
}

const ARTIFACT_SPECS: readonly ArtifactSpec[] = [
  // Tier 1
  { key: 'thanh_moc_tieu_kiem_t1', nameVi: 'Thanh Mộc Tiểu Kiếm', nameEn: 'Verdant Small Sword', type: 'FLYING_SWORD', element: 'moc', tier: 1 },
  { key: 'hoa_van_tieu_dinh_t1', nameVi: 'Hỏa Văn Tiểu Đỉnh', nameEn: 'Flame-rune Small Cauldron', type: 'CAULDRON', element: 'hoa', tier: 1 },
  { key: 'tho_linh_ho_giap_t1', nameVi: 'Thổ Linh Hộ Giáp', nameEn: 'Earth Spirit Plate', type: 'ARMOR', element: 'tho', tier: 1 },
  { key: 'tinh_thuy_chau_t1', nameVi: 'Tịnh Thủy Châu', nameEn: 'Pure Water Pearl', type: 'PEARL', element: 'thuy', tier: 1 },
  // Tier 2
  { key: 'kim_quang_phi_kiem_t2', nameVi: 'Kim Quang Phi Kiếm', nameEn: 'Golden Flying Sword', type: 'FLYING_SWORD', element: 'kim', tier: 2 },
  { key: 'han_thuy_linh_chau_t2', nameVi: 'Hàn Thủy Linh Châu', nameEn: 'Cold Water Spirit Pearl', type: 'PEARL', element: 'thuy', tier: 2 },
  { key: 'huyet_van_chuong_t2', nameVi: 'Huyết Văn Chuông', nameEn: 'Blood-rune Bell', type: 'BELL', element: 'NONE', tier: 2 },
  { key: 'doan_cot_ho_giap_t2', nameVi: 'Đoán Cốt Hộ Giáp', nameEn: 'Bone-forged Plate', type: 'ARMOR', element: 'tho', tier: 2 },
  // Tier 3
  { key: 'huyen_thiet_kiem_t3', nameVi: 'Huyền Thiết Kiếm', nameEn: 'Mystic Iron Sword', type: 'FLYING_SWORD', element: 'kim', tier: 3 },
  { key: 'tay_tuy_bao_dinh_t3', nameVi: 'Tẩy Tủy Bảo Đỉnh', nameEn: 'Marrow-cleansing Cauldron', type: 'CAULDRON', element: 'hoa', tier: 3 },
  { key: 'thanh_tam_kinh_t3', nameVi: 'Thanh Tâm Kính', nameEn: 'Clear-heart Mirror', type: 'MIRROR', element: 'thuy', tier: 3 },
  { key: 'hau_tho_an_t3', nameVi: 'Hậu Thổ Ấn', nameEn: 'Earth Lord Seal', type: 'SEAL', element: 'tho', tier: 3 },
  // Tier 4
  { key: 'nguyen_anh_linh_kiem_t4', nameVi: 'Nguyên Anh Linh Kiếm', nameEn: 'Nascent Soul Sword', type: 'FLYING_SWORD', element: 'kim', tier: 4 },
  { key: 'kim_cuong_bao_giap_t4', nameVi: 'Kim Cương Bảo Giáp', nameEn: 'Diamond Plate', type: 'ARMOR', element: 'tho', tier: 4 },
  { key: 'ngu_hanh_bao_ky_t4', nameVi: 'Ngũ Hành Bảo Kỳ', nameEn: 'Five-Element Banner', type: 'BANNER', element: 'MIXED', tier: 4 },
  { key: 'huyen_bang_kinh_t4', nameVi: 'Huyền Băng Kính', nameEn: 'Mystic Ice Mirror', type: 'MIRROR', element: 'thuy', tier: 4 },
  // Tier 5
  { key: 'bat_hoai_than_giap_t5', nameVi: 'Bất Hoại Thần Giáp', nameEn: 'Indestructible Divine Plate', type: 'ARMOR', element: 'tho', tier: 5 },
  { key: 'long_huyet_chien_an_t5', nameVi: 'Long Huyết Chiến Ấn', nameEn: 'Dragon-blood War Seal', type: 'SEAL', element: 'hoa', tier: 5 },
  { key: 'can_khon_ho_lo_t5', nameVi: 'Càn Khôn Hồ Lô', nameEn: 'Heaven-and-Earth Gourd', type: 'GOURD', element: 'MIXED', tier: 5 },
  { key: 'hu_linh_bao_chau_t5', nameVi: 'Hư Linh Bảo Châu', nameEn: 'Void Spirit Pearl', type: 'PEARL', element: 'NONE', tier: 5 },
  // Tier 6
  { key: 'kiep_loi_than_chung_t6', nameVi: 'Kiếp Lôi Thần Chung', nameEn: 'Tribulation Lightning Bell', type: 'BELL', element: 'kim', tier: 6 },
  { key: 'tien_cot_bao_giap_t6', nameVi: 'Tiên Cốt Bảo Giáp', nameEn: 'Immortal-Bone Plate', type: 'ARMOR', element: 'tho', tier: 6 },
  { key: 'long_tuong_chien_an_t6', nameVi: 'Long Tượng Chiến Ấn', nameEn: 'Dragon-Elephant War Seal', type: 'SEAL', element: 'hoa', tier: 6 },
  { key: 'tien_van_linh_chau_t6', nameVi: 'Tiên Vân Linh Châu', nameEn: 'Immortal-Cloud Spirit Pearl', type: 'PEARL', element: 'thuy', tier: 6 },
  // Tier 7
  { key: 'dai_la_kim_kiem_t7', nameVi: 'Đại La Kim Kiếm', nameEn: 'Daluo Golden Sword', type: 'FLYING_SWORD', element: 'kim', tier: 7 },
  { key: 'hon_nguyen_dao_dinh_t7', nameVi: 'Hỗn Nguyên Đạo Đỉnh', nameEn: 'Primordial Dao Cauldron', type: 'CAULDRON', element: 'HON_NGUYEN', tier: 7 },
  { key: 'ngu_hanh_quy_nguyen_ky_t7', nameVi: 'Ngũ Hành Quy Nguyên Kỳ', nameEn: 'Five-Element Source Banner', type: 'BANNER', element: 'MIXED', tier: 7 },
  { key: 'thai_at_thanh_tam_kinh_t7', nameVi: 'Thái Ất Thanh Tâm Kính', nameEn: 'Taiyi Pure-Heart Mirror', type: 'MIRROR', element: 'moc', tier: 7 },
  // Tier 8
  { key: 'thanh_nhan_phap_chung_t8', nameVi: 'Thánh Nhân Pháp Chung', nameEn: 'Sage Dharma Bell', type: 'BELL', element: 'NONE', tier: 8 },
  { key: 'dao_quan_vo_cau_an_t8', nameVi: 'Đạo Quân Vô Cấu Ấn', nameEn: 'Daojun Immaculate Seal', type: 'SEAL', element: 'HON_NGUYEN', tier: 8 },
  { key: 'hon_nguyen_bat_diet_giap_t8', nameVi: 'Hỗn Nguyên Bất Diệt Giáp', nameEn: 'Primordial Immortal Plate', type: 'ARMOR', element: 'tho', tier: 8 },
  { key: 'van_phap_thien_ky_t8', nameVi: 'Vạn Pháp Thiên Kỳ', nameEn: 'Myriad-Dharma Banner', type: 'BANNER', element: 'MIXED', tier: 8 },
  // Tier 9
  { key: 'thien_dao_chi_ton_kiem_t9', nameVi: 'Thiên Đạo Chí Tôn Kiếm', nameEn: 'Heavenly-Dao Supreme Sword', type: 'FLYING_SWORD', element: 'kim', tier: 9 },
  { key: 'vinh_hang_chan_than_giap_t9', nameVi: 'Vĩnh Hằng Chân Thân Giáp', nameEn: 'Eternal True-Body Plate', type: 'ARMOR', element: 'HON_NGUYEN', tier: 9 },
  { key: 'hu_khong_chi_ton_chau_t9', nameVi: 'Hư Không Chí Tôn Châu', nameEn: 'Void Supreme Pearl', type: 'PEARL', element: 'NONE', tier: 9 },
  { key: 'ban_nguyen_hon_don_dinh_t9', nameVi: 'Bản Nguyên Hỗn Độn Đỉnh', nameEn: 'Source Chaos Cauldron', type: 'CAULDRON', element: 'HON_NGUYEN', tier: 9 },
];

function loreFor(spec: ArtifactSpec): string {
  return `${spec.nameVi} — pháp bảo hệ ${spec.element.toString()} thuộc ${getArtifactTierName(spec.tier)}, ` +
    `nung qua linh lửa tu sĩ trải nhiều đời.`;
}

function descVi(spec: ArtifactSpec): string {
  const td = getArtifactTierDef(spec.tier)!;
  return `${spec.nameVi} (${td.nameVi}, ${spec.type}, ${spec.element}). Pháp bảo crafting V2 — luyện qua bản vẽ + phôi + nguyên liệu.`;
}
function descEn(spec: ArtifactSpec): string {
  const td = getArtifactTierDef(spec.tier)!;
  return `${spec.nameEn} (${td.nameEn}, ${spec.type}, ${spec.element}). Artifact crafting V2 — forged from blueprint + embryo + materials.`;
}

export const ARTIFACT_CATALOG_V2: readonly ArtifactDef[] = ARTIFACT_SPECS.map((spec) => ({
  key: spec.key,
  nameVi: spec.nameVi,
  nameEn: spec.nameEn,
  descriptionVi: descVi(spec),
  descriptionEn: descEn(spec),
  loreVi: loreFor(spec),
  type: spec.type,
  element: spec.element,
  tier: spec.tier,
  requiredRealmOrder: getArtifactTierDef(spec.tier)!.minRealmOrder,
  baseStats: tierBaseStats(spec.tier, spec.type),
  perLevelStats: tierPerLevelStats(spec.tier, spec.type),
  perStarStats: tierPerStarStats(spec.tier, spec.type),
  subStatPool: tierSubStatPool(spec.tier, spec.type),
  skillPool: tierSkillPool(spec.tier, spec.type),
  sourceHint: spec.tier <= 3 ? ['BOSS', 'DUNGEON', 'QUEST'] : spec.tier <= 6 ? ['BOSS', 'WORLD_BOSS', 'EVENT'] : ['WORLD_BOSS', 'EVENT'],
  enabled: true,
}));

const ARTIFACT_BY_KEY = new Map<string, ArtifactDef>(
  ARTIFACT_CATALOG_V2.map((a) => [a.key, a]),
);

export function getArtifactDef(key: string): ArtifactDef | undefined {
  return ARTIFACT_BY_KEY.get(key);
}

// ─────────────────────────────────────────────────────────────────────
// Blueprint catalog — auto-derived (1 blueprint per artifact).
// ─────────────────────────────────────────────────────────────────────

function blueprintKeyFor(artifactKey: string): string {
  return `blueprint_${artifactKey}`;
}

function blueprintBaseSuccess(tier: ArtifactTier): number {
  // Craft success rate target:
  //   tier 1–3 (low): 0.65 → 0.55 → 0.45
  //   tier 4–6 (mid): 0.35 → 0.28 → 0.22
  //   tier 7–9 (top): 0.18 → 0.14 → 0.10
  const table = [0.65, 0.55, 0.45, 0.35, 0.28, 0.22, 0.18, 0.14, 0.1];
  return table[tier - 1];
}

function blueprintLinhThachCost(tier: ArtifactTier): number {
  return tierPriceCurve(tier, 600);
}

function blueprintMaxGrade(tier: ArtifactTier): ArtifactGrade {
  if (tier <= 2) return 'CUC_PHAM';
  if (tier <= 4) return 'LINH_VAN';
  return 'DAO_VAN';
}

function blueprintGradeWeights(tier: ArtifactTier): Readonly<Partial<Record<ArtifactGrade, number>>> {
  if (tier <= 2) {
    return { HA_PHAM: 35, TRUNG_PHAM: 40, THUONG_PHAM: 18, CUC_PHAM: 7 };
  }
  if (tier <= 4) {
    return {
      HA_PHAM: 18,
      TRUNG_PHAM: 38,
      THUONG_PHAM: 26,
      CUC_PHAM: 13,
      LINH_VAN: 5,
    };
  }
  if (tier <= 6) {
    return {
      HA_PHAM: 10,
      TRUNG_PHAM: 30,
      THUONG_PHAM: 30,
      CUC_PHAM: 20,
      LINH_VAN: 8,
      DAO_VAN: 2,
    };
  }
  // tier 7–9
  return {
    HA_PHAM: 5,
    TRUNG_PHAM: 25,
    THUONG_PHAM: 30,
    CUC_PHAM: 25,
    LINH_VAN: 12,
    DAO_VAN: 3,
  };
}

function blueprintInputs(spec: ArtifactSpec): readonly ArtifactBlueprintInput[] {
  const t = spec.tier;
  const inputs: ArtifactBlueprintInput[] = [
    { itemKey: artifactEmbryoKey(t), qty: 1 },
    { itemKey: artifactOreKey(t), qty: t + 1 },
    { itemKey: artifactElementalEssenceKey(t), qty: Math.max(1, Math.floor(t / 2)) },
  ];
  if (t >= 3) inputs.push({ itemKey: artifactBlueprintItemKey(t), qty: 1 });
  if (t >= 4) inputs.push({ itemKey: artifactBossCoreKey(t), qty: 1 });
  if (t >= 6) inputs.push({ itemKey: artifactSpiritEssenceKey(t), qty: 1 });
  return inputs;
}

export const ARTIFACT_BLUEPRINT_CATALOG: readonly ArtifactBlueprintDef[] = ARTIFACT_SPECS.map((spec) => ({
  key: blueprintKeyFor(spec.key),
  artifactKey: spec.key,
  nameVi: `Bản vẽ ${spec.nameVi}`,
  nameEn: `${spec.nameEn} Blueprint`,
  descriptionVi: `Bản vẽ luyện chế pháp bảo ${spec.nameVi}.`,
  descriptionEn: `Blueprint to craft ${spec.nameEn}.`,
  artifactType: spec.type,
  artifactElement: spec.element,
  artifactTier: spec.tier,
  requiredRealmOrder: getArtifactTierDef(spec.tier)!.minRealmOrder,
  requiredAlchemyLevel: spec.tier >= 3 ? spec.tier - 1 : undefined,
  sourceHint: spec.tier <= 3 ? ['BOSS', 'QUEST', 'DUNGEON'] : spec.tier <= 6 ? ['BOSS', 'WORLD_BOSS', 'EVENT'] : ['WORLD_BOSS', 'EVENT'],
  inputs: blueprintInputs(spec),
  linhThachCost: blueprintLinhThachCost(spec.tier),
  successRate: blueprintBaseSuccess(spec.tier),
  possibleGrades: blueprintGradeWeights(spec.tier),
  maxGrade: blueprintMaxGrade(spec.tier),
  bindOnCraft: spec.tier >= 8,
  enabled: true,
}));

const BLUEPRINT_BY_KEY = new Map<string, ArtifactBlueprintDef>(
  ARTIFACT_BLUEPRINT_CATALOG.map((b) => [b.key, b]),
);

export function getArtifactBlueprint(key: string): ArtifactBlueprintDef | undefined {
  return BLUEPRINT_BY_KEY.get(key);
}

// ─────────────────────────────────────────────────────────────────────
// Crafting helpers.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactCraftContext {
  playerRealmOrder: number;
  playerBodyRealmOrder?: number;
  playerAlchemyLevel?: number;
  /** Tổng % bonus success từ furnace/method/passive talent (cap 0.15). */
  externalSuccessBonus?: number;
}

const CRAFT_EXTERNAL_BONUS_CAP = 0.15;
const CRAFT_SUCCESS_RATE_CAP = 0.95;

export function computeArtifactCraftSuccessRate(
  blueprint: ArtifactBlueprintDef,
  context: ArtifactCraftContext,
): number {
  let rate = blueprint.successRate;
  // Penalty nếu cảnh giới chưa đủ recommended: -10% per missing realm tier.
  const recommended = getArtifactTierDef(blueprint.artifactTier)?.recommendedRealmOrder ?? 0;
  if (context.playerRealmOrder < recommended) {
    rate -= 0.05 * Math.max(0, recommended - context.playerRealmOrder);
  }
  // Bonus nếu cảnh giới vượt recommended: +2% per extra realm, cap 0.1.
  if (context.playerRealmOrder > recommended) {
    rate += Math.min(0.1, 0.02 * (context.playerRealmOrder - recommended));
  }
  // External bonus (furnace, method, passive).
  const ext = Math.min(CRAFT_EXTERNAL_BONUS_CAP, Math.max(0, context.externalSuccessBonus ?? 0));
  rate += ext;
  return clamp01(rate, 0.05, CRAFT_SUCCESS_RATE_CAP);
}

function clamp01(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export interface ArtifactCraftCheck {
  ok: boolean;
  errors: ArtifactCraftErrorCode[];
}

export type ArtifactCraftErrorCode =
  | 'BLUEPRINT_NOT_FOUND'
  | 'BLUEPRINT_DISABLED'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_DISABLED'
  | 'REALM_TOO_LOW'
  | 'BODY_REALM_TOO_LOW'
  | 'ALCHEMY_LEVEL_TOO_LOW'
  | 'TIER_TOO_HIGH';

/**
 * Validate điều kiện cảnh giới + alchemy level + body. Caller chịu
 * trách nhiệm check inventory + linhThach trước khi commit.
 */
export function canCraftArtifact(
  blueprint: ArtifactBlueprintDef,
  context: ArtifactCraftContext,
): ArtifactCraftCheck {
  const errors: ArtifactCraftErrorCode[] = [];
  if (!blueprint.enabled) errors.push('BLUEPRINT_DISABLED');
  const art = getArtifactDef(blueprint.artifactKey);
  if (!art) errors.push('ARTIFACT_NOT_FOUND');
  else if (!art.enabled) errors.push('ARTIFACT_DISABLED');
  if (context.playerRealmOrder < blueprint.requiredRealmOrder) {
    errors.push('REALM_TOO_LOW');
  }
  if (
    blueprint.requiredBodyRealmOrder &&
    (context.playerBodyRealmOrder ?? 0) < blueprint.requiredBodyRealmOrder
  ) {
    errors.push('BODY_REALM_TOO_LOW');
  }
  if (
    blueprint.requiredAlchemyLevel &&
    (context.playerAlchemyLevel ?? 0) < blueprint.requiredAlchemyLevel
  ) {
    errors.push('ALCHEMY_LEVEL_TOO_LOW');
  }
  // Tier-too-high rule: artifact tier > player tier + 1 → require special.
  const playerTier = artifactTierForRealmOrder(context.playerRealmOrder);
  if (blueprint.artifactTier > playerTier + 1) errors.push('TIER_TOO_HIGH');
  return { ok: errors.length === 0, errors };
}

/**
 * Roll grade khi craft success. Khi craft fail thì không gọi hàm này.
 *
 * Algorithm: cumulative weight + linear roll, clamp to `maxGrade`. Cap
 * DAO_VAN rate cứng ≤ 0.05 ngay cả khi blueprint khai báo cao hơn.
 */
export function rollArtifactGrade(
  blueprint: ArtifactBlueprintDef,
  rng: () => number,
): ArtifactGrade {
  const weights = blueprint.possibleGrades;
  const maxOrder = artifactGradeOrder(blueprint.maxGrade);
  let total = 0;
  const norm: Array<{ grade: ArtifactGrade; w: number }> = [];
  for (const g of ARTIFACT_GRADES) {
    if (artifactGradeOrder(g) > maxOrder) continue;
    const w = weights[g] ?? 0;
    if (w <= 0) continue;
    // DAO_VAN extra cap.
    let capped = w;
    if (g === 'DAO_VAN' && blueprint.artifactTier <= 7) {
      capped = Math.min(w, Math.max(0.0001, total * (0.02 / Math.max(0.0001, 1 - 0.02))));
    }
    total += capped;
    norm.push({ grade: g, w: capped });
  }
  if (total <= 0) return 'TRUNG_PHAM';
  const r = rng() * total;
  let acc = 0;
  for (const entry of norm) {
    acc += entry.w;
    if (r <= acc) return entry.grade;
  }
  return norm[norm.length - 1].grade;
}

export interface ArtifactSubStatRoll {
  kind: keyof ArtifactStatBlock;
  value: number;
}

/**
 * Roll N substat khi craft / refine. Higher grade → more substat slots.
 */
export function rollArtifactSubStats(
  art: ArtifactDef,
  grade: ArtifactGrade,
  rng: () => number,
): ArtifactSubStatRoll[] {
  const slots = subStatSlotsForGrade(grade);
  if (slots <= 0) return [];
  const pool = art.subStatPool;
  if (pool.length === 0) return [];
  const total = pool.reduce((acc, e) => acc + e.weight, 0);
  const out: ArtifactSubStatRoll[] = [];
  const used = new Set<string>();
  let safety = 0;
  while (out.length < slots && safety++ < 50) {
    const r = rng() * total;
    let acc = 0;
    let pick: ArtifactSubStatPool | undefined;
    for (const e of pool) {
      acc += e.weight;
      if (r <= acc) {
        pick = e;
        break;
      }
    }
    if (!pick) break;
    if (used.has(pick.kind as string)) continue;
    used.add(pick.kind as string);
    const value = Math.round(pick.min + rng() * (pick.max - pick.min));
    out.push({ kind: pick.kind, value });
  }
  return out;
}

export function subStatSlotsForGrade(grade: ArtifactGrade): number {
  switch (grade) {
    case 'HA_PHAM':
      return 0;
    case 'TRUNG_PHAM':
      return 1;
    case 'THUONG_PHAM':
      return 2;
    case 'CUC_PHAM':
      return 3;
    case 'LINH_VAN':
      return 4;
    case 'DAO_VAN':
      return 4;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Stat computation.
// ─────────────────────────────────────────────────────────────────────

export interface CharacterArtifactState {
  artifactKey: string;
  grade: ArtifactGrade;
  level: number;
  star: number;
  refineLevel: number;
  awakenLevel: number;
  spiritLevel: number;
  /** Substat rolled từ craft / refine. */
  subStats: readonly ArtifactSubStatRoll[];
  /** Slot equipped — null = không trong combat snapshot. */
  equippedSlot: ArtifactEquipSlot | null;
}

function addStat(target: ArtifactStatBlock, source: ArtifactStatBlock, mul = 1): void {
  if (source.atk) target.atk = (target.atk ?? 0) + source.atk * mul;
  if (source.def) target.def = (target.def ?? 0) + source.def * mul;
  if (source.hpMax) target.hpMax = (target.hpMax ?? 0) + source.hpMax * mul;
  if (source.mpMax) target.mpMax = (target.mpMax ?? 0) + source.mpMax * mul;
  if (source.spirit) target.spirit = (target.spirit ?? 0) + source.spirit * mul;
  if (source.speed) target.speed = (target.speed ?? 0) + source.speed * mul;
  if (source.crit) target.crit = (target.crit ?? 0) + source.crit * mul;
  if (source.bossDamageReductionPct) {
    target.bossDamageReductionPct =
      (target.bossDamageReductionPct ?? 0) + source.bossDamageReductionPct * mul;
  }
  if (source.cultivationRateBonusPct) {
    target.cultivationRateBonusPct =
      (target.cultivationRateBonusPct ?? 0) + source.cultivationRateBonusPct * mul;
  }
  if (source.bodyCultivationRateBonusPct) {
    target.bodyCultivationRateBonusPct =
      (target.bodyCultivationRateBonusPct ?? 0) + source.bodyCultivationRateBonusPct * mul;
  }
  if (source.alchemySuccessRateBonusPct) {
    target.alchemySuccessRateBonusPct =
      (target.alchemySuccessRateBonusPct ?? 0) + source.alchemySuccessRateBonusPct * mul;
  }
  if (source.dropRateBonusPct) {
    target.dropRateBonusPct = (target.dropRateBonusPct ?? 0) + source.dropRateBonusPct * mul;
  }
  if (source.luckBonusPct) {
    target.luckBonusPct = (target.luckBonusPct ?? 0) + source.luckBonusPct * mul;
  }
  if (source.tribulationSupportBonusPct) {
    target.tribulationSupportBonusPct =
      (target.tribulationSupportBonusPct ?? 0) + source.tribulationSupportBonusPct * mul;
  }
  if (source.elementalAtkBonus) {
    target.elementalAtkBonus = target.elementalAtkBonus ?? {};
    for (const k of Object.keys(source.elementalAtkBonus) as ElementKey[]) {
      target.elementalAtkBonus[k] =
        (target.elementalAtkBonus[k] ?? 0) + (source.elementalAtkBonus[k] ?? 0) * mul;
    }
  }
  if (source.elementResist) {
    target.elementResist = target.elementResist ?? {};
    for (const k of Object.keys(source.elementResist) as ElementKey[]) {
      target.elementResist[k] =
        (target.elementResist[k] ?? 0) + (source.elementResist[k] ?? 0) * mul;
    }
  }
}

function scaleStat(target: ArtifactStatBlock, mul: number): void {
  if (target.atk) target.atk = Math.round(target.atk * mul);
  if (target.def) target.def = Math.round(target.def * mul);
  if (target.hpMax) target.hpMax = Math.round(target.hpMax * mul);
  if (target.mpMax) target.mpMax = Math.round(target.mpMax * mul);
  if (target.spirit) target.spirit = Math.round(target.spirit * mul);
  if (target.speed) target.speed = Math.round(target.speed * mul * 10) / 10;
  if (target.crit) target.crit = Math.round(target.crit * mul * 10) / 10;
  if (target.bossDamageReductionPct) {
    target.bossDamageReductionPct = round2(target.bossDamageReductionPct * mul);
  }
  if (target.cultivationRateBonusPct) {
    target.cultivationRateBonusPct = round2(target.cultivationRateBonusPct * mul);
  }
  if (target.bodyCultivationRateBonusPct) {
    target.bodyCultivationRateBonusPct = round2(target.bodyCultivationRateBonusPct * mul);
  }
  if (target.alchemySuccessRateBonusPct) {
    target.alchemySuccessRateBonusPct = round2(target.alchemySuccessRateBonusPct * mul);
  }
  if (target.dropRateBonusPct) target.dropRateBonusPct = round2(target.dropRateBonusPct * mul);
  if (target.luckBonusPct) target.luckBonusPct = round2(target.luckBonusPct * mul);
  if (target.tribulationSupportBonusPct) {
    target.tribulationSupportBonusPct = round2(target.tribulationSupportBonusPct * mul);
  }
  // element bonuses stay percent floats (rounded to 4 decimals).
  if (target.elementalAtkBonus) {
    for (const k of Object.keys(target.elementalAtkBonus) as ElementKey[]) {
      target.elementalAtkBonus[k] = round4(
        (target.elementalAtkBonus[k] ?? 0) * mul,
      );
    }
  }
  if (target.elementResist) {
    for (const k of Object.keys(target.elementResist) as ElementKey[]) {
      target.elementResist[k] = round4((target.elementResist[k] ?? 0) * mul);
    }
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Tổng stat 1 artifact instance. KHÔNG clamp cap ở đây — clamp ở
 * `clampArtifactV2Snapshot` khi compose tất cả equipped artifacts.
 */
export function computeArtifactStats(
  art: ArtifactDef,
  state: Omit<CharacterArtifactState, 'artifactKey' | 'equippedSlot'>,
): ArtifactStatBlock {
  const out: ArtifactStatBlock = {};
  const level = Math.max(1, state.level);
  const star = Math.max(0, state.star);
  addStat(out, art.baseStats);
  addStat(out, art.perLevelStats, level - 1);
  if (star > 0) addStat(out, art.perStarStats, star);
  // Refine multiplier — each refine level +5% to baseStats only.
  const refineMul = 1 + 0.05 * Math.max(0, state.refineLevel);
  scaleStat(out, refineMul);
  // Awaken multiplier — each awaken +8%.
  const awakenMul = 1 + 0.08 * Math.max(0, state.awakenLevel);
  scaleStat(out, awakenMul);
  // Spirit level bonus — +2% per spirit level (light support).
  const spiritMul = 1 + 0.02 * Math.max(0, state.spiritLevel);
  scaleStat(out, spiritMul);
  // Apply substats additively (already capped per refine roll).
  for (const sub of state.subStats) {
    if (sub.kind === 'elementalAtkBonus' || sub.kind === 'elementResist') continue;
    const key = sub.kind as keyof ArtifactStatBlock;
    const numericKeys: ReadonlyArray<keyof ArtifactStatBlock> = [
      'atk',
      'def',
      'hpMax',
      'mpMax',
      'spirit',
      'speed',
      'crit',
      'bossDamageReductionPct',
      'cultivationRateBonusPct',
      'bodyCultivationRateBonusPct',
      'alchemySuccessRateBonusPct',
      'dropRateBonusPct',
      'luckBonusPct',
      'tribulationSupportBonusPct',
    ];
    if (numericKeys.includes(key)) {
      const k = key as
        | 'atk'
        | 'def'
        | 'hpMax'
        | 'mpMax'
        | 'spirit'
        | 'speed'
        | 'crit'
        | 'bossDamageReductionPct'
        | 'cultivationRateBonusPct'
        | 'bodyCultivationRateBonusPct'
        | 'alchemySuccessRateBonusPct'
        | 'dropRateBonusPct'
        | 'luckBonusPct'
        | 'tribulationSupportBonusPct';
      out[k] = (out[k] ?? 0) + sub.value;
    }
  }
  // Apply grade multiplier on flat stats only (not on % bonus).
  const gradeMul = artifactGradeMultiplier(state.grade);
  if (out.atk) out.atk = Math.round(out.atk * gradeMul);
  if (out.def) out.def = Math.round(out.def * gradeMul);
  if (out.hpMax) out.hpMax = Math.round(out.hpMax * gradeMul);
  if (out.mpMax) out.mpMax = Math.round(out.mpMax * gradeMul);
  if (out.spirit) out.spirit = Math.round(out.spirit * gradeMul);
  if (out.speed) out.speed = Math.round(out.speed * gradeMul * 10) / 10;
  if (out.crit) out.crit = Math.round(out.crit * gradeMul * 10) / 10;
  return out;
}

export function computeArtifactPowerScore(
  art: ArtifactDef,
  state: Omit<CharacterArtifactState, 'artifactKey' | 'equippedSlot'>,
): number {
  const stats = computeArtifactStats(art, state);
  let score = 0;
  score += (stats.atk ?? 0) * 5;
  score += (stats.def ?? 0) * 5;
  score += (stats.hpMax ?? 0) * 1;
  score += (stats.mpMax ?? 0) * 1;
  score += (stats.spirit ?? 0) * 6;
  score += (stats.speed ?? 0) * 8;
  score += (stats.crit ?? 0) * 12;
  score += (stats.bossDamageReductionPct ?? 0) * 60;
  score += (stats.cultivationRateBonusPct ?? 0) * 40;
  score += (stats.bodyCultivationRateBonusPct ?? 0) * 40;
  score += (stats.alchemySuccessRateBonusPct ?? 0) * 50;
  score += (stats.luckBonusPct ?? 0) * 30;
  score += (stats.dropRateBonusPct ?? 0) * 30;
  return Math.round(score);
}

/**
 * Snapshot bonus tổng từ TẤT CẢ artifact V2 đang equip. Clamp cap theo
 * `ARTIFACT_BONUS_CAPS` để không phá balance.
 */
export interface ArtifactV2Snapshot {
  atk: number;
  def: number;
  hpMax: number;
  mpMax: number;
  spirit: number;
  speed: number;
  crit: number;
  bossDamageReductionPct: number;
  cultivationRateBonusPct: number;
  bodyCultivationRateBonusPct: number;
  alchemySuccessRateBonusPct: number;
  dropRateBonusPct: number;
  luckBonusPct: number;
  tribulationSupportBonusPct: number;
  elementalAtkBonus: Partial<Record<ElementKey, number>>;
  elementResist: Partial<Record<ElementKey, number>>;
}

export function emptyArtifactSnapshot(): ArtifactV2Snapshot {
  return {
    atk: 0,
    def: 0,
    hpMax: 0,
    mpMax: 0,
    spirit: 0,
    speed: 0,
    crit: 0,
    bossDamageReductionPct: 0,
    cultivationRateBonusPct: 0,
    bodyCultivationRateBonusPct: 0,
    alchemySuccessRateBonusPct: 0,
    dropRateBonusPct: 0,
    luckBonusPct: 0,
    tribulationSupportBonusPct: 0,
    elementalAtkBonus: {},
    elementResist: {},
  };
}

export function clampArtifactV2Snapshot(
  raw: ArtifactV2Snapshot,
): ArtifactV2Snapshot {
  const out: ArtifactV2Snapshot = { ...raw };
  out.cultivationRateBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.cultivationRateBonusPct,
    Math.max(0, raw.cultivationRateBonusPct),
  );
  out.bodyCultivationRateBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.bodyCultivationRateBonusPct,
    Math.max(0, raw.bodyCultivationRateBonusPct),
  );
  out.alchemySuccessRateBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.alchemySuccessRateBonusPct,
    Math.max(0, raw.alchemySuccessRateBonusPct),
  );
  out.dropRateBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.dropRateBonusPct,
    Math.max(0, raw.dropRateBonusPct),
  );
  out.luckBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.luckBonusPct,
    Math.max(0, raw.luckBonusPct),
  );
  out.bossDamageReductionPct = Math.min(
    ARTIFACT_BONUS_CAPS.bossDamageReductionPct,
    Math.max(0, raw.bossDamageReductionPct),
  );
  out.tribulationSupportBonusPct = Math.min(
    ARTIFACT_BONUS_CAPS.tribulationSupportBonusPct,
    Math.max(0, raw.tribulationSupportBonusPct),
  );
  out.crit = Math.min(ARTIFACT_BONUS_CAPS.critPct, Math.max(0, raw.crit));
  out.speed = Math.min(ARTIFACT_BONUS_CAPS.speedPct, Math.max(0, raw.speed));
  const elemAtk: Partial<Record<ElementKey, number>> = {};
  for (const k of Object.keys(raw.elementalAtkBonus) as ElementKey[]) {
    elemAtk[k] = Math.min(
      ARTIFACT_BONUS_CAPS.elementalAtkBonusPerElement,
      Math.max(0, raw.elementalAtkBonus[k] ?? 0),
    );
  }
  out.elementalAtkBonus = elemAtk;
  const elemRes: Partial<Record<ElementKey, number>> = {};
  for (const k of Object.keys(raw.elementResist) as ElementKey[]) {
    elemRes[k] = Math.min(
      ARTIFACT_BONUS_CAPS.elementResistPerElement,
      Math.max(0, raw.elementResist[k] ?? 0),
    );
  }
  out.elementResist = elemRes;
  // Flat stats keep raw (combat aggregator already uses them via `+`).
  return out;
}

export interface EquippedArtifactEntry {
  state: CharacterArtifactState;
  def: ArtifactDef;
}

export function aggregateArtifactV2Snapshot(
  entries: readonly EquippedArtifactEntry[],
): ArtifactV2Snapshot {
  const snap = emptyArtifactSnapshot();
  for (const entry of entries) {
    if (!entry.state.equippedSlot) continue;
    const stats = computeArtifactStats(entry.def, entry.state);
    snap.atk += stats.atk ?? 0;
    snap.def += stats.def ?? 0;
    snap.hpMax += stats.hpMax ?? 0;
    snap.mpMax += stats.mpMax ?? 0;
    snap.spirit += stats.spirit ?? 0;
    snap.speed += stats.speed ?? 0;
    snap.crit += stats.crit ?? 0;
    snap.bossDamageReductionPct += stats.bossDamageReductionPct ?? 0;
    snap.cultivationRateBonusPct += stats.cultivationRateBonusPct ?? 0;
    snap.bodyCultivationRateBonusPct += stats.bodyCultivationRateBonusPct ?? 0;
    snap.alchemySuccessRateBonusPct += stats.alchemySuccessRateBonusPct ?? 0;
    snap.dropRateBonusPct += stats.dropRateBonusPct ?? 0;
    snap.luckBonusPct += stats.luckBonusPct ?? 0;
    snap.tribulationSupportBonusPct += stats.tribulationSupportBonusPct ?? 0;
    if (stats.elementalAtkBonus) {
      for (const k of Object.keys(stats.elementalAtkBonus) as ElementKey[]) {
        snap.elementalAtkBonus[k] =
          (snap.elementalAtkBonus[k] ?? 0) + (stats.elementalAtkBonus[k] ?? 0);
      }
    }
    if (stats.elementResist) {
      for (const k of Object.keys(stats.elementResist) as ElementKey[]) {
        snap.elementResist[k] = (snap.elementResist[k] ?? 0) + (stats.elementResist[k] ?? 0);
      }
    }
  }
  return clampArtifactV2Snapshot(snap);
}

// ─────────────────────────────────────────────────────────────────────
// Upgrade cost helpers.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactUpgradeCost {
  linhThachCost: number;
  materials: readonly ArtifactBlueprintInput[];
}

export function computeArtifactLevelUpCost(
  art: ArtifactDef,
  currentLevel: number,
): ArtifactUpgradeCost {
  const t = art.tier;
  const base = tierPriceCurve(t, 80);
  const linhThachCost = Math.round(base * (1 + 0.18 * currentLevel));
  const materials: ArtifactBlueprintInput[] = [
    { itemKey: artifactOreKey(t), qty: 1 + Math.floor(currentLevel / 5) },
  ];
  return { linhThachCost, materials };
}

export function computeArtifactStarUpCost(
  art: ArtifactDef,
  currentStar: number,
): ArtifactUpgradeCost {
  const t = art.tier;
  const base = tierPriceCurve(t, 280);
  const linhThachCost = Math.round(base * Math.pow(1.6, currentStar));
  const materials: ArtifactBlueprintInput[] = [
    { itemKey: artifactEmbryoKey(t), qty: 1 + currentStar },
    { itemKey: artifactSpiritEssenceKey(t), qty: 1 + Math.floor(currentStar / 2) },
  ];
  return { linhThachCost, materials };
}

export function computeArtifactRefineCost(
  art: ArtifactDef,
  currentRefine: number,
): ArtifactUpgradeCost {
  const t = art.tier;
  const base = tierPriceCurve(t, 420);
  const linhThachCost = Math.round(base * (1 + 0.5 * currentRefine));
  const materials: ArtifactBlueprintInput[] = [
    { itemKey: artifactRefineStoneKey(t), qty: 1 + Math.floor(currentRefine / 2) },
    { itemKey: artifactElementalEssenceKey(t), qty: 1 },
  ];
  return { linhThachCost, materials };
}

export function computeArtifactAwakenCost(
  art: ArtifactDef,
  currentAwaken: number,
): ArtifactUpgradeCost {
  const t = art.tier;
  const base = tierPriceCurve(t, 800);
  const linhThachCost = Math.round(base * Math.pow(2, currentAwaken));
  const materials: ArtifactBlueprintInput[] = [
    { itemKey: artifactAwakenCoreKey(t), qty: 1 + currentAwaken },
    { itemKey: artifactBossCoreKey(t), qty: 1 },
  ];
  return { linhThachCost, materials };
}

// ─────────────────────────────────────────────────────────────────────
// Star-up success rate (with fail handling).
// ─────────────────────────────────────────────────────────────────────

export function artifactStarUpSuccessRate(currentStar: number): number {
  if (currentStar <= 0) return 1.0; // 0 → 1 luôn thành công.
  if (currentStar <= 2) return 0.85;
  if (currentStar <= 4) return 0.65;
  if (currentStar <= 6) return 0.45;
  if (currentStar <= 8) return 0.3;
  return 0.18; // sao 9+ rất khó.
}

export function artifactRefineSuccessRate(currentRefine: number): number {
  if (currentRefine <= 1) return 1.0;
  if (currentRefine <= 3) return 0.8;
  if (currentRefine <= 5) return 0.6;
  if (currentRefine <= 7) return 0.4;
  return 0.25;
}

export function artifactAwakenSuccessRate(currentAwaken: number): number {
  if (currentAwaken <= 0) return 0.9;
  if (currentAwaken <= 1) return 0.7;
  if (currentAwaken <= 2) return 0.5;
  if (currentAwaken <= 3) return 0.35;
  return 0.2;
}

// ─────────────────────────────────────────────────────────────────────
// Equip helpers.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactEquipContext {
  playerRealmOrder: number;
  /** Slot đang có artifact khác equipped (sẽ swap). */
  occupyingArtifactId?: string | null;
}

export type ArtifactEquipErrorCode =
  | 'ARTIFACT_NOT_FOUND'
  | 'REALM_TOO_LOW'
  | 'SLOT_INVALID_FOR_TYPE'
  | 'SLOT_CONFLICT';

export interface ArtifactEquipCheck {
  ok: boolean;
  errors: ArtifactEquipErrorCode[];
}

export function canEquipArtifact(
  art: ArtifactDef,
  slot: ArtifactEquipSlot,
  context: ArtifactEquipContext,
): ArtifactEquipCheck {
  const errors: ArtifactEquipErrorCode[] = [];
  if (context.playerRealmOrder < art.requiredRealmOrder) errors.push('REALM_TOO_LOW');
  if (!allowedSlotsForArtifactType(art.type).includes(slot)) {
    errors.push('SLOT_INVALID_FOR_TYPE');
  }
  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Validation helpers.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactCatalogValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateArtifactCatalog(): ArtifactCatalogValidationResult {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const a of ARTIFACT_CATALOG_V2) {
    if (keys.has(a.key)) errors.push(`duplicate artifact key: ${a.key}`);
    keys.add(a.key);
    if (!ARTIFACT_TYPES.includes(a.type)) errors.push(`bad type ${a.type} on ${a.key}`);
    if (!ARTIFACT_ELEMENTS.includes(a.element)) {
      errors.push(`bad element ${a.element} on ${a.key}`);
    }
    if (!getArtifactTierDef(a.tier)) errors.push(`bad tier ${a.tier} on ${a.key}`);
    if (a.requiredRealmOrder < 1 || a.requiredRealmOrder > 28) {
      errors.push(`bad requiredRealmOrder on ${a.key}`);
    }
  }
  const bpKeys = new Set<string>();
  for (const bp of ARTIFACT_BLUEPRINT_CATALOG) {
    if (bpKeys.has(bp.key)) errors.push(`duplicate blueprint: ${bp.key}`);
    bpKeys.add(bp.key);
    if (!ARTIFACT_BY_KEY.has(bp.artifactKey)) {
      errors.push(`blueprint ${bp.key} references unknown artifact ${bp.artifactKey}`);
    }
    if (bp.successRate <= 0 || bp.successRate > CRAFT_SUCCESS_RATE_CAP) {
      errors.push(`blueprint ${bp.key} success rate out of [0..${CRAFT_SUCCESS_RATE_CAP}]`);
    }
    // DAO_VAN cap weight check for low tier.
    if (bp.artifactTier <= 4 && (bp.possibleGrades.DAO_VAN ?? 0) > 5) {
      errors.push(`blueprint ${bp.key} DAO_VAN weight too high for low tier`);
    }
    for (const input of bp.inputs) {
      if (!ARTIFACT_MATERIAL_BY_KEY.has(input.itemKey)) {
        errors.push(
          `blueprint ${bp.key} input ${input.itemKey} not in artifact material catalog`,
        );
      }
      if (input.qty <= 0) errors.push(`blueprint ${bp.key} input qty <= 0`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Reverse-lookup helpers used by inventory / drop UI.
// ─────────────────────────────────────────────────────────────────────

export function isArtifactV2EquipSlot(slot: string): slot is ArtifactEquipSlot {
  return ARTIFACT_EQUIP_SLOTS.includes(slot as ArtifactEquipSlot);
}

export function isLegacyArtifactSlot(slot: EquipSlot | null | undefined): boolean {
  return slot === 'ARTIFACT_1' || slot === 'ARTIFACT_2' || slot === 'ARTIFACT_3';
}

/**
 * Quality mapping cho artifact V2 — chỉ dùng cho UI tag (icon/màu sắc).
 * Tier 1–2 = LINH, 3–4 = HUYEN, 5–6 = TIEN, 7–9 = THAN.
 */
export function qualityForArtifactTier(tier: ArtifactTier): Quality {
  if (tier <= 2) return 'LINH';
  if (tier <= 4) return 'HUYEN';
  if (tier <= 6) return 'TIEN';
  return 'THAN';
}
