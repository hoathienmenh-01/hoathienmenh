/**
 * Phase 35.0 — Pet / Linh Thú Full System (Foundation + Box/Pity + Upgrade +
 * Sources). Pure shared catalog & validators — KHÔNG I/O, KHÔNG Prisma,
 * KHÔNG env. Test deterministic.
 *
 * **Invariant (spec §1 §3)**:
 *   - Pet/Linh Thú KHÔNG bao giờ mạnh hơn nhân vật chính.
 *     `petPvECapPercent` ≤ 12, `petPvPDamageCapPercent` ≤ 5.
 *   - Mọi reward (pet, shard, material) phải qua `InventoryService` /
 *     `CurrencyService` / ledger — catalog ở đây CHỈ là metadata + công bố.
 *   - Mọi pet đều phải có `sourceTags` ≥ 1; pet không phải premium-only
 *     bắt buộc có ít nhất 1 source thuộc {FREE, EVENT, DUNGEON, BOSS,
 *     SECRET_REALM, ACHIEVEMENT, TRIAL_TOWER} để giữ non-gacha path.
 *   - Pet box rate sum = 100% (1.0 ± 1e-9), pity guarantee không bao giờ
 *     vượt 300 mở.
 *   - Skill effect drop/cultivation cap nhỏ; không có x2 damage vĩnh viễn,
 *     hồi sinh vô hạn, miễn sát thương dài.
 */

// ===========================================================================
// 1. Enums — type / element / quality / rarity / role / source / box
// ===========================================================================

export const PET_TYPES = ['PET', 'LINH_THU'] as const;
export type PetType = (typeof PET_TYPES)[number];

export function isPetType(s: unknown): s is PetType {
  return typeof s === 'string' && (PET_TYPES as readonly string[]).includes(s);
}

/** Ngũ Hành mở rộng cho pet (Kim Mộc Thủy Hỏa Thổ + Phong/Lôi/Băng/Quang/Ám). */
export const PET_ELEMENTS = [
  'KIM',
  'MOC',
  'THUY',
  'HOA',
  'THO',
  'PHONG',
  'LOI',
  'BANG',
  'QUANG',
  'AM',
] as const;
export type PetElement = (typeof PET_ELEMENTS)[number];

export function isPetElement(s: unknown): s is PetElement {
  return typeof s === 'string' && (PET_ELEMENTS as readonly string[]).includes(s);
}

/** Rarity dùng cho box drop / display. */
export const PET_RARITIES = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
] as const;
export type PetRarity = (typeof PET_RARITIES)[number];

export function isPetRarity(s: unknown): s is PetRarity {
  return typeof s === 'string' && (PET_RARITIES as readonly string[]).includes(s);
}

/** Quality dùng cho stat cap (Phàm/Linh/Huyền/Địa/Thiên/Thần). */
export const PET_QUALITIES = ['PHAM', 'LINH', 'HUYEN', 'DIA', 'THIEN', 'THAN'] as const;
export type PetQuality = (typeof PET_QUALITIES)[number];

export function isPetQuality(s: unknown): s is PetQuality {
  return typeof s === 'string' && (PET_QUALITIES as readonly string[]).includes(s);
}

export const PET_ROLES = [
  'UTILITY',
  'SUPPORT',
  'TANK',
  'DPS_SUPPORT',
  'HEAL_SUPPORT',
  'EXPLORATION',
] as const;
export type PetRole = (typeof PET_ROLES)[number];

export function isPetRole(s: unknown): s is PetRole {
  return typeof s === 'string' && (PET_ROLES as readonly string[]).includes(s);
}

export const PET_SOURCE_TAGS = [
  'FREE',
  'BOX',
  'EVENT',
  'DUNGEON',
  'SECRET_REALM',
  'BOSS',
  'ACHIEVEMENT',
  'TRIAL_TOWER',
  'SHOP',
] as const;
export type PetSourceTag = (typeof PET_SOURCE_TAGS)[number];

export function isPetSourceTag(s: unknown): s is PetSourceTag {
  return (
    typeof s === 'string' && (PET_SOURCE_TAGS as readonly string[]).includes(s)
  );
}

/** Combat context dùng để clamp pet contribution. */
export const PET_COMBAT_CONTEXTS = [
  'PVE',
  'PVP',
  'BOSS',
  'DUNGEON',
  'SECRET_REALM',
] as const;
export type PetCombatContext = (typeof PET_COMBAT_CONTEXTS)[number];

export function isPetCombatContext(s: unknown): s is PetCombatContext {
  return (
    typeof s === 'string' && (PET_COMBAT_CONTEXTS as readonly string[]).includes(s)
  );
}

// ===========================================================================
// 2. Power cap & policy (Phase 35 invariant)
// ===========================================================================

/**
 * Pet đóng góp tối đa trong PvE (% sức mạnh nhân vật). Spec §GIỚI HẠN
 * SỨC MẠNH: 5–12% — ta cap ở 12%.
 */
export const PET_PVE_CAP_PERCENT = 12;

/**
 * Pet damage contribution tối đa trong PvP (%). Spec §GIỚI HẠN SỨC MẠNH:
 * 3–5% — ta cap ở 5% (server clamp).
 */
export const PET_PVP_DAMAGE_CAP_PERCENT = 5;

/**
 * Pet damage contribution tối đa khi đánh BOSS (%). Pet hỗ trợ, không
 * solo boss.
 */
export const PET_BOSS_DAMAGE_CAP_PERCENT = 8;

/** PvP nhân multiplier cho mọi pet effect (giảm tác dụng pet trong PvP). */
export const PET_PVP_EFFECT_MULTIPLIER = 0.4; // 30–50% — chọn 40%.

/** Cap drop bonus skill: skill tăng drop ≤ 5%. */
export const PET_SKILL_DROP_BONUS_CAP_PERCENT = 5;

/** Cap cultivation bonus skill: skill tăng tu luyện ≤ 5%. */
export const PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT = 5;

/** Slot tối đa: 1 pet active foundation (mở rộng sau). */
export const PET_EQUIP_SLOT_MAX_DEFAULT = 1;

/** Tên custom: 1–24 ký tự, ASCII/VI thường, không control char. */
export const PET_CUSTOM_NAME_MIN_LENGTH = 1;
export const PET_CUSTOM_NAME_MAX_LENGTH = 24;

export function validatePetCustomName(name: string): {
  ok: boolean;
  reason?: 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_CHARS';
} {
  if (typeof name !== 'string') return { ok: false, reason: 'INVALID_CHARS' };
  const trimmed = name.trim();
  if (trimmed.length < PET_CUSTOM_NAME_MIN_LENGTH) {
    return { ok: false, reason: 'TOO_SHORT' };
  }
  if (trimmed.length > PET_CUSTOM_NAME_MAX_LENGTH) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>{}\\]/.test(trimmed)) {
    return { ok: false, reason: 'INVALID_CHARS' };
  }
  return { ok: true };
}

// ===========================================================================
// 3. Catalog types
// ===========================================================================

export interface PetBaseStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

