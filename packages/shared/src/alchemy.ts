import { ITEMS, itemByKey, type ItemEffect, type PillCategory, type PillGrade, type SourceHint } from './items';
import { REALMS, realmByKey } from './realms';

/**
 * Alchemy (Luyện Đan) catalog foundation — Phase 11.X.A
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration.
 *
 * Design intent:
 * - Mỗi `AlchemyRecipeDef` mô tả 1 công thức luyện đan: input (item + qty) → output (item + qty)
 *   với `successRate`, `furnaceLevel` requirement, `linhThachCost`, optional `realmRequirement`.
 * - Catalog cover toàn bộ pill hiện có trong `ITEMS` (HP/MP/EXP × PHAM..THAN).
 * - Helper `simulateAlchemyAttempt(recipe, rng)` deterministic — server replay-able + audit-able.
 * - Phase 11.X.B runtime sẽ wire vào `apps/api/src/modules/alchemy/` qua `ItemLedger`
 *   atomic consume input + grant output (idempotency qua attemptId UUID).
 *
 * Convention:
 * - `furnaceLevel`: cấp lò đan của character (Phase 11.X.B sẽ thêm field `Character.alchemyFurnaceLevel`).
 * - `successRate ∈ [0,1]`: tỉ lệ luyện thành. Nếu fail thì input vẫn bị consume (intent: balance).
 * - `realmRequirement`: optional realm key tối thiểu để học recipe.
 * - Tất cả `outputItem` tham chiếu key trong ITEMS hiện có (PILL_HP/MP/EXP).
 * - Tất cả input tham chiếu material item key trong ITEMS (linh_thao, huyet_tinh, ...).
 *
 * Curve (12 recipe tổng):
 * - PHAM tier (5): linhThach 50–200, success 0.90–0.95, furnace L1.
 * - LINH tier (2): linhThach 400–500, success 0.80–0.85, furnace L3.
 * - HUYEN tier (2): linhThach 1500, success 0.65, furnace L5.
 * - TIEN tier (2): linhThach 8000–12000, success 0.35–0.40, furnace L7.
 * - THAN tier (1): linhThach 30000, success 0.20, furnace L9.
 */

export interface AlchemyIngredient {
  /** Reference key vào ITEMS catalog */
  readonly itemKey: string;
  /** Số lượng cần consume */
  readonly qty: number;
}

export interface AlchemyRecipeDef {
  /** Stable lookup key */
  readonly key: string;
  /** Tên hiển thị */
  readonly name: string;
  /** Mô tả VI */
  readonly description: string;
  /** Item key của pill output (tham chiếu ITEMS) */
  readonly outputItem: string;
  readonly recipeTier: number;
  readonly recipeCategory: PillCategory;
  readonly requiredAlchemyLevel: number;
  /** Số lượng pill output mỗi lần luyện thành */
  readonly outputQty: number;
  /** Tier output (PHAM..THAN), giúp filter UI */
  readonly outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  readonly maxOutputGrade?: PillGrade;
  /** Danh sách nguyên liệu input + qty */
  readonly inputs: readonly AlchemyIngredient[];
  /** Cấp lò đan tối thiểu để dùng được recipe này */
  readonly furnaceLevel: number;
  /** Realm key tối thiểu để học (optional) */
  readonly realmRequirement: string | null;
  readonly targetRealmOrder?: number;
  /** LinhThach cost cho 1 lần thử (ngay cả khi fail) */
  readonly linhThachCost: number;
  /** Tỉ lệ thành công cơ bản (0..1). Phase 11.X.B sẽ wire bonus từ alchemyMastery */
  readonly successRate: number;
  readonly alchemyExpReward: bigint;
  readonly sourceHint?: readonly SourceHint[];
  readonly unlockSource?:
    | 'DEFAULT'
    | 'NPC_SHOP'
    | 'SECT_SHOP'
    | 'QUEST'
    | 'BOSS_DROP'
    | 'DUNGEON_DROP'
    | 'EVENT'
    | 'FRAGMENT_COMBINE';
  readonly tags?: readonly string[];
}

type AlchemyRecipeSeed = Omit<
  AlchemyRecipeDef,
  'recipeTier' | 'recipeCategory' | 'requiredAlchemyLevel' | 'alchemyExpReward'
> &
  Partial<
    Pick<
      AlchemyRecipeDef,
      'recipeTier' | 'recipeCategory' | 'requiredAlchemyLevel' | 'alchemyExpReward'
    >
  >;

/**
 * 13 recipe baseline cover toàn bộ pill HP/MP/EXP từ PHAM đến THAN.
 *
 * Stable order: PHAM → LINH → HUYEN → TIEN → THAN.
 */
