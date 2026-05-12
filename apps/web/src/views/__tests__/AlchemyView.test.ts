import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11.11.D — AlchemyView test suite.
 *
 * Bao phủ:
 *  - Loading state khi store chưa loaded.
 *  - Render đầy đủ recipes từ store sau khi loaded.
 *  - Filter theo quality (PHAM/LINH/HUYEN/TIEN/THAN).
 *  - Empty state khi filter không khớp.
 *  - Furnace level header text reflect store.furnaceLevel.
 *  - Click craft → store.craft called.
 *  - Toast success khi outcome.success=true.
 *  - Toast warning khi outcome.success=false (fail outcome).
 *  - Toast error khi server reject (errCode).
 *  - Craft button disabled khi inFlight.
 */

const replaceMock = vi.fn();
const craftMock = vi.fn();
const upgradeFurnaceMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const gameFetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

interface AlchemyOutcomeStub {
  recipeKey: string;
  success: boolean;
  rollValue: number;
  outputItem: string | null;
  outputQty: number;
  linhThachConsumed: number;
  inputsConsumed: { itemKey: string; qty: number }[];
}

interface AlchemyMissingInputStub {
  itemKey: string;
  requiredQty: number;
  ownedQty: number;
  itemName?: string;
  materialTier?: number;
  materialCategory?: string;
  sourceHint?: string[];
}

interface AlchemyRecipeStub {
  key: string;
  name: string;
  description: string;
  outputItem: string;
  outputQty: number;
  outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  inputs: { itemKey: string; qty: number }[];
  furnaceLevel: number;
  realmRequirement: string | null;
  linhThachCost: number;
  successRate: number;
  /** Phase 26.2 — recipe card source hint surfacing. */
  missingInputs?: AlchemyMissingInputStub[];
}

const STUB_RECIPES: AlchemyRecipeStub[] = [
  {
    key: 'recipe_tieu_phuc_dan',
    name: 'Tiểu Phục Đan',
    description: 'Đan dược nhập môn',
    outputItem: 'tieu_phuc_dan',
    outputQty: 1,
    outputQuality: 'PHAM',
    inputs: [{ itemKey: 'linh_thao_pham', qty: 3 }],
    furnaceLevel: 1,
    realmRequirement: null,
    linhThachCost: 50,
    successRate: 0.8,
  },
  {
    key: 'recipe_linh_dan',
    name: 'Linh Đan',
    description: 'Linh phẩm trung cấp',
    outputItem: 'linh_dan',
    outputQty: 1,
    outputQuality: 'LINH',
    inputs: [{ itemKey: 'linh_thao_linh', qty: 5 }],
    furnaceLevel: 2,
    realmRequirement: 'truc_co',
    linhThachCost: 200,
    successRate: 0.6,
  },
];

interface AlchemyUpgradePreviewStub {
  toLevel: number;
  linhThachCost: number;
  realmRequirement: string | null;
}

interface AlchemyUpgradeOutcomeStub {
  fromLevel: number;
  toLevel: number;
  linhThachConsumed: number;
}

interface AlchemyStoreStub {
  furnaceLevel: number;
  recipes: AlchemyRecipeStub[];
  loaded: boolean;
  inFlight: Set<string>;
  lastOutcome: AlchemyOutcomeStub | null;
  nextUpgrade: AlchemyUpgradePreviewStub | null;
  upgradeInFlight: boolean;
  lastUpgradeOutcome: AlchemyUpgradeOutcomeStub | null;
  fetchState: typeof fetchStateMock;
  craft: typeof craftMock;
  upgradeFurnace: typeof upgradeFurnaceMock;
  isCrafting: (k: string) => boolean;
  reset: () => void;
}

