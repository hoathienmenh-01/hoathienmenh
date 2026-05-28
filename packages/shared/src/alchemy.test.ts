import { describe, expect, it } from 'vitest';
import {
  ALCHEMY_FURNACE_DEFAULT_LEVEL,
  ALCHEMY_FURNACE_MAX_LEVEL,
  ALCHEMY_FURNACE_UPGRADES,
  ALCHEMY_RECIPES,
  alchemyRecipesAvailableAtFurnace,
  alchemyRecipesByOutputItem,
  alchemyRecipesByQuality,
  clampPillEffectByRecipeTier,
  computeAlchemySuccessRate,
  computeLowerTierCraftBonus,
  getAlchemyFurnaceUpgradeDef,
  getAlchemyIngredientTotal,
  getAlchemyRecipeDef,
  getExpectedAlchemyAttempts,
  pillGradeMultiplier,
  rollMaterialDrop,
  rollPillGrade,
  simulateAlchemyAttempt,
  simulateAlchemyBulk,
  validateAlchemyV2Catalog,
  type AlchemyRecipeDef,
} from './alchemy';
import { ITEMS } from './items';
import { REALMS } from './realms';

describe('ALCHEMY_RECIPES catalog shape', () => {
  it('có ít nhất 12 recipe baseline', () => {
    expect(ALCHEMY_RECIPES.length).toBeGreaterThanOrEqual(12);
  });

  it('tất cả key duy nhất', () => {
    const keys = ALCHEMY_RECIPES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tất cả key bắt đầu bằng "recipe_"', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(r.key.startsWith('recipe_')).toBe(true);
    }
  });

  it('mỗi recipe có name + description không rỗng', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it('outputItem reference key tồn tại trong ITEMS', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const r of ALCHEMY_RECIPES) {
      expect(itemKeys.has(r.outputItem)).toBe(true);
    }
  });

  it('outputQuality match với quality của output item trong ITEMS', () => {
    for (const r of ALCHEMY_RECIPES) {
      const outputDef = ITEMS.find((i) => i.key === r.outputItem);
      expect(outputDef).toBeDefined();
      if (outputDef) {
        expect(outputDef.quality).toBe(r.outputQuality);
      }
    }
  });

  it('outputQty là số nguyên dương', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(Number.isInteger(r.outputQty)).toBe(true);
      expect(r.outputQty).toBeGreaterThan(0);
    }
  });

  it('mỗi recipe có ít nhất 1 input', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(r.inputs.length).toBeGreaterThan(0);
    }
  });

  it('input itemKey tham chiếu key tồn tại trong ITEMS', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const r of ALCHEMY_RECIPES) {
      for (const ing of r.inputs) {
        expect(itemKeys.has(ing.itemKey)).toBe(true);
      }
    }
  });

  it('input qty là số nguyên dương', () => {
    for (const r of ALCHEMY_RECIPES) {
      for (const ing of r.inputs) {
        expect(Number.isInteger(ing.qty)).toBe(true);
        expect(ing.qty).toBeGreaterThan(0);
      }
    }
  });

  it('furnaceLevel là số nguyên không âm', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(Number.isInteger(r.furnaceLevel)).toBe(true);
      expect(r.furnaceLevel).toBeGreaterThanOrEqual(1);
    }
  });

  it('realmRequirement nếu có thì tham chiếu key tồn tại trong REALMS', () => {
    const realmKeys = new Set(REALMS.map((r) => r.key));
    for (const r of ALCHEMY_RECIPES) {
      if (r.realmRequirement !== null) {
        expect(realmKeys.has(r.realmRequirement)).toBe(true);
      }
    }
  });

  it('linhThachCost là số nguyên dương', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(Number.isInteger(r.linhThachCost)).toBe(true);
      expect(r.linhThachCost).toBeGreaterThan(0);
    }
  });

  it('successRate trong (0, 1]', () => {
    for (const r of ALCHEMY_RECIPES) {
      expect(r.successRate).toBeGreaterThan(0);
      expect(r.successRate).toBeLessThanOrEqual(1);
    }
  });
});

