import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const listMarketMock = vi.fn();
const listMineMock = vi.fn();
const listInventoryMock = vi.fn();
const postListingMock = vi.fn();
const toastPushMock = vi.fn();

vi.mock('@/api/market', () => ({
  listMarket: (...a: unknown[]) => listMarketMock(...a),
  listMine: (...a: unknown[]) => listMineMock(...a),
  buyListing: vi.fn(),
  cancelListing: vi.fn(),
  postListing: (...a: unknown[]) => postListingMock(...a),
}));

vi.mock('@/api/inventory', () => ({
  listInventory: (...a: unknown[]) => listInventoryMock(...a),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import MarketView from '@/views/MarketView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { all: 'Tất cả' },
      itemKind: {
        WEAPON: 'Vũ Khí',
        ARMOR: 'Giáp',
        PILL_HP: 'Đan HP',
        PILL_MP: 'Đan MP',
        PILL_EXP: 'Đan EXP',
        ORE: 'Khoáng',
        MISC: 'Khác',
      },
      market: {
        title: 'Phường Thị',
        feeNote: 'Phí {pct}%',
        tab: { buy: 'Mua', sell: 'Bán' },
        filter: 'Lọc',
        noListings: 'Chưa có tin đăng.',
        noMine: 'Chưa đăng tin.',
        myListings: 'Tin của tôi',
        newListingTitle: 'Đăng bán',
        item: 'Vật phẩm',
        chooseItem: 'Chọn vật phẩm',
        qty: 'Số lượng',
        price: 'Giá',
        priceBandHint: 'Đề nghị: {min} – {max} LT/đơn vị.',
        post: 'Đăng',
        postToast: 'Đăng OK',
        sellerPosted: '{name}',
        perUnit: '{price}/đơn vị',
        buy: 'Mua',
        yours: 'Của bạn',
        takeDown: 'Hạ tin',
        totalLine: 'Tổng {total} {fee}',
        fee: 'phí {fee} → còn {net}',
        errors: {
          PRICE_TOO_LOW: 'Giá thấp hơn mức tối thiểu.',
          PRICE_TOO_HIGH: 'Giá cao hơn mức tối đa.',
          UNKNOWN: 'Lỗi không xác định.',
        },
        roleHint: 'Mua bán trang bị và vật phẩm với đạo hữu khác.',
        crossNav: {
          marketV2: 'Đấu Giá',
          marketV2Desc: 'Nhà Đấu Giá',
          inventory: 'Túi Đồ',
          inventoryDesc: 'Quản lý vật phẩm',
        },
      },
      quality: {},
      listingStatus: { ACTIVE: 'Đang bán', SOLD: 'Đã bán', CANCELLED: 'Huỷ' },
    },
  },
});

function mountView() {
  return mount(MarketView, {
    global: { plugins: [i18n] },
  });
}

describe('MarketView — skeleton loaders (L5 cont)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMarketMock.mockReset();
    listMineMock.mockReset();
    listInventoryMock.mockReset();
    postListingMock.mockReset();
    toastPushMock.mockReset();
  });

  it('render market-buy-skeleton khi đang fetch tab Mua', async () => {
    let resolveMarket: (v: { listings: unknown[]; feePct: number }) => void = () => {};
    listMarketMock.mockReturnValue(
      new Promise((r) => {
        resolveMarket = r;
      }),
    );
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([]);

    const w = mountView();
    await w.vm.$nextTick();

    expect(w.find('[data-testid="market-buy-skeleton"]').exists()).toBe(true);
    resolveMarket({ listings: [], feePct: 0.05 });
    await flushPromises();
    expect(w.find('[data-testid="market-buy-skeleton"]').exists()).toBe(false);
  });

  it('render market-mine-skeleton khi đang fetch tab Bán', async () => {
    let resolveMine: (v: unknown[]) => void = () => {};
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockReturnValue(
      new Promise<unknown[]>((r) => {
        resolveMine = r;
      }),
    );
    listInventoryMock.mockResolvedValue([]);

    const w = mountView();
    await w.vm.$nextTick();

    // Switch to sell tab — skeleton rendered.
    await w.findAll('button').filter((b) => b.text().includes('Bán'))[0].trigger('click');
    await w.vm.$nextTick();
    expect(w.find('[data-testid="market-mine-skeleton"]').exists()).toBe(true);

    resolveMine([]);
    await flushPromises();
    expect(w.find('[data-testid="market-mine-skeleton"]').exists()).toBe(false);
  });

  it('hide skeleton + show empty state khi không có listing', async () => {
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([]);

    const w = mountView();
    await flushPromises();

    expect(w.find('[data-testid="market-buy-skeleton"]').exists()).toBe(false);
    expect(w.text()).toContain('Chưa có tin đăng');
  });
});

