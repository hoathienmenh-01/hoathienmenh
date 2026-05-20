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

const getWalletMock = vi.fn();
const getWalletLedgerMock = vi.fn();
const listEntitlementsMock = vi.fn();

vi.mock('@/api/monetization', () => ({
  getWallet: (...a: unknown[]) => getWalletMock(...a),
  getWalletLedger: (...a: unknown[]) => getWalletLedgerMock(...a),
  listEntitlements: (...a: unknown[]) => listEntitlementsMock(...a),
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
vi.mock('@/components/xianxia/XTStatTile.vue', () => ({
  default: { name: 'XTStatTileStub', props: ['eyebrow', 'label', 'tone', 'icon', 'value', 'testId'], template: '<div :data-testid="testId"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxSection.vue', () => ({
  default: { name: 'XTLuxSectionStub', props: ['testId'], template: '<div :data-testid="testId || \'section\'"><slot /></div>' },
}));

import WalletView from '@/views/WalletView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      wallet: {
        title: 'Ví',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Quản lý tài sản.',
        crossNav: {
          topup: 'Nạp',
          topupDesc: 'desc',
          shop: 'Cửa Hàng',
          shopDesc: 'desc',
        },
      },
      luxHero: {
        wallet: { eyebrow: 'PREMIUM', label: 'Ví', subtitle: 'sub', breadcrumb: 'Ví' },
      },
    },
  },
});

function mountView() {
  return mount(WalletView, { global: { plugins: [i18n] } });
}

describe('WalletView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    getWalletMock.mockResolvedValue({ TIEN_NGOC: 0, TIEN_NGOC_KHOA: 0, LINH_THACH: 0, CONG_HIEN_TONG_MON: 0, TRIAL_POINT: 0, EVENT_TOKEN: 0 });
    getWalletLedgerMock.mockResolvedValue([]);
    listEntitlementsMock.mockResolvedValue([]);
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="wallet-view-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="wallet-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="wallet-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="wallet-cross-nav"]').exists()).toBe(true);
  });
});

describe('WalletView — functional', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getWalletMock.mockReset();
    getWalletLedgerMock.mockReset();
    listEntitlementsMock.mockReset();
    getWalletMock.mockResolvedValue({
      TIEN_NGOC: 1000,
      TIEN_NGOC_KHOA: 500,
      LINH_THACH: 9999,
      CONG_HIEN_TONG_MON: 100,
      TRIAL_POINT: 50,
      EVENT_TOKEN: 25,
    });
    getWalletLedgerMock.mockResolvedValue([]);
    listEntitlementsMock.mockResolvedValue([]);
  });

  it('render currency tiles khi wallet loaded', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="wallet-tile-tien_ngoc"]').exists()).toBe(true);
    expect(w.find('[data-testid="wallet-tile-linh_thach"]').exists()).toBe(true);
    expect(w.find('[data-testid="wallet-tile-cong_hien_tong_mon"]').exists()).toBe(true);
  });

  it('render ledger section', async () => {
    getWalletLedgerMock.mockResolvedValue([
      { id: 'l1', createdAt: '2026-01-01T00:00:00Z', currency: 'LINH_THACH', delta: -500, reason: 'Mua vật phẩm', refType: 'PURCHASE', refId: 'p1' },
    ]);
    const w = mountView();
    await flushPromises();
    const section = w.find('[data-testid="wallet-ledger-section"]');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain('LINH_THACH');
    expect(section.text()).toContain('-500');
  });

  it('empty ledger message khi không có giao dịch', async () => {
    getWalletLedgerMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    const section = w.find('[data-testid="wallet-ledger-section"]');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain('Chưa có giao dịch');
  });

  it('render entitlements section', async () => {
    listEntitlementsMock.mockResolvedValue([
      { key: 'MONTHLY_CARD', value: 1, source: 'PURCHASE', startsAt: '2026-01-01', expiresAt: '2026-02-01' },
    ]);
    const w = mountView();
    await flushPromises();
    const section = w.find('[data-testid="wallet-entitlements-section"]');
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain('MONTHLY_CARD');
  });

  it('gọi getWallet, getWalletLedger, listEntitlements on mount', async () => {
    mountView();
    await flushPromises();
    expect(getWalletMock).toHaveBeenCalled();
    expect(getWalletLedgerMock).toHaveBeenCalled();
    expect(listEntitlementsMock).toHaveBeenCalled();
  });
});