const alchemyState: AlchemyStoreStub = {
  furnaceLevel: 1,
  recipes: STUB_RECIPES,
  loaded: true,
  inFlight: new Set<string>(),
  lastOutcome: null,
  nextUpgrade: null,
  upgradeInFlight: false,
  lastUpgradeOutcome: null,
  fetchState: fetchStateMock,
  craft: craftMock,
  upgradeFurnace: upgradeFurnaceMock,
  isCrafting: (k: string) => alchemyState.inFlight.has(k),
  reset: vi.fn(),
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: gameFetchStateMock,
    bindSocket: vi.fn(),
    character: { realmKey: 'truc_co' },
  }),
}));
vi.mock('@/stores/alchemy', () => ({
  useAlchemyStore: () => alchemyState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import AlchemyView from '@/views/AlchemyView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      alchemy: {
        title: 'Luyện Đan',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        furnaceLevel: 'Lò cấp {level}',
        furnaceReq: 'Cần lò {level}',
        filter: {
          quality: 'Phẩm',
          all: 'Tất cả',
          shown: 'Hiển thị {shown}/{total}',
        },
        quality: {
          PHAM: 'Phàm',
          LINH: 'Linh',
          HUYEN: 'Huyền',
          TIEN: 'Tiên',
          THAN: 'Thần',
        },
        field: {
          output: 'Output',
          inputs: 'Inputs',
          cost: 'Cost',
          linhThach: 'LT',
          successRate: 'Rate',
          missingInputs: 'Thiếu',
          sourceHint: 'Nguồn',
          dropFrom: 'Rơi từ',
        },
        materialCategory: {
          ALCHEMY_QI: 'Luyện Khí',
          ALCHEMY_BODY: 'Luyện Thể',
          QI_BREAKTHROUGH: 'Đột phá Khí',
          BODY_BREAKTHROUGH: 'Đột phá Thể',
          TRIBULATION: 'Độ kiếp',
          COMBAT_BUFF: 'Chiến đấu',
          EQUIPMENT_CRAFT: 'Trang bị',
          ARTIFACT_CRAFT: 'Pháp bảo',
          FURNACE_UPGRADE: 'Nâng lò',
          GENERAL: 'Phổ thông',
        },
        sourceHint: {
          NORMAL_MONSTER: 'Quái thường',
          ELITE: 'Tinh anh',
          BOSS: 'Boss',
          WORLD_BOSS: 'World Boss',
          DUNGEON: 'Bí cảnh',
          BODY_DUNGEON: 'Bí cảnh Luyện Thể',
          ALCHEMY_DUNGEON: 'Bí cảnh Luyện Khí',
          QUEST: 'Nhiệm vụ',
          EVENT: 'Sự kiện',
          MAIN_QUEST: 'Nhiệm vụ chính',
          DAILY_QUEST: 'Nhiệm vụ ngày',
          SECT_SHOP: 'Tông môn shop',
          NPC_SHOP: 'NPC shop',
          MARKET: 'Chợ',
          AUCTION: 'Đấu giá',
          ADMIN_ONLY: 'Quản trị',
        },
        button: {
          craft: 'Luyện',
          crafting: 'Đang luyện',
        },
        craft: {
          success: 'Luyện {name} × {qty}',
          fail: 'Thất bại {name}',
          errors: {
            INSUFFICIENT_INGREDIENTS: 'Thiếu nguyên liệu',
            FURNACE_LEVEL_TOO_LOW: 'Lò thấp',
            UNKNOWN: 'Lỗi',
          },
        },
        upgrade: {
          title: 'Nâng cấp lò',
          maxNotice: 'Lò tối đa',
          realmReq: 'Cảnh: {realm}',
          success: 'Lò {fromLevel} -> {toLevel}',
          button: {
            upgrade: 'Lên L{level}',
            upgrading: 'Đang nâng',
            maxLevel: 'Tối đa',
          },
          errors: {
            INSUFFICIENT_FUNDS: 'Thiếu LT',
            REALM_REQUIREMENT_NOT_MET: 'Cảnh chưa đủ',
            FURNACE_LEVEL_MAX: 'Mức tối đa',
            UNKNOWN: 'Lỗi nâng',
          },
        },
      },
    },
  },
});

function mountView() {
  return mount(AlchemyView, { global: { plugins: [i18n] } });
}

function resetState() {
  alchemyState.furnaceLevel = 1;
  alchemyState.recipes = STUB_RECIPES;
  alchemyState.loaded = true;
  alchemyState.inFlight = new Set();
  alchemyState.lastOutcome = null;
  alchemyState.nextUpgrade = null;
  alchemyState.upgradeInFlight = false;
  alchemyState.lastUpgradeOutcome = null;
  craftMock.mockReset();
  upgradeFurnaceMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  gameFetchStateMock.mockReset();
  gameFetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('AlchemyView — render & loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị loading khi store.loaded=false', async () => {
    alchemyState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="alchemy-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="alchemy-list"]').exists()).toBe(false);
  });

  it('render đủ recipes sau khi loaded', async () => {
    const w = mountView();
    await flushPromises();
    const cards = w.findAll('[data-testid^="alchemy-card-"]');
    expect(cards).toHaveLength(STUB_RECIPES.length);
  });

  it('hiển thị furnace level từ store', async () => {
    alchemyState.furnaceLevel = 3;
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="alchemy-furnace-level"]').text();
    expect(txt).toContain('3');
  });

  it('result count text reflect filtered/total', async () => {
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="alchemy-result-count"]').text();
    expect(txt).toContain(`${STUB_RECIPES.length}/${STUB_RECIPES.length}`);
  });
});

