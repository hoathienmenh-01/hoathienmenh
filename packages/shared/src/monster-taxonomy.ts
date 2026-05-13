/**
 * Phase 26.5 — Monster Taxonomy V2 (Family + extended MonsterType + danger
 * level) cho World Content V2.
 *
 * Module này **mở rộng** taxonomy quái mà KHÔNG đụng `MonsterDef` cũ ở
 * `combat.ts`. V1 `MonsterType` chỉ có BEAST/HUMANOID/SPIRIT/ELITE/BOSS —
 * World Content V2 cần phân loại tinh hơn để:
 *
 *   - Quyết định auto-battle vs manual encounter (chỉ NORMAL được auto).
 *   - Group drop hint theo family (yêu thú → yêu đan, ma tu → ma hạch,
 *     khôi lỗi → linh kiện ...) để Drop Economy V2 chọn pool đúng.
 *   - Reward boss theo category (region/hourly/world/event/quest/sect/
 *     hidden/trial/dungeon) — wire qua `world-bosses-v2.ts`.
 *
 * **Pure catalog + helper** — không phụ thuộc runtime, không Prisma.
 * Combat runtime hiện vẫn dùng `MonsterType` cũ; World Content V2 service
 * sẽ map qua helper `monsterTypeToV2(monsterTypeV1)` khi cần.
 */
import type { MaterialCategory } from './items';
import type { ElementKey } from './combat';

// ───────────────────────────────────────────────────────────────────────────
// MonsterTypeV2 — extended taxonomy
// ───────────────────────────────────────────────────────────────────────────

/**
 * Loại quái mở rộng cho World Content V2. Đặt tách khỏi `MonsterType` cũ
 * (`combat.ts`) để không phá schema combat hiện hữu. Mapping V1↔V2 qua
 * {@link mapV1MonsterTypeToV2}.
 */
export type MonsterTypeV2 =
  | 'NORMAL'
  | 'ELITE'
  | 'MINI_BOSS'
  | 'REGION_BOSS'
  | 'DUNGEON_BOSS'
  | 'WORLD_BOSS'
  | 'EVENT_BOSS'
  | 'QUEST_BOSS'
  | 'SIDE_QUEST_BOSS'
  | 'SECT_BOSS'
  | 'HIDDEN_BOSS'
  | 'TOWER_GUARDIAN';

export const MONSTER_TYPES_V2: readonly MonsterTypeV2[] = [
  'NORMAL',
  'ELITE',
  'MINI_BOSS',
  'REGION_BOSS',
  'DUNGEON_BOSS',
  'WORLD_BOSS',
  'EVENT_BOSS',
  'QUEST_BOSS',
  'SIDE_QUEST_BOSS',
  'SECT_BOSS',
  'HIDDEN_BOSS',
  'TOWER_GUARDIAN',
] as const;

/** Danger level — quyết định auto-farm có được phép tấn công không. */
export type MonsterDangerLevel = 'SAFE' | 'CAUTION' | 'DANGEROUS' | 'EXTREME';

export const MONSTER_DANGER_LEVELS: readonly MonsterDangerLevel[] = [
  'SAFE',
  'CAUTION',
  'DANGEROUS',
  'EXTREME',
] as const;

const DANGER_ORDER: Readonly<Record<MonsterDangerLevel, number>> = {
  SAFE: 0,
  CAUTION: 1,
  DANGEROUS: 2,
  EXTREME: 3,
};

export function compareDangerLevel(
  a: MonsterDangerLevel,
  b: MonsterDangerLevel,
): number {
  return DANGER_ORDER[a] - DANGER_ORDER[b];
}

// ───────────────────────────────────────────────────────────────────────────
// MonsterFamily — drop hint group
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tộc quái — dùng để gợi ý drop pool & lore narration. Mỗi family có
 * material category bias (xem {@link FAMILY_DROP_HINT}). Drop Economy V2
 * runtime tham chiếu hint khi gen drop pool cho monster cụ thể.
 */
