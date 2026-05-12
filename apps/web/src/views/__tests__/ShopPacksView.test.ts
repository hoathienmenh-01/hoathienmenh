import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import ShopPacksView from '@/views/ShopPacksView.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';
import type { ShopPackView } from '@/api/shopPacks';

const getShopPacksMock = vi.fn();
const purchaseShopPackMock = vi.fn();

vi.mock('@/api/shopPacks', () => ({
  getShopPacks: () => getShopPacksMock(),
  purchaseShopPack: (...a: unknown[]) => purchaseShopPackMock(...a),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

const gameState = {
  character: { tienNgoc: 500, tienNgocKhoa: 0 },
  fetchState: vi.fn().mockResolvedValue(undefined),
  bindSocket: vi.fn(),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

function makePack(over: Partial<ShopPackView> = {}): ShopPackView {
  return {
    packId: 'daily_cultivation_support',
    nameVi: 'Gói Tu Luyện Hằng Ngày',
    nameEn: 'Daily Cultivation Support Pack',
    descriptionVi: 'Hỗ trợ tu luyện mỗi ngày.',
    descriptionEn: 'Daily cultivation boost.',
    category: 'DAILY',
    priceCurrency: 'tienNgoc',
    priceAmount: 50,
    purchaseLimit: 1,
    purchaseLimitWindow: 'DAY',
    rewards: [{ kind: 'currency', key: 'linhThach', qty: 2000 }],
    active: true,
    tags: ['equipment'],
    remainingPurchases: 1,
    ...over,
  };
}

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages: { vi: viMessages, en: enMessages },
  });
}

async function mountView(locale: 'vi' | 'en' = 'vi') {
  const w = mount(ShopPacksView, { global: { plugins: [makeI18n(locale)] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getShopPacksMock.mockReset().mockResolvedValue([makePack()]);
  purchaseShopPackMock.mockReset().mockResolvedValue({
    purchaseId: 'p1',
    packId: 'daily_cultivation_support',
    rewards: [],
  });
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.character = { tienNgoc: 500, tienNgocKhoa: 0 };
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
});

describe('ShopPacksView', () => {
  it('redirects unauthenticated users to auth page', async () => {
    authState.isAuthenticated = false;
    await mountView();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getShopPacksMock).not.toHaveBeenCalled();
  });

  it('renders pack list with remaining limit and reward', async () => {
    const w = await mountView();
    expect(w.text()).toContain('Gói Tu Luyện Hằng Ngày');
    expect(w.text()).toContain('Còn lại: 1/1');
    expect(w.text()).toContain('Linh Thạch ×2.000');
  });

  it('filters by category', async () => {
    getShopPacksMock.mockResolvedValue([
      makePack({ category: 'DAILY', packId: 'daily_cultivation_support' }),
      makePack({
        category: 'WEEKLY',
        packId: 'weekly_equipment_forge',
        nameVi: 'Gói Luyện Trang Bị Tuần',
      }),
    ]);
    const w = await mountView();
    expect(w.text()).toContain('Gói Luyện Trang Bị Tuần');
    await w.get('button:nth-of-type(3)').trigger('click');
    expect(w.text()).toContain('Gói Luyện Trang Bị Tuần');
    expect(w.text()).not.toContain('Gói Tu Luyện Hằng Ngày');
  });

  it('disables purchase when sold out', async () => {
    getShopPacksMock.mockResolvedValue([makePack({ remainingPurchases: 0 })]);
    const w = await mountView();
    const buy = w.findAll('button').find((b) => b.text() === 'Đã hết');
    expect(buy?.attributes('disabled')).toBeDefined();
  });

  it('disables purchase when insufficient funds', async () => {
    gameState.character = { tienNgoc: 10, tienNgocKhoa: 0 };
    const w = await mountView();
    const buy = w.findAll('button').find((b) => b.text() === 'Thiếu tiền');
    expect(buy?.attributes('disabled')).toBeDefined();
  });

  it('opens confirm modal and purchases successfully', async () => {
    const w = await mountView();
    await w.findAll('button').find((b) => b.text() === 'Mua')!.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('Xác nhận mua gói');

    const buttons = document.body.querySelectorAll('button');
    const confirm = Array.from(buttons).find((b) => b.textContent?.includes('Đồng ý'))!;
    confirm.click();
    await flushPromises();

    expect(purchaseShopPackMock).toHaveBeenCalledWith('daily_cultivation_support', expect.any(String));
    expect(toastPushMock).toHaveBeenCalledWith({ type: 'success', text: 'Mua gói thành công!' });
    expect(gameState.fetchState).toHaveBeenCalled();
    expect(getShopPacksMock).toHaveBeenCalledTimes(2);
  });

  it('renders English copy', async () => {
    const w = await mountView('en');
    expect(w.text()).toContain('Daily Cultivation Support Pack');
    expect(w.text()).toContain('Remaining: 1/1');
  });
});