describe('AlchemyView — filter quality', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter quality=PHAM → chỉ render recipe PHAM', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="alchemy-filter-quality"]').setValue('PHAM');
    await flushPromises();
    const cards = w.findAll('[data-testid^="alchemy-card-"]');
    const phamCount = STUB_RECIPES.filter((r) => r.outputQuality === 'PHAM')
      .length;
    expect(cards).toHaveLength(phamCount);
    expect(w.find('[data-testid="alchemy-card-recipe_tieu_phuc_dan"]').exists())
      .toBe(true);
    expect(w.find('[data-testid="alchemy-card-recipe_linh_dan"]').exists())
      .toBe(false);
  });

  it('filter quality=THAN với store stub không có THAN → empty state', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="alchemy-filter-quality"]').setValue('THAN');
    await flushPromises();
    expect(w.find('[data-testid="alchemy-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="alchemy-list"]').exists()).toBe(false);
  });

  it('filter quality=all → render đủ', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="alchemy-filter-quality"]').setValue('PHAM');
    await flushPromises();
    await w.find('[data-testid="alchemy-filter-quality"]').setValue('all');
    await flushPromises();
    const cards = w.findAll('[data-testid^="alchemy-card-"]');
    expect(cards).toHaveLength(STUB_RECIPES.length);
  });
});

describe('AlchemyView — recipe card content', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị output item + qty', async () => {
    const w = mountView();
    await flushPromises();
    const out = w.find('[data-testid="alchemy-output-recipe_tieu_phuc_dan"]')
      .text();
    expect(out).toContain('tieu_phuc_dan');
    expect(out).toContain('1');
  });

  it('hiển thị inputs list', async () => {
    const w = mountView();
    await flushPromises();
    const ins = w.find('[data-testid="alchemy-inputs-recipe_tieu_phuc_dan"]')
      .text();
    expect(ins).toContain('linh_thao_pham');
    expect(ins).toContain('3');
  });

  it('hiển thị cost (linh thạch) + success rate %', async () => {
    const w = mountView();
    await flushPromises();
    const cost = w
      .find('[data-testid="alchemy-cost-recipe_tieu_phuc_dan"]')
      .text();
    expect(cost).toContain('50');
    const rate = w
      .find('[data-testid="alchemy-rate-recipe_tieu_phuc_dan"]')
      .text();
    expect(rate).toContain('80');
  });

  it('hiển thị furnace requirement badge', async () => {
    const w = mountView();
    await flushPromises();
    const badge = w
      .find('[data-testid="alchemy-furnace-recipe_linh_dan"]')
      .text();
    expect(badge).toContain('2');
  });
});

describe('AlchemyView — craft button & toast', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('click Luyện → gọi store.craft', async () => {
    craftMock.mockImplementationOnce(async () => {
      alchemyState.lastOutcome = {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.4,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      };
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]')
      .trigger('click');
    await flushPromises();
    expect(craftMock).toHaveBeenCalledWith('recipe_tieu_phuc_dan');
  });

  it('craft success outcome → toast success', async () => {
    craftMock.mockImplementationOnce(async () => {
      alchemyState.lastOutcome = {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: true,
        rollValue: 0.4,
        outputItem: 'tieu_phuc_dan',
        outputQty: 1,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      };
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: expect.stringContaining('Tiểu Phục Đan'),
      }),
    );
  });

  it('craft fail outcome (RNG fail) → toast warning', async () => {
    craftMock.mockImplementationOnce(async () => {
      alchemyState.lastOutcome = {
        recipeKey: 'recipe_tieu_phuc_dan',
        success: false,
        rollValue: 0.95,
        outputItem: null,
        outputQty: 0,
        linhThachConsumed: 50,
        inputsConsumed: [{ itemKey: 'linh_thao_pham', qty: 3 }],
      };
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        text: expect.stringContaining('Thất bại'),
      }),
    );
  });

  it('craft server error → toast error với i18n key đúng', async () => {
    craftMock.mockResolvedValueOnce('INSUFFICIENT_INGREDIENTS');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: 'Thiếu nguyên liệu',
      }),
    );
  });

  it('craft unknown error code → toast error fallback UNKNOWN', async () => {
    craftMock.mockResolvedValueOnce('SOME_NEW_CODE');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: 'Lỗi',
      }),
    );
  });

  it('craft button disabled khi inFlight', async () => {
    alchemyState.inFlight = new Set(['recipe_tieu_phuc_dan']);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="alchemy-craft-recipe_tieu_phuc_dan"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toBe('Đang luyện');
  });
});

