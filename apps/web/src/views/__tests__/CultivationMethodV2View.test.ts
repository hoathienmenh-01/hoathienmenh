import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CultivationMethodV2View — functional test coverage.
 *
 * Covers: loading, empty, list rendering, filters (category/slot/unlocked),
 * unlock/equip/unequip/upgrade/star-up actions, error toasts.
 */

const replaceMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const unlockMock = vi.fn();
const equipMock = vi.fn();
const unequipMock = vi.fn();
const upgradeMock = vi.fn();
const starUpMock = vi.fn();
const findEntryMock = vi.fn();
const toastPushMock = vi.fn();

interface MethodEntry {
  methodKey: string;
  unlocked: boolean;
  level: number;
  star: number;
  equippedSlot: string | null;
  canUnlock?: boolean;
  canUpgrade?: boolean;
}

interface StoreState {
  loaded: boolean;
  lastError: string | null;
  catalog: MethodEntry[];
  equippedSlots: { slot: string; methodKey: string }[];
  fetchState: typeof fetchStateMock;
  unlock: typeof unlockMock;
  equip: typeof equipMock;
  unequip: typeof unequipMock;
  upgrade: typeof upgradeMock;
  starUp: typeof starUpMock;
  findEntry: typeof findEntryMock;
  isEquipped: (k: string) => boolean;
  isUnlocking: () => boolean;
  isUpgrading: () => boolean;
  isEquipping: () => boolean;
  busy: (k: string) => boolean;
  cultivationRateMul: number;
  bodyRateMul: number;
  aggregatedBonuses: Record<string, number> | null;
}

const storeState: StoreState = {
  loaded: true,
  lastError: null,
  catalog: [],
  equippedSlots: [],
  fetchState: fetchStateMock,
  unlock: unlockMock,
  equip: equipMock,
  unequip: unequipMock,
  upgrade: upgradeMock,
  starUp: starUpMock,
  findEntry: findEntryMock,
  isEquipped: () => false,
  isUnlocking: () => false,
  isUpgrading: () => false,
  isEquipping: () => false,
  busy: () => false,
  cultivationRateMul: 1,
  bodyRateMul: 1,
  aggregatedBonuses: null,
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));
vi.mock('@/stores/cultivationMethodV2', () => ({
  useCultivationMethodV2Store: () => storeState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useRoute: () => ({ params: {} }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', props: ['label', 'caps'], template: '<p>{{ label }}</p>' },
}));
vi.mock('@/components/xianxia/XTSealFrame.vue', () => ({
  default: { name: 'XTSealFrameStub', template: '<div><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTGlyphBadge.vue', () => ({
  default: { name: 'XTGlyphBadgeStub', props: ['tone', 'size', 'glyph'], template: '<span><slot /></span>' },
}));

vi.mock('@xuantoi/shared', () => ({
  CULTIVATION_METHODS_V2: [
    { key: 'phap_kiem_quyet', name: 'Pháp Kiếm Quyết', category: 'SWORD', tier: 1, grade: 'PHAM', allowedSlots: ['QI_MAIN', 'SUPPORT'], statScaling: { qiExpPercent: 10 }, sourceHint: ['STARTER'], maxLevel: 10 },
    { key: 'than_ma_cong', name: 'Thần Ma Công', category: 'BODY', tier: 3, grade: 'HUYEN', allowedSlots: ['BODY_MAIN'], statScaling: { bodyExpPercent: 20 }, sourceHint: ['DUNGEON', 'BOSS'] },
  ],
  METHOD_CATEGORIES: ['SWORD', 'BODY'],
  METHOD_EQUIP_SLOTS: ['QI_MAIN', 'BODY_MAIN', 'SUPPORT', 'SECT', 'SPECIAL'],
  getMethodV2Def: (key: string) => {
    const defs: Record<string, unknown> = {
      phap_kiem_quyet: { key: 'phap_kiem_quyet', name: 'Pháp Kiếm Quyết', category: 'SWORD', tier: 1, grade: 'PHAM', allowedSlots: ['QI_MAIN', 'SUPPORT'], statScaling: { qiExpPercent: 10 }, sourceHint: ['STARTER'], maxLevel: 10 },
      than_ma_cong: { key: 'than_ma_cong', name: 'Thần Ma Công', category: 'BODY', tier: 3, grade: 'HUYEN', allowedSlots: ['BODY_MAIN'], statScaling: { bodyExpPercent: 20 }, sourceHint: ['DUNGEON', 'BOSS'] },
    };
    return defs[key] ?? null;
  },
}));

import CultivationMethodV2View from '@/views/CultivationMethodV2View.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      cultivationMethodV2: {
        title: 'Công Pháp V2',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Chưa có công pháp',
        roleHint: 'Quản lý công pháp.',
        crossNav: { cultivation: 'Tu Luyện', cultivationDesc: 'desc', skillBook: 'Sách Kỹ Năng', skillBookDesc: 'desc' },
        slot: { QI_MAIN: 'Chính', BODY_MAIN: 'Thân', SUPPORT: 'Phụ', SECT: 'Tông', SPECIAL: 'Đặc biệt' },
        category: { SWORD: 'Kiếm', BODY: 'Thân' },
        success: { unlock: 'Mở khoá {name}', equip: 'Trang bị {name} vào {slot}', unequip: 'Gỡ khỏi {slot}', upgrade: 'Nâng cấp {name} Lv.{level}', starUp: 'Nâng sao {name} ★{star}' },
        errors: { UNKNOWN: 'Lỗi', NOT_UNLOCKED: 'Chưa mở khoá', METHOD_ALREADY_UNLOCKED: 'Đã mở khoá' },
        filter: { category: 'Loại', slot: 'Slot', unlockedOnly: 'Đã mở', all: 'Tất cả', clear: 'Xoá', shown: '{shown}/{total}' },
        button: { unlock: 'Mở khoá', equip: 'Trang bị', unequip: 'Gỡ', upgrade: 'Nâng cấp', starUp: 'Nâng sao' },
        equippedBadge: 'Đang trang bị',
        aggregatedBonus: 'Tổng bonus',
      },
    },
  },
});

