import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

const getWalletMock = vi.fn();
const listShopMock = vi.fn();
const getExtraAttemptsMock = vi.fn();
const purchaseProductMock = vi.fn();
const buyExtraAttemptMock = vi.fn();

vi.mock('@/api/monetization', () => ({
  getWallet: (...a: unknown[]) => getWalletMock(...a),
  listShop: (...a: unknown[]) => listShopMock(...a),
  getExtraAttempts: (...a: unknown[]) => getExtraAttemptsMock(...a),
  purchaseProduct: (...a: unknown[]) => purchaseProductMock(...a),
  buyExtraAttempt: (...a: unknown[]) => buyExtraAttemptMock(...a),
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
vi.mock('@/components/ui/MButton.vue', () => ({
  default: { name: 'MButtonStub', inheritAttrs: false, template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
}));

import MonetizationShopView from '@/views/MonetizationShopView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      monetizationShop: {
        title: 'Cửa Hàng',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Mua vật phẩm.',
        crossNav: {
          topup: 'Nạp',
          topupDesc: 'desc',
          inventory: 'Túi Đồ',
          inventoryDesc: 'desc',
        },
      },
      luxHero: {
        monetizationShop: { eyebrow: 'SHOP', label: 'Cửa hàng', subtitle: 'sub', breadcrumb: 'Cửa hàng' },
      },
    },
  },
});

function mountView() {
  return mount(MonetizationShopView, { global: { plugins: [i18n] } });
}

describe('MonetizationShopView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getWalletMock.mockResolvedValue({ TIEN_NGOC: 0, TIEN_NGOC_KHOA: 0, LINH_THACH: 0 });
    listShopMock.mockResolvedValue([]);
    getExtraAttemptsMock.mockResolvedValue([]);
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="monetization-shop-view-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="monetization-shop-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="monetization-shop-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="monetization-shop-cross-nav"]').exists()).toBe(true);
  });
});

describe('MonetizationShopView — functional', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getWalletMock.mockReset();
    listShopMock.mockReset();
    getExtraAttemptsMock.mockReset();
    purchaseProductMock.mockReset();
    buyExtraAttemptMock.mockReset();
    getWalletMock.mockResolvedValue({ TIEN_NGOC: 1000, TIEN_NGOC_KHOA: 500, LINH_THACH: 9999 });
    listShopMock.mockResolvedValue([]);
    getExtraAttemptsMock.mockResolvedValue([]);
  });

  it('gọi getWallet, listShop, getExtraAttempts on mount', async () => {
    mountView();
    await flushPromises();
    expect(getWalletMock).toHaveBeenCalled();
    expect(listShopMock).toHaveBeenCalled();
    expect(getExtraAttemptsMock).toHaveBeenCalled();
  });

  it('render shop cards khi có listings', async () => {
    listShopMock.mockResolvedValue([
      {
        product: { key: 'monthly_card', nameVi: 'Thẻ Tháng', descriptionVi: 'Nhận quà mỗi ngày', productType: 'SUBSCRIPTION', priceAmount: 50000, priceCurrency: 'VND', purchaseLimitType: 'ONCE', purchaseLimitCount: 1, enabled: true },
        remaining: 1,
        soldOut: false,
      },
      {
        product: { key: 'gem_pack', nameVi: 'Gói Ngọc', descriptionVi: '100 Tiên Ngọc', productType: 'CONSUMABLE', priceAmount: 10000, priceCurrency: 'VND', purchaseLimitType: 'DAILY', purchaseLimitCount: 5, enabled: true },
        remaining: 3,
        soldOut: false,
      },
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Thẻ Tháng');
    expect(w.text()).toContain('Gói Ngọc');
    expect(w.text()).toContain('50000');
  });

  it('hiển thị sold out khi soldOut=true', async () => {
    listShopMock.mockResolvedValue([
      {
        product: { key: 'monthly_card', nameVi: 'Thẻ Tháng', descriptionVi: 'desc', productType: 'SUBSCRIPTION', priceAmount: 50000, priceCurrency: 'VND', purchaseLimitType: 'ONCE', purchaseLimitCount: 1, enabled: true },
        remaining: 0,
        soldOut: true,
      },
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Hết lượt');
  });

  it('click buy → gọi purchaseProduct → success toast', async () => {
    purchaseProductMock.mockResolvedValue({ product: { nameVi: 'Thẻ Tháng' } });
    listShopMock.mockResolvedValue([
      {
        product: { key: 'monthly_card', nameVi: 'Thẻ Tháng', descriptionVi: 'desc', productType: 'SUBSCRIPTION', priceAmount: 50000, priceCurrency: 'VND', purchaseLimitType: 'ONCE', purchaseLimitCount: 1, enabled: true },
        remaining: 1,
        soldOut: false,
      },
    ]);
    const w = mountView();
    await flushPromises();
    const buyBtn = w.findAll('button').find((b) => b.text() === 'Mua');
    expect(buyBtn).toBeTruthy();
    await buyBtn!.trigger('click');
    await flushPromises();
    expect(purchaseProductMock).toHaveBeenCalledWith('monthly_card');
  });

  it('render extra attempts section', async () => {
    getExtraAttemptsMock.mockResolvedValue([
      { limitKey: 'DUNGEON_DAILY', usedCount: 2, maxCount: 5, remaining: 3 },
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('DUNGEON_DAILY');
    expect(w.text()).toContain('2/5');
  });

  it('click buy attempt → gọi buyExtraAttempt', async () => {
    buyExtraAttemptMock.mockResolvedValue({});
    getExtraAttemptsMock.mockResolvedValue([
      { limitKey: 'DUNGEON_DAILY', usedCount: 2, maxCount: 5, remaining: 3 },
    ]);
    const w = mountView();
    await flushPromises();
    const attemptBtn = w.findAll('button').find((b) => b.text().includes('Mua thêm'));
    expect(attemptBtn).toBeTruthy();
    await attemptBtn!.trigger('click');
    await flushPromises();
    expect(buyExtraAttemptMock).toHaveBeenCalledWith('DUNGEON_DAILY');
  });
});