export interface PetGrowthStats {
  /** HP cộng / level. */
  hpPerLevel: number;
  atkPerLevel: number;
  defPerLevel: number;
  spdPerLevel: number;
}

export type PetSkillCategory = 'PASSIVE' | 'ACTIVE' | 'SUPPORT' | 'EXPLORATION';

export interface PetSkillDef {
  skillKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: PetSkillCategory;
  /** Max skill level cho phép (cap theo quality/evolution của pet). */
  maxLevel: number;
  /** Hệ áp dụng. `null` = mọi hệ. */
  element?: PetElement | null;
  /** Tag effect — UI hiển thị + balance check. */
  effects?: {
    /** % bonus drop khi pet active (capped by `PET_SKILL_DROP_BONUS_CAP_PERCENT`). */
    dropBonusPct?: number;
    /** % bonus cultivation exp (capped by `PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT`). */
    cultivationBonusPct?: number;
    /** % HP shield khi vào trận. */
    shieldPct?: number;
    /** % heal khi pet active. */
    healPct?: number;
    /** % bonus damage cộng vào player damage. */
    damageBonusPct?: number;
    /** % giảm sát thương đối thủ vào player. */
    damageReductionPct?: number;
    /** Note đặc biệt. */
    notes?: string;
  };
}

export interface PetEvolutionStageDef {
  /** Stage 0 = base, 1 = first evolution, 2 = second. */
  stage: number;
  /** Tên hiển thị stage. */
  nameVi: string;
  nameEn: string;
  /** Visual key (asset). */
  visualKey?: string;
  /** Yêu cầu mở stage này. */
  requirements: {
    minLevel: number;
    minStar: number;
    /** Material consume — key trùng item catalog. */
    materials: { itemKey: string; qty: number }[];
    /** Cost linhThach. */
    linhThachCost?: number;
  };
  /** Skill unlock thêm khi đạt stage này. */
  unlocksSkillKeys?: string[];
}

export interface PetCatalogEntry {
  petKey: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  type: PetType;
  /** Loài (sói tuyết, hỏa long, …) — display only. */
  species: string;
  element: PetElement;
  /** Rarity cơ bản (khi sinh ra từ box / drop). */
  rarity: PetRarity;
  /** Quality khởi điểm. */
  quality: PetQuality;
  role: PetRole;
  baseStats: PetBaseStats;
  growthStats: PetGrowthStats;
  /** Danh sách skill key (resolve qua `PET_SKILLS`). */
  skillKeys: string[];
  /** Max level theo quality (tham chiếu policy). */
  maxLevelByQuality: Record<PetQuality, number>;
  starLimit: number;
  evolutionStages: PetEvolutionStageDef[];
  sourceTags: PetSourceTag[];
  isEventLimited: boolean;
  /** Pet "quan trọng" thường không tradeable trong market. */
  isTradeable: boolean;
  /** Pet chỉ cosmetic (skin / aura) — không tham gia combat. */
  isPremiumVisualOnly?: boolean;
  /**
   * Hint power budget: 1–5. Pet vượt budget cảnh báo ở Bestiary/admin.
   */
  powerBudgetTier: 1 | 2 | 3 | 4 | 5;
  /**
   * Hệ số nhân hiệu ứng PvP. Mặc định `PET_PVP_EFFECT_MULTIPLIER`. Pet
   * "anti-PvP" có thể nhỏ hơn.
   */
  pvpEffectivenessMultiplier?: number;
}

// ===========================================================================
// 4. Skill catalog (compact — share giữa nhiều pet)
// ===========================================================================

export const PET_SKILLS: readonly PetSkillDef[] = [
  // PASSIVE — bonus drop / cultivation (capped)
  {
    skillKey: 'pet_skill_explorer_eye',
    nameVi: 'Mắt Linh Thám',
    nameEn: 'Explorer Eye',
    descriptionVi: 'Tăng nhẹ tỉ lệ rơi vật phẩm.',
    descriptionEn: 'Slightly increases item drop rate.',
    category: 'PASSIVE',
    maxLevel: 5,
    effects: { dropBonusPct: 1 },
  },
  {
    skillKey: 'pet_skill_qi_nurture',
    nameVi: 'Dưỡng Khí',
    nameEn: 'Qi Nurture',
    descriptionVi: 'Tăng nhẹ tốc độ tu luyện.',
    descriptionEn: 'Slightly increases cultivation speed.',
    category: 'PASSIVE',
    maxLevel: 5,
    effects: { cultivationBonusPct: 1 },
  },
  {
    skillKey: 'pet_skill_lucky_paw',
    nameVi: 'Trảo May Mắn',
    nameEn: 'Lucky Paw',
    descriptionVi: 'Cộng thêm % nhỏ tỉ lệ drop hiếm.',
    descriptionEn: 'Small bonus to rare drop chance.',
    category: 'PASSIVE',
    maxLevel: 5,
    effects: { dropBonusPct: 2 },
  },

  // SUPPORT — shield / heal / damage reduction (PvP capped via multiplier)
  {
    skillKey: 'pet_skill_iron_shell',
    nameVi: 'Vỏ Sắt',
    nameEn: 'Iron Shell',
    descriptionVi: 'Tạo lá chắn HP khi vào trận.',
    descriptionEn: 'Generates an HP shield on combat start.',
    category: 'SUPPORT',
    maxLevel: 6,
    effects: { shieldPct: 3 },
  },
  {
    skillKey: 'pet_skill_gentle_breeze',
    nameVi: 'Phong Hoà',
    nameEn: 'Gentle Breeze',
    descriptionVi: 'Hồi máu định kỳ trong trận.',
    descriptionEn: 'Periodic heal during combat.',
    category: 'SUPPORT',
    maxLevel: 6,
    effects: { healPct: 2 },
  },
  {
    skillKey: 'pet_skill_aegis_aura',
    nameVi: 'Hộ Khiên Linh Hồn',
    nameEn: 'Aegis Aura',
    descriptionVi: 'Giảm nhẹ sát thương phải nhận.',
    descriptionEn: 'Slight damage reduction.',
    category: 'SUPPORT',
    maxLevel: 6,
    effects: { damageReductionPct: 2 },
  },

  // DPS_SUPPORT — damage bonus passive (PvP-cap aware)
  {
    skillKey: 'pet_skill_battle_roar',
    nameVi: 'Chiến Hống',
    nameEn: 'Battle Roar',
    descriptionVi: 'Cộng nhẹ sát thương trận.',
    descriptionEn: 'Slight bonus combat damage.',
    category: 'PASSIVE',
    maxLevel: 6,
    effects: { damageBonusPct: 2 },
  },
  {
    skillKey: 'pet_skill_flame_inspire',
    nameVi: 'Ngọn Lửa Cổ Vũ',
    nameEn: 'Flame Inspire',
    descriptionVi: 'Cộng sát thương lửa nhỏ.',
    descriptionEn: 'Small fire damage bonus.',
    category: 'PASSIVE',
    maxLevel: 6,
    element: 'HOA',
    effects: { damageBonusPct: 3 },
  },
  {
    skillKey: 'pet_skill_thunder_inspire',
    nameVi: 'Lôi Tâm Cổ Vũ',
    nameEn: 'Thunder Inspire',
    descriptionVi: 'Cộng sát thương sét nhỏ.',
    descriptionEn: 'Small thunder damage bonus.',
    category: 'PASSIVE',
    maxLevel: 6,
    element: 'LOI',
    effects: { damageBonusPct: 3 },
  },
  {
    skillKey: 'pet_skill_ice_inspire',
    nameVi: 'Băng Tâm Cổ Vũ',
    nameEn: 'Ice Inspire',
    descriptionVi: 'Cộng sát thương băng nhỏ.',
    descriptionEn: 'Small ice damage bonus.',
    category: 'PASSIVE',
    maxLevel: 6,
    element: 'BANG',
    effects: { damageBonusPct: 3 },
  },

  // EXPLORATION — chỉ ngoài combat
  {
    skillKey: 'pet_skill_scout_step',
    nameVi: 'Bước Trinh Sát',
    nameEn: 'Scout Step',
    descriptionVi: 'Mở thêm tầm nhìn map.',
    descriptionEn: 'Expands map vision in exploration.',
    category: 'EXPLORATION',
    maxLevel: 3,
    effects: { notes: 'EXPLORATION_VISION' },
  },
  {
    skillKey: 'pet_skill_treasure_sense',
    nameVi: 'Cảm Bảo',
    nameEn: 'Treasure Sense',
    descriptionVi: 'Báo hiệu ô có kỳ ngộ.',
    descriptionEn: 'Hints opportunity tiles.',
    category: 'EXPLORATION',
    maxLevel: 3,
    effects: { notes: 'EXPLORATION_OPPORTUNITY_HINT' },
  },

  // ACTIVE — only highest rarity
  {
    skillKey: 'pet_skill_phoenix_resurgence',
    nameVi: 'Phượng Hoàng Phục Sinh',
    nameEn: 'Phoenix Resurgence',
    descriptionVi: 'Hồi sinh 1 lần / trận với HP nhỏ.',
    descriptionEn: 'Revives once per match with small HP.',
    category: 'ACTIVE',
    maxLevel: 1,
    element: 'HOA',
    effects: { healPct: 10, notes: 'REVIVE_ONCE' },
  },
  {
    skillKey: 'pet_skill_kirin_blessing',
    nameVi: 'Kỳ Lân Ban Phúc',
    nameEn: 'Kirin Blessing',
    descriptionVi: 'Hộ khiên + heal kép đầu trận.',
    descriptionEn: 'Double shield + heal at combat start.',
    category: 'ACTIVE',
    maxLevel: 1,
    effects: { shieldPct: 5, healPct: 3 },
  },
] as const;