describe('AlchemyView — Phase 11.11.D-3 furnace upgrade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('upgrade section hiện preview khi nextUpgrade != null', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="alchemy-furnace-upgrade"]').exists()).toBe(true);
    const preview = w.find('[data-testid="alchemy-upgrade-preview"]').text();
    expect(preview).toContain('2');
    expect(preview).toContain('500');
    const btn = w.find('[data-testid="alchemy-upgrade-btn"]');
    expect(btn.attributes('disabled')).toBeUndefined();
    expect(btn.text()).toBe('Lên L2');
  });

  it('nextUpgrade=null → max notice + button disabled', async () => {
    alchemyState.nextUpgrade = null;
    alchemyState.furnaceLevel = 9;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="alchemy-upgrade-max"]').exists()).toBe(true);
    expect(w.find('[data-testid="alchemy-upgrade-preview"]').exists()).toBe(false);
    const btn = w.find('[data-testid="alchemy-upgrade-btn"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toBe('Tối đa');
  });

  it('upgradeInFlight=true → button disabled + label Đang nâng', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    };
    alchemyState.upgradeInFlight = true;
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="alchemy-upgrade-btn"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toBe('Đang nâng');
  });

  it('click upgrade success → toast success + refetch state', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    };
    upgradeFurnaceMock.mockImplementationOnce(async () => {
      alchemyState.lastUpgradeOutcome = {
        fromLevel: 1,
        toLevel: 2,
        linhThachConsumed: 500,
      };
      return null;
    });
    const w = mountView();
    await flushPromises();
    fetchStateMock.mockClear();
    gameFetchStateMock.mockClear();
    await w.find('[data-testid="alchemy-upgrade-btn"]').trigger('click');
    await flushPromises();
    expect(upgradeFurnaceMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: 'Lò 1 -> 2',
      }),
    );
    expect(fetchStateMock).toHaveBeenCalledTimes(1);
    expect(gameFetchStateMock).toHaveBeenCalledTimes(1);
  });

  it('upgrade server error INSUFFICIENT_FUNDS → toast error i18n', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    };
    upgradeFurnaceMock.mockResolvedValueOnce('INSUFFICIENT_FUNDS');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="alchemy-upgrade-btn"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: 'Thiếu LT',
      }),
    );
  });

  it('upgrade unknown error code → toast error fallback UNKNOWN', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    };
    upgradeFurnaceMock.mockResolvedValueOnce('SOME_NEW_CODE');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="alchemy-upgrade-btn"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: 'Lỗi nâng',
      }),
    );
  });

  it('preview hiện realmRequirement khi có', async () => {
    alchemyState.nextUpgrade = {
      toLevel: 4,
      linhThachCost: 5_000,
      realmRequirement: 'truc_co',
    };
    const w = mountView();
    await flushPromises();
    const preview = w.find('[data-testid="alchemy-upgrade-preview"]').text();
    expect(preview).toContain('truc_co');
  });
});

/**
 * Phase 26.2 — Drop Economy V2 source-hint surfacing trên recipe card.
 *
 * Bao phủ:
 *  - Recipe có `missingInputs` với sourceHint render "Rơi từ: ..." block.
 *  - i18n vi: tag `BOSS` → "Boss", `DUNGEON` → "Bí cảnh".
 *  - Missing input có materialTier render badge `T{tier}`.
 *  - Missing input thiếu sourceHint (legacy item) KHÔNG crash, KHÔNG render
 *    block "Rơi từ" cho dòng đó.
 *  - Recipe không có missing input → KHÔNG render block missingInputs.
 */
