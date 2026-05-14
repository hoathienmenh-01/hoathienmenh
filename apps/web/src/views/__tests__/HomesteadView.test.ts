import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadMock = vi.fn();
const upgradeMock = vi.fn();
const plantMock = vi.fn();
const harvestMock = vi.fn();
const startGardenMock = vi.fn();
const claimGardenMock = vi.fn();
const toastPushMock = vi.fn();

const homesteadState = reactive({
  loading: false,
  lastError: null as string | null,
  upgradeInFlight: false,
  activeTab: 'fields' as 'fields' | 'garden',
  selectedCropKey: 'linh_thao_mam' as string | null,
  selectedProductionKey: 'tinh_thiet_loc' as string | null,
  lastHarvest: null as { qty: number } | null,
  lastGardenClaim: null as { qty: number } | null,
  homestead: {
    id: 'hs1',
    level: 1,
    nameVi: 'Thạch Động Sơ Khai',
    nameEn: 'Stone Cave',
    spiritualEnergy: 40,
    storageCap: 120,
    fieldSlots: 2,
    gardenSlots: 1,
    maxCropTier: 1,
    maxGardenTier: 1,
    energyUpdatedAt: '2026-01-01T00:00:00.000Z',
    serverTime: '2026-01-01T00:00:00.000Z',
    offlineCapHours: 8,
  },
  upgrade: {
    available: true,
    canUpgrade: true,
    toLevel: 2,
    linhThachCost: 300,
    spiritualEnergyCost: 40,
    requiredRealmKey: 'luyenkhi',
  },
  fields: [
    { slotIndex: 0, state: 'EMPTY' },
    {
      slotIndex: 1,
      state: 'READY',
      cropKey: 'linh_thao_mam',
      outputItemKey: 'linh_thao',
      expectedYield: 2,
      plantedAt: '2026-01-01T00:00:00.000Z',
      readyAt: '2026-01-01T00:30:00.000Z',
      remainingSeconds: 0,
    },
  ],
  garden: [
    {
      slotIndex: 0,
      state: 'READY',
      productionKey: 'tinh_thiet_loc',
      outputItemKey: 'tinh_thiet',
      expectedYield: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      readyAt: '2026-01-01T01:00:00.000Z',
      remainingSeconds: 0,
    },
  ],
  cropCatalog: [
    {
      key: 'linh_thao_mam',
      nameVi: 'Mầm Linh Thảo',
      nameEn: 'Spirit Herb Sprout',
      tier: 1,
      outputItemKey: 'linh_thao',
      yieldQty: 2,
      growthMinutes: 30,
      spiritualEnergyCost: 8,
      dailyCapQty: 24,
      requiredRealmKey: null,
      unlocked: true,
    },
  ],
  gardenCatalog: [
    {
      key: 'tinh_thiet_loc',
      nameVi: 'Lọc Tinh Thiết',
      nameEn: 'Refined Iron',
      tier: 1,
      outputItemKey: 'tinh_thiet',
      yieldQty: 1,
      durationMinutes: 60,
      spiritualEnergyCost: 12,
      dailyCapQty: 8,
      rare: false,
      requiredRealmKey: null,
      unlocked: true,
    },
  ],
  load: loadMock,
  upgradeHomestead: upgradeMock,
  plant: plantMock,
  harvest: harvestMock,
  startGarden: startGardenMock,
  claimGarden: claimGardenMock,
  isFieldBusy: () => false,
  isGardenBusy: () => false,
});

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/stores/homestead', () => ({
  useHomesteadStore: () => homesteadState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));

import HomesteadView from '@/views/HomesteadView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  messages: {
    vi: {
      common: { refresh: 'Làm mới' },
      homestead: {
        title: 'Động Phủ',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        level: 'Cấp {level}',
        offlineCap: '{hours} giờ',
        energy: 'Linh khí',
        fields: 'Linh Điền',
        garden: 'Dược Viên',
        maxTier: 'Tier',
        upgradeTitle: 'Nâng cấp',
        upgradeCost: '{linhThach}/{energy}/{realm}',
        upgrade: 'Nâng',
        maxLevel: 'Max',
        tabs: { fields: 'Linh Điền', garden: 'Dược Viên' },
        selectCrop: 'Chọn cây',
        selectProduction: 'Chọn sản xuất',
        costLine: '{energy}/{cap}/{item}',
        locked: 'khóa',
        rare: 'hiếm',
        slot: 'Ô {n}',
        emptyField: 'Trống field',
        emptyGarden: 'Trống garden',
        plant: 'Trồng',
        harvest: 'Thu hoạch',
        startGarden: 'Bắt đầu',
        claim: 'Nhận',
        ready: 'Sẵn sàng',
        toast: {
          upgraded: 'Đã nâng',
          harvested: '+{qty}',
          claimed: '+{qty}',
        },
        error: { UNKNOWN: 'Lỗi' },
      },
    },
  },
});

function mountView() {
  return mount(HomesteadView, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  homesteadState.loading = false;
  homesteadState.lastError = null;
  homesteadState.activeTab = 'fields';
  loadMock.mockResolvedValue(undefined);
  upgradeMock.mockResolvedValue(null);
  plantMock.mockResolvedValue(null);
  harvestMock.mockResolvedValue(null);
  startGardenMock.mockResolvedValue(null);
  claimGardenMock.mockResolvedValue(null);
  toastPushMock.mockReset();
});

describe('HomesteadView', () => {
  it('renders homestead page and field slots', async () => {
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.find('[data-testid="homestead-page"]').text()).toContain('Động Phủ');
    expect(wrapper.findAll('[data-testid^="homestead-field-"]')).toHaveLength(2);
  });

  it('plants and harvests field slots through store actions', async () => {
    const wrapper = mountView();
    await flushPromises();
    const fieldCards = wrapper.findAll('[data-testid^="homestead-field-"]');
    await fieldCards[0]!.find('button').trigger('click');
    await fieldCards[1]!.find('button').trigger('click');
    expect(plantMock).toHaveBeenCalledWith(0, 'linh_thao_mam');
    expect(harvestMock).toHaveBeenCalledWith(1);
  });

  it('renders garden tab and claim CTA', async () => {
    const wrapper = mountView();
    await flushPromises();
    homesteadState.activeTab = 'garden';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="homestead-garden-0"]').text()).toContain('Lọc Tinh Thiết');
    await wrapper.find('[data-testid="homestead-garden-0"] button').trigger('click');
    expect(claimGardenMock).toHaveBeenCalledWith(0);
  });
});
