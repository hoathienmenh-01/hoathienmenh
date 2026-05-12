import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/alchemy', () => ({
  getAlchemyRecipes: vi.fn(),
  craftAlchemyRecipe: vi.fn(),
  upgradeAlchemyFurnace: vi.fn(),
}));

import * as api from '@/api/alchemy';
import { useAlchemyStore } from '@/stores/alchemy';

const mockedGet = vi.mocked(api.getAlchemyRecipes);
const mockedCraft = vi.mocked(api.craftAlchemyRecipe);
const mockedUpgrade = vi.mocked(api.upgradeAlchemyFurnace);

const STUB_RECIPE: api.AlchemyRecipeView = {
  key: 'recipe_tieu_phuc_dan',
  name: 'Tiểu Phục Đan',
  description: 'Đan dược nhập môn',
  outputItem: 'tieu_phuc_dan',
  outputQty: 1,
  outputQuality: 'PHAM',
  recipeTier: 1,
  recipeCategory: 'HEAL_HP',
  requiredAlchemyLevel: 1,
  inputs: [{ itemKey: 'linh_thao_pham', qty: 3 }],
  furnaceLevel: 1,
  realmRequirement: null,
  linhThachCost: 50,
  successRate: 0.8,
  successRateBase: 0.8,
  successRateFinal: 0.8,
  possibleGrades: ['HA_PHAM', 'TRUNG_PHAM'],
  missingInputs: [],
  canCraft: true,
  failureReason: null,
};