const LEGACY_ALCHEMY_RECIPE_SEEDS: readonly AlchemyRecipeSeed[] = [
  // ----- PHAM tier (5 recipe) -----
  {
    key: 'recipe_tieu_phuc_dan',
    name: 'Công thức Tiểu Phục Đan',
    description: 'Đan phàm phẩm tân thủ, hồi 35 HP. Linh thảo × 2.',
    outputItem: 'tieu_phuc_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [{ itemKey: 'linh_thao', qty: 2 }],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 50,
    successRate: 0.95,
  },
  {
    key: 'recipe_huyet_chi_dan',
    name: 'Công thức Huyết Chỉ Đan',
    description: 'Đan phàm phẩm hồi 60 HP. Linh thảo + huyết tinh.',
    outputItem: 'huyet_chi_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [
      { itemKey: 'linh_thao', qty: 1 },
      { itemKey: 'huyet_tinh', qty: 1 },
    ],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 100,
    successRate: 0.92,
  },
  {
    key: 'recipe_linh_tinh_dan',
    name: 'Công thức Linh Tinh Đan',
    description: 'Đan phàm phẩm hồi 30 MP. Linh thảo × 2.',
    outputItem: 'linh_tinh_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [{ itemKey: 'linh_thao', qty: 2 }],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 50,
    successRate: 0.95,
  },
  {
    key: 'recipe_linh_lo_dan',
    name: 'Công thức Linh Lộ Đan',
    description: 'Đan phàm phẩm hồi 80 MP. Linh thảo × 3 + huyết tinh × 1.',
    outputItem: 'linh_lo_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [
      { itemKey: 'linh_thao', qty: 3 },
      { itemKey: 'huyet_tinh', qty: 1 },
    ],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 120,
    successRate: 0.9,
  },
  {
    key: 'recipe_so_huyen_dan',
    name: 'Công thức Sơ Huyền Đan',
    description: 'Đan phàm phẩm tăng 200 EXP tu vi. Linh thảo × 4.',
    outputItem: 'so_huyen_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [{ itemKey: 'linh_thao', qty: 4 }],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 180,
    successRate: 0.92,
  },
  {
    key: 'recipe_khi_huyet_dan_t1',
    name: 'Công thức Khí Huyết Đan',
    description: 'Đan Luyện Thể sơ cấp. Khí huyết thảo × 3 + linh thảo × 2.',
    outputItem: 'khi_huyet_dan_t1',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [
      { itemKey: 'khi_huyet_thao', qty: 3 },
      { itemKey: 'linh_thao', qty: 2 },
    ],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 45,
    successRate: 0.9,
  },

  // ----- LINH tier (2 recipe) -----
  {
    key: 'recipe_thanh_lam_dan',
    name: 'Công thức Thanh Lam Đan',
    description: 'Đan Linh phẩm hồi 200 HP. Huyết tinh × 3 + linh thảo × 5.',
    outputItem: 'thanh_lam_dan',
    outputQty: 1,
    outputQuality: 'LINH',
    inputs: [
      { itemKey: 'huyet_tinh', qty: 3 },
      { itemKey: 'linh_thao', qty: 5 },
    ],
    furnaceLevel: 3,
    realmRequirement: 'truc_co',
    linhThachCost: 400,
    successRate: 0.85,
  },
  {
    key: 'recipe_co_thien_dan',
    name: 'Công thức Cổ Thiên Đan',
    description: 'Đan Linh phẩm tăng 500 EXP. Yêu đan × 1 + linh thảo × 4.',
    outputItem: 'co_thien_dan',
    outputQty: 1,
    outputQuality: 'LINH',
    inputs: [
      { itemKey: 'yeu_dan', qty: 1 },
      { itemKey: 'linh_thao', qty: 4 },
    ],
    furnaceLevel: 3,
    realmRequirement: 'truc_co',
    linhThachCost: 500,
    successRate: 0.8,
  },
  {
    key: 'recipe_cuong_cot_dan_t2',
    name: 'Công thức Cường Cốt Đan',
    description: 'Đan Luyện Thể cường cốt. Đoán cốt thạch × 2 + yêu thú huyết tinh × 1.',
    outputItem: 'cuong_cot_dan_t2',
    outputQty: 1,
    outputQuality: 'LINH',
    inputs: [
      { itemKey: 'doan_cot_thach', qty: 2 },
      { itemKey: 'yeu_thu_huyet_tinh', qty: 1 },
    ],
    furnaceLevel: 3,
    realmRequirement: 'truc_co',
    linhThachCost: 140,
    successRate: 0.76,
  },

  // ----- HUYEN tier (2 recipe) -----
  {
    key: 'recipe_cuu_huyen_dan',
    name: 'Công thức Cửu Huyền Đan',
    description: 'Đan Huyền phẩm hồi 600 HP. Yêu đan × 2 + huyết tinh × 3.',
    outputItem: 'cuu_huyen_dan',
    outputQty: 1,
    outputQuality: 'HUYEN',
    inputs: [
      { itemKey: 'yeu_dan', qty: 2 },
      { itemKey: 'huyet_tinh', qty: 3 },
    ],
    furnaceLevel: 5,
    realmRequirement: 'kim_dan',
    linhThachCost: 1500,
    successRate: 0.65,
  },
  {
    key: 'recipe_ngoc_lien_dan',
    name: 'Công thức Ngọc Liên Đan',
    description: 'Đan Huyền phẩm hồi 800 MP. Yêu đan × 2 + tinh thiết × 3.',
    outputItem: 'ngoc_lien_dan',
    outputQty: 1,
    outputQuality: 'HUYEN',
    inputs: [
      { itemKey: 'yeu_dan', qty: 2 },
      { itemKey: 'tinh_thiet', qty: 3 },
    ],
    furnaceLevel: 5,
    realmRequirement: 'kim_dan',
    linhThachCost: 1500,
    successRate: 0.65,
  },
  {
    key: 'recipe_tay_tuy_dan_t3',
    name: 'Công thức Tẩy Tủy Đan',
    description: 'Đan hỗ trợ phá quan Tẩy Tủy. Tẩy tủy dịch × 2 + đoán cốt thạch × 2.',
    outputItem: 'tay_tuy_dan_t3',
    outputQty: 1,
    outputQuality: 'HUYEN',
    inputs: [
      { itemKey: 'tay_tuy_dich', qty: 2 },
      { itemKey: 'doan_cot_thach', qty: 2 },
    ],
    furnaceLevel: 5,
    realmRequirement: 'kim_dan',
    linhThachCost: 360,
    successRate: 0.62,
    recipeCategory: 'BODY_EXP',
  },

  // ----- TIEN tier (3 recipe) -----
  {
    key: 'recipe_tien_phach_dan',
    name: 'Công thức Tiên Phách Đan',
    description: 'Đan Tiên phẩm hồi 2500 HP. Hàn ngọc × 2 + yêu đan × 3 + huyết tinh × 5.',
    outputItem: 'tien_phach_dan',
    outputQty: 1,
    outputQuality: 'TIEN',
    inputs: [
      { itemKey: 'han_ngoc', qty: 2 },
      { itemKey: 'yeu_dan', qty: 3 },
      { itemKey: 'huyet_tinh', qty: 5 },
    ],
    furnaceLevel: 7,
    realmRequirement: 'hoa_than',
    linhThachCost: 8000,
    successRate: 0.4,
  },
  {
    key: 'recipe_tien_van_dan',
    name: 'Công thức Tiên Vân Đan',
    description: 'Đan Tiên phẩm hồi 2500 MP. Hàn ngọc × 2 + tiên kim sa × 3.',
    outputItem: 'tien_van_dan',
    outputQty: 1,
    outputQuality: 'TIEN',
    inputs: [
      { itemKey: 'han_ngoc', qty: 2 },
      { itemKey: 'tien_kim_sa', qty: 3 },
    ],
    furnaceLevel: 7,
    realmRequirement: 'hoa_than',
    linhThachCost: 8000,
    successRate: 0.4,
  },
  {
    key: 'recipe_cuu_thien_dan',
    name: 'Công thức Cửu Thiên Đan',
    description: 'Đan Tiên phẩm tăng 6000 EXP. Tiên kim sa × 3 + yêu đan × 4 + linh thảo × 8.',
    outputItem: 'cuu_thien_dan',
    outputQty: 1,
    outputQuality: 'TIEN',
    inputs: [
      { itemKey: 'tien_kim_sa', qty: 3 },
      { itemKey: 'yeu_dan', qty: 4 },
      { itemKey: 'linh_thao', qty: 8 },
    ],
    furnaceLevel: 7,
    realmRequirement: 'hoa_than',
    linhThachCost: 12000,
    successRate: 0.35,
  },
  {
    key: 'recipe_kim_than_dan_t4',
    name: 'Công thức Kim Thân Đan',
    description: 'Đan Kim Cương Thân. Kim thân tinh × 2 + tẩy tủy dịch × 2.',
    outputItem: 'kim_than_dan_t4',
    outputQty: 1,
    outputQuality: 'TIEN',
    inputs: [
      { itemKey: 'kim_than_tinh', qty: 2 },
      { itemKey: 'tay_tuy_dich', qty: 2 },
    ],
    furnaceLevel: 7,
    realmRequirement: 'hoa_than',
    linhThachCost: 900,
    successRate: 0.5,
    recipeCategory: 'BODY_EXP',
  },

  // ----- THAN tier (1 recipe) -----
  {
    key: 'recipe_nhan_tien_dan',
    name: 'Công thức Nhân Tiên Đan',
    description: 'Đan Thần phẩm tăng 18000 EXP, hỗ trợ phá quan đại thừa. Hàn ngọc × 3 + tiên kim sa × 4 + yêu đan × 6.',
    outputItem: 'nhan_tien_dan',
    outputQty: 1,
    outputQuality: 'THAN',
    inputs: [
      { itemKey: 'han_ngoc', qty: 3 },
      { itemKey: 'tien_kim_sa', qty: 4 },
      { itemKey: 'yeu_dan', qty: 6 },
    ],
    furnaceLevel: 9,
    realmRequirement: 'do_kiep',
    linhThachCost: 30000,
    successRate: 0.2,
  },
  {
    key: 'recipe_bat_hoai_dan_t5',
    name: 'Công thức Bất Hoại Đan',
    description: 'Đan Bất Hoại Pháp Thân. Bất hoại hồn thạch × 2 + kim thân tinh × 3.',
    outputItem: 'bat_hoai_dan_t5',
    outputQty: 1,
    outputQuality: 'THAN',
    inputs: [
      { itemKey: 'bat_hoai_hon_thach', qty: 2 },
      { itemKey: 'kim_than_tinh', qty: 3 },
    ],
    furnaceLevel: 9,
    realmRequirement: 'do_kiep',
    linhThachCost: 2200,
    successRate: 0.2,
  },
];