export type MonsterFamily =
  | 'YEU_THU'          // yêu thú: yêu đan, thú cốt, huyết tinh
  | 'TA_TU'            // tà tu: đan bẩn, công pháp tà, độc vật
  | 'MA_TU'            // ma tu: ma hạch, tâm ma, vật liệu cấm
  | 'KHOI_LOI'         // khôi lỗi: linh kiện, pháp bảo phôi, kim loại
  | 'LINH_THE'         // linh thể: hồn tinh, linh châu, công pháp
  | 'QUY_VAT'          // quỷ vật: âm khí, hồn tinh, tâm ma
  | 'CO_THU'           // cổ thú: cổ huyết, sừng cổ thú, linh hồn
  | 'THU_VE_BI_CANH'   // thủ vệ bí cảnh: chìa khóa, mảnh bản đồ, mảnh công thức
  | 'DICH_TONG_MON'    // địch tông môn: tông môn token, công pháp tà
  | 'THIEN_KIEP'       // thiên kiếp hóa hình: tribulation material
  | 'TAM_MA'           // tâm ma: tâm ma, tinh thần, công pháp
  | 'DAO_ANH';         // đạo ảnh: điểm tháp, mảnh công pháp, trial reward

export const MONSTER_FAMILIES: readonly MonsterFamily[] = [
  'YEU_THU',
  'TA_TU',
  'MA_TU',
  'KHOI_LOI',
  'LINH_THE',
  'QUY_VAT',
  'CO_THU',
  'THU_VE_BI_CANH',
  'DICH_TONG_MON',
  'THIEN_KIEP',
  'TAM_MA',
  'DAO_ANH',
] as const;

/**
 * Per-family drop hint. Mỗi family bias về 1-3 `MaterialCategory` chính +
 * optional element affinity. Drop Economy V2 service sẽ tham chiếu để
 * weight pool drop khi roll cho monster của family đó.
 *
 * **KHÔNG override Drop Economy V2 cap** — hint chỉ là weight prior cho
 * pool pick, cap per-tier vẫn enforce. Anti-P2W: hint không cho rare
 * artifact / endgame material vào family `YEU_THU` thường.
 */
export interface FamilyDropHint {
  family: MonsterFamily;
  /** Categories quái family này thiên về rơi (theo thứ tự ưu tiên). */
  primaryCategories: readonly MaterialCategory[];
  /** Categories phụ — rơi ít hơn primary. */
  secondaryCategories: readonly MaterialCategory[];
  /** Element affinity hint nếu family có thiên hệ rõ. `null` = vô hệ / mix. */
  elementHint: ElementKey | null;
  /** Mô tả ngắn (Vi) — dùng cho UI tooltip family badge. */
  flavorVi: string;
  flavorEn: string;
}