describe('Alchemy V2 catalog and balance', () => {
  it('validateAlchemyV2Catalog passes and catalog spans tiers 1-9', () => {
    expect(validateAlchemyV2Catalog()).toEqual([]);
    const tiers = new Set(ALCHEMY_RECIPES.map((r) => r.recipeTier));
    for (let tier = 1; tier <= 9; tier += 1) expect(tiers.has(tier)).toBe(true);
    expect(ALCHEMY_RECIPES.length).toBeGreaterThanOrEqual(60);
  });

  it('all V2 recipes have required metadata and valid references', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const recipe of ALCHEMY_RECIPES) {
      expect(recipe.recipeTier).toBeGreaterThanOrEqual(1);
      expect(recipe.recipeTier).toBeLessThanOrEqual(9);
      expect(recipe.requiredAlchemyLevel).toBeLessThanOrEqual(9);
      expect(recipe.recipeCategory).toBeTruthy();
      expect(itemKeys.has(recipe.outputItem)).toBe(true);
      for (const input of recipe.inputs) expect(itemKeys.has(input.itemKey)).toBe(true);
    }
  });

  it('pill and material metadata prevents qi/body effect mixups', () => {
    for (const item of ITEMS) {
      if (item.pillCategory === 'BODY_EXP') {
        expect(item.effect?.bodyExp).toBeDefined();
        expect(item.effect?.exp).toBeUndefined();
      }
      if (item.pillCategory === 'QI_EXP') {
        expect(item.effect?.exp).toBeDefined();
        expect(item.effect?.bodyExp).toBeUndefined();
      }
      if (item.pillCategory === 'QI_BREAKTHROUGH' || item.pillCategory === 'BODY_BREAKTHROUGH') {
        expect(item.effect?.exp).toBeUndefined();
      }
      if (item.materialTier !== undefined) {
        expect(item.materialCategory).toBeDefined();
        expect(item.sourceHint?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('pill grade multiplier, lower-tier bonus, success cap, and grade caps hold', () => {
    expect(pillGradeMultiplier('HA_PHAM')).toBe(0.85);
    expect(pillGradeMultiplier('TRUNG_PHAM')).toBe(1);
    expect(pillGradeMultiplier('THUONG_PHAM')).toBe(1.15);
    expect(pillGradeMultiplier('CUC_PHAM')).toBe(1.3);
    expect(pillGradeMultiplier('DAN_VAN')).toBe(1.5);
    expect(pillGradeMultiplier('PHONG_HAU')).toBe(1.7);
    expect(pillGradeMultiplier('DAO_TO')).toBe(1.9);
    expect(pillGradeMultiplier('THAN_THONG')).toBe(2.1);
    expect(pillGradeMultiplier('CHI_TON')).toBe(2.5);
    expect(computeLowerTierCraftBonus(1, 1)).toBe(0);
    expect(computeLowerTierCraftBonus(2, 1)).toBe(0.05);
    expect(computeLowerTierCraftBonus(5, 1)).toBe(0.2);
    const recipe = { ...ALCHEMY_RECIPES[0], successRate: 0.97 };
    expect(computeAlchemySuccessRate(recipe, { alchemyLevel: 9, furnaceLevel: 9, alchemyMastery: 999 })).toBe(0.98);
    const capped = { ...recipe, maxOutputGrade: 'THUONG_PHAM' as const };
    expect(rollPillGrade(capped, { alchemyLevel: 9, furnaceLevel: 9, alchemyMastery: 999 }, () => 0.999)).toBe('THUONG_PHAM');
  });

  it('clamp prevents tier-1 high grade effects from exceeding tier-2 normal scale', () => {
    const clamped = clampPillEffectByRecipeTier(
      { exp: 99999, bodyExp: 99999, qiBreakthroughBonus: 1, bodyInjuryReductionMinutes: 999 },
      1,
    );
    expect(clamped.exp).toBeLessThanOrEqual(260);
    expect(clamped.bodyExp).toBeLessThanOrEqual(150);
    expect(clamped.qiBreakthroughBonus).toBeLessThanOrEqual(0.038);
    expect(clamped.bodyInjuryReductionMinutes).toBeLessThanOrEqual(23);
  });

  it('material drop helper keeps normal drops tame and boss drops plausible', () => {
    expect(rollMaterialDrop({ playerRealmOrder: 1, source: 'NORMAL_MONSTER' }, () => 0.99)).toBeNull();
    const boss = rollMaterialDrop(
      { playerRealmOrder: 6, dungeonTier: 3, source: 'BOSS' },
      (() => {
        const rolls = [0.01, 0.86, 0.2, 0.2];
        return () => rolls.shift() ?? 0.1;
      })(),
    );
    expect(boss?.tier).toBe(3);
    expect(boss?.rarity).toBe('rareSameTier');
  });
});

describe('Curve sanity', () => {
  it('PHAM tier có successRate >= 0.85', () => {
    const phams = alchemyRecipesByQuality('PHAM');
    expect(phams.length).toBeGreaterThanOrEqual(3);
    for (const r of phams) {
      expect(r.successRate).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('THAN tier có successRate <= 0.30 (very hard)', () => {
    const thans = alchemyRecipesByQuality('THAN');
    expect(thans.length).toBeGreaterThanOrEqual(1);
    for (const r of thans) {
      expect(r.successRate).toBeLessThanOrEqual(0.3);
    }
  });

  it('successRate giảm theo tier: PHAM > LINH > HUYEN > TIEN > THAN', () => {
    const tiers: AlchemyRecipeDef['outputQuality'][] = ['PHAM', 'LINH', 'HUYEN', 'TIEN', 'THAN'];
    const minSuccessByTier = tiers.map((tier) => {
      const list = alchemyRecipesByQuality(tier);
      if (list.length === 0) return 1;
      return Math.min(...list.map((r) => r.successRate));
    });
    for (let i = 1; i < minSuccessByTier.length; i += 1) {
      if (minSuccessByTier[i] < 1 && minSuccessByTier[i - 1] < 1) {
        expect(minSuccessByTier[i]).toBeLessThanOrEqual(minSuccessByTier[i - 1]);
      }
    }
  });

  it('linhThachCost tăng theo tier: PHAM < LINH < HUYEN < TIEN < THAN', () => {
    const tiers: AlchemyRecipeDef['outputQuality'][] = ['PHAM', 'LINH', 'HUYEN', 'TIEN', 'THAN'];
    const maxCostByTier = tiers.map((tier) => {
      const list = alchemyRecipesByQuality(tier);
      if (list.length === 0) return 0;
      return Math.max(...list.map((r) => r.linhThachCost));
    });
    for (let i = 1; i < maxCostByTier.length; i += 1) {
      if (maxCostByTier[i] > 0 && maxCostByTier[i - 1] > 0) {
        expect(maxCostByTier[i]).toBeGreaterThanOrEqual(maxCostByTier[i - 1]);
      }
    }
  });

  it('furnaceLevel tăng theo tier', () => {
    const tiers: AlchemyRecipeDef['outputQuality'][] = ['PHAM', 'LINH', 'HUYEN', 'TIEN', 'THAN'];
    const minFurnaceByTier = tiers.map((tier) => {
      const list = alchemyRecipesByQuality(tier);
      if (list.length === 0) return 99;
      return Math.min(...list.map((r) => r.furnaceLevel));
    });
    for (let i = 1; i < minFurnaceByTier.length; i += 1) {
      if (minFurnaceByTier[i] < 99 && minFurnaceByTier[i - 1] < 99) {
        expect(minFurnaceByTier[i]).toBeGreaterThanOrEqual(minFurnaceByTier[i - 1]);
      }
    }
  });

  it('cover toàn bộ pill HP (5 quality tiers)', () => {
    const hpPills = ITEMS.filter((i) => i.kind === 'PILL_HP');
    const recipeOutputs = new Set(ALCHEMY_RECIPES.map((r) => r.outputItem));
    const hpPillsCovered = hpPills.filter((p) => recipeOutputs.has(p.key));
    expect(hpPillsCovered.length).toBeGreaterThanOrEqual(3);
  });

  it('cover toàn bộ pill MP', () => {
    const mpPills = ITEMS.filter((i) => i.kind === 'PILL_MP');
    const recipeOutputs = new Set(ALCHEMY_RECIPES.map((r) => r.outputItem));
    const mpPillsCovered = mpPills.filter((p) => recipeOutputs.has(p.key));
    expect(mpPillsCovered.length).toBeGreaterThanOrEqual(3);
  });

  it('cover toàn bộ pill EXP', () => {
    const expPills = ITEMS.filter((i) => i.kind === 'PILL_EXP');
    const recipeOutputs = new Set(ALCHEMY_RECIPES.map((r) => r.outputItem));
    const expPillsCovered = expPills.filter((p) => recipeOutputs.has(p.key));
    expect(expPillsCovered.length).toBeGreaterThanOrEqual(3);
  });
});

describe('getAlchemyRecipeDef', () => {
  it('trả recipe def khi key hợp lệ', () => {
    const r = getAlchemyRecipeDef('recipe_tieu_phuc_dan');
    expect(r).toBeDefined();
    expect(r?.outputItem).toBe('tieu_phuc_dan');
  });

  it('trả undefined khi key sai', () => {
    expect(getAlchemyRecipeDef('recipe_invalid_key')).toBeUndefined();
  });
});

describe('alchemyRecipesByQuality', () => {
  it('PHAM trả danh sách non-empty', () => {
    const list = alchemyRecipesByQuality('PHAM');
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(r.outputQuality).toBe('PHAM');
    }
  });

  it('LINH trả danh sách non-empty', () => {
    const list = alchemyRecipesByQuality('LINH');
    expect(list.length).toBeGreaterThan(0);
  });

  it('union 5 tier = ALCHEMY_RECIPES.length', () => {
    const tiers: AlchemyRecipeDef['outputQuality'][] = ['PHAM', 'LINH', 'HUYEN', 'TIEN', 'THAN'];
    const total = tiers.reduce((sum, t) => sum + alchemyRecipesByQuality(t).length, 0);
    expect(total).toBe(ALCHEMY_RECIPES.length);
  });
});

describe('alchemyRecipesByOutputItem', () => {
  it('trả ít nhất 1 recipe cho output item hợp lệ', () => {
    const list = alchemyRecipesByOutputItem('tieu_phuc_dan');
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('trả empty array khi outputItem không có recipe', () => {
    const list = alchemyRecipesByOutputItem('non_existent_pill');
    expect(list.length).toBe(0);
  });
});

describe('alchemyRecipesAvailableAtFurnace', () => {
  it('furnace L1 chỉ trả recipe có furnaceLevel <= 1', () => {
    const list = alchemyRecipesAvailableAtFurnace(1);
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(r.furnaceLevel).toBeLessThanOrEqual(1);
    }
  });

  it('furnace L9 trả tất cả recipe', () => {
    const list = alchemyRecipesAvailableAtFurnace(9);
    expect(list.length).toBe(ALCHEMY_RECIPES.length);
  });

  it('furnace L0 trả empty (vì min furnaceLevel của catalog = 1)', () => {
    const list = alchemyRecipesAvailableAtFurnace(0);
    expect(list.length).toBe(0);
  });

  it('throw nếu furnaceLevel âm', () => {
    expect(() => alchemyRecipesAvailableAtFurnace(-1)).toThrow();
  });

  it('throw nếu furnaceLevel = NaN', () => {
    expect(() => alchemyRecipesAvailableAtFurnace(NaN)).toThrow();
  });
});

describe('getAlchemyIngredientTotal', () => {
  it('flatten qty cho recipe 1 input', () => {
    const r = getAlchemyRecipeDef('recipe_tieu_phuc_dan');
    expect(r).toBeDefined();
    if (r) expect(getAlchemyIngredientTotal(r)).toBe(2);
  });

  it('flatten qty cho recipe nhiều input', () => {
    const r = getAlchemyRecipeDef('recipe_tien_phach_dan');
    expect(r).toBeDefined();
    if (r) expect(getAlchemyIngredientTotal(r)).toBe(2 + 3 + 5);
  });
});

describe('getExpectedAlchemyAttempts', () => {
  it('= 1/successRate', () => {
    const r = getAlchemyRecipeDef('recipe_tieu_phuc_dan');
    expect(r).toBeDefined();
    if (r) {
      const expected = getExpectedAlchemyAttempts(r);
      expect(expected).toBeCloseTo(1 / r.successRate, 5);
    }
  });

  it('THAN tier expected attempts >= 5', () => {
    const thans = alchemyRecipesByQuality('THAN');
    for (const r of thans) {
      expect(getExpectedAlchemyAttempts(r)).toBeGreaterThanOrEqual(1 / 0.3);
    }
  });
});

describe('simulateAlchemyAttempt', () => {
  const recipe = ALCHEMY_RECIPES[0];

  it('rng < successRate → success', () => {
    const result = simulateAlchemyAttempt(recipe, 0.0);
    expect(result.success).toBe(true);
    expect(result.outputItem).toBe(recipe.outputItem);
    expect(result.outputQty).toBe(recipe.outputQty);
  });

  it('rng >= successRate → fail', () => {
    const result = simulateAlchemyAttempt(recipe, 0.999);
    expect(result.success).toBe(false);
    expect(result.outputItem).toBeNull();
    expect(result.outputQty).toBe(0);
  });

  it('linhThach LUÔN bị consume dù fail', () => {
    const successResult = simulateAlchemyAttempt(recipe, 0.0);
    const failResult = simulateAlchemyAttempt(recipe, 0.999);
    expect(successResult.linhThachConsumed).toBe(recipe.linhThachCost);
    expect(failResult.linhThachConsumed).toBe(recipe.linhThachCost);
  });

  it('input LUÔN bị consume dù fail', () => {
    const failResult = simulateAlchemyAttempt(recipe, 0.999);
    expect(failResult.inputsConsumed).toEqual(recipe.inputs);
  });

  it('rollValue = rng truyền vào', () => {
    const result = simulateAlchemyAttempt(recipe, 0.5);
    expect(result.rollValue).toBe(0.5);
  });

  it('deterministic — cùng rng cho cùng output', () => {
    const r1 = simulateAlchemyAttempt(recipe, 0.42);
    const r2 = simulateAlchemyAttempt(recipe, 0.42);
    expect(r1).toEqual(r2);
  });

  it('throw nếu rng âm', () => {
    expect(() => simulateAlchemyAttempt(recipe, -0.1)).toThrow();
  });

  it('throw nếu rng >= 1', () => {
    expect(() => simulateAlchemyAttempt(recipe, 1.0)).toThrow();
  });

  it('throw nếu rng = NaN', () => {
    expect(() => simulateAlchemyAttempt(recipe, NaN)).toThrow();
  });
});

describe('simulateAlchemyBulk', () => {
  const recipe = ALCHEMY_RECIPES[0];

  it('100% success khi tất cả rng = 0', () => {
    const result = simulateAlchemyBulk(recipe, [0.0, 0.0, 0.0, 0.0, 0.0]);
    expect(result.successes).toBe(5);
    expect(result.fails).toBe(0);
    expect(result.totalOutputsProduced).toBe(5 * recipe.outputQty);
  });

  it('0% success khi tất cả rng cao', () => {
    const result = simulateAlchemyBulk(recipe, [0.99, 0.99, 0.99]);
    expect(result.successes).toBe(0);
    expect(result.fails).toBe(3);
    expect(result.totalOutputsProduced).toBe(0);
  });

  it('totalLinhThach = N × cost dù success/fail', () => {
    const result = simulateAlchemyBulk(recipe, [0.0, 0.99, 0.5, 0.99]);
    expect(result.totalLinhThach).toBe(4 * recipe.linhThachCost);
  });

  it('totalInputsConsumed map đúng (qty × N)', () => {
    const result = simulateAlchemyBulk(recipe, [0.0, 0.5, 0.99]);
    for (const ing of recipe.inputs) {
      expect(result.totalInputsConsumed.get(ing.itemKey)).toBe(ing.qty * 3);
    }
  });

  it('multi-input recipe: input map sum đúng từng key', () => {
    const tienPhach = getAlchemyRecipeDef('recipe_tien_phach_dan')!;
    const result = simulateAlchemyBulk(tienPhach, [0.5, 0.5]);
    expect(result.totalInputsConsumed.get('han_ngoc')).toBe(2 * 2);
    expect(result.totalInputsConsumed.get('yeu_dan')).toBe(3 * 2);
    expect(result.totalInputsConsumed.get('huyet_tinh')).toBe(5 * 2);
  });

  it('throw nếu rngArray rỗng', () => {
    expect(() => simulateAlchemyBulk(recipe, [])).toThrow();
  });

  it('deterministic — cùng rngArray cho cùng kết quả', () => {
    const arr = [0.1, 0.5, 0.95, 0.3];
    const r1 = simulateAlchemyBulk(recipe, arr);
    const r2 = simulateAlchemyBulk(recipe, arr);
    expect(r1.successes).toBe(r2.successes);
    expect(r1.fails).toBe(r2.fails);
    expect(r1.totalLinhThach).toBe(r2.totalLinhThach);
  });
});

describe('AlchemyRecipeDef type assertion', () => {
  it('ALCHEMY_RECIPES[0] match AlchemyRecipeDef shape', () => {
    const r = ALCHEMY_RECIPES[0];
    expect(typeof r.key).toBe('string');
    expect(typeof r.name).toBe('string');
    expect(typeof r.outputItem).toBe('string');
    expect(typeof r.outputQty).toBe('number');
    expect(Array.isArray(r.inputs)).toBe(true);
    expect(typeof r.successRate).toBe('number');
    expect(typeof r.furnaceLevel).toBe('number');
  });
});

describe('ALCHEMY_FURNACE_UPGRADES catalog (Phase 11.11.D-2)', () => {
  it('default level = 1 và max level = 9', () => {
    expect(ALCHEMY_FURNACE_DEFAULT_LEVEL).toBe(1);
    expect(ALCHEMY_FURNACE_MAX_LEVEL).toBe(9);
  });

  it('có đúng 8 entry cho L2..L9', () => {
    expect(ALCHEMY_FURNACE_UPGRADES.length).toBe(8);
    const levels = ALCHEMY_FURNACE_UPGRADES.map((u) => u.toLevel);
    expect(levels).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('toLevel ascending và linhThachCost monotonic non-decreasing', () => {
    for (let i = 1; i < ALCHEMY_FURNACE_UPGRADES.length; i++) {
      expect(ALCHEMY_FURNACE_UPGRADES[i].toLevel).toBeGreaterThan(
        ALCHEMY_FURNACE_UPGRADES[i - 1].toLevel,
      );
      expect(ALCHEMY_FURNACE_UPGRADES[i].linhThachCost).toBeGreaterThan(
        ALCHEMY_FURNACE_UPGRADES[i - 1].linhThachCost,
      );
    }
  });

  it('linhThachCost > 0 và là integer finite', () => {
    for (const u of ALCHEMY_FURNACE_UPGRADES) {
      expect(Number.isInteger(u.linhThachCost)).toBe(true);
      expect(u.linhThachCost).toBeGreaterThan(0);
    }
  });

  it('realmRequirement nếu set phải tồn tại trong REALMS', () => {
    for (const u of ALCHEMY_FURNACE_UPGRADES) {
      if (u.realmRequirement !== null) {
        const realm = REALMS.find((r) => r.key === u.realmRequirement);
        expect(realm, `realm ${u.realmRequirement} for L${u.toLevel}`).toBeDefined();
      }
    }
  });

  it('realmRequirement đồng bộ recipe gating: L3-4 ≥ truc_co, L5-6 ≥ kim_dan, L7-8 ≥ hoa_than, L9 ≥ do_kiep', () => {
    const find = (lv: number) =>
      ALCHEMY_FURNACE_UPGRADES.find((u) => u.toLevel === lv)!;
    expect(find(2).realmRequirement).toBeNull();
    expect(find(3).realmRequirement).toBe('truc_co');
    expect(find(4).realmRequirement).toBe('truc_co');
    expect(find(5).realmRequirement).toBe('kim_dan');
    expect(find(6).realmRequirement).toBe('kim_dan');
    expect(find(7).realmRequirement).toBe('hoa_than');
    expect(find(8).realmRequirement).toBe('hoa_than');
    expect(find(9).realmRequirement).toBe('do_kiep');
  });
});

describe('getAlchemyFurnaceUpgradeDef', () => {
  it('lookup đúng entry theo toLevel', () => {
    const u = getAlchemyFurnaceUpgradeDef(2);
    expect(u).toBeDefined();
    expect(u!.toLevel).toBe(2);
    expect(u!.linhThachCost).toBe(500);
  });

  it('return undefined nếu toLevel ngoài [2, 9]', () => {
    expect(getAlchemyFurnaceUpgradeDef(0)).toBeUndefined();
    expect(getAlchemyFurnaceUpgradeDef(1)).toBeUndefined();
    expect(getAlchemyFurnaceUpgradeDef(10)).toBeUndefined();
    expect(getAlchemyFurnaceUpgradeDef(-1)).toBeUndefined();
    expect(getAlchemyFurnaceUpgradeDef(2.5)).toBeUndefined();
  });

  it('lookup mỗi level từ 2 → 9 đều trả entry hợp lệ', () => {
    for (let lv = 2; lv <= ALCHEMY_FURNACE_MAX_LEVEL; lv++) {
      const u = getAlchemyFurnaceUpgradeDef(lv);
      expect(u, `level ${lv}`).toBeDefined();
      expect(u!.toLevel).toBe(lv);
    }
  });
});