const ALCHEMY_TIER_QUALITY: Record<number, AlchemyRecipeDef['outputQuality']> = {
  1: 'PHAM',
  2: 'LINH',
  3: 'HUYEN',
  4: 'TIEN',
  5: 'THAN',
  6: 'THAN',
  7: 'THAN',
  8: 'THAN',
  9: 'THAN',
};

const ALCHEMY_REALM_BY_TIER: Record<number, string | null> = {
  1: null,
  2: 'truc_co',
  3: 'kim_dan',
  4: 'nguyen_anh',
  5: 'luyen_hu',
  6: 'do_kiep',
  7: 'huyen_tien',
  8: 'chuan_thanh',
  9: 'thien_dao',
};

const ALCHEMY_DEFAULT_COST_BY_TIER: Record<number, number> = {
  1: 80,
  2: 420,
  3: 1200,
  4: 3600,
  5: 10000,
  6: 28000,
  7: 70000,
  8: 180000,
  9: 520000,
};

const ALCHEMY_DEFAULT_SUCCESS_BY_TIER: Record<number, number> = {
  1: 0.92,
  2: 0.82,
  3: 0.7,
  4: 0.58,
  5: 0.3,
  6: 0.3,
  7: 0.28,
  8: 0.26,
  9: 0.2,
};

const PILL_CATEGORY_MATERIALS: Record<PillCategory, string[]> = {
  HEAL_HP: ['linh_thao_t1', 'truc_tam_thao_t2', 'kim_lien_tu_t3'],
  HEAL_MP: ['tinh_thuy_lo_t1', 'han_lo_hoa_t2', 'ngoc_lien_tu_t3'],
  HEAL_STAMINA: ['thu_gan_vun_t1', 'yeu_thu_huyet_tinh_t2'],
  QI_EXP: ['linh_thao_t1', 'moc_linh_qua_t2', 'kim_lien_tu_t3'],
  BODY_EXP: ['khi_huyet_thao_t1', 'yeu_thu_huyet_tinh_t2', 'kim_tuy_dich_t3'],
  QI_BREAKTHROUGH: ['yeu_dan_non_t2', 'yeu_dan_t3', 'yeu_dan_cao_cap_t5'],
  BODY_BREAKTHROUGH: ['doan_cot_thach_t2', 'tay_tuy_dich_t3', 'bat_hoai_hon_thach_t5'],
  COMBAT_BUFF: ['bot_dan_sa_t1', 'can_khon_tuy_t5'],
  TRIBULATION_SUPPORT: ['kiep_loi_tinh_t6', 'thien_dao_tan_phien_t8'],
  INJURY_CURE: ['thanh_tam_thao_t3', 'van_phap_thanh_lien_t8'],
  MIXED_RECOVERY: ['huyen_bang_ngoc_t4', 'kim_tien_ngoc_dich_t7_material'],
  SPECIAL: ['dao_van_thach_t8', 'niet_ban_huyet_t9'],
};