describe('AlchemyView — Phase 26.2 sourceHint surfacing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('render missing input block với sourceHint i18n', async () => {
    alchemyState.recipes = [
      {
        ...STUB_RECIPES[0],
        missingInputs: [
          {
            itemKey: 'huyet_tinh_t2',
            itemName: 'Huyết Tinh',
            requiredQty: 5,
            ownedQty: 1,
            materialTier: 2,
            materialCategory: 'ALCHEMY_QI',
            sourceHint: ['BOSS', 'ELITE', 'DUNGEON'],
          },
        ],
      },
      STUB_RECIPES[1],
    ];
    const w = mountView();
    await flushPromises();
    const sourceBlock = w.find(
      '[data-testid="alchemy-missing-source-recipe_tieu_phuc_dan-huyet_tinh_t2"]',
    );
    expect(sourceBlock.exists()).toBe(true);
    const txt = sourceBlock.text();
    expect(txt).toContain('Rơi từ');
    expect(txt).toContain('Boss');
    expect(txt).toContain('Tinh anh');
    expect(txt).toContain('Bí cảnh');
  });

  it('render materialTier badge khi missingInput có tier', async () => {
    alchemyState.recipes = [
      {
        ...STUB_RECIPES[0],
        missingInputs: [
          {
            itemKey: 'huyet_tinh_t3',
            itemName: 'Huyết Tinh Tier 3',
            requiredQty: 2,
            ownedQty: 0,
            materialTier: 3,
            materialCategory: 'ALCHEMY_QI',
            sourceHint: ['BOSS'],
          },
        ],
      },
    ];
    const w = mountView();
    await flushPromises();
    const tierBadge = w.find(
      '[data-testid="alchemy-missing-tier-recipe_tieu_phuc_dan-huyet_tinh_t3"]',
    );
    expect(tierBadge.exists()).toBe(true);
    expect(tierBadge.text()).toContain('T3');
  });

  it('missing input KHÔNG có sourceHint vẫn render không crash', async () => {
    alchemyState.recipes = [
      {
        ...STUB_RECIPES[0],
        missingInputs: [
          {
            itemKey: 'legacy_item',
            itemName: 'Legacy item',
            requiredQty: 5,
            ownedQty: 1,
            // sourceHint omitted (legacy item path).
          },
        ],
      },
    ];
    const w = mountView();
    await flushPromises();
    // Missing item row vẫn render (item name + qty).
    const row = w.find(
      '[data-testid="alchemy-missing-recipe_tieu_phuc_dan-legacy_item"]',
    );
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('Legacy item');
    // Nhưng KHÔNG có block "Rơi từ" (sourceHint missing).
    const sourceBlock = w.find(
      '[data-testid="alchemy-missing-source-recipe_tieu_phuc_dan-legacy_item"]',
    );
    expect(sourceBlock.exists()).toBe(false);
  });

  it('recipe không có missingInputs → KHÔNG render block missingInputs', async () => {
    alchemyState.recipes = [
      {
        ...STUB_RECIPES[0],
        missingInputs: [],
      },
    ];
    const w = mountView();
    await flushPromises();
    const block = w.find('[data-testid="alchemy-missing-recipe_tieu_phuc_dan"]');
    expect(block.exists()).toBe(false);
  });

  it('sourceHint với 1 entry duy nhất vẫn render đúng (no separator)', async () => {
    alchemyState.recipes = [
      {
        ...STUB_RECIPES[0],
        missingInputs: [
          {
            itemKey: 'world_boss_drop',
            itemName: 'Linh Cốt',
            requiredQty: 1,
            ownedQty: 0,
            materialTier: 5,
            materialCategory: 'ARTIFACT_CRAFT',
            sourceHint: ['WORLD_BOSS'],
          },
        ],
      },
    ];
    const w = mountView();
    await flushPromises();
    const sourceBlock = w.find(
      '[data-testid="alchemy-missing-source-recipe_tieu_phuc_dan-world_boss_drop"]',
    );
    expect(sourceBlock.exists()).toBe(true);
    expect(sourceBlock.text()).toContain('World Boss');
    // Single entry KHÔNG có separator ", ".
    const txt = sourceBlock.text();
    const dropIdx = txt.indexOf('World Boss');
    expect(txt.slice(dropIdx)).not.toContain(',');
  });
});