describe('MarketView — Phase 16.6 price band (L1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMarketMock.mockReset();
    listMineMock.mockReset();
    listInventoryMock.mockReset();
    postListingMock.mockReset();
    toastPushMock.mockReset();
  });

  it('render price band hint khi chọn item trong sell form', async () => {
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([
      {
        id: 'inv1',
        itemKey: 'so_kiem',
        qty: 1,
        equippedSlot: null,
        item: {
          key: 'so_kiem',
          name: 'Sơ Kiếm',
          description: '',
          kind: 'WEAPON',
          quality: 'PHAM',
          stackable: false,
          slot: 'WEAPON',
          bonuses: { atk: 5 },
          price: 30,
        },
        sockets: [],
        refineLevel: 0,
      },
    ]);

    const w = mountView();
    await flushPromises();

    // Switch to sell tab
    await w.findAll('button').filter((b) => b.text().includes('Bán'))[0].trigger('click');
    await w.vm.$nextTick();

    // No item selected yet → no hint
    expect(w.find('[data-testid="market-price-band-hint"]').exists()).toBe(false);

    // Select item — vue-test-utils setValue for select
    const select = w.find('select');
    await select.setValue('inv1');
    await w.vm.$nextTick();

    const hint = w.find('[data-testid="market-price-band-hint"]');
    expect(hint.exists()).toBe(true);
    // PHAM rarity band defaults: minPrice=10, maxPrice=1000.
    expect(hint.text()).toContain('10');
    expect(hint.text()).toContain('1000');
  });

  it('show error toast khi post listing trả PRICE_TOO_LOW', async () => {
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([
      {
        id: 'inv1',
        itemKey: 'so_kiem',
        qty: 1,
        equippedSlot: null,
        item: {
          key: 'so_kiem',
          name: 'Sơ Kiếm',
          description: '',
          kind: 'WEAPON',
          quality: 'PHAM',
          stackable: false,
          slot: 'WEAPON',
          bonuses: { atk: 5 },
          price: 30,
        },
        sockets: [],
        refineLevel: 0,
      },
    ]);
    postListingMock.mockRejectedValue(
      Object.assign(new Error('PRICE_TOO_LOW'), { code: 'PRICE_TOO_LOW' }),
    );

    const w = mountView();
    await flushPromises();

    await w.findAll('button').filter((b) => b.text().includes('Bán'))[0].trigger('click');
    await w.vm.$nextTick();

    await w.find('select').setValue('inv1');
    await w.vm.$nextTick();

    // Click post button (the one with "Đăng" text — note "Đăng bán" is the section
    // title, "Đăng" alone is the post button label per fixture).
    const postBtn = w
      .findAll('button')
      .filter((b) => b.text().trim() === 'Đăng')[0];
    expect(postBtn).toBeTruthy();
    await postBtn.trigger('click');
    await flushPromises();

    expect(postListingMock).toHaveBeenCalled();
    // Error toast pushed with PRICE_TOO_LOW i18n.
    const errorCall = toastPushMock.mock.calls.find(
      (c) => c[0]?.type === 'error',
    );
    expect(errorCall).toBeTruthy();
    expect(errorCall![0].text).toContain('thấp hơn');
  });
});

describe('MarketView — cross-navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMarketMock.mockReset();
    listMineMock.mockReset();
    listInventoryMock.mockReset();
    postListingMock.mockReset();
    toastPushMock.mockReset();
  });

  it('render role hint', async () => {
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="market-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="market-role-hint"]').text()).toContain('Mua bán');
  });

  it('render cross-navigation links', async () => {
    listMarketMock.mockResolvedValue({ listings: [], feePct: 0.05 });
    listMineMock.mockResolvedValue([]);
    listInventoryMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="market-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-market-v2"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-inventory"]').exists()).toBe(true);
  });
});
