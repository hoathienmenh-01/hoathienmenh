import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { ShopEntry, ShopBuyResult } from '@/api/shop';

/**
 * ShopView smoke tests (session 9j task D / K3.3): cover onMounted routing,
 * render shop entries + balance + canAfford gating, qty clamping
 * (stackable + non-stackable), buy flow (success + fetchState, error map
 * shop.errors.<code> / fallback UNKNOWN, submittingKey guard chống
 * duplicate purchase — ShopView ĐỤNG CurrencyLedger + ItemLedger economy
 * safety), listNpcShop fail → toast.
 */

const listNpcShopMock = vi.fn();
const buyFromShopMock = vi.fn();

vi.mock('@/api/shop', async () => {
  const actual = await vi.importActual<typeof import('@/api/shop')>('@/api/shop');
  return {
    ...actual,
    listNpcShop: (...a: unknown[]) => listNpcShopMock(...a),
    buyFromShop: (...a: unknown[]) => buyFromShopMock(...a),
  };
});

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

const gameState: {
  character: { linhThach: string; tienNgoc: number } | null;
  bindSocket: ReturnType<typeof vi.fn>;
  fetchState: ReturnType<typeof vi.fn>;
} = {
  character: { linhThach: '1000', tienNgoc: 50 },
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
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

import ShopViewComponent from '@/views/ShopView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang tải…' },
      shop: {
        title: 'NPC Shop',
        subtitle: 'Cửa hàng hạ giới.',
        balance: 'Linh Thạch',
        empty: 'Cửa hàng trống.',
        buy: 'Mua',
        qty: 'Số lượng',
        nonStackable: 'Không chồng được',
        dailyLimit: 'Hạn mức hôm nay: {n}',
        buyOk: 'Đã mua {name} x{qty} ({price} LT)',
        currency: {
          linhThach: 'LT',
          tienNgoc: 'TN',
        },
        errors: {
          NOT_ENOUGH_BALANCE: 'Không đủ linh thạch.',
          ITEM_NOT_AVAILABLE: 'Vật phẩm không còn bán.',
          SHOP_DAILY_LIMIT: 'Vượt hạn mức hôm nay.',
          RATE_LIMITED: 'Mua quá nhanh.',
          loadFail: 'Không tải được shop.',
          UNKNOWN: 'Có lỗi xảy ra.',
        },
      },
      quality: {
        PHAM: 'Phàm',
        LINH: 'Linh',
      },
    },
  },
});

function makeEntry(over: Partial<ShopEntry> = {}): ShopEntry {
  return {
    itemKey: 'pill_hp',
    name: 'Hồi HP Đan',
    description: 'Hồi 50 HP.',
    kind: 'PILL_HP',
    quality: 'PHAM',
    price: 10,
    currency: 'LINH_THACH',
    stackable: true,
    dailyLimit: null,
    ...over,
  };
}

function mountView() {
  return mount(ShopViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listNpcShopMock.mockReset();
  buyFromShopMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  gameState.character = { linhThach: '1000', tienNgoc: 50 };
  gameState.bindSocket.mockReset();
  gameState.fetchState.mockReset();
  gameState.fetchState.mockResolvedValue(undefined);
});

describe('ShopView — onMounted routing', () => {
  it('chưa auth → router.replace(/auth) + không gọi listNpcShop', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listNpcShopMock).not.toHaveBeenCalled();
  });

  it('có auth → fetchState + bindSocket + listNpcShop', async () => {
    listNpcShopMock.mockResolvedValue([]);
    mountView();
    await flushPromises();
    expect(gameState.fetchState).toHaveBeenCalled();
    expect(gameState.bindSocket).toHaveBeenCalled();
    expect(listNpcShopMock).toHaveBeenCalledTimes(1);
  });
});

describe('ShopView — render', () => {
  it('loading state lúc đầu', async () => {
    listNpcShopMock.mockImplementation(() => new Promise(() => {})); // never
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Đang tải…');
  });

  it('empty state: entries rỗng → shop.empty', async () => {
    listNpcShopMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Cửa hàng trống.');
  });

  it('render balance + entry name + total price (qty=1)', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ name: 'Đan A', price: 25 })]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('1000'); // balance
    expect(w.text()).toContain('Đan A');
    expect(w.text()).toContain('25'); // totalPrice 25 * 1
    expect(w.text()).toContain('LT'); // currency linhThach
  });

  it('non-stackable entry: hiện label shop.nonStackable, không có input qty', async () => {
    listNpcShopMock.mockResolvedValue([
      makeEntry({ itemKey: 'unique_weapon', name: 'Kiếm độc', stackable: false, price: 500 }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Không chồng được');
    const qtyInput = w.find('input[type="number"]');
    expect(qtyInput.exists()).toBe(false);
  });
});

describe('ShopView — canAfford gating', () => {
  it('đủ linhThach → nút Mua enabled', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ price: 100 })]);
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    expect(btn!.attributes('disabled')).toBeUndefined();
  });

  it('không đủ linhThach → nút Mua disabled', async () => {
    gameState.character = { linhThach: '5', tienNgoc: 50 };
    listNpcShopMock.mockResolvedValue([makeEntry({ price: 100 })]);
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    expect(btn!.attributes('disabled')).toBeDefined();
  });

  it('currency TIEN_NGOC: đủ tienNgoc → enabled', async () => {
    gameState.character = { linhThach: '0', tienNgoc: 100 };
    listNpcShopMock.mockResolvedValue([
      makeEntry({ currency: 'TIEN_NGOC', price: 50 }),
    ]);
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    expect(btn!.attributes('disabled')).toBeUndefined();
  });

  it('currency TIEN_NGOC: thiếu tienNgoc → disabled', async () => {
    gameState.character = { linhThach: '1000', tienNgoc: 5 };
    listNpcShopMock.mockResolvedValue([
      makeEntry({ currency: 'TIEN_NGOC', price: 50 }),
    ]);
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    expect(btn!.attributes('disabled')).toBeDefined();
  });
});