const ALCHEMY_PILL_RECIPE_SPECS: Array<{ key: string; name: string; tier: number; category: PillCategory }> = [
  { key: 'tieu_phuc_dan_t1', name: 'Tiểu Phục Đan', tier: 1, category: 'HEAL_HP' },
  { key: 'linh_tinh_dan_t1', name: 'Linh Tinh Đan', tier: 1, category: 'HEAL_MP' },
  { key: 'so_huyen_dan_t1', name: 'Sơ Huyền Đan', tier: 1, category: 'QI_EXP' },
  { key: 'khi_huyet_dan_t1', name: 'Khí Huyết Đan', tier: 1, category: 'BODY_EXP' },
  { key: 'cuong_gan_dan_t1', name: 'Cường Gân Đan', tier: 1, category: 'HEAL_STAMINA' },
  { key: 'duong_than_tan_t1', name: 'Dưỡng Thân Tán', tier: 1, category: 'INJURY_CURE' },
  { key: 'tu_khi_dan_t1', name: 'Tụ Khí Đan', tier: 1, category: 'QI_EXP' },
  { key: 'thanh_lam_dan_t2', name: 'Thanh Lam Đan', tier: 2, category: 'HEAL_HP' },
  { key: 'hoi_nguyen_dan_t2', name: 'Hồi Nguyên Đan', tier: 2, category: 'HEAL_MP' },
  { key: 'co_thien_dan_t2', name: 'Cổ Thiên Đan', tier: 2, category: 'QI_EXP' },
  { key: 'cuong_cot_dan_t2', name: 'Cường Cốt Đan', tier: 2, category: 'BODY_EXP' },
  { key: 'cuu_huyen_dan_t3', name: 'Cửu Huyền Đan', tier: 3, category: 'HEAL_HP' },
  { key: 'ngoc_lien_dan_t3', name: 'Ngọc Liên Đan', tier: 3, category: 'HEAL_MP' },
  { key: 'van_linh_dan_t3', name: 'Vạn Linh Đan', tier: 3, category: 'QI_EXP' },
  { key: 'kim_tuy_dan_t3', name: 'Kim Tủy Đan', tier: 3, category: 'BODY_EXP' },
  { key: 'thanh_tam_dan_t3', name: 'Thanh Tâm Đan', tier: 3, category: 'INJURY_CURE' },
  { key: 'anh_nguyen_dan_t4', name: 'Anh Nguyên Đan', tier: 4, category: 'QI_EXP' },
  { key: 'huyen_menh_dan_t4', name: 'Huyền Mệnh Đan', tier: 4, category: 'MIXED_RECOVERY' },
  { key: 'ngoc_cot_dan_t4', name: 'Ngọc Cốt Đan', tier: 4, category: 'BODY_EXP' },
  { key: 'kim_cuong_ho_the_dan_t4', name: 'Kim Cương Hộ Thể Đan', tier: 4, category: 'INJURY_CURE' },
  { key: 'hu_linh_dan_t5', name: 'Hư Linh Đan', tier: 5, category: 'QI_EXP' },
  { key: 'long_huyet_dan_t5', name: 'Long Huyết Đan', tier: 5, category: 'BODY_EXP' },
  { key: 'bat_hoai_ho_mach_dan_t5', name: 'Bất Hoại Hộ Mạch Đan', tier: 5, category: 'INJURY_CURE' },
  { key: 'tinh_hon_dan_t5', name: 'Tĩnh Hồn Đan', tier: 5, category: 'INJURY_CURE' },
  { key: 'nhan_tien_dan_t6', name: 'Nhân Tiên Đan', tier: 6, category: 'QI_EXP' },
  { key: 'kiep_loi_ho_menh_dan_t6', name: 'Kiếp Lôi Hộ Mệnh Đan', tier: 6, category: 'TRIBULATION_SUPPORT' },
  { key: 'tien_phach_dan_t6', name: 'Tiên Phách Đan', tier: 6, category: 'HEAL_HP' },
  { key: 'tien_van_dan_t6', name: 'Tiên Vân Đan', tier: 6, category: 'HEAL_MP' },
  { key: 'long_tuong_dan_t6', name: 'Long Tượng Đan', tier: 6, category: 'BODY_EXP' },
  { key: 'niet_ban_dan_t6', name: 'Niết Bàn Đan', tier: 6, category: 'SPECIAL' },
  { key: 'huyen_tien_dao_dan_t7', name: 'Huyền Tiên Đạo Đan', tier: 7, category: 'QI_EXP' },
  { key: 'kim_tien_ngoc_dich_t7', name: 'Kim Tiên Ngọc Dịch', tier: 7, category: 'MIXED_RECOVERY' },
  { key: 'thai_at_tu_linh_dan_t7', name: 'Thái Ất Tụ Linh Đan', tier: 7, category: 'QI_EXP' },
  { key: 'dai_la_kim_than_dan_t7', name: 'Đại La Kim Thân Đan', tier: 7, category: 'BODY_EXP' },
  { key: 'chuan_thanh_dao_dan_t8', name: 'Chuẩn Thánh Đạo Đan', tier: 8, category: 'QI_EXP' },
  { key: 'thanh_nhan_huyet_dan_t8', name: 'Thánh Nhân Huyết Đan', tier: 8, category: 'BODY_EXP' },
  { key: 'dao_quan_tu_nguyen_dan_t8', name: 'Đạo Quân Tụ Nguyên Đan', tier: 8, category: 'QI_EXP' },
  { key: 'thien_dao_ho_than_dan_t8', name: 'Thiên Đạo Hộ Thân Đan', tier: 8, category: 'TRIBULATION_SUPPORT' },
  { key: 'van_phap_thanh_tam_dan_t8', name: 'Vạn Pháp Thanh Tâm Đan', tier: 8, category: 'INJURY_CURE' },
  { key: 'dao_van_dan_t8', name: 'Đạo Văn Đan', tier: 8, category: 'SPECIAL' },
  { key: 'thien_dao_dan_t9', name: 'Thiên Đạo Đan', tier: 9, category: 'QI_EXP' },
  { key: 'vo_thuy_dao_dan_t9', name: 'Vô Thủy Đạo Đan', tier: 9, category: 'QI_EXP' },
  { key: 'vo_chung_bat_diet_dan_t9', name: 'Vô Chung Bất Diệt Đan', tier: 9, category: 'BODY_EXP' },
  { key: 'hu_khong_chi_ton_dan_t9', name: 'Hư Không Chí Tôn Đan', tier: 9, category: 'SPECIAL' },
  { key: 'dai_dao_niet_ban_dan_t9', name: 'Đại Đạo Niết Bàn Đan', tier: 9, category: 'SPECIAL' },
];

function recipeInputsFor(tier: number, category: PillCategory): readonly AlchemyIngredient[] {
  const candidates = PILL_CATEGORY_MATERIALS[category];
  const primary = candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor((tier - 1) / 3)))] ?? 'linh_thao_t1';
  const general = tier <= 2 ? 'bot_dan_sa_t1' : tier <= 5 ? 'hon_tinh_t4' : 'tien_linh_tuy_t6';
  const high = tier >= 8 ? 'thien_dao_tan_phien_t8' : tier >= 6 ? 'kiep_loi_tinh_t6' : null;
  const inputs: AlchemyIngredient[] = [
    { itemKey: primary, qty: Math.max(1, tier) },
    { itemKey: general, qty: Math.max(1, Math.ceil(tier / 2)) },
  ];
  if (high) inputs.push({ itemKey: high, qty: Math.max(1, tier - 5) });
  return inputs;
}

function makeAlchemyV2Recipe(spec: (typeof ALCHEMY_PILL_RECIPE_SPECS)[number]): AlchemyRecipeDef {
  const rare = spec.category.includes('BREAKTHROUGH') || spec.category === 'SPECIAL' || spec.category === 'TRIBULATION_SUPPORT';
  return {
    key: `recipe_${spec.key}`,
    name: `Công thức ${spec.name}`,
    description: `${spec.name} cấp ${spec.tier} thuộc ${spec.category}; recipe server-authoritative với phẩm đan và cap output.`,
    outputItem: spec.key,
    recipeTier: spec.tier,
    recipeCategory: spec.category,
    requiredAlchemyLevel: spec.tier,
    outputQty: 1,
    outputQuality: ALCHEMY_TIER_QUALITY[spec.tier] ?? 'THAN',
    maxOutputGrade: spec.tier >= 8 || rare ? 'CUC_PHAM' : 'DAN_VAN',
    inputs: recipeInputsFor(spec.tier, spec.category),
    furnaceLevel: spec.tier,
    realmRequirement: ALCHEMY_REALM_BY_TIER[spec.tier] ?? null,
    targetRealmOrder: itemByKey(spec.key)?.targetRealmOrder,
    linhThachCost: Math.round((ALCHEMY_DEFAULT_COST_BY_TIER[spec.tier] ?? 1000) * (rare ? 1.35 : 1)),
    successRate: Number(((ALCHEMY_DEFAULT_SUCCESS_BY_TIER[spec.tier] ?? 0.5) - (rare ? 0.05 : 0)).toFixed(3)),
    alchemyExpReward: BigInt(40 * spec.tier * spec.tier * (rare ? 2 : 1)),
    sourceHint: spec.tier <= 2 ? ['NPC_SHOP', 'DUNGEON'] as SourceHint[] : spec.tier <= 5 ? ['DUNGEON', 'BOSS'] as SourceHint[] : ['BOSS', 'WORLD_BOSS'] as SourceHint[],
    unlockSource: spec.tier <= 2 ? 'DEFAULT' : spec.tier <= 5 ? 'DUNGEON_DROP' : 'BOSS_DROP',
    tags: [spec.category.toLowerCase(), `tier_${spec.tier}`],
  };
}

