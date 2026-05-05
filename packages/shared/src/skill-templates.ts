/**
 * Phase 11.2 PR — SkillTemplate static catalog (catalog-only foundation).
 *
 * Mục đích: build progression layer phía trên `SkillDef` (combat.ts) —
 * mỗi `SkillTemplate` map tới 1 `SkillDef.key` và mô tả:
 *   - Tier (basic / intermediate / advanced / master / legendary).
 *   - Unlock requirements (realm / sect / method / item / quest).
 *   - Mastery curve (atkScaleBonus%, mpCostReduction%, cooldownReduction)
 *     theo level 1..maxMastery.
 *   - Cost (linhThach + skill shards) để upgrade từng level.
 *   - Optional evolution branches ở max mastery (variant skill cùng key
 *     family, future Phase 11.2.B runtime sẽ resolve thành SkillDef alt).
 *
 * Server-authoritative reminder: catalog này là **metadata only**. Combat
 * runtime (`apps/api/src/modules/combat/combat.service.ts`) HIỆN KHÔNG
 * đọc template — vẫn dùng `SkillDef.atkScale / mpCost / cooldownTurns`
 * baseline. Phase 11.2.B (`CharacterSkill` Prisma model) sẽ wire
 * `applyMasteryEffect(template, masteryLevel, baseSkill)` vào
 * combat damage formula.
 *
 * KHÔNG schema migration, KHÔNG runtime hook ở PR này.
 */

import { SectKey, ElementKey, SkillDef, SKILLS, skillByKey } from './combat';

// =====================================================================
// Tier
// =====================================================================

/**
 * 5-tier progression — chia theo (unlockRealm, atkScale, role) của
 * `SkillDef` baseline. Tier xác định:
 *   - maxMastery (số level mastery tối đa).
 *   - per-level atkScale bonus, mpCost reduction.
 *   - LinhThach + shard cost ramp.
 *   - Có evolution branches ở L_max hay không.
 */
export type SkillTier = 'basic' | 'intermediate' | 'advanced' | 'master' | 'legendary';

export const SKILL_TIERS: readonly SkillTier[] = [
  'basic',
  'intermediate',
  'advanced',
  'master',
  'legendary',
];

export interface SkillTierDef {
  key: SkillTier;
  /** Số level mastery tối đa (1..maxMastery). */
  maxMastery: number;
  /** Mỗi level cộng % atkScale (additive, decimal — 0.05 = +5%). */
  atkScaleBonusPerLevel: number;
  /** Mỗi level giảm % mpCost (additive, decimal — 0.05 = -5%). */
  mpCostReductionPerLevel: number;
  /**
   * Mỗi N level (`cooldownReductionEveryNLevels`) giảm 1 turn cooldown.
   * Default 0 = không bao giờ giảm cooldown.
   */
  cooldownReductionEveryNLevels: number;
  /** Base LinhThach để upgrade L1 — sau đó nhân `linhThachCostMultiplier`. */
  baseLinhThachCost: number;
  linhThachCostMultiplier: number;
  /** Base skill shard count để upgrade L1 — sau đó nhân `shardCostMultiplier`. */
  baseShardCost: number;
  shardCostMultiplier: number;
  /** Có evolution branches ở max mastery? */
  hasEvolution: boolean;
}