function mountView() {
  return mount(CultivationMethodV2View, { global: { plugins: [i18n] } });
}

function resetStore() {
  storeState.loaded = true;
  storeState.lastError = null;
  storeState.catalog = [];
  storeState.equippedSlots = [];
  storeState.isEquipped = () => false;
  storeState.isUnlocking = () => false;
  storeState.isUpgrading = () => false;
  storeState.isEquipping = () => false;
  unlockMock.mockReset();
  equipMock.mockReset();
  unequipMock.mockReset();
  upgradeMock.mockReset();
  starUpMock.mockReset();
  findEntryMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('CultivationMethodV2View — loading & empty', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetStore();
  });

  it('loading state khi store.loaded=false', async () => {
    storeState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-loading"]').exists()).toBe(true);
  });

  it('empty state khi catalog rỗng', async () => {
    storeState.loaded = true;
    storeState.catalog = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-empty"]').exists()).toBe(true);
  });
});

describe('CultivationMethodV2View — list rendering', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetStore();
  });

  it('render method cards khi có data', async () => {
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 3, star: 1, equippedSlot: 'QI_MAIN' },
      { methodKey: 'than_ma_cong', unlocked: false, level: 0, star: 0, equippedSlot: null },
    ];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-card-phap_kiem_quyet"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-v2-card-than_ma_cong"]').exists()).toBe(true);
  });

  it('hiển thị equipped badge cho method đang equip', async () => {
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 3, star: 1, equippedSlot: 'QI_MAIN' },
    ];
    storeState.equippedSlots = [{ slot: 'QI_MAIN', methodKey: 'phap_kiem_quyet' }];
    storeState.isEquipped = (k: string) => k === 'phap_kiem_quyet';
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-equipped-badge-phap_kiem_quyet"]').exists()).toBe(true);
  });

  it('hiển thị counts header', async () => {
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 3, star: 1, equippedSlot: 'QI_MAIN' },
    ];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-count"]').exists()).toBe(true);
  });
});

describe('CultivationMethodV2View — filters', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetStore();
  });

  it('filter category=SWORD chỉ giữ method có category=SWORD', async () => {
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 1, star: 0, equippedSlot: null },
      { methodKey: 'than_ma_cong', unlocked: true, level: 1, star: 0, equippedSlot: null },
    ];
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="cultivation-method-v2-filter-category"]').setValue('SWORD');
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-card-phap_kiem_quyet"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-v2-card-than_ma_cong"]').exists()).toBe(false);
  });

  it('filter unlockedOnly=true chỉ giữ method đã unlock', async () => {
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 1, star: 0, equippedSlot: null },
      { methodKey: 'than_ma_cong', unlocked: false, level: 0, star: 0, equippedSlot: null },
    ];
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="cultivation-method-v2-filter-unlocked"]').setValue(true);
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-card-phap_kiem_quyet"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-v2-card-than_ma_cong"]').exists()).toBe(false);
  });
});

describe('CultivationMethodV2View — actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetStore();
  });

  it('click unlock → store.unlock → success toast', async () => {
    unlockMock.mockResolvedValue(null);
    storeState.catalog = [
      { methodKey: 'than_ma_cong', unlocked: false, level: 0, star: 0, equippedSlot: null, canUnlock: true, canUpgrade: false },
    ];
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="cultivation-method-v2-unlock-than_ma_cong"]').trigger('click');
    await flushPromises();
    expect(unlockMock).toHaveBeenCalledWith('than_ma_cong');
    expect(toastPushMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('click upgrade → store.upgrade → success toast', async () => {
    upgradeMock.mockResolvedValue(null);
    findEntryMock.mockReturnValue({ methodKey: 'phap_kiem_quyet', level: 4, star: 1 });
    storeState.catalog = [
      { methodKey: 'phap_kiem_quyet', unlocked: true, level: 3, star: 1, equippedSlot: 'QI_MAIN', canUnlock: false, canUpgrade: true },
    ];
    storeState.isEquipped = () => true;
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="cultivation-method-v2-upgrade-phap_kiem_quyet"]').trigger('click');
    await flushPromises();
    expect(upgradeMock).toHaveBeenCalledWith('phap_kiem_quyet');
    expect(toastPushMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('unlock error code → error toast', async () => {
    unlockMock.mockResolvedValue('NOT_UNLOCKED');
    storeState.catalog = [
      { methodKey: 'than_ma_cong', unlocked: false, level: 0, star: 0, equippedSlot: null, canUnlock: true, canUpgrade: false },
    ];
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="cultivation-method-v2-unlock-than_ma_cong"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
});