const PET_SKILLS_BY_KEY: Record<string, PetSkillDef> = Object.fromEntries(
  PET_SKILLS.map((s) => [s.skillKey, s]),
);

export function petSkillByKey(skillKey: string): PetSkillDef | undefined {
  return PET_SKILLS_BY_KEY[skillKey];
}

// ===========================================================================
// 5. Max level / star / evolution policy (per quality)
// ===========================================================================

/** Mặc định maxLevel theo quality — pet có thể override. */
export const PET_MAX_LEVEL_DEFAULT: Record<PetQuality, number> = {
  PHAM: 20,
  LINH: 40,
  HUYEN: 60,
  DIA: 80,
  THIEN: 100,
  THAN: 120,
};

/** Star limit chung mọi pet (catalog có thể override). */
export const PET_STAR_LIMIT_DEFAULT = 6;

/** Shard cần để star-up (theo mốc star). */
export const PET_STAR_UP_SHARD_COST: Record<number, number> = {
  2: 20,
  3: 40,
  4: 80,
  5: 150,
  6: 300,
};

export function petStarUpShardCost(targetStar: number): number {
  return PET_STAR_UP_SHARD_COST[targetStar] ?? 0;
}

/** Breakthrough level milestones (server gate maxLevel grow). */
export const PET_BREAKTHROUGH_LEVELS = [20, 40, 60, 80, 100] as const;

/** Material cần để breakthrough mốc (mirror item catalog). */
export interface PetBreakthroughCost {
  fromLevel: number;
  toLevel: number;
  materials: { itemKey: string; qty: number }[];
  linhThachCost: number;
}

export const PET_BREAKTHROUGH_COSTS: readonly PetBreakthroughCost[] = [
  {
    fromLevel: 20,
    toLevel: 21,
    materials: [{ itemKey: 'pet_mat_thu_hon_thach', qty: 5 }],
    linhThachCost: 500,
  },
  {
    fromLevel: 40,
    toLevel: 41,
    materials: [
      { itemKey: 'pet_mat_thu_hon_thach', qty: 12 },
      { itemKey: 'pet_mat_yeu_dan', qty: 3 },
    ],
    linhThachCost: 2000,
  },
  {
    fromLevel: 60,
    toLevel: 61,
    materials: [
      { itemKey: 'pet_mat_yeu_dan', qty: 8 },
      { itemKey: 'pet_mat_huyet_mach_tinh_hoa', qty: 2 },
    ],
    linhThachCost: 8000,
  },
  {
    fromLevel: 80,
    toLevel: 81,
    materials: [
      { itemKey: 'pet_mat_huyet_mach_tinh_hoa', qty: 5 },
      { itemKey: 'pet_mat_ban_menh_linh_chau', qty: 1 },
    ],
    linhThachCost: 25000,
  },
  {
    fromLevel: 100,
    toLevel: 101,
    materials: [
      { itemKey: 'pet_mat_ban_menh_linh_chau', qty: 3 },
      { itemKey: 'pet_mat_ngu_hanh_tinh_tuy', qty: 5 },
    ],
    linhThachCost: 80000,
  },
] as const;

export function petBreakthroughCost(
  fromLevel: number,
): PetBreakthroughCost | undefined {
  return PET_BREAKTHROUGH_COSTS.find((c) => c.fromLevel === fromLevel);
}

// ===========================================================================
// 6. Pet exp / feed table
// ===========================================================================

/** Exp item keys (matched với item catalog). */
export const PET_EXP_ITEMS: Record<string, number> = {
  pet_mat_linh_thao: 50,
  pet_mat_huyet_linh_qua: 200,
  pet_mat_thu_linh_dan: 1000,
};

export function petExpForItem(itemKey: string, qty: number): number {
  const per = PET_EXP_ITEMS[itemKey];
  if (per === undefined) return 0;
  return per * Math.max(0, Math.floor(qty));
}

/** Exp cần để lên level (curve đơn giản, deterministic). */
export function petExpRequiredForLevel(level: number): number {
  if (level < 1) return 0;
  return 100 + (level - 1) * 50 + Math.floor((level - 1) * (level - 1) * 5);
}

/** Tổng exp tích lũy để đạt level. */
export function petCumulativeExpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += petExpRequiredForLevel(l);
  return total;
}

