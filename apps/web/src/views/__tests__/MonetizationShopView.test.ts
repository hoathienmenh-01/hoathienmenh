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
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
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
    expect(w.find('[data-testid="cross-nav-topup"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-inventory"]').exists()).toBe(true);
  });
});