function inferRecipeTier(seed: AlchemyRecipeSeed): number {
  if (seed.recipeTier) return seed.recipeTier;
  const itemTier = itemByKey(seed.outputItem)?.recipeTier;
  if (itemTier) return itemTier;
  if (seed.outputQuality === 'PHAM') return 1;
  if (seed.outputQuality === 'LINH') return 2;
  if (seed.outputQuality === 'HUYEN') return 3;
  if (seed.outputQuality === 'TIEN') return 4;
  return 5;
}

function inferRecipeCategory(seed: AlchemyRecipeSeed): PillCategory {
  if (seed.recipeCategory) return seed.recipeCategory;
  const item = itemByKey(seed.outputItem);
  if (item?.pillCategory) return item.pillCategory;
  if (item?.effect?.mp) return 'HEAL_MP';
  if (item?.effect?.exp) return 'QI_EXP';
  if (item?.effect?.bodyExp) return 'BODY_EXP';
  return 'HEAL_HP';
}

function normalizeAlchemyRecipe(seed: AlchemyRecipeSeed): AlchemyRecipeDef {
  const recipeTier = inferRecipeTier(seed);
  const recipeCategory = inferRecipeCategory(seed);
  return {
    ...seed,
    recipeTier,
    recipeCategory,
    requiredAlchemyLevel: seed.requiredAlchemyLevel ?? recipeTier,
    targetRealmOrder: seed.targetRealmOrder ?? itemByKey(seed.outputItem)?.targetRealmOrder,
    alchemyExpReward: seed.alchemyExpReward ?? BigInt(30 * recipeTier * recipeTier),
    maxOutputGrade: seed.maxOutputGrade ?? 'DAN_VAN',
    unlockSource: seed.unlockSource ?? 'DEFAULT',
    tags: seed.tags ?? [recipeCategory.toLowerCase(), `tier_${recipeTier}`],
  };
}

const ALCHEMY_V2_RECIPES = ALCHEMY_PILL_RECIPE_SPECS.map(makeAlchemyV2Recipe);

const ALCHEMY_V2_RECIPE_KEYS = new Set(ALCHEMY_V2_RECIPES.map((recipe) => recipe.key));