describe('ShopView — qty clamping', () => {
  it('set qty âm/0 → clamp về 1', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    const w = mountView();
    await flushPromises();
    const input = w.find('input[type="number"]');
    await input.setValue('0');
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe('1');
  });

  it('set qty > 99 → clamp về 99', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    const w = mountView();
    await flushPromises();
    const input = w.find('input[type="number"]');
    await input.setValue('500');
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe('99');
  });

  it('totalPrice = price × qty sau khi tăng qty', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ price: 10 })]);
    const w = mountView();
    await flushPromises();
    const input = w.find('input[type="number"]');
    await input.setValue('5');
    await flushPromises();
    expect(w.text()).toContain('50'); // 10 * 5
  });
});

describe('ShopView — buy flow', () => {
  it('success: buyFromShop(itemKey, qty) + toast + fetchState', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ price: 10 })]);
    const result: ShopBuyResult = {
      itemKey: 'pill_hp',
      qty: 3,
      totalPrice: 30,
      currency: 'LINH_THACH',
    };
    buyFromShopMock.mockResolvedValue(result);

    const w = mountView();
    await flushPromises();
    const input = w.find('input[type="number"]');
    await input.setValue('3');
    await flushPromises();

    gameState.fetchState.mockClear();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();

    expect(buyFromShopMock).toHaveBeenCalledWith('pill_hp', 3);
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã mua Hồi HP Đan x3 (30 LT)',
    });
    expect(gameState.fetchState).toHaveBeenCalled();
  });

  it('non-stackable: buyFromShop luôn qty=1 bất kể qty state', async () => {
    listNpcShopMock.mockResolvedValue([
      makeEntry({ itemKey: 'unique', stackable: false, price: 50 }),
    ]);
    buyFromShopMock.mockResolvedValue({
      itemKey: 'unique',
      qty: 1,
      totalPrice: 50,
      currency: 'LINH_THACH',
    });

    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();

    expect(buyFromShopMock).toHaveBeenCalledWith('unique', 1);
  });

  it('error NOT_ENOUGH_BALANCE → map shop.errors.NOT_ENOUGH_BALANCE', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    buyFromShopMock.mockRejectedValue(
      Object.assign(new Error('no'), { code: 'NOT_ENOUGH_BALANCE' }),
    );

    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không đủ linh thạch.',
    });
  });

  it('error code lạ → fallback shop.errors.UNKNOWN', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    buyFromShopMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'WEIRD' }),
    );

    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });

  it('submittingKey guard: click lần 2 trong khi pending → buyFromShop chỉ 1 call', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    const resolveHolder: {
      current: ((v: ShopBuyResult) => void) | null;
    } = { current: null };
    buyFromShopMock.mockImplementation(
      () =>
        new Promise<ShopBuyResult>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );

    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();
    await btn!.trigger('click');
    await flushPromises();

    expect(buyFromShopMock).toHaveBeenCalledTimes(1);

    resolveHolder.current?.({
      itemKey: 'pill_hp',
      qty: 1,
      totalPrice: 10,
      currency: 'LINH_THACH',
    });
    await flushPromises();
  });
});

describe('ShopView — list fetch error', () => {
  it('listNpcShop throw → toast shop.errors.loadFail + empty entries', async () => {
    listNpcShopMock.mockRejectedValue(new Error('net'));
    const w = mountView();
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không tải được shop.',
    });
    // Render empty state since entries still [].
    expect(w.text()).toContain('Cửa hàng trống.');
  });
});

/**
 * M10 — Daily purchase cap badge + RATE_LIMITED / SHOP_DAILY_LIMIT mapping.
 */
describe('ShopView — M10 daily limit + rate limit', () => {
  it('entry có dailyLimit → render badge "Hạn mức hôm nay: N"', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ dailyLimit: 10 })]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Hạn mức hôm nay: 10');
  });

  it('entry KHÔNG có dailyLimit (null) → KHÔNG render badge', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry({ dailyLimit: null })]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).not.toContain('Hạn mức hôm nay');
  });

  it('SHOP_DAILY_LIMIT → toast i18n đúng', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    buyFromShopMock.mockRejectedValue(
      Object.assign(new Error('cap'), { code: 'SHOP_DAILY_LIMIT' }),
    );
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Vượt hạn mức hôm nay.',
    });
  });

  it('RATE_LIMITED → toast i18n đúng', async () => {
    listNpcShopMock.mockResolvedValue([makeEntry()]);
    buyFromShopMock.mockRejectedValue(
      Object.assign(new Error('rl'), { code: 'RATE_LIMITED' }),
    );
    const w = mountView();
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text().includes('Mua'));
    await btn!.trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Mua quá nhanh.',
    });
  });
});