// ===========================================================================
// 7. Snapshot computation (server-authoritative; clamped by context)
// ===========================================================================

export interface PetSnapshotInput {
  petKey: string;
  level: number;
  star: number;
  evolutionStage: number;
  skillLevels: Record<string, number>;
  /** Hệ số nhân chung theo context. */
  context: PetCombatContext;
}

export interface PetSnapshotOutput {
  petKey: string;
  level: number;
  star: number;
  evolutionStage: number;
  context: PetCombatContext;
  /** Stats sau clamp + context multiplier. */
  stats: PetBaseStats;
  /** % đóng góp sức mạnh tối đa cho phép trong context. */
  contributionCapPercent: number;
  /** % damage contribution tối đa khi tham gia combat. */
  damageContributionCapPercent: number;
  /** Skill snapshot (key + level + clamped effect). */
  skills: {
    skillKey: string;
    level: number;
    category: PetSkillCategory;
    effectClampedPct?: number;
  }[];
  /** Pet PvP multiplier áp dụng. */
  pvpEffectivenessMultiplier: number;
}

/**
 * Tính snapshot pet theo context. **Server-side authoritative** — client chỉ
 * hiển thị, không cộng thêm. Clamp:
 *   - PvP: damage contribution ≤ `PET_PVP_DAMAGE_CAP_PERCENT`.
 *   - PvE: contribution ≤ `PET_PVE_CAP_PERCENT`.
 *   - BOSS: damage contribution ≤ `PET_BOSS_DAMAGE_CAP_PERCENT`.
 *   - Skill drop bonus ≤ `PET_SKILL_DROP_BONUS_CAP_PERCENT`.
 *   - Skill cultivation bonus ≤ `PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT`.
 */