export const FAMILY_DROP_HINT: readonly FamilyDropHint[] = [
  {
    family: 'YEU_THU',
    primaryCategories: ['ALCHEMY_BODY', 'BODY_BREAKTHROUGH'],
    secondaryCategories: ['ALCHEMY_QI', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Yêu thú thượng cổ — yêu đan, thú cốt, huyết tinh.',
    flavorEn: 'Ancient beasts — beast pills, beast bones, blood essence.',
  },
  {
    family: 'TA_TU',
    primaryCategories: ['ALCHEMY_QI', 'METHOD_FRAGMENT'],
    secondaryCategories: ['COMBAT_BUFF', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Tà tu phản phái — đan bẩn, công pháp tà, độc vật.',
    flavorEn: 'Heretic cultivators — tainted pills, dark methods, poisonous goods.',
  },
  {
    family: 'MA_TU',
    primaryCategories: ['TRIBULATION', 'METHOD_FRAGMENT'],
    secondaryCategories: ['COMBAT_BUFF', 'ARTIFACT_CRAFT'],
    elementHint: null,
    flavorVi: 'Ma tu — ma hạch, tâm ma, vật liệu cấm.',
    flavorEn: 'Demonic cultivators — demon cores, inner demon shards, forbidden materials.',
  },
  {
    family: 'KHOI_LOI',
    primaryCategories: ['ARTIFACT_CRAFT', 'EQUIPMENT_CRAFT'],
    secondaryCategories: ['FURNACE_UPGRADE', 'GENERAL'],
    elementHint: 'kim',
    flavorVi: 'Khôi lỗi linh khí — linh kiện, phôi pháp bảo, kim loại.',
    flavorEn: 'Mechanical constructs — spirit parts, artifact blanks, metals.',
  },
  {
    family: 'LINH_THE',
    primaryCategories: ['METHOD_FRAGMENT', 'ALCHEMY_QI'],
    secondaryCategories: ['ALCHEMY_BODY', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Linh thể — hồn tinh, linh châu, mảnh công pháp.',
    flavorEn: 'Spirit entities — soul essence, spirit pearls, method fragments.',
  },
  {
    family: 'QUY_VAT',
    primaryCategories: ['ALCHEMY_QI', 'TRIBULATION'],
    secondaryCategories: ['COMBAT_BUFF', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Quỷ vật âm khí — âm khí ngưng tụ, hồn tinh, tâm ma vụn.',
    flavorEn: 'Ghostly creatures — yin essence, soul fragments, inner demon shards.',
  },
  {
    family: 'CO_THU',
    primaryCategories: ['BODY_BREAKTHROUGH', 'ARTIFACT_CRAFT'],
    secondaryCategories: ['ALCHEMY_BODY', 'EQUIPMENT_CRAFT'],
    elementHint: 'tho',
    flavorVi: 'Cổ thú thượng cổ — cổ huyết, sừng cổ thú, linh hồn cổ tộc.',
    flavorEn: 'Primordial beasts — ancient blood, primal horns, ancient souls.',
  },
  {
    family: 'THU_VE_BI_CANH',
    primaryCategories: ['ARTIFACT_CRAFT', 'METHOD_FRAGMENT'],
    secondaryCategories: ['EQUIPMENT_CRAFT', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Thủ vệ bí cảnh — chìa khóa, mảnh bản đồ, mảnh công thức.',
    flavorEn: 'Secret-realm guardians — keys, map fragments, recipe shards.',
  },
  {
    family: 'DICH_TONG_MON',
    primaryCategories: ['METHOD_FRAGMENT', 'EQUIPMENT_CRAFT'],
    secondaryCategories: ['ARTIFACT_CRAFT', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Địch tông môn — tông môn token, công pháp tà, vật liệu tông môn.',
    flavorEn: 'Rival sect cultivators — sect tokens, hostile methods, sect materials.',
  },
  {
    family: 'THIEN_KIEP',
    primaryCategories: ['TRIBULATION'],
    secondaryCategories: ['METHOD_FRAGMENT', 'ARTIFACT_CRAFT'],
    elementHint: null,
    flavorVi: 'Thiên kiếp hóa hình — nguyên liệu vượt kiếp, lôi tinh.',
    flavorEn: 'Tribulation incarnations — tribulation materials, lightning essence.',
  },
  {
    family: 'TAM_MA',
    primaryCategories: ['TRIBULATION', 'METHOD_FRAGMENT'],
    secondaryCategories: ['ALCHEMY_QI', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Tâm ma — vụn tâm ma, tinh thần kết tinh, mảnh công pháp tâm pháp.',
    flavorEn: 'Inner demons — demon shards, crystallized will, mind-method fragments.',
  },
  {
    family: 'DAO_ANH',
    primaryCategories: ['METHOD_FRAGMENT', 'ARTIFACT_CRAFT'],
    secondaryCategories: ['ALCHEMY_QI', 'GENERAL'],
    elementHint: null,
    flavorVi: 'Đạo ảnh — phản chiếu chính ngươi trong tháp đạo, mảnh công pháp, điểm tháp.',
    flavorEn: 'Dao reflections — your own reflection inside the trial tower, method fragments, trial points.',
  },
];

export function getFamilyDropHint(
  family: MonsterFamily,
): FamilyDropHint | undefined {
  return FAMILY_DROP_HINT.find((h) => h.family === family);
}

// ───────────────────────────────────────────────────────────────────────────
// V1 ↔ V2 mapping helper
// ───────────────────────────────────────────────────────────────────────────

/** Map `MonsterDef.monsterType` (V1) sang `MonsterTypeV2` mặc định. */
export function mapV1MonsterTypeToV2(
  v1: 'BEAST' | 'HUMANOID' | 'SPIRIT' | 'ELITE' | 'BOSS' | undefined,
): MonsterTypeV2 {
  switch (v1) {
    case 'ELITE':
      return 'ELITE';
    case 'BOSS':
      return 'REGION_BOSS';
    case 'BEAST':
    case 'HUMANOID':
    case 'SPIRIT':
    case undefined:
    default:
      return 'NORMAL';
  }
}

/**
 * Quyết định auto-battle có được phép vs monster này.
 *
 * Rule (xem `docs/phase-26-5-world-content-v2-plan.md` §Auto farm rule):
 *
 *   canAutoBattle =
 *     monsterType === 'NORMAL'
 *     && monsterRealmTier <= playerRealmTier
 *     && dangerLevel <= SAFE
 */
export function canAutoBattle(args: {
  monsterType: MonsterTypeV2;
  monsterRealmTier: number;
  playerRealmTier: number;
  dangerLevel?: MonsterDangerLevel;
}): boolean {
  if (args.monsterType !== 'NORMAL') return false;
  if (args.monsterRealmTier > args.playerRealmTier) return false;
  const danger = args.dangerLevel ?? 'SAFE';
  return compareDangerLevel(danger, 'SAFE') <= 0;
}

/**
 * Threshold cho "quá nguy hiểm — cảnh báo / chặn challenge".
 * Áp dụng cho cả manual challenge: nếu monster cao hơn player ≥ 3 tier
 * thì client phải show cảnh báo cực mạnh.
 */
export const DANGEROUS_TIER_GAP = 2;
export const EXTREME_TIER_GAP = 3;

export function computeEffectiveDangerLevel(args: {
  monsterType: MonsterTypeV2;
  monsterRealmTier: number;
  playerRealmTier: number;
  base?: MonsterDangerLevel;
}): MonsterDangerLevel {
  const gap = args.monsterRealmTier - args.playerRealmTier;
  let base = args.base ?? 'SAFE';

  // Boss / Elite tự nâng base.
  if (
    args.monsterType === 'WORLD_BOSS' ||
    args.monsterType === 'EVENT_BOSS' ||
    args.monsterType === 'HIDDEN_BOSS' ||
    args.monsterType === 'TOWER_GUARDIAN'
  ) {
    base = compareDangerLevel(base, 'DANGEROUS') < 0 ? 'DANGEROUS' : base;
  } else if (
    args.monsterType === 'MINI_BOSS' ||
    args.monsterType === 'REGION_BOSS' ||
    args.monsterType === 'DUNGEON_BOSS' ||
    args.monsterType === 'QUEST_BOSS' ||
    args.monsterType === 'SIDE_QUEST_BOSS' ||
    args.monsterType === 'SECT_BOSS'
  ) {
    base = compareDangerLevel(base, 'CAUTION') < 0 ? 'CAUTION' : base;
  } else if (args.monsterType === 'ELITE') {
    base = compareDangerLevel(base, 'CAUTION') < 0 ? 'CAUTION' : base;
  }

  if (gap >= EXTREME_TIER_GAP) return 'EXTREME';
  if (gap >= DANGEROUS_TIER_GAP) {
    return compareDangerLevel(base, 'DANGEROUS') < 0 ? 'DANGEROUS' : base;
  }
  return base;
}
