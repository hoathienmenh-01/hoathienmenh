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
  /** Số lượng pill output mỗi lần luyện thành */
  readonly outputQty: number;
  /** Tier output (PHAM..THAN), giúp filter UI */
  readonly outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  /** Danh sách nguyên liệu input + qty */
  readonly inputs: readonly AlchemyIngredient[];
  /** Cấp lò đan tối thiểu để dùng được recipe này */
  readonly furnaceLevel: number;
  /** Realm key tối thiểu để học (optional) */
  readonly realmRequirement: string | null;
  /** LinhThach cost cho 1 lần thử (ngay cả khi fail) */
  readonly linhThachCost: number;
  /** Tỉ lệ thành công cơ bản (0..1). Phase 11.X.B sẽ wire bonus từ alchemyMastery */
  readonly successRate: number;
}

/**
 * 13 recipe baseline cover toàn bộ pill HP/MP/EXP từ PHAM đến THAN.
 *
 * Stable order: PHAM → LINH → HUYEN → TIEN → THAN.
 */
export const ALCHEMY_RECIPES: readonly AlchemyRecipeDef[] = [
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