describe('useAlchemyStore — Phase 11.11.D', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: furnaceLevel=1, recipes empty, not loaded, no inFlight, lastOutcome null, nextUpgrade null', () => {
    const s = useAlchemyStore();
    expect(s.furnaceLevel).toBe(1);
    expect(s.recipes).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.inFlight.size).toBe(0);
    expect(s.lastOutcome).toBeNull();
    expect(s.nextUpgrade).toBeNull();
    expect(s.upgradeInFlight).toBe(false);
    expect(s.lastUpgradeOutcome).toBeNull();
  });

  it('fetchState: hydrate furnaceLevel + recipes + nextUpgrade + loaded=true', async () => {
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 2,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [STUB_RECIPE],
      nextUpgrade: {
        toLevel: 3,
        linhThachCost: 2_000,
        realmRequirement: 'truc_co',
      },
    });
    const s = useAlchemyStore();
    await s.fetchState();
    expect(s.furnaceLevel).toBe(2);
    expect(s.recipes).toHaveLength(1);
    expect(s.recipes[0].key).toBe('recipe_tieu_phuc_dan');
    expect(s.loaded).toBe(true);
    expect(s.nextUpgrade?.toLevel).toBe(3);
    expect(s.nextUpgrade?.linhThachCost).toBe(2_000);
  });

  it('fetchState: nextUpgrade=null khi furnace ở MAX_LEVEL', async () => {
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 9,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [STUB_RECIPE],
      nextUpgrade: null,
    });
    const s = useAlchemyStore();
    await s.fetchState();
    expect(s.furnaceLevel).toBe(9);
    expect(s.nextUpgrade).toBeNull();
  });

  it('upgradeFurnace happy path: bump furnaceLevel + nextUpgrade refresh + lastUpgradeOutcome', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 1,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: {
        toLevel: 2,
        linhThachCost: 500,
        realmRequirement: null,
      },
    });
    await s.fetchState();
    mockedUpgrade.mockResolvedValueOnce({
      furnaceLevel: 2,
      outcome: { fromLevel: 1, toLevel: 2, linhThachConsumed: 500 },
      nextUpgrade: {
        toLevel: 3,
        linhThachCost: 2_000,
        realmRequirement: 'truc_co',
      },
    });
    const err = await s.upgradeFurnace();
    expect(err).toBeNull();
    expect(s.furnaceLevel).toBe(2);
    expect(s.nextUpgrade?.toLevel).toBe(3);
    expect(s.lastUpgradeOutcome).toEqual({
      fromLevel: 1,
      toLevel: 2,
      linhThachConsumed: 500,
    });
    expect(s.upgradeInFlight).toBe(false);
  });

  it('upgradeFurnace: pre-check MAX_LEVEL (nextUpgrade=null) → return MAX_LEVEL, không gọi API', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 9,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: null,
    });
    await s.fetchState();
    const err = await s.upgradeFurnace();
    expect(err).toBe('MAX_LEVEL');
    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('upgradeFurnace: server error code (INSUFFICIENT_FUNDS) → trả code, không update outcome', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 1,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: { toLevel: 2, linhThachCost: 500, realmRequirement: null },
    });
    await s.fetchState();
    mockedUpgrade.mockRejectedValueOnce({ code: 'INSUFFICIENT_FUNDS' });
    const err = await s.upgradeFurnace();
    expect(err).toBe('INSUFFICIENT_FUNDS');
    expect(s.lastUpgradeOutcome).toBeNull();
    expect(s.furnaceLevel).toBe(1);
    expect(s.upgradeInFlight).toBe(false);
  });

  it('upgradeFurnace: nested error.code (axios envelope) → extract đúng', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 1,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: { toLevel: 2, linhThachCost: 500, realmRequirement: null },
    });
    await s.fetchState();
    mockedUpgrade.mockRejectedValueOnce({
      error: { code: 'REALM_REQUIREMENT_NOT_MET', message: 'low realm' },
    });
    const err = await s.upgradeFurnace();
    expect(err).toBe('REALM_REQUIREMENT_NOT_MET');
  });

  it('upgradeFurnace: unknown error → trả "UNKNOWN"', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 1,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: { toLevel: 2, linhThachCost: 500, realmRequirement: null },
    });
    await s.fetchState();
    mockedUpgrade.mockRejectedValueOnce(new Error('boom'));
    const err = await s.upgradeFurnace();
    expect(err).toBe('UNKNOWN');
  });

  it('upgradeFurnace double-call → second returns IN_FLIGHT (race protect)', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 1,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: { toLevel: 2, linhThachCost: 500, realmRequirement: null },
    });
    await s.fetchState();
    let resolveFn!: (v: api.AlchemyUpgradeResult) => void;
    mockedUpgrade.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p1 = s.upgradeFurnace();
    expect(s.upgradeInFlight).toBe(true);
    const r2 = await s.upgradeFurnace();
    expect(r2).toBe('IN_FLIGHT');
    resolveFn({
      furnaceLevel: 2,
      outcome: { fromLevel: 1, toLevel: 2, linhThachConsumed: 500 },
      nextUpgrade: { toLevel: 3, linhThachCost: 2_000, realmRequirement: 'truc_co' },
    });
    await p1;
    expect(s.upgradeInFlight).toBe(false);
  });

  it('upgradeFurnace: max level reached (response nextUpgrade=null) → store nextUpgrade=null', async () => {
    const s = useAlchemyStore();
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 8,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [],
      nextUpgrade: { toLevel: 9, linhThachCost: 800_000, realmRequirement: 'do_kiep' },
    });
    await s.fetchState();
    mockedUpgrade.mockResolvedValueOnce({
      furnaceLevel: 9,
      outcome: { fromLevel: 8, toLevel: 9, linhThachConsumed: 800_000 },
      nextUpgrade: null,
    });
    const err = await s.upgradeFurnace();
    expect(err).toBeNull();
    expect(s.furnaceLevel).toBe(9);
    expect(s.nextUpgrade).toBeNull();
  });

  it('craft success outcome: cập nhật furnaceLevel + lastOutcome.success=true', async () => {
    const s = useAlchemyStore();
    mockedCraft.mockResolvedValueOnce({
      furnaceLevel: 1,
      outcome: {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.42,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        pillGrade: 'TRUNG_PHAM',
        successRate: 0.8,
        alchemyExpGained: '40',
        alchemyLevelBefore: 1,
        alchemyLevelAfter: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      },
    });
    const err = await s.craft('recipe_tieu_phuc_dan');
    expect(err).toBeNull();
    expect(s.lastOutcome?.success).toBe(true);
    expect(s.lastOutcome?.outputQty).toBe(1);
    expect(s.furnaceLevel).toBe(1);
    expect(s.inFlight.has('recipe_tieu_phuc_dan')).toBe(false);
  });

  it('craft fail outcome (server roll fail): vẫn return null, lastOutcome.success=false', async () => {
    const s = useAlchemyStore();
    mockedCraft.mockResolvedValueOnce({
      furnaceLevel: 1,
      outcome: {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: false,
        rollValue: 0.95,
        outputItem: null,
        outputQty: 0,
        pillGrade: null,
        successRate: 0.8,
        alchemyExpGained: '8',
        alchemyLevelBefore: 1,
        alchemyLevelAfter: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      },
    });
    const err = await s.craft('recipe_tieu_phuc_dan');
    expect(err).toBeNull();
    expect(s.lastOutcome?.success).toBe(false);
    expect(s.lastOutcome?.outputQty).toBe(0);
  });

  it('craft server error code: trả code, không update lastOutcome', async () => {
    const s = useAlchemyStore();
    mockedCraft.mockRejectedValueOnce({ code: 'INSUFFICIENT_INGREDIENTS' });
    const err = await s.craft('recipe_tieu_phuc_dan');
    expect(err).toBe('INSUFFICIENT_INGREDIENTS');
    expect(s.lastOutcome).toBeNull();
    expect(s.inFlight.has('recipe_tieu_phuc_dan')).toBe(false);
  });

  it('craft nested error.code: extract đúng (axios envelope shape)', async () => {
    const s = useAlchemyStore();
    mockedCraft.mockRejectedValueOnce({
      error: { code: 'FURNACE_LEVEL_TOO_LOW', message: 'low' },
    });
    const err = await s.craft('recipe_tieu_phuc_dan');
    expect(err).toBe('FURNACE_LEVEL_TOO_LOW');
  });

  it('craft unknown error: trả "UNKNOWN"', async () => {
    const s = useAlchemyStore();
    mockedCraft.mockRejectedValueOnce(new Error('boom'));
    const err = await s.craft('recipe_tieu_phuc_dan');
    expect(err).toBe('UNKNOWN');
  });

  it('craft double-call same key → second returns IN_FLIGHT (race protect)', async () => {
    const s = useAlchemyStore();
    let resolveFn!: (v: api.AlchemyCraftResult) => void;
    mockedCraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p1 = s.craft('recipe_tieu_phuc_dan');
    const r2 = await s.craft('recipe_tieu_phuc_dan');
    expect(r2).toBe('IN_FLIGHT');
    resolveFn({
      furnaceLevel: 1,
      outcome: {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.5,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        pillGrade: 'TRUNG_PHAM',
        successRate: 0.8,
        alchemyExpGained: '40',
        alchemyLevelBefore: 1,
        alchemyLevelAfter: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      },
    });
    await p1;
  });

  it('isCrafting reflect inFlight set during pending craft', async () => {
    const s = useAlchemyStore();
    let resolveFn!: (v: api.AlchemyCraftResult) => void;
    mockedCraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p = s.craft('recipe_tieu_phuc_dan');
    expect(s.isCrafting('recipe_tieu_phuc_dan')).toBe(true);
    expect(s.isCrafting('other_recipe')).toBe(false);
    resolveFn({
      furnaceLevel: 1,
      outcome: {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.5,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        pillGrade: 'TRUNG_PHAM',
        successRate: 0.8,
        alchemyExpGained: '40',
        alchemyLevelBefore: 1,
        alchemyLevelAfter: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      },
    });
    await p;
    expect(s.isCrafting('recipe_tieu_phuc_dan')).toBe(false);
  });

  it('reset: xoá furnaceLevel back to 1 + recipes empty + loaded=false + lastOutcome null + nextUpgrade null', async () => {
    mockedGet.mockResolvedValueOnce({
      furnaceLevel: 3,
      alchemyLevel: 1,
      alchemyLevelName: 'Đan Sư Nhập Môn',
      alchemyExp: '0',
      alchemyExpNext: '120',
      alchemyMastery: 0,
      recipes: [STUB_RECIPE],
      nextUpgrade: { toLevel: 4, linhThachCost: 5_000, realmRequirement: 'truc_co' },
    });
    const s = useAlchemyStore();
    await s.fetchState();
    mockedCraft.mockResolvedValueOnce({
      furnaceLevel: 3,
      outcome: {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.42,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        pillGrade: 'TRUNG_PHAM',
        successRate: 0.8,
        alchemyExpGained: '40',
        alchemyLevelBefore: 1,
        alchemyLevelAfter: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      },
    });
    await s.craft('recipe_tieu_phuc_dan');
    expect(s.loaded).toBe(true);
    expect(s.lastOutcome).not.toBeNull();
    s.reset();
    expect(s.furnaceLevel).toBe(1);
    expect(s.recipes).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.lastOutcome).toBeNull();
    expect(s.nextUpgrade).toBeNull();
    expect(s.upgradeInFlight).toBe(false);
    expect(s.lastUpgradeOutcome).toBeNull();
  });
});