export const ALCHEMY_RECIPES: readonly AlchemyRecipeDef[] = [
  ...LEGACY_ALCHEMY_RECIPE_SEEDS.map(normalizeAlchemyRecipe).filter(
    (recipe) => !ALCHEMY_V2_RECIPE_KEYS.has(recipe.key),
  ),
  ...ALCHEMY_V2_RECIPES,
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Lookup recipe theo key.
 */
export function getAlchemyRecipeDef(key: string): AlchemyRecipeDef | undefined {
  return ALCHEMY_RECIPES.find((r) => r.key === key);
}

/**
 * Filter recipes theo output quality tier.
 */
export function alchemyRecipesByQuality(
  quality: AlchemyRecipeDef['outputQuality']
): readonly AlchemyRecipeDef[] {
  return ALCHEMY_RECIPES.filter((r) => r.outputQuality === quality);
}

/**
 * Filter recipes theo output item key (1 pill có thể có nhiều recipe alt route trong tương lai).
 */
export function alchemyRecipesByOutputItem(
  outputItem: string
): readonly AlchemyRecipeDef[] {
  return ALCHEMY_RECIPES.filter((r) => r.outputItem === outputItem);
}

/**
 * Filter recipes mà character ở `furnaceLevel` này có thể dùng được.
 */
export function alchemyRecipesAvailableAtFurnace(
  furnaceLevel: number
): readonly AlchemyRecipeDef[] {
  if (!Number.isFinite(furnaceLevel) || furnaceLevel < 0) {
    throw new Error(`furnaceLevel must be non-negative finite, got ${furnaceLevel}`);
  }
  return ALCHEMY_RECIPES.filter((r) => r.furnaceLevel <= furnaceLevel);
}

export const ALCHEMY_MAX_LEVEL = 9 as const;

export const ALCHEMY_LEVEL_NAMES: readonly string[] = [
  'Đan Sư Nhập Môn',
  'Nhất Phẩm Đan Sư',
  'Nhị Phẩm Đan Sư',
  'Tam Phẩm Đan Sư',
  'Tứ Phẩm Đan Sư',
  'Ngũ Phẩm Đan Sư',
  'Lục Phẩm Đan Sư',
  'Thất Phẩm Đan Sư',
  'Đan Đạo Tông Sư',
];

export interface AlchemyCraftContext {
  readonly alchemyLevel: number;
  readonly furnaceLevel: number;
  readonly alchemyMastery?: number;
}

export interface AlchemyCraftCharacterContext {
  readonly alchemyLevel: number;
  readonly alchemyFurnaceLevel: number;
  readonly realmKey?: string | null;
}

export interface AlchemyMaterialDropContext {
  readonly playerRealmOrder: number;
  readonly playerBodyRealmOrder?: number;
  readonly monsterType?: 'NORMAL' | 'ELITE' | 'BOSS' | 'WORLD_BOSS';
  readonly monsterLevel?: number;
  readonly dungeonTier?: number;
  readonly source?: 'NORMAL_MONSTER' | 'ELITE' | 'BOSS' | 'WORLD_BOSS' | 'DUNGEON' | 'BODY_DUNGEON';
  readonly luck?: number;
}

export interface RolledAlchemyMaterialDrop {
  readonly itemKey: string;
  readonly qty: number;
  readonly tier: number;
  readonly rarity: 'lowerTier' | 'sameTier' | 'rareSameTier' | 'special';
}

const PILL_GRADES: readonly PillGrade[] = [
  'HA_PHAM',
  'TRUNG_PHAM',
  'THUONG_PHAM',
  'CUC_PHAM',
  'DAN_VAN',
  'PHONG_HAU',
  'DAO_TO',
  'THAN_THONG',
  'CHI_TON',
];

const PILL_GRADE_ORDER: Record<PillGrade, number> = {
  HA_PHAM: 1,
  TRUNG_PHAM: 2,
  THUONG_PHAM: 3,
  CUC_PHAM: 4,
  DAN_VAN: 5,
  PHONG_HAU: 6,
  DAO_TO: 7,
  THAN_THONG: 8,
  CHI_TON: 9,
};

export function getAlchemyLevelExpRequirement(level: number): bigint {
  if (!Number.isInteger(level) || level < 1 || level >= ALCHEMY_MAX_LEVEL) return 0n;
  return BigInt(120 * level * level * level);
}

export function computeLowerTierCraftBonus(alchemyLevel: number, recipeTier: number): number {
  const diff = Math.max(0, Math.floor(alchemyLevel) - Math.floor(recipeTier));
  if (diff <= 0) return 0;
  return Math.min(0.2, diff * 0.05);
}

export function computeAlchemySuccessRate(
  recipe: AlchemyRecipeDef,
  context: AlchemyCraftContext,
): number {
  const lowerTierBonus = computeLowerTierCraftBonus(context.alchemyLevel, recipe.recipeTier);
  const furnaceBonus = Math.min(
    0.08,
    Math.max(0, Math.floor(context.furnaceLevel) - recipe.furnaceLevel) * 0.02,
  );
  const masteryBonus = Math.min(0.05, Math.max(0, context.alchemyMastery ?? 0) * 0.0005);
  const raw = recipe.successRate + lowerTierBonus + furnaceBonus + masteryBonus;
  return Number(Math.min(0.98, Math.max(0.05, raw)).toFixed(4));
}

export function pillGradeMultiplier(grade: PillGrade): number {
  switch (grade) {
    case 'HA_PHAM':
      return 0.85;
    case 'TRUNG_PHAM':
      return 1;
    case 'THUONG_PHAM':
      return 1.15;
    case 'CUC_PHAM':
      return 1.3;
    case 'DAN_VAN':
      return 1.5;
    case 'PHONG_HAU':
      return 1.7;
    case 'DAO_TO':
      return 1.9;
    case 'THAN_THONG':
      return 2.1;
    case 'CHI_TON':
      return 2.5;
  }
}

function allowedGrades(maxOutputGrade?: PillGrade): readonly PillGrade[] {
  const maxOrder = maxOutputGrade ? PILL_GRADE_ORDER[maxOutputGrade] : PILL_GRADE_ORDER.DAN_VAN;
  return PILL_GRADES.filter((grade) => PILL_GRADE_ORDER[grade] <= maxOrder);
}

export function possiblePillGrades(recipe: AlchemyRecipeDef): readonly PillGrade[] {
  return allowedGrades(recipe.maxOutputGrade);
}

export function rollPillGrade(
  recipe: AlchemyRecipeDef,
  context: AlchemyCraftContext,
  rng: () => number,
): PillGrade {
  const qualityShift = Math.min(
    0.12,
    computeLowerTierCraftBonus(context.alchemyLevel, recipe.recipeTier) / 2 +
      Math.max(0, context.furnaceLevel - recipe.furnaceLevel) * 0.005 +
      Math.max(0, context.alchemyMastery ?? 0) * 0.0001,
  );
  const weights: Record<PillGrade, number> = {
    HA_PHAM: Math.max(0.22, 0.40 - qualityShift),
    TRUNG_PHAM: Math.max(0.20, 0.28 - qualityShift / 2),
    THUONG_PHAM: 0.15 + qualityShift * 0.6,
    CUC_PHAM: Math.min(0.15, 0.06 + qualityShift * 0.45),
    DAN_VAN: Math.min(0.05, 0.01 + qualityShift * 0.15),
    PHONG_HAU: Math.min(0.03, 0.005 + qualityShift * 0.08),
    DAO_TO: Math.min(0.02, 0.002 + qualityShift * 0.04),
    THAN_THONG: Math.min(0.01, 0.001 + qualityShift * 0.02),
    CHI_TON: Math.min(0.005, 0.0005 + qualityShift * 0.01),
  };
  for (const grade of PILL_GRADES) {
    if (!allowedGrades(recipe.maxOutputGrade).includes(grade)) weights[grade] = 0;
  }
  const total = PILL_GRADES.reduce((sum, grade) => sum + weights[grade], 0);
  let roll = Math.min(0.999999, Math.max(0, rng())) * total;
  for (const grade of PILL_GRADES) {
    roll -= weights[grade];
    if (roll <= 0) return grade;
  }
  return allowedGrades(recipe.maxOutputGrade).at(-1) ?? 'TRUNG_PHAM';
}

export function clampPillEffectByRecipeTier(effect: ItemEffect, recipeTier: number): ItemEffect {
  const scalarCap = Math.max(1, recipeTier) ** 2;
  return {
    ...effect,
    hp: effect.hp === undefined ? undefined : Math.min(effect.hp, 320 * scalarCap),
    mp: effect.mp === undefined ? undefined : Math.min(effect.mp, 300 * scalarCap),
    stamina: effect.stamina === undefined ? undefined : Math.min(effect.stamina, 12 + recipeTier * 9),
    exp: effect.exp === undefined ? undefined : Math.min(effect.exp, 260 * scalarCap),
    bodyExp: effect.bodyExp === undefined ? undefined : Math.min(effect.bodyExp, 150 * scalarCap),
    qiBreakthroughBonus:
      effect.qiBreakthroughBonus === undefined
        ? undefined
        : Math.min(effect.qiBreakthroughBonus, 0.025 + recipeTier * 0.012),
    bodyBreakthroughBonus:
      effect.bodyBreakthroughBonus === undefined
        ? undefined
        : Math.min(effect.bodyBreakthroughBonus, 0.02 + recipeTier * 0.011),
    tribulationSupport:
      effect.tribulationSupport === undefined
        ? undefined
        : Math.min(effect.tribulationSupport, 0.025 + recipeTier * 0.01),
    bodyInjuryReductionMinutes:
      effect.bodyInjuryReductionMinutes === undefined
        ? undefined
        : Math.min(effect.bodyInjuryReductionMinutes, 8 + recipeTier * 15),
    taoMaReductionMinutes:
      effect.taoMaReductionMinutes === undefined
        ? undefined
        : Math.min(effect.taoMaReductionMinutes, 8 + recipeTier * 15),
  };
}

export function canCraftAlchemyRecipe(
  character: AlchemyCraftCharacterContext,
  recipe: AlchemyRecipeDef,
): { canCraft: boolean; failureReason: string | null } {
  if (recipe.recipeTier > character.alchemyLevel || recipe.requiredAlchemyLevel > character.alchemyLevel) {
    return { canCraft: false, failureReason: 'ALCHEMY_LEVEL_TOO_LOW' };
  }
  if (recipe.furnaceLevel > character.alchemyFurnaceLevel) {
    return { canCraft: false, failureReason: 'FURNACE_LEVEL_TOO_LOW' };
  }
  if (recipe.realmRequirement && character.realmKey) {
    const currentOrder = realmByKey(character.realmKey)?.order ?? -1;
    const requiredOrder = realmByKey(recipe.realmRequirement)?.order ?? 999;
    if (currentOrder < requiredOrder) {
      return { canCraft: false, failureReason: 'REALM_REQUIREMENT_NOT_MET' };
    }
  }
  return { canCraft: true, failureReason: null };
}

export function computeAlchemyExpReward(
  recipe: AlchemyRecipeDef,
  success: boolean,
  grade?: PillGrade,
): bigint {
  const base = success ? recipe.alchemyExpReward : recipe.alchemyExpReward / 5n;
  if (!success || !grade) return base;
  return BigInt(Math.max(1, Math.round(Number(base) * pillGradeMultiplier(grade))));
}

export function resolveAlchemyLevelAfter(
  currentLevel: number,
  currentExp: bigint,
  gainedExp: bigint,
): { level: number; exp: bigint } {
  let level = Math.min(ALCHEMY_MAX_LEVEL, Math.max(1, currentLevel));
  let exp = currentExp + gainedExp;
  while (level < ALCHEMY_MAX_LEVEL) {
    const need = getAlchemyLevelExpRequirement(level);
    if (need <= 0n || exp < need) break;
    exp -= need;
    level += 1;
  }
  if (level >= ALCHEMY_MAX_LEVEL) {
    return { level: ALCHEMY_MAX_LEVEL, exp };
  }
  return { level, exp };
}

export function rollMaterialDrop(
  context: AlchemyMaterialDropContext,
  rng: () => number = Math.random,
): RolledAlchemyMaterialDrop | null {
  const source = context.source ?? context.monsterType ?? 'NORMAL_MONSTER';
  const luck = Math.max(0, context.luck ?? 0);
  const dropRates: Record<string, number> = {
    NORMAL: 0.03,
    NORMAL_MONSTER: 0.03,
    ELITE: 0.12,
    BOSS: 0.35,
    WORLD_BOSS: 0.45,
    DUNGEON: 0.28,
    BODY_DUNGEON: 0.3,
  };
  const rate = Math.min(0.55, (dropRates[source] ?? 0.03) + luck * 0.002);
  if (rng() > rate) return null;
  const tierBase = Math.min(9, Math.max(1, context.dungeonTier ?? Math.ceil((context.playerRealmOrder + 1) / 3)));
  const bossLike = source === 'BOSS' || source === 'WORLD_BOSS' || source === 'DUNGEON' || source === 'BODY_DUNGEON';
  const thresholds = bossLike
    ? [
        ['lowerTier', 0.4],
        ['sameTier', 0.85],
        ['rareSameTier', 0.97],
        ['special', 1],
      ] as const
    : [
        ['lowerTier', 0.7],
        ['sameTier', 0.95],
        ['rareSameTier', 0.99],
        ['special', 1],
      ] as const;
  const rarityRoll = rng();
  const rarity = thresholds.find(([, threshold]) => rarityRoll <= threshold)?.[0] ?? 'lowerTier';
  const tier = rarity === 'lowerTier' ? Math.max(1, tierBase - (rng() < 0.5 ? 1 : 2)) : tierBase;
  const candidates = ITEMS.filter((item) => {
    if (item.materialTier !== tier || !item.materialCategory) return false;
    if (source === 'NORMAL_MONSTER' || source === 'NORMAL') {
      return item.materialCategory !== 'ARTIFACT_CRAFT' && item.materialCategory !== 'BODY_BREAKTHROUGH';
    }
    if (rarity === 'special') return item.materialCategory === 'ARTIFACT_CRAFT' || item.materialCategory === 'TRIBULATION';
    if (rarity === 'rareSameTier') return item.materialCategory.includes('BREAKTHROUGH') || item.materialCategory === 'TRIBULATION';
    return item.materialCategory.startsWith('ALCHEMY') || item.materialCategory === 'GENERAL';
  });
  if (candidates.length === 0) return null;
  const item = candidates[Math.floor(rng() * candidates.length)]!;
  return { itemKey: item.key, qty: bossLike ? 1 + Math.floor(rng() * 2) : 1, tier, rarity };
}

export function validateAlchemyV2Catalog(): string[] {
  const errors: string[] = [];
  const recipeKeys = new Set<string>();
  const itemKeys = new Set(ITEMS.map((item) => item.key));
  for (const recipe of ALCHEMY_RECIPES) {
    if (recipeKeys.has(recipe.key)) errors.push(`duplicate recipe ${recipe.key}`);
    recipeKeys.add(recipe.key);
    if (recipe.recipeTier < 1 || recipe.recipeTier > 9) errors.push(`${recipe.key} invalid recipeTier`);
    if (recipe.requiredAlchemyLevel > 9) errors.push(`${recipe.key} invalid requiredAlchemyLevel`);
    if (!itemKeys.has(recipe.outputItem)) errors.push(`${recipe.key} missing output ${recipe.outputItem}`);
    for (const input of recipe.inputs) {
      if (!itemKeys.has(input.itemKey)) errors.push(`${recipe.key} missing input ${input.itemKey}`);
    }
  }
  for (const item of ITEMS) {
    if (item.kind === 'PILL_HP' || item.kind === 'PILL_MP' || item.kind === 'PILL_EXP') {
      const alchemyPill = item.recipeTier !== undefined || item.key.endsWith('_t1') || item.key.endsWith('_t2') || item.key.endsWith('_t3') || item.key.endsWith('_t4') || item.key.endsWith('_t5') || item.key.endsWith('_t6') || item.key.endsWith('_t7') || item.key.endsWith('_t8') || item.key.endsWith('_t9');
      if (alchemyPill && !item.pillCategory) errors.push(`${item.key} missing pillCategory`);
      if (item.pillCategory === 'BODY_EXP' && item.effect?.exp !== undefined) errors.push(`${item.key} body pill uses exp`);
      if (item.pillCategory === 'QI_EXP' && item.effect?.bodyExp !== undefined) errors.push(`${item.key} qi pill uses bodyExp`);
      if (
        (item.pillCategory === 'QI_BREAKTHROUGH' || item.pillCategory === 'BODY_BREAKTHROUGH') &&
        (item.effect?.exp !== undefined || item.effect?.bodyExp !== undefined)
      ) {
        errors.push(`${item.key} breakthrough pill grants exp`);
      }
    }
    if (item.materialTier !== undefined) {
      if (!item.materialCategory) errors.push(`${item.key} missing materialCategory`);
      if (!item.sourceHint || item.sourceHint.length === 0) errors.push(`${item.key} missing sourceHint`);
    }
  }
  return errors;
}

// ============================================================================
// Phase 11.11.D-2 — Furnace upgrade catalog
// ============================================================================

/**
 * Static cost curve để upgrade lò đan từ level (toLevel - 1) lên `toLevel`.
 * Character mặc định L1; có thể upgrade lên L2..L9 (max 9 = THAN tier).
 *
 * Convention:
 * - `toLevel` ∈ [2, 9]; mỗi entry mô tả 1 step upgrade.
 * - `linhThachCost` scale theo recipe gating (≥ chi phí 5–10 craft mỗi tier).
 * - `realmRequirement` đồng bộ với recipe gating: L3-4 truc_co, L5-6 kim_dan,
 *   L7-8 hoa_than, L9 do_kiep.
 * - Catalog là source of truth — runtime KHÔNG hard-code cost.
 */
export interface AlchemyFurnaceUpgradeDef {
  /** Target level sau upgrade (current = toLevel - 1) */
  readonly toLevel: number;
  /** LinhThach phải tốn cho upgrade này */
  readonly linhThachCost: number;
  /** Realm key tối thiểu (null = không yêu cầu) */
  readonly realmRequirement: string | null;
}

export const ALCHEMY_FURNACE_DEFAULT_LEVEL = 1 as const;
export const ALCHEMY_FURNACE_MAX_LEVEL = 9 as const;

export const ALCHEMY_FURNACE_UPGRADES: readonly AlchemyFurnaceUpgradeDef[] = [
  { toLevel: 2, linhThachCost: 500, realmRequirement: null },
  { toLevel: 3, linhThachCost: 2_000, realmRequirement: 'truc_co' },
  { toLevel: 4, linhThachCost: 5_000, realmRequirement: 'truc_co' },
  { toLevel: 5, linhThachCost: 15_000, realmRequirement: 'kim_dan' },
  { toLevel: 6, linhThachCost: 40_000, realmRequirement: 'kim_dan' },
  { toLevel: 7, linhThachCost: 100_000, realmRequirement: 'hoa_than' },
  { toLevel: 8, linhThachCost: 300_000, realmRequirement: 'hoa_than' },
  { toLevel: 9, linhThachCost: 800_000, realmRequirement: 'do_kiep' },
];

/**
 * Lookup upgrade def để chuyển từ (toLevel - 1) lên `toLevel`.
 * @returns undefined nếu toLevel ngoài [2, 9].
 */
export function getAlchemyFurnaceUpgradeDef(
  toLevel: number
): AlchemyFurnaceUpgradeDef | undefined {
  return ALCHEMY_FURNACE_UPGRADES.find((u) => u.toLevel === toLevel);
}

/**
 * Tổng cost ingredient (qty) cho 1 attempt — flatten input list.
 */
export function getAlchemyIngredientTotal(recipe: AlchemyRecipeDef): number {
  return recipe.inputs.reduce((sum, ing) => sum + ing.qty, 0);
}

/**
 * Expected attempts ~ 1/successRate — dùng để estimate cost trung bình.
 */
export function getExpectedAlchemyAttempts(recipe: AlchemyRecipeDef): number {
  if (recipe.successRate <= 0) {
    throw new Error(`recipe ${recipe.key} has non-positive successRate`);
  }
  return 1 / recipe.successRate;
}

export interface AlchemyAttemptResult {
  /** Recipe được luyện */
  readonly recipeKey: string;
  /** Roll value đã sample (0..1) */
  readonly rollValue: number;
  /** Có thành công không */
  readonly success: boolean;
  /** Item output key (= recipe.outputItem nếu success, null nếu fail) */
  readonly outputItem: string | null;
  /** Số lượng output (= recipe.outputQty nếu success, 0 nếu fail) */
  readonly outputQty: number;
  /** LinhThach đã tốn (luôn bằng recipe.linhThachCost dù fail) */
  readonly linhThachConsumed: number;
  /** Input đã consume (luôn full input dù fail — intent balance) */
  readonly inputsConsumed: readonly AlchemyIngredient[];
}

/**
 * Simulate 1 attempt luyện đan deterministic.
 *
 * @param recipe Recipe def
 * @param rng Roll value [0..1) — server cung cấp seed deterministic, KHÔNG dùng Math.random()
 * @returns Kết quả attempt (success/fail, output, cost)
 *
 * Convention:
 * - Phase 11.X.B runtime sẽ dùng `seedrandom(attemptId)` để derive rng — replay-able.
 * - Input + linhThach LUÔN bị consume dù fail (balance: không cho free retry).
 * - Success khi `rng < successRate`.
 */
export function simulateAlchemyAttempt(
  recipe: AlchemyRecipeDef,
  rng: number
): AlchemyAttemptResult {
  if (!Number.isFinite(rng) || rng < 0 || rng >= 1) {
    throw new Error(`rng must be in [0, 1), got ${rng}`);
  }
  const success = rng < recipe.successRate;
  return {
    recipeKey: recipe.key,
    rollValue: rng,
    success,
    outputItem: success ? recipe.outputItem : null,
    outputQty: success ? recipe.outputQty : 0,
    linhThachConsumed: recipe.linhThachCost,
    inputsConsumed: recipe.inputs,
  };
}

/**
 * Bulk simulate N attempts với array RNG (deterministic). Trả tổng kết.
 *
 * @returns { successes, fails, totalLinhThach, totalInputs (flattened qty per item key), totalOutputs }
 */
export interface AlchemyBulkResult {
  readonly successes: number;
  readonly fails: number;
  readonly totalLinhThach: number;
  readonly totalInputsConsumed: ReadonlyMap<string, number>;
  readonly totalOutputsProduced: number;
}

export function simulateAlchemyBulk(
  recipe: AlchemyRecipeDef,
  rngArray: readonly number[]
): AlchemyBulkResult {
  if (rngArray.length === 0) {
    throw new Error('rngArray must have at least 1 element');
  }
  let successes = 0;
  let fails = 0;
  let totalLinhThach = 0;
  let totalOutputsProduced = 0;
  const totalInputsConsumed = new Map<string, number>();

  for (const rng of rngArray) {
    const result = simulateAlchemyAttempt(recipe, rng);
    if (result.success) {
      successes += 1;
      totalOutputsProduced += result.outputQty;
    } else {
      fails += 1;
    }
    totalLinhThach += result.linhThachConsumed;
    for (const ing of result.inputsConsumed) {
      totalInputsConsumed.set(
        ing.itemKey,
        (totalInputsConsumed.get(ing.itemKey) ?? 0) + ing.qty
      );
    }
  }

  return {
    successes,
    fails,
    totalLinhThach,
    totalInputsConsumed,
    totalOutputsProduced,
  };
}