export const SKILL_TIER_DEFS: Readonly<Record<SkillTier, SkillTierDef>> = {
  basic: {
    key: 'basic',
    maxMastery: 5,
    atkScaleBonusPerLevel: 0.05,
    mpCostReductionPerLevel: 0.05,
    cooldownReductionEveryNLevels: 0,
    baseLinhThachCost: 100,
    linhThachCostMultiplier: 2.0,
    baseShardCost: 0,
    shardCostMultiplier: 1.5,
    hasEvolution: false,
  },
  intermediate: {
    key: 'intermediate',
    maxMastery: 7,
    atkScaleBonusPerLevel: 0.05,
    mpCostReductionPerLevel: 0.04,
    cooldownReductionEveryNLevels: 4,
    baseLinhThachCost: 200,
    linhThachCostMultiplier: 2.0,
    baseShardCost: 1,
    shardCostMultiplier: 1.5,
    hasEvolution: false,
  },
  advanced: {
    key: 'advanced',
    maxMastery: 8,
    atkScaleBonusPerLevel: 0.06,
    mpCostReductionPerLevel: 0.04,
    cooldownReductionEveryNLevels: 4,
    baseLinhThachCost: 500,
    linhThachCostMultiplier: 2.0,
    baseShardCost: 2,
    shardCostMultiplier: 1.6,
    hasEvolution: false,
  },
  master: {
    key: 'master',
    maxMastery: 10,
    atkScaleBonusPerLevel: 0.06,
    mpCostReductionPerLevel: 0.04,
    cooldownReductionEveryNLevels: 4,
    baseLinhThachCost: 1000,
    linhThachCostMultiplier: 2.0,
    baseShardCost: 4,
    shardCostMultiplier: 1.6,
    hasEvolution: false,
  },
  legendary: {
    key: 'legendary',
    maxMastery: 10,
    atkScaleBonusPerLevel: 0.07,
    mpCostReductionPerLevel: 0.05,
    cooldownReductionEveryNLevels: 3,
    baseLinhThachCost: 2000,
    linhThachCostMultiplier: 2.1,
    baseShardCost: 8,
    shardCostMultiplier: 1.7,
    hasEvolution: true,
  },
};

export function getSkillTierDef(tier: SkillTier): SkillTierDef {
  const def = SKILL_TIER_DEFS[tier];
  if (!def) {
    throw new Error(`getSkillTierDef: unknown tier "${tier}"`);
  }
  return def;
}

// =====================================================================
// Mastery level
// =====================================================================

export interface SkillMasteryLevel {
  /** Level 1..maxMastery. */
  level: number;
  /** Cộng dồn % atkScale tới level này (ví dụ L3 basic = 0.15 = +15%). */
  atkScaleBonus: number;
  /** Cộng dồn % mpCost reduction tới level này (decimal). */
  mpCostReduction: number;
  /** Cộng dồn cooldown reduction (turns, integer >= 0). */
  cooldownReduction: number;
  /** LinhThach cost để upgrade từ level-1 lên level này. L1 = base. */
  linhThachCost: number;
  /** Skill shard cost để upgrade lên level này. */
  shardCost: number;
}

/**
 * Generate mastery curve cho 1 tier theo công thức deterministic.
 * Giảm trùng lặp khi định nghĩa `SkillTemplate.masteryLevels` —
 * preset levels có thể override điểm bất kỳ qua `customMasteryLevels`.
 */
