/**
 * Market V2 Player UX Polish — tests.
 *
 * Coverage:
 *   - Renders title + tabs + calls list APIs on mount.
 *   - Renders auction cards with time remaining + status badge.
 *   - Renders role hint + cross-navigation.
 *   - Switches to claim box tab and calls claimEntry on click.
 *   - Shows empty states with hints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const toastPushMock = vi.fn();
const pushMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  listAuctions: vi.fn(),
  listClaimBox: vi.fn(),
  claimEntry: vi.fn(),
}));

vi.mock('@/api/marketV2', () => apiMocks);
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    props: ['disabled', 'variant', 'size'],
    template: '<button :disabled="disabled"><slot /></button>',
  },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', template: '<div><slot /><slot name="meta" /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxSection.vue', () => ({
  default: {
    name: 'XTLuxSectionStub',
    props: ['title', 'badge', 'tone'],
    template: '<div><slot /></div>',
  },
}));
vi.mock('@/components/xianxia/XTGlyphBadge.vue', () => ({
  default: { name: 'XTGlyphBadgeStub', template: '<span><slot /></span>' },
}));
vi.mock('@/components/xianxia/XTPullRefresh.vue', () => ({
  default: { name: 'XTPullRefreshStub', template: '<div><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));

import MarketV2View from '@/views/MarketV2View.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { error: 'err', loading: 'Đang tải...', search: 'Tìm', pullToRefresh: 'pull', releaseToRefresh: 'release', refreshing: 'refreshing' },
      luxHero: { marketV2: { eyebrow: 'eyebrow', label: 'label', subtitle: 'subtitle', breadcrumb: 'breadcrumb' } },
      marketV2: {
        title: 'Chợ Đấu Giá',
        tabAuctions: 'Đấu giá',
        tabClaimBox: 'Hộp nhận',
        filterItemKey: 'Lọc vật phẩm',
        itemKey: 'Item',
        qty: 'Qty',
        startPrice: 'Giá khởi điểm',
        currentBid: 'Bid',
        endsAt: 'Kết thúc',
        status: 'Trạng thái',
        noAuctions: 'Chưa có đấu giá nào',
        claim: 'Nhận',
        claimSuccess: 'Đã nhận',
        noClaimEntries: 'Hộp trống',
        roleHint: 'Chợ đấu giá — mua bán vật phẩm với người chơi khác.',
        timeLeft: '{time} còn lại',
        timeExpired: 'Hết hạn',
        timeDays: '{n} ngày',
        timeHours: '{n} giờ',
        timeMinutes: '{n} phút',
        bidLabel: '{amount} LN',
        noBid: 'Chưa có lượt',
        currencyLinhThach: 'Linh Thạch',
        currencyTienNgoc: 'Tiên Ngọc',
        statusActive: 'Đang diễn ra',
        statusEnded: 'Kết thúc',
        statusCancelled: 'Đã hủy',
        statusSold: 'Đã bán',
        sourceAUCTION_WON: 'Trúng đấu giá',
        sourceAUCTION_SELL: 'Bán thành công',
        sourceADMIN_REFUND: 'Hoàn trả',
        sourceMARKET_SOLD: 'Bán chợ',
        sourceOTHER: 'Khác',
        emptyHint: 'Vào Túi để xem vật phẩm có thể bán.',
        crossNav: {
          market: 'Chợ cũ',
          marketDesc: 'Giá cố định',
          inventory: 'Túi đồ',
          inventoryDesc: 'Xem vật phẩm',
        },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
  apiMocks.listAuctions.mockResolvedValue([]);
  apiMocks.listClaimBox.mockResolvedValue([]);
  apiMocks.claimEntry.mockResolvedValue(null);
  toastPushMock.mockClear();
  pushMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MarketV2View', () => {
  it('renders title + tabs + calls list APIs on mount', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Đấu giá');
    expect(wrapper.text()).toContain('Hộp nhận');
    expect(apiMocks.listAuctions).toHaveBeenCalled();
    expect(apiMocks.listClaimBox).toHaveBeenCalledWith('PENDING');
  });

  it('renders role hint and cross-navigation', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="market-v2-role-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="market-v2-cross-nav"]').exists()).toBe(true);
  });

  it('renders auction cards with time remaining and status badge', async () => {
    apiMocks.listAuctions.mockResolvedValueOnce([
      {
        id: 'a1',
        sellerCharacterId: 'c1',
        itemKey: 'item:foo',
        quantity: 5,
        currency: 'LINH_THACH',
        startPrice: '100',
        buyoutPrice: null,
        minBidStep: '10',
        currentBid: null,
        currentBidderId: null,
        status: 'ACTIVE',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        finalizedAt: null,
        taxAmount: null,
      },
    ]);
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="auction-list"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="auction-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="auction-time-remaining"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('item:foo');
    expect(wrapper.text()).toContain('Đang diễn ra');
  });

  it('renders empty state with hint when no auctions', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="auctions-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Chưa có đấu giá nào');
    expect(wrapper.text()).toContain('Vào Túi để xem vật phẩm có thể bán.');
  });

  it('switches to claim box tab and calls claimEntry on click', async () => {
    apiMocks.listClaimBox.mockResolvedValueOnce([
      {
        id: 'e1',
        source: 'AUCTION_WON',
        sourceRefId: null,
        itemKey: 'item:foo',
        itemQty: 3,
        currency: null,
        amount: null,
        status: 'PENDING',
        expiresAt: null,
        claimedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    const claimTab = wrapper.find('[data-testid="tab-claimBox"]');
    await claimTab.trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="claim-box-list"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="claim-card"]').exists()).toBe(true);
    const claimBtn = wrapper.find('[data-testid="claim-btn"]');
    expect(claimBtn.exists()).toBe(true);
    await claimBtn.trigger('click');
    await flushPromises();
    expect(apiMocks.claimEntry).toHaveBeenCalledWith('e1');
    expect(toastPushMock).toHaveBeenCalledWith({ type: 'success', text: 'Đã nhận' });
  });

  it('shows empty claim box state', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    const claimTab = wrapper.find('[data-testid="tab-claimBox"]');
    await claimTab.trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="claim-box-empty"]').exists()).toBe(true);
  });

  it('cross-navigation buttons navigate to correct routes', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    const marketBtn = wrapper.find('[data-testid="cross-nav-market"]');
    expect(marketBtn.exists()).toBe(true);
    await marketBtn.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/market');
    const inventoryBtn = wrapper.find('[data-testid="cross-nav-inventory"]');
    expect(inventoryBtn.exists()).toBe(true);
    await inventoryBtn.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/inventory');
  });
});