export function computePetSnapshot(
  catalogEntry: PetCatalogEntry,
  input: PetSnapshotInput,
): PetSnapshotOutput {
  const level = Math.max(1, Math.floor(input.level));
  const star = Math.max(1, Math.min(catalogEntry.starLimit, Math.floor(input.star)));
  const stage = Math.max(0, Math.floor(input.evolutionStage));

  // Base + growth
  const starMul = 1 + (star - 1) * 0.06;
  const stageMul = 1 + stage * 0.1;
  const hp = Math.floor(
    (catalogEntry.baseStats.hp + catalogEntry.growthStats.hpPerLevel * (level - 1)) *
      starMul *
      stageMul,
  );
  const atk = Math.floor(
    (catalogEntry.baseStats.atk + catalogEntry.growthStats.atkPerLevel * (level - 1)) *
      starMul *
      stageMul,
  );
  const def = Math.floor(
    (catalogEntry.baseStats.def + catalogEntry.growthStats.defPerLevel * (level - 1)) *
      starMul *
      stageMul,
  );
  const spd = Math.floor(
    (catalogEntry.baseStats.spd + catalogEntry.growthStats.spdPerLevel * (level - 1)) *
      starMul *
      stageMul,
  );

  const pvpMul =
    catalogEntry.pvpEffectivenessMultiplier ?? PET_PVP_EFFECT_MULTIPLIER;

  const contextMul: Record<PetCombatContext, number> = {
    PVE: 1,
    PVP: pvpMul,
    BOSS: 0.7,
    DUNGEON: 1,
    SECRET_REALM: 1,
  };
  const ctxMul = contextMul[input.context];

  const stats: PetBaseStats = {
    hp: Math.floor(hp * ctxMul),
    atk: Math.floor(atk * ctxMul),
    def: Math.floor(def * ctxMul),
    spd: Math.floor(spd * ctxMul),
  };

  // Damage contribution cap by context
  const dmgCapByCtx: Record<PetCombatContext, number> = {
    PVE: PET_PVE_CAP_PERCENT,
    PVP: PET_PVP_DAMAGE_CAP_PERCENT,
    BOSS: PET_BOSS_DAMAGE_CAP_PERCENT,
    DUNGEON: PET_PVE_CAP_PERCENT,
    SECRET_REALM: PET_PVE_CAP_PERCENT,
  };
  const damageContributionCapPercent = dmgCapByCtx[input.context];

  // Skill snapshot — clamp effect by drop/cultivation cap
  const skills = catalogEntry.skillKeys
    .map((sk) => {
      const def = petSkillByKey(sk);
      if (!def) return null;
      const rawLevel = input.skillLevels[sk] ?? 1;
      const level = Math.max(1, Math.min(def.maxLevel, Math.floor(rawLevel)));
      let effectClampedPct: number | undefined;
      if (def.effects?.dropBonusPct !== undefined) {
        effectClampedPct = Math.min(
          PET_SKILL_DROP_BONUS_CAP_PERCENT,
          def.effects.dropBonusPct * level,
        );
      } else if (def.effects?.cultivationBonusPct !== undefined) {
        effectClampedPct = Math.min(
          PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT,
          def.effects.cultivationBonusPct * level,
        );
      } else if (def.effects?.damageBonusPct !== undefined) {
        effectClampedPct = Math.min(
          damageContributionCapPercent,
          def.effects.damageBonusPct * level * (input.context === 'PVP' ? pvpMul : 1),
        );
      } else if (def.effects?.shieldPct !== undefined) {
        effectClampedPct = def.effects.shieldPct * level * (input.context === 'PVP' ? pvpMul : 1);
      } else if (def.effects?.healPct !== undefined) {
        effectClampedPct = def.effects.healPct * level * (input.context === 'PVP' ? pvpMul : 1);
      } else if (def.effects?.damageReductionPct !== undefined) {
        effectClampedPct =
          def.effects.damageReductionPct * level * (input.context === 'PVP' ? pvpMul : 1);
      }
      return {
        skillKey: sk,
        level,
        category: def.category,
        effectClampedPct,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    petKey: catalogEntry.petKey,
    level,
    star,
    evolutionStage: stage,
    context: input.context,
    stats,
    contributionCapPercent:
      input.context === 'PVP'
        ? PET_PVP_DAMAGE_CAP_PERCENT
        : input.context === 'BOSS'
          ? PET_BOSS_DAMAGE_CAP_PERCENT
          : PET_PVE_CAP_PERCENT,
    damageContributionCapPercent,
    skills,
    pvpEffectivenessMultiplier: pvpMul,
  };
}

// ===========================================================================
// 8. Pet catalog — ≥30 pets across all elements & qualities
// ===========================================================================

const STD_GROWTH: PetGrowthStats = {
  hpPerLevel: 80,
  atkPerLevel: 6,
  defPerLevel: 4,
  spdPerLevel: 1,
};

const STD_MAX_LEVEL = PET_MAX_LEVEL_DEFAULT;

const EVOLUTION_S1_LIGHT: PetEvolutionStageDef = {
  stage: 1,
  nameVi: 'Tiến Hoá Sơ Cấp',
  nameEn: 'Stage 1 Evolution',
  visualKey: 'evo_s1',
  requirements: {
    minLevel: 40,
    minStar: 4,
    materials: [
      { itemKey: 'pet_mat_huyet_mach_tinh_hoa', qty: 3 },
      { itemKey: 'pet_mat_ngu_hanh_tinh_tuy', qty: 2 },
    ],
    linhThachCost: 5000,
  },
};

const EVOLUTION_S2_HEAVY: PetEvolutionStageDef = {
  stage: 2,
  nameVi: 'Tiến Hoá Cao Cấp',
  nameEn: 'Stage 2 Evolution',
  visualKey: 'evo_s2',
  requirements: {
    minLevel: 80,
    minStar: 5,
    materials: [
      { itemKey: 'pet_mat_ban_menh_linh_chau', qty: 2 },
      { itemKey: 'pet_mat_ngu_hanh_tinh_tuy', qty: 5 },
    ],
    linhThachCost: 30000,
  },
};

function pet(entry: Omit<PetCatalogEntry, 'maxLevelByQuality' | 'growthStats' | 'starLimit' | 'evolutionStages'> & Partial<Pick<PetCatalogEntry, 'maxLevelByQuality' | 'growthStats' | 'starLimit' | 'evolutionStages'>>): PetCatalogEntry {
  return {
    growthStats: STD_GROWTH,
    maxLevelByQuality: STD_MAX_LEVEL,
    starLimit: PET_STAR_LIMIT_DEFAULT,
    evolutionStages: [EVOLUTION_S1_LIGHT, EVOLUTION_S2_HEAVY],
    ...entry,
  } as PetCatalogEntry;
}

export const PETS: readonly PetCatalogEntry[] = [
  // ─── Utility pet (5–8) — không gây damage chính ───────────────────────────
  pet({
    petKey: 'pet_lapin_qi',
    nameVi: 'Linh Thố Dưỡng Khí',
    nameEn: 'Qi Lapin',
    descriptionVi: 'Thỏ linh giúp tu luyện nhanh hơn nhẹ.',
    descriptionEn: 'Lapin spirit that nudges cultivation speed.',
    type: 'PET',
    species: 'Linh Thố',
    element: 'MOC',
    rarity: 'COMMON',
    quality: 'PHAM',
    role: 'UTILITY',
    baseStats: { hp: 240, atk: 8, def: 14, spd: 12 },
    skillKeys: ['pet_skill_qi_nurture', 'pet_skill_scout_step'],
    sourceTags: ['FREE', 'ACHIEVEMENT', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 1,
  }),
  pet({
    petKey: 'pet_squirrel_explorer',
    nameVi: 'Tùng Linh Sóc',
    nameEn: 'Pinewood Squirrel',
    descriptionVi: 'Sóc nhỏ thám hiểm linh nhanh.',
    descriptionEn: 'Tiny squirrel that scouts ahead.',
    type: 'PET',
    species: 'Linh Sóc',
    element: 'MOC',
    rarity: 'COMMON',
    quality: 'PHAM',
    role: 'EXPLORATION',
    baseStats: { hp: 220, atk: 6, def: 10, spd: 16 },
    skillKeys: ['pet_skill_scout_step', 'pet_skill_treasure_sense'],
    sourceTags: ['FREE', 'DUNGEON', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 1,
  }),
  pet({
    petKey: 'pet_cat_lucky',
    nameVi: 'Miêu May Mắn',
    nameEn: 'Lucky Cat',
    descriptionVi: 'Mèo linh tăng nhẹ tỉ lệ rơi đồ.',
    descriptionEn: 'Cat spirit boosting drop rate.',
    type: 'PET',
    species: 'Linh Miêu',
    element: 'KIM',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'UTILITY',
    baseStats: { hp: 280, atk: 10, def: 16, spd: 14 },
    skillKeys: ['pet_skill_lucky_paw', 'pet_skill_explorer_eye'],
    sourceTags: ['FREE', 'DUNGEON', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),
  pet({
    petKey: 'pet_butterfly_breeze',
    nameVi: 'Bích Phong Hồ Điệp',
    nameEn: 'Breeze Butterfly',
    descriptionVi: 'Bướm gió nhỏ nhẹ, bonus tu luyện.',
    descriptionEn: 'Wind butterfly with gentle cultivation buff.',
    type: 'PET',
    species: 'Linh Điệp',
    element: 'PHONG',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'UTILITY',
    baseStats: { hp: 230, atk: 6, def: 8, spd: 18 },
    skillKeys: ['pet_skill_qi_nurture', 'pet_skill_explorer_eye'],
    sourceTags: ['FREE', 'EVENT', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),
  pet({
    petKey: 'pet_owl_secret',
    nameVi: 'Linh Hiêu Trí Tuệ',
    nameEn: 'Wise Owl',
    descriptionVi: 'Cú linh báo hiệu kỳ ngộ.',
    descriptionEn: 'Owl that senses opportunities.',
    type: 'PET',
    species: 'Linh Cú',
    element: 'AM',
    rarity: 'RARE',
    quality: 'LINH',
    role: 'EXPLORATION',
    baseStats: { hp: 260, atk: 9, def: 12, spd: 15 },
    skillKeys: ['pet_skill_treasure_sense', 'pet_skill_explorer_eye'],
    sourceTags: ['DUNGEON', 'SECRET_REALM', 'BOX'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 2,
  }),
  pet({
    petKey: 'pet_fox_courier',
    nameVi: 'Linh Hồ Đưa Tin',
    nameEn: 'Courier Fox',
    descriptionVi: 'Hồ ly nhỏ tăng tốc khám phá.',
    descriptionEn: 'Small fox speeding exploration.',
    type: 'PET',
    species: 'Linh Hồ',
    element: 'HOA',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'EXPLORATION',
    baseStats: { hp: 250, atk: 8, def: 10, spd: 17 },
    skillKeys: ['pet_skill_scout_step', 'pet_skill_lucky_paw'],
    sourceTags: ['FREE', 'EVENT', 'ACHIEVEMENT'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // ─── Linh Thú combat support (10–15) — đầy đủ Ngũ Hành ───────────────────
  // KIM
  pet({
    petKey: 'pet_kim_lang',
    nameVi: 'Kim Lang Thiết Trảo',
    nameEn: 'Steel Wolf',
    descriptionVi: 'Sói thép hệ Kim, bonus damage nhẹ.',
    descriptionEn: 'Steel wolf with light damage buff.',
    type: 'LINH_THU',
    species: 'Linh Lang',
    element: 'KIM',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 320, atk: 18, def: 16, spd: 12 },
    skillKeys: ['pet_skill_battle_roar', 'pet_skill_iron_shell'],
    sourceTags: ['BOX', 'DUNGEON', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_kim_dieu',
    nameVi: 'Kim Diêu Linh Vũ',
    nameEn: 'Golden Hawk',
    descriptionVi: 'Diều vàng tốc độ cao.',
    descriptionEn: 'Golden hawk with high speed.',
    type: 'LINH_THU',
    species: 'Linh Điểu',
    element: 'KIM',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 280, atk: 22, def: 12, spd: 18 },
    skillKeys: ['pet_skill_battle_roar', 'pet_skill_lucky_paw'],
    sourceTags: ['BOX', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_kim_qilin',
    nameVi: 'Kim Lân',
    nameEn: 'Golden Qilin',
    descriptionVi: 'Lân vàng, hộ thể mạnh.',
    descriptionEn: 'Golden qilin, strong guardian.',
    type: 'LINH_THU',
    species: 'Kỳ Lân',
    element: 'KIM',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'TANK',
    baseStats: { hp: 460, atk: 18, def: 28, spd: 8 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'SECRET_REALM', 'EVENT'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),

  // MOC
  pet({
    petKey: 'pet_moc_long',
    nameVi: 'Mộc Long Tiểu Long',
    nameEn: 'Wood Dragonling',
    descriptionVi: 'Long con hệ Mộc.',
    descriptionEn: 'Young wood dragon.',
    type: 'LINH_THU',
    species: 'Linh Long',
    element: 'MOC',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 420, atk: 14, def: 22, spd: 10 },
    skillKeys: ['pet_skill_gentle_breeze', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'SECRET_REALM'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),
  pet({
    petKey: 'pet_moc_bear',
    nameVi: 'Mộc Hùng',
    nameEn: 'Forest Bear',
    descriptionVi: 'Gấu rừng, tank chắc.',
    descriptionEn: 'Forest bear, solid tank.',
    type: 'LINH_THU',
    species: 'Linh Hùng',
    element: 'MOC',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'TANK',
    baseStats: { hp: 480, atk: 16, def: 24, spd: 6 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_battle_roar'],
    sourceTags: ['DUNGEON', 'BOX', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_moc_seedling',
    nameVi: 'Linh Mộc Tiểu Tinh',
    nameEn: 'Wood Sprite',
    descriptionVi: 'Tiểu tinh hệ Mộc, hồi máu nhẹ.',
    descriptionEn: 'Wood sprite with light heal.',
    type: 'LINH_THU',
    species: 'Linh Tinh',
    element: 'MOC',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 300, atk: 10, def: 16, spd: 12 },
    skillKeys: ['pet_skill_gentle_breeze', 'pet_skill_qi_nurture'],
    sourceTags: ['FREE', 'BOX', 'ACHIEVEMENT'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // THUY
  pet({
    petKey: 'pet_thuy_rui',
    nameVi: 'Thuỷ Chu Tước',
    nameEn: 'Waterborn Sparrow',
    descriptionVi: 'Linh điểu hệ Thuỷ.',
    descriptionEn: 'Aquatic spirit bird.',
    type: 'LINH_THU',
    species: 'Linh Điểu',
    element: 'THUY',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 320, atk: 12, def: 18, spd: 16 },
    skillKeys: ['pet_skill_gentle_breeze', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'DUNGEON', 'EVENT'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_thuy_dragon',
    nameVi: 'Thuỷ Long Tử',
    nameEn: 'Water Dragonling',
    descriptionVi: 'Long thuỷ con, hộ thể.',
    descriptionEn: 'Water dragonling guardian.',
    type: 'LINH_THU',
    species: 'Linh Long',
    element: 'THUY',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'TANK',
    baseStats: { hp: 440, atk: 18, def: 26, spd: 10 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'SECRET_REALM', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),
  pet({
    petKey: 'pet_thuy_jellyfish',
    nameVi: 'Linh Hải Sứa',
    nameEn: 'Spirit Jellyfish',
    descriptionVi: 'Sứa biển linh, heal nhẹ.',
    descriptionEn: 'Spirit jellyfish with light heal.',
    type: 'LINH_THU',
    species: 'Linh Sứa',
    element: 'THUY',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 280, atk: 8, def: 16, spd: 12 },
    skillKeys: ['pet_skill_gentle_breeze', 'pet_skill_qi_nurture'],
    sourceTags: ['FREE', 'BOX', 'DUNGEON'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // HOA
  pet({
    petKey: 'pet_hoa_phoenix',
    nameVi: 'Hoả Phượng Sơ Sinh',
    nameEn: 'Newborn Phoenix',
    descriptionVi: 'Phượng hoàng con cực hiếm.',
    descriptionEn: 'Extremely rare phoenix chick.',
    type: 'LINH_THU',
    species: 'Phượng Hoàng',
    element: 'HOA',
    rarity: 'LEGENDARY',
    quality: 'THIEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 380, atk: 30, def: 18, spd: 18 },
    skillKeys: ['pet_skill_flame_inspire', 'pet_skill_phoenix_resurgence'],
    sourceTags: ['BOX', 'EVENT', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 5,
  }),
  pet({
    petKey: 'pet_hoa_kirin',
    nameVi: 'Hoả Kỳ Lân',
    nameEn: 'Flame Kirin',
    descriptionVi: 'Kỳ lân hệ Hoả mạnh nhưng cân bằng.',
    descriptionEn: 'Balanced fire kirin.',
    type: 'LINH_THU',
    species: 'Kỳ Lân',
    element: 'HOA',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 380, atk: 24, def: 18, spd: 14 },
    skillKeys: ['pet_skill_flame_inspire', 'pet_skill_battle_roar'],
    sourceTags: ['BOX', 'EVENT', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),
  pet({
    petKey: 'pet_hoa_salamander',
    nameVi: 'Hoả Linh Long Tích',
    nameEn: 'Fire Salamander',
    descriptionVi: 'Tích hoả nhỏ, dmg buff nhẹ.',
    descriptionEn: 'Small fire salamander.',
    type: 'LINH_THU',
    species: 'Linh Tích',
    element: 'HOA',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 240, atk: 16, def: 8, spd: 14 },
    skillKeys: ['pet_skill_flame_inspire', 'pet_skill_lucky_paw'],
    sourceTags: ['FREE', 'BOX', 'DUNGEON'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // THO
  pet({
    petKey: 'pet_tho_tortoise',
    nameVi: 'Thổ Linh Quy',
    nameEn: 'Earth Tortoise',
    descriptionVi: 'Quy linh hệ Thổ, tank cứng.',
    descriptionEn: 'Tortoise spirit, hard tank.',
    type: 'LINH_THU',
    species: 'Linh Quy',
    element: 'THO',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'TANK',
    baseStats: { hp: 520, atk: 12, def: 32, spd: 5 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'SECRET_REALM', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),
  pet({
    petKey: 'pet_tho_boar',
    nameVi: 'Thổ Linh Trư',
    nameEn: 'Earth Boar',
    descriptionVi: 'Heo rừng hệ Thổ.',
    descriptionEn: 'Earth-aligned boar.',
    type: 'LINH_THU',
    species: 'Linh Trư',
    element: 'THO',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'TANK',
    baseStats: { hp: 440, atk: 14, def: 24, spd: 8 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_battle_roar'],
    sourceTags: ['DUNGEON', 'BOX'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_tho_mole',
    nameVi: 'Thổ Linh Du',
    nameEn: 'Earth Mole',
    descriptionVi: 'Chuột chũi hệ Thổ, drop bonus.',
    descriptionEn: 'Earth mole boosting drops.',
    type: 'LINH_THU',
    species: 'Linh Du',
    element: 'THO',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'UTILITY',
    baseStats: { hp: 250, atk: 10, def: 14, spd: 12 },
    skillKeys: ['pet_skill_lucky_paw', 'pet_skill_scout_step'],
    sourceTags: ['FREE', 'DUNGEON', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // PHONG
  pet({
    petKey: 'pet_phong_falcon',
    nameVi: 'Phong Linh Ưng',
    nameEn: 'Wind Falcon',
    descriptionVi: 'Ưng gió, tốc độ rất cao.',
    descriptionEn: 'Wind falcon with very high speed.',
    type: 'LINH_THU',
    species: 'Linh Điểu',
    element: 'PHONG',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 260, atk: 22, def: 10, spd: 22 },
    skillKeys: ['pet_skill_battle_roar', 'pet_skill_lucky_paw'],
    sourceTags: ['BOX', 'BOSS', 'DUNGEON'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),

  // LOI
  pet({
    petKey: 'pet_loi_dragon',
    nameVi: 'Lôi Long Tử',
    nameEn: 'Thunder Dragonling',
    descriptionVi: 'Long sét con, dmg sét.',
    descriptionEn: 'Thunder dragonling.',
    type: 'LINH_THU',
    species: 'Linh Long',
    element: 'LOI',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 360, atk: 28, def: 14, spd: 18 },
    skillKeys: ['pet_skill_thunder_inspire', 'pet_skill_battle_roar'],
    sourceTags: ['BOX', 'BOSS', 'SECRET_REALM'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),
  pet({
    petKey: 'pet_loi_panther',
    nameVi: 'Lôi Linh Báo',
    nameEn: 'Thunder Panther',
    descriptionVi: 'Báo sét, tốc độ cao.',
    descriptionEn: 'Thunder panther, high speed.',
    type: 'LINH_THU',
    species: 'Linh Báo',
    element: 'LOI',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 300, atk: 22, def: 12, spd: 20 },
    skillKeys: ['pet_skill_thunder_inspire', 'pet_skill_lucky_paw'],
    sourceTags: ['BOX', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),

  // BANG
  pet({
    petKey: 'pet_bang_wolf',
    nameVi: 'Băng Lang',
    nameEn: 'Ice Wolf',
    descriptionVi: 'Sói băng, dmg băng nhẹ.',
    descriptionEn: 'Ice wolf with light ice damage.',
    type: 'LINH_THU',
    species: 'Linh Lang',
    element: 'BANG',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 300, atk: 20, def: 14, spd: 14 },
    skillKeys: ['pet_skill_ice_inspire', 'pet_skill_battle_roar'],
    sourceTags: ['BOX', 'DUNGEON', 'EVENT'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_bang_seal',
    nameVi: 'Băng Hải Cẩu',
    nameEn: 'Ice Seal',
    descriptionVi: 'Hải cẩu băng, hộ thân.',
    descriptionEn: 'Ice seal guardian.',
    type: 'LINH_THU',
    species: 'Linh Hải',
    element: 'BANG',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'TANK',
    baseStats: { hp: 360, atk: 10, def: 22, spd: 8 },
    skillKeys: ['pet_skill_iron_shell', 'pet_skill_ice_inspire'],
    sourceTags: ['FREE', 'BOX', 'DUNGEON'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // QUANG
  pet({
    petKey: 'pet_quang_kirin',
    nameVi: 'Quang Lân',
    nameEn: 'Light Kirin',
    descriptionVi: 'Lân ánh sáng, ban phúc.',
    descriptionEn: 'Light kirin granting blessings.',
    type: 'LINH_THU',
    species: 'Kỳ Lân',
    element: 'QUANG',
    rarity: 'LEGENDARY',
    quality: 'THIEN',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 380, atk: 20, def: 24, spd: 14 },
    skillKeys: ['pet_skill_kirin_blessing', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'EVENT', 'BOSS'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 5,
  }),
  pet({
    petKey: 'pet_quang_crane',
    nameVi: 'Quang Hạc',
    nameEn: 'Light Crane',
    descriptionVi: 'Hạc sáng, support thuần.',
    descriptionEn: 'Light crane, pure support.',
    type: 'LINH_THU',
    species: 'Linh Hạc',
    element: 'QUANG',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 340, atk: 14, def: 20, spd: 16 },
    skillKeys: ['pet_skill_gentle_breeze', 'pet_skill_aegis_aura'],
    sourceTags: ['BOX', 'SECRET_REALM'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 4,
  }),

  // AM
  pet({
    petKey: 'pet_am_serpent',
    nameVi: 'Ám Linh Xà',
    nameEn: 'Shadow Serpent',
    descriptionVi: 'Xà bóng tối, dmg phụ.',
    descriptionEn: 'Shadow serpent with side damage.',
    type: 'LINH_THU',
    species: 'Linh Xà',
    element: 'AM',
    rarity: 'RARE',
    quality: 'HUYEN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 290, atk: 22, def: 12, spd: 16 },
    skillKeys: ['pet_skill_battle_roar', 'pet_skill_explorer_eye'],
    sourceTags: ['BOX', 'BOSS', 'DUNGEON'],
    isEventLimited: false,
    isTradeable: true,
    powerBudgetTier: 3,
  }),
  pet({
    petKey: 'pet_am_bat',
    nameVi: 'Ám Linh Biển',
    nameEn: 'Shadow Bat',
    descriptionVi: 'Dơi linh trinh sát đêm.',
    descriptionEn: 'Shadow bat night scout.',
    type: 'LINH_THU',
    species: 'Linh Biển',
    element: 'AM',
    rarity: 'UNCOMMON',
    quality: 'LINH',
    role: 'EXPLORATION',
    baseStats: { hp: 240, atk: 12, def: 10, spd: 16 },
    skillKeys: ['pet_skill_scout_step', 'pet_skill_treasure_sense'],
    sourceTags: ['FREE', 'DUNGEON', 'BOX'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 2,
  }),

  // High-end (powerBudgetTier 5) — Mythic / Thần phẩm; chỉ box hiếm + event
  pet({
    petKey: 'pet_legend_kirin_supreme',
    nameVi: 'Thiên Lân Vương',
    nameEn: 'Supreme Kirin',
    descriptionVi: 'Kỳ lân Thần phẩm, hộ thân kép.',
    descriptionEn: 'Mythic kirin with double guardian.',
    type: 'LINH_THU',
    species: 'Kỳ Lân',
    element: 'QUANG',
    rarity: 'MYTHIC',
    quality: 'THAN',
    role: 'HEAL_SUPPORT',
    baseStats: { hp: 480, atk: 24, def: 28, spd: 16 },
    skillKeys: ['pet_skill_kirin_blessing', 'pet_skill_aegis_aura', 'pet_skill_iron_shell'],
    sourceTags: ['BOX', 'EVENT'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 5,
    pvpEffectivenessMultiplier: 0.35, // mạnh, nên hạ multiplier
  }),
  pet({
    petKey: 'pet_legend_phoenix_supreme',
    nameVi: 'Thiên Phượng Vương',
    nameEn: 'Supreme Phoenix',
    descriptionVi: 'Phượng hoàng Thần phẩm.',
    descriptionEn: 'Mythic phoenix.',
    type: 'LINH_THU',
    species: 'Phượng Hoàng',
    element: 'HOA',
    rarity: 'MYTHIC',
    quality: 'THAN',
    role: 'DPS_SUPPORT',
    baseStats: { hp: 420, atk: 36, def: 18, spd: 22 },
    skillKeys: ['pet_skill_flame_inspire', 'pet_skill_phoenix_resurgence', 'pet_skill_battle_roar'],
    sourceTags: ['BOX', 'EVENT'],
    isEventLimited: false,
    isTradeable: false,
    powerBudgetTier: 5,
    pvpEffectivenessMultiplier: 0.35,
  }),

  // Event-limited cosmetic pet (không vượt trội về stats)
  pet({
    petKey: 'pet_event_lantern',
    nameVi: 'Linh Đèn Lễ Hội',
    nameEn: 'Festival Lantern Spirit',
    descriptionVi: 'Pet sự kiện ánh đèn — cosmetic + bonus tu luyện nhẹ.',
    descriptionEn: 'Festival lantern pet — cosmetic + light cultivation buff.',
    type: 'PET',
    species: 'Linh Đèn',
    element: 'HOA',
    rarity: 'EPIC',
    quality: 'DIA',
    role: 'UTILITY',
    baseStats: { hp: 280, atk: 8, def: 12, spd: 12 },
    skillKeys: ['pet_skill_qi_nurture', 'pet_skill_lucky_paw'],
    sourceTags: ['EVENT'],
    isEventLimited: true,
    isTradeable: false,
    powerBudgetTier: 2,
  }),
] as const;

const PETS_BY_KEY: Record<string, PetCatalogEntry> = Object.fromEntries(
  PETS.map((p) => [p.petKey, p]),
);

export function petByKey(petKey: string): PetCatalogEntry | undefined {
  return PETS_BY_KEY[petKey];
}

// ===========================================================================
// 9. Catalog integrity helpers (used by tests)
// ===========================================================================

export interface PetCatalogIssue {
  petKey: string;
  code:
    | 'INVALID_TYPE'
    | 'INVALID_ELEMENT'
    | 'INVALID_RARITY'
    | 'INVALID_QUALITY'
    | 'INVALID_ROLE'
    | 'INVALID_SOURCE_TAG'
    | 'MISSING_SKILL'
    | 'MISSING_SOURCE'
    | 'NO_FREE_PATH'
    | 'INVALID_POWER_BUDGET'
    | 'INVALID_PVP_MULTIPLIER'
    | 'INVALID_STAR_LIMIT'
    | 'INVALID_EVOLUTION_REQUIREMENT';
  message: string;
}

/**
 * Audit catalog — chạy ở test thời gian build. Phát hiện:
 *   - Skill ref không tồn tại.
 *   - Pet thiếu source.
 *   - Pet non-premium nhưng chỉ có source BOX (vi phạm "free path").
 *   - Pet powerBudgetTier > 5 hoặc <1.
 *   - Pet pvp multiplier ngoài (0,1].
 */
export function auditPetCatalog(
  entries: readonly PetCatalogEntry[] = PETS,
): PetCatalogIssue[] {
  const issues: PetCatalogIssue[] = [];
  for (const p of entries) {
    if (!isPetType(p.type)) issues.push({ petKey: p.petKey, code: 'INVALID_TYPE', message: `bad type ${p.type}` });
    if (!isPetElement(p.element)) issues.push({ petKey: p.petKey, code: 'INVALID_ELEMENT', message: `bad element ${p.element}` });
    if (!isPetRarity(p.rarity)) issues.push({ petKey: p.petKey, code: 'INVALID_RARITY', message: `bad rarity ${p.rarity}` });
    if (!isPetQuality(p.quality)) issues.push({ petKey: p.petKey, code: 'INVALID_QUALITY', message: `bad quality ${p.quality}` });
    if (!isPetRole(p.role)) issues.push({ petKey: p.petKey, code: 'INVALID_ROLE', message: `bad role ${p.role}` });
    for (const st of p.sourceTags) {
      if (!isPetSourceTag(st)) issues.push({ petKey: p.petKey, code: 'INVALID_SOURCE_TAG', message: `bad sourceTag ${st}` });
    }
    if (p.sourceTags.length === 0) issues.push({ petKey: p.petKey, code: 'MISSING_SOURCE', message: 'no sourceTags' });
    if (p.powerBudgetTier < 1 || p.powerBudgetTier > 5) {
      issues.push({ petKey: p.petKey, code: 'INVALID_POWER_BUDGET', message: `tier=${p.powerBudgetTier}` });
    }
    if (p.pvpEffectivenessMultiplier !== undefined) {
      if (p.pvpEffectivenessMultiplier <= 0 || p.pvpEffectivenessMultiplier > 1) {
        issues.push({ petKey: p.petKey, code: 'INVALID_PVP_MULTIPLIER', message: `mul=${p.pvpEffectivenessMultiplier}` });
      }
    }
    for (const sk of p.skillKeys) {
      if (!petSkillByKey(sk)) issues.push({ petKey: p.petKey, code: 'MISSING_SKILL', message: `skill ${sk}` });
    }
    // Free-path rule: pet không event-limited & không premium-only phải có ≥1 nguồn free/event/dungeon/...
    const freeTags: PetSourceTag[] = ['FREE', 'EVENT', 'DUNGEON', 'SECRET_REALM', 'BOSS', 'ACHIEVEMENT', 'TRIAL_TOWER'];
    if (!p.isPremiumVisualOnly && !p.isEventLimited) {
      const hasFree = p.sourceTags.some((t) => freeTags.includes(t));
      if (!hasFree) issues.push({ petKey: p.petKey, code: 'NO_FREE_PATH', message: 'box-only without free path' });
    }
    if (p.starLimit < 1 || p.starLimit > 10) {
      issues.push({ petKey: p.petKey, code: 'INVALID_STAR_LIMIT', message: `star=${p.starLimit}` });
    }
    for (const ev of p.evolutionStages) {
      if (ev.requirements.minLevel < 1 || ev.requirements.minLevel > 200) {
        issues.push({ petKey: p.petKey, code: 'INVALID_EVOLUTION_REQUIREMENT', message: `stage ${ev.stage} bad level` });
      }
    }
  }
  return issues;
}

// ===========================================================================
// 10. Skill upgrade cost
// ===========================================================================

/** Material để nâng skill: `pet_mat_ngu_hanh_tinh_tuy` × (level^2 × 3). */
export function petSkillUpgradeCost(currentLevel: number): {
  materials: { itemKey: string; qty: number }[];
  linhThachCost: number;
} {
  const next = currentLevel + 1;
  return {
    materials: [{ itemKey: 'pet_mat_ngu_hanh_tinh_tuy', qty: 3 * next * next }],
    linhThachCost: 500 * next,
  };
}