export function generateMasteryCurve(tier: SkillTier): SkillMasteryLevel[] {
  const def = getSkillTierDef(tier);
  const levels: SkillMasteryLevel[] = [];
  for (let lv = 1; lv <= def.maxMastery; lv++) {
    const atkBonus = round2(def.atkScaleBonusPerLevel * lv);
    const mpReduction = round2(def.mpCostReductionPerLevel * lv);
    const cooldownReduction =
      def.cooldownReductionEveryNLevels > 0
        ? Math.floor(lv / def.cooldownReductionEveryNLevels)
        : 0;
    const linhThachCost = Math.round(
      def.baseLinhThachCost * Math.pow(def.linhThachCostMultiplier, lv - 1)
    );
    const shardCost =
      def.baseShardCost === 0
        ? 0
        : Math.round(def.baseShardCost * Math.pow(def.shardCostMultiplier, lv - 1));
    levels.push({
      level: lv,
      atkScaleBonus: atkBonus,
      mpCostReduction: mpReduction,
      cooldownReduction,
      linhThachCost,
      shardCost,
    });
  }
  return levels;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// =====================================================================
// Unlock + Evolution
// =====================================================================

export type SkillUnlockKind = 'realm' | 'sect' | 'method' | 'item' | 'quest' | 'event';

export interface SkillUnlockRequirement {
  kind: SkillUnlockKind;
  /**
   * Tham chiếu tới catalog tương ứng:
   *   - realm  : `RealmDef.key`
   *   - sect   : `SectKey`
   *   - method : `CultivationMethodDef.key`
   *   - item   : `ItemDef.key`
   *   - quest  : mission key (string, runtime resolve)
   *   - event  : event key (string, runtime resolve)
   */
  ref: string;
  description?: string;
}

export interface SkillEvolutionBranch {
  /** Stable key — `<skillKey>.<branchSuffix>`. Unique trong catalog. */
  branchKey: string;
  /**
   * Skill key alternative — Phase 11.2.B runtime sẽ resolve thành
   * `SkillDef` mới (catalog metadata-level reference, KHÔNG enforce
   * tồn tại ở PR catalog hiện tại).
   */
  targetSkillKey: string;
  /** Mastery level cần đạt để unlock evolution (default = maxMastery). */
  unlockMastery: number;
  /** Mô tả branch — UI hiển thị cho người chơi. */
  description: string;
}

// =====================================================================
// SkillTemplate
// =====================================================================

export interface SkillTemplate {
  /** Match `SkillDef.key` ở `combat.ts`. */
  key: string;
  /** Tier xác định curve baseline. */
  tier: SkillTier;
  /**
   * Unlock requirements (AND condition — tất cả phải thoả). Empty array
   * = không yêu cầu (skill mở sẵn từ realm 1).
   */
  unlocks: SkillUnlockRequirement[];
  /** Mastery curve full — generate hoặc custom. Length = `tier.maxMastery`. */
  masteryLevels: SkillMasteryLevel[];
  /** Evolution branches — chỉ legendary tier mặc định có. Optional cho lower tier. */
  evolutions?: SkillEvolutionBranch[];
  /** Notes design — không runtime-effect. */
  notes?: string;
}

// =====================================================================
// Catalog — 26 template baseline (1-1 với SKILLS)
// =====================================================================

interface TemplateEntryShorthand {
  key: string;
  tier: SkillTier;
  unlocks?: SkillUnlockRequirement[];
  evolutions?: SkillEvolutionBranch[];
  notes?: string;
}

/**
 * Shorthand definitions — `masteryLevels` được gen từ `tier`. Khi cần
 * custom curve cho 1 skill cụ thể, override sau ở `SKILL_TEMPLATES`.
 */
const TEMPLATE_SHORTHAND: readonly TemplateEntryShorthand[] = [
  // ----- Basic tier (12) -----
  {
    key: 'basic_attack',
    tier: 'basic',
    unlocks: [],
    notes: 'Đòn thường, mọi nhân vật đều có ngay từ thuyenkhi.',
  },
  {
    key: 'kiem_khi_chem',
    tier: 'basic',
    unlocks: [{ kind: 'sect', ref: 'thanh_van' }],
    notes: 'Sect skill nền của Thanh Vân — atkScale 1.7 baseline.',
  },
  {
    key: 'thuy_tieu_phu',
    tier: 'basic',
    unlocks: [{ kind: 'sect', ref: 'huyen_thuy' }],
    notes: 'Sect heal nền Huyền Thuỷ — selfHealRatio 0.25 baseline.',
  },
  {
    key: 'ngung_thien_chuong',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'kim_quang_tram',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'moc_linh_truong_dieu',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'thanh_moc_hoi_xuan',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
    notes: 'Passive — atkScaleBonus thực chất 0 (atkScale base = 0); mastery cải thiện regen tỉ lệ qua mpCostReduction proxy.',
  },
  {
    key: 'thuy_kinh_phong_an',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'thuy_thuan_van_hanh',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
    notes: 'Passive Thuỷ regen MP — atkScale base = 0, mastery cải thiện regen.',
  },
  {
    key: 'hoa_xa_phun_diem',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'thach_giap_ho_than',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
  },
  {
    key: 'hau_tho_an_son',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
    notes: 'Passive Thổ defense — atkScale base = 0, mastery cải thiện def-bonus proxy.',
  },

  // ----- Intermediate tier (10) -----
  {
    key: 'huyet_te_chi_thuat',
    tier: 'intermediate',
    unlocks: [{ kind: 'sect', ref: 'tu_la' }],
    notes: 'Sect tu_la huyết tế — atkScale 2.4 baseline, selfBloodCost 0.10.',
  },
  {
    key: 'tu_hanh_kiem_quyet',
    tier: 'intermediate',
    unlocks: [
      { kind: 'sect', ref: 'thanh_van' },
      { kind: 'realm', ref: 'truc_co' },
    ],
  },
  {
    key: 'huyen_bang_khoa_tran',
    tier: 'intermediate',
    unlocks: [
      { kind: 'sect', ref: 'huyen_thuy' },
      { kind: 'realm', ref: 'truc_co' },
    ],
  },
  {
    key: 'kim_phong_phap_quyet',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
  },
  {
    key: 'kim_cuong_huyen_the',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Passive Kim defense buff — atkScale base = 0, mastery cải thiện def proxy.',
  },
  {
    key: 'doc_lam_phu_mao',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'DOT poison Mộc — atkScaleBonus áp dụng cho hit gốc 1.5×; DOT damage curve riêng phase 11.2.B.',
  },
  {
    key: 'huyen_thuy_quan_dinh',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
  },
  {
    key: 'hoa_long_phen_thien',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
  },
  {
    key: 'hoa_long_huyet_man',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Passive Hoả crit-buff — atkScale base = 0, mastery cải thiện crit chance proxy.',
  },
  {
    key: 'hoang_dia_chan_long',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
  },

  // ----- Phase 10 PR-2 v2 — Skill Pack Ngũ Hành expansion (mid passive — intermediate tier truc_co/luyenkhi) -----
  {
    key: 'kim_phong_lien_hoa',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
    notes: 'Passive Kim sharpness — atkScale base = 0, mastery cải thiện sharpness/atk-bonus proxy.',
  },
  {
    key: 'moc_lam_co_thuy',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Passive Mộc DOT poison — atkScale base = 0, mastery cải thiện DOT damage curve proxy.',
  },
  {
    key: 'thuy_huyen_thanh_tinh',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Passive Thuỷ MP regen — atkScale base = 0, mastery cải thiện mpCostReduction curve.',
  },
  {
    key: 'hoa_thieu_chau_van',
    tier: 'basic',
    unlocks: [{ kind: 'realm', ref: 'luyenkhi' }],
    notes: 'Passive Hoả burn DOT — atkScale base = 0, mastery cải thiện burn DOT damage proxy.',
  },
  {
    key: 'tho_quan_dia_man',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Passive Thổ knockback resist — atkScale base = 0, mastery cải thiện CC-resist proxy.',
  },

  // ----- Advanced tier (1 legacy + 5 new Phase 10 PR-2 v2 ULT kim_dan Ngũ Hành) -----
  {
    key: 'tu_la_chan_that',
    tier: 'advanced',
    unlocks: [
      { kind: 'sect', ref: 'tu_la' },
      { kind: 'realm', ref: 'kim_dan' },
    ],
    notes: 'atkScale 3.2 + selfBloodCost 0.20 — high-risk skill, advanced tier để hạn chế abuse early.',
  },
  {
    key: 'kim_kiep_luan_chuyen',
    tier: 'advanced',
    unlocks: [{ kind: 'realm', ref: 'kim_dan' }],
    notes: 'ULT Kim Đan Kim hệ — atkScale 3.4 baseline, mpCost 70, cooldown 5.',
  },
  {
    key: 'moc_huyen_thien_dia',
    tier: 'advanced',
    unlocks: [{ kind: 'realm', ref: 'kim_dan' }],
    notes: 'ULT Kim Đan Mộc hệ — atkScale 2.0 + selfHealRatio 0.40, mpCost 65, cooldown 4 (heal-combo).',
  },
  {
    key: 'thuy_long_thien_thai',
    tier: 'advanced',
    unlocks: [{ kind: 'realm', ref: 'kim_dan' }],
    notes: 'ULT Kim Đan Thuỷ hệ — atkScale 2.6, mpCost 60, cooldown 5 (control + dmg).',
  },
  {
    key: 'hoa_thien_chu_tuoc',
    tier: 'advanced',
    unlocks: [{ kind: 'realm', ref: 'kim_dan' }],
    notes: 'ULT Kim Đan Hoả hệ — atkScale 3.4 + selfBloodCost 0.10, mpCost 70, cooldown 5 (huyết tế nhẹ).',
  },
  {
    key: 'tho_huyet_son_quan',
    tier: 'advanced',
    unlocks: [{ kind: 'realm', ref: 'kim_dan' }],
    notes: 'ULT Kim Đan Thổ hệ — atkScale 2.8, mpCost 65, cooldown 5 (area dmg).',
  },

  // ----- Phase 11 nâng cao §2 v3 expansion — 5 truc_co role-fill (intermediate) -----
  {
    key: 'kim_loan_y_tham_phap',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Role-fill Kim hệ HEAL truc_co tier — atkScale 0.7 + selfHealRatio 0.28, mpCost 30, cooldown 3.',
  },
  {
    key: 'moc_kinh_thuong_thien',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Role-fill Mộc hệ DAMAGE pure truc_co tier — atkScale 2.6, mpCost 30, cooldown 3.',
  },
  {
    key: 'thuy_kinh_phong_dao',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Role-fill Thuỷ hệ DAMAGE pure truc_co tier — atkScale 2.7, mpCost 32, cooldown 3.',
  },
  {
    key: 'hoa_diem_phap_y',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Role-fill Hoả hệ BUFF truc_co tier (active buff) — atkScale 1.0, mpCost 24, cooldown 4.',
  },
  {
    key: 'tho_huyen_son_phong_an',
    tier: 'intermediate',
    unlocks: [{ kind: 'realm', ref: 'truc_co' }],
    notes: 'Role-fill Thổ hệ CONTROL truc_co tier — atkScale 2.0, mpCost 28, cooldown 3.',
  },

  // ----- Master tier (1 legacy) -----
  {
    key: 'thanh_lien_hoan_sinh',
    tier: 'master',
    unlocks: [
      { kind: 'sect', ref: 'huyen_thuy' },
      { kind: 'realm', ref: 'nguyen_anh' },
    ],
    notes: 'selfHealRatio 0.5 cứu mạng — master tier để giới hạn endgame access.',
  },

  // ----- Phase 11 nâng cao §2 v3 expansion — 5 nguyen_anh ULT (master) -----
  // Classification: master tier (nguyen_anh-locked endgame). Although
  // atkScale ≥ 3.5 trigger inferExpectedTier=legendary, master fits
  // semantic hơn: legendary reserved cho hoa_than+ ULT với evolution
  // branches (Phase 12 scope). Whitelisted in TIER_OVERRIDE_ALLOWED.
  {
    key: 'kim_quang_dao_thien',
    tier: 'master',
    unlocks: [{ kind: 'realm', ref: 'nguyen_anh' }],
    notes: 'ULT Nguyên Anh Kim hệ — atkScale 4.0 baseline, mpCost 80, cooldown 6 (endgame DPS).',
  },
  {
    key: 'moc_thuong_co_lam_thien',
    tier: 'master',
    unlocks: [{ kind: 'realm', ref: 'nguyen_anh' }],
    notes: 'ULT Nguyên Anh Mộc hệ — atkScale 3.6 + selfHealRatio 0.30, mpCost 78, cooldown 5 (heal-combo).',
  },
  {
    key: 'thuy_thien_dong_chuong',
    tier: 'master',
    unlocks: [{ kind: 'realm', ref: 'nguyen_anh' }],
    notes: 'ULT Nguyên Anh Thuỷ hệ — atkScale 3.8, mpCost 75, cooldown 6 (control + dmg).',
  },
  {
    key: 'hoa_phuong_de_quan',
    tier: 'master',
    unlocks: [{ kind: 'realm', ref: 'nguyen_anh' }],
    notes: 'ULT Nguyên Anh Hoả hệ — atkScale 4.0 + selfBloodCost 0.15, mpCost 78, cooldown 6 (huyết tế nặng).',
  },
  {
    key: 'tho_van_co_trach_thien',
    tier: 'master',
    unlocks: [{ kind: 'realm', ref: 'nguyen_anh' }],
    notes: 'ULT Nguyên Anh Thổ hệ — atkScale 3.6, mpCost 76, cooldown 5 (area dmg).',
  },

  // ----- Legendary tier (2) — có evolution branches -----
  {
    key: 'van_kiem_quy_tong',
    tier: 'legendary',
    unlocks: [
      { kind: 'sect', ref: 'thanh_van' },
      { kind: 'realm', ref: 'hoa_than' },
    ],
    evolutions: [
      {
        branchKey: 'van_kiem_quy_tong.thien_kiem',
        targetSkillKey: 'van_kiem_quy_tong_thien_kiem',
        unlockMastery: 10,
        description: 'Thiên Kiếm — atkScale +1.0, cooldown -1, mpCost +20%.',
      },
      {
        branchKey: 'van_kiem_quy_tong.dia_kiem',
        targetSkillKey: 'van_kiem_quy_tong_dia_kiem',
        unlockMastery: 10,
        description: 'Địa Kiếm — atkScale +0.5, AoE 2 target, mpCost +30%.',
      },
    ],
    notes: 'Tuyệt kỹ Thanh Vân — atkScale 3.8 baseline, evolution Phase 11.2.B add SkillDef alt.',
  },
  {
    key: 'huyet_ma_giang_the',
    tier: 'legendary',
    unlocks: [
      { kind: 'sect', ref: 'tu_la' },
      { kind: 'realm', ref: 'hoa_than' },
    ],
    evolutions: [
      {
        branchKey: 'huyet_ma_giang_the.huyet_long',
        targetSkillKey: 'huyet_ma_giang_the_huyet_long',
        unlockMastery: 10,
        description: 'Huyết Long — atkScale +1.5, selfBloodCost giảm xuống 0.20.',
      },
      {
        branchKey: 'huyet_ma_giang_the.tu_la_van_dao',
        targetSkillKey: 'huyet_ma_giang_the_tu_la_van_dao',
        unlockMastery: 10,
        description: 'Tu La Vạn Đạo — atkScale +0.8, hit toàn party địch (AoE), selfBloodCost +0.10.',
      },
    ],
    notes: 'Tuyệt kỹ Tu La — atkScale 4.5 baseline, evolution Phase 11.2.B.',
  },
];

/**
 * Build full template với mastery curve generated.
 */
function buildTemplate(entry: TemplateEntryShorthand): SkillTemplate {
  return {
    key: entry.key,
    tier: entry.tier,
    unlocks: entry.unlocks ?? [],
    masteryLevels: generateMasteryCurve(entry.tier),
    evolutions: entry.evolutions,
    notes: entry.notes,
  };
}

export const SKILL_TEMPLATES: readonly SkillTemplate[] = TEMPLATE_SHORTHAND.map(buildTemplate);

// =====================================================================
// Helpers
// =====================================================================

/**
 * Lookup template theo `skillKey`. Trả về undefined nếu skill chưa
 * có template (catalog có thể lệch tạm thời với SKILLS — test coverage
 * enforce cả 2 set bằng nhau).
 */
export function getSkillTemplate(skillKey: string): SkillTemplate | undefined {
  return SKILL_TEMPLATES.find((t) => t.key === skillKey);
}

export function templatesByTier(tier: SkillTier): SkillTemplate[] {
  return SKILL_TEMPLATES.filter((t) => t.tier === tier).slice();
}

/**
 * Filter templates có unlock requirement match `kind` + `ref`.
 * Useful cho UI: "Skills available in realm X" hoặc "Skills for sect Y".
 */
export function templatesByUnlock(kind: SkillUnlockKind, ref: string): SkillTemplate[] {
  return SKILL_TEMPLATES.filter((t) =>
    t.unlocks.some((u) => u.kind === kind && u.ref === ref)
  ).slice();
}

/**
 * Combine `SkillDef` baseline với mastery effect tại `masteryLevel`.
 * Trả về effective skill — Phase 11.2.B runtime CombatService sẽ
 * gọi helper này thay vì đọc trực tiếp `SkillDef`.
 *
 * `masteryLevel = 0` → trả base skill không bonus.
 * `masteryLevel > maxMastery` → clamp tới maxMastery.
 */
export interface EffectiveSkill {
  key: string;
  atkScale: number;
  mpCost: number;
  selfHealRatio: number;
  selfBloodCost: number;
  cooldownTurns: number;
  element: ElementKey | null;
  sect: SectKey | null;
  masteryLevel: number;
  tier: SkillTier;
}

export function applyMasteryEffect(
  template: SkillTemplate,
  masteryLevel: number,
  baseSkill: SkillDef
): EffectiveSkill {
  if (template.key !== baseSkill.key) {
    throw new Error(
      `applyMasteryEffect: template "${template.key}" mismatch baseSkill "${baseSkill.key}"`
    );
  }
  const tierDef = getSkillTierDef(template.tier);
  const clampedLevel = Math.max(0, Math.min(masteryLevel, tierDef.maxMastery));

  if (clampedLevel === 0) {
    return {
      key: baseSkill.key,
      atkScale: baseSkill.atkScale,
      mpCost: baseSkill.mpCost,
      selfHealRatio: baseSkill.selfHealRatio,
      selfBloodCost: baseSkill.selfBloodCost,
      cooldownTurns: baseSkill.cooldownTurns ?? 0,
      element: baseSkill.element ?? null,
      sect: baseSkill.sect,
      masteryLevel: 0,
      tier: template.tier,
    };
  }

  const lvDef = template.masteryLevels[clampedLevel - 1];
  if (!lvDef) {
    throw new Error(
      `applyMasteryEffect: template "${template.key}" missing level ${clampedLevel} (curve length ${template.masteryLevels.length})`
    );
  }

  const atkScale = round2(baseSkill.atkScale * (1 + lvDef.atkScaleBonus));
  const mpCost = Math.max(0, Math.round(baseSkill.mpCost * (1 - lvDef.mpCostReduction)));
  const cooldownTurns = Math.max(0, (baseSkill.cooldownTurns ?? 0) - lvDef.cooldownReduction);

  return {
    key: baseSkill.key,
    atkScale,
    mpCost,
    selfHealRatio: baseSkill.selfHealRatio,
    selfBloodCost: baseSkill.selfBloodCost,
    cooldownTurns,
    element: baseSkill.element ?? null,
    sect: baseSkill.sect,
    masteryLevel: clampedLevel,
    tier: template.tier,
  };
}

/**
 * Total LinhThach + shard cost để upgrade từ level `from` đến level `to`
 * (inclusive of `to`, exclusive of `from`). Useful cho UI cost preview.
 */
export interface MasteryUpgradeCost {
  linhThachCost: number;
  shardCost: number;
  fromLevel: number;
  toLevel: number;
}

export function masteryUpgradeCost(
  template: SkillTemplate,
  fromLevel: number,
  toLevel: number
): MasteryUpgradeCost {
  if (fromLevel < 0) {
    throw new Error(`masteryUpgradeCost: fromLevel ${fromLevel} < 0`);
  }
  if (toLevel < fromLevel) {
    throw new Error(`masteryUpgradeCost: toLevel ${toLevel} < fromLevel ${fromLevel}`);
  }
  const tierDef = getSkillTierDef(template.tier);
  if (toLevel > tierDef.maxMastery) {
    throw new Error(
      `masteryUpgradeCost: toLevel ${toLevel} > maxMastery ${tierDef.maxMastery} for tier "${template.tier}"`
    );
  }
  let linhThach = 0;
  let shard = 0;
  for (let lv = fromLevel + 1; lv <= toLevel; lv++) {
    const lvDef = template.masteryLevels[lv - 1];
    if (!lvDef) {
      throw new Error(
        `masteryUpgradeCost: template "${template.key}" missing level ${lv}`
      );
    }
    linhThach += lvDef.linhThachCost;
    shard += lvDef.shardCost;
  }
  return { linhThachCost: linhThach, shardCost: shard, fromLevel, toLevel };
}

/**
 * Coverage helper — verify mọi `SkillDef.key` ở `SKILLS` đều có template.
 * Test sẽ assert. Runtime có thể gọi sanity-check ở bootstrap (catalog
 * load).
 */
export function findOrphanSkills(): string[] {
  const templateKeys = new Set(SKILL_TEMPLATES.map((t) => t.key));
  return SKILLS.filter((s) => !templateKeys.has(s.key)).map((s) => s.key);
}

export function findOrphanTemplates(): string[] {
  const skillKeys = new Set(SKILLS.map((s) => s.key));
  return SKILL_TEMPLATES.filter((t) => !skillKeys.has(t.key)).map((t) => t.key);
}

/**
 * Verify template tier <=> SkillDef.unlockRealm consistency.
 * Trả về list mismatch (nếu có) — empty array = OK.
 *
 * Logic mapping (loose):
 *   - Skills realm 'luyenkhi' / null/legacy với atkScale ≤ 2.0 → tier basic.
 *   - Skills realm 'truc_co' hoặc atkScale 2.0..2.9 → intermediate.
 *   - Skills atkScale 3.0..3.5 hoặc realm 'kim_dan' → advanced.
 *   - Skills realm 'nguyen_anh' hoặc selfHealRatio ≥ 0.5 → master.
 *   - Skills atkScale ≥ 3.5 hoặc realm 'hoa_than+' → legendary.
 *
 * Soft check — chỉ warn, không enforce ở runtime. PR catalog hiện tại
 * có thể có overrides cho design intent.
 */
export interface TierMismatch {
  skillKey: string;
  templateTier: SkillTier;
  expectedTier: SkillTier;
  reason: string;
}

export function findTierMismatches(): TierMismatch[] {
  const mismatches: TierMismatch[] = [];
  for (const template of SKILL_TEMPLATES) {
    const skill = skillByKey(template.key);
    if (!skill) {
      continue;
    }
    const expected = inferExpectedTier(skill);
    if (expected !== template.tier && !TIER_OVERRIDE_ALLOWED.has(template.key)) {
      mismatches.push({
        skillKey: template.key,
        templateTier: template.tier,
        expectedTier: expected,
        reason: `atkScale=${skill.atkScale} unlockRealm=${skill.unlockRealm ?? 'null'} selfHealRatio=${skill.selfHealRatio}`,
      });
    }
  }
  return mismatches;
}

function inferExpectedTier(skill: SkillDef): SkillTier {
  if (skill.atkScale >= 3.5 || skill.unlockRealm === 'hoa_than') {
    return 'legendary';
  }
  if (skill.unlockRealm === 'nguyen_anh' || skill.selfHealRatio >= 0.5) {
    return 'master';
  }
  if (skill.atkScale >= 3.0 || skill.unlockRealm === 'kim_dan') {
    return 'advanced';
  }
  if (skill.unlockRealm === 'truc_co' || skill.atkScale >= 2.0) {
    return 'intermediate';
  }
  return 'basic';
}

/**
 * Allowed overrides — skill keys mà template tier có thể lệch khỏi
 * `inferExpectedTier` vì design intent.
 */
const TIER_OVERRIDE_ALLOWED: ReadonlySet<string> = new Set([
  // Sect skill có thể intermediate/master dù atkScale baseline thấp/cao
  // do unlock requirement nặng (sect-bound).
  'huyet_te_chi_thuat', // atkScale 2.4 → intermediate (mặc dù sect, cập nhật pattern lock realm sau)
  'huyen_bang_khoa_tran', // atkScale 1.4 → intermediate (control + sect-locked)
  'thanh_lien_hoan_sinh', // selfHeal 0.5 → master (rule khớp, không override)
  'tu_la_chan_that', // atkScale 3.2 → advanced (rule khớp)
  'van_kiem_quy_tong', // atkScale 3.8 → legendary (rule khớp)
  'huyet_ma_giang_the', // atkScale 4.5 → legendary (rule khớp)
  'kim_cuong_huyen_the', // passive truc_co → intermediate (rule khớp)
  'hoa_long_huyet_man', // passive truc_co → intermediate (rule khớp)
  'doc_lam_phu_mao', // DOT design intent intermediate (atkScale 1.5 < 2.0)
  // Phase 11 nâng cao §2 v3 — nguyen_anh ULT atkScale ≥ 3.5 nhưng tier=master
  // (legendary reserved cho hoa_than+ ULT với evolution branches Phase 12).
  'kim_quang_dao_thien',
  'moc_thuong_co_lam_thien',
  'thuy_thien_dong_chuong',
  'hoa_phuong_de_quan',
  'tho_van_co_trach_thien',
]);
