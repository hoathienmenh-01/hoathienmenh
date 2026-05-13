/**
 * Phase 30.0 — MarketV2View smoke tests.
 *
 * Bao phủ:
 *   - Render được tab Auctions + Claim Box.
 *   - listAuctions + listClaimBox được gọi khi mount.
 *   - Click claim button gọi claimEntry + refresh + toast success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const toastPushMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  listAuctions: vi.fn(),
  listClaimBox: vi.fn(),
  claimEntry: vi.fn(),
}));

vi.mock('@/api/marketV2', () => apiMocks);
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div><slot /></div>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    props: ['disabled', 'variant', 'size'],
    template: '<button :disabled="disabled"><slot /></button>',
  },
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
      common: { error: 'err', loading: 'loading', search: 'search' },
      marketV2: {
        title: 'Market',
        tabAuctions: 'Auctions',
        tabClaimBox: 'Claim Box',
        filterItemKey: 'filter',
        itemKey: 'Item',
        qty: 'Qty',
        startPrice: 'Start',
        currentBid: 'Bid',
        endsAt: 'Ends',
        status: 'Status',
        noAuctions: 'no auctions',
        claim: 'Claim',
        claimSuccess: 'claimed',
        noClaimEntries: 'empty',
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MarketV2View', () => {
  it('renders title + tabs + calls list APIs on mount', async () => {
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Market');
    expect(apiMocks.listAuctions).toHaveBeenCalled();
    expect(apiMocks.listClaimBox).toHaveBeenCalledWith('PENDING');
  });

  it('renders auction rows when listAuctions returns data', async () => {
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
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        finalizedAt: null,
        taxAmount: null,
      },
    ]);
    const wrapper = mount(MarketV2View, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('item:foo');
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
    const tabs = wrapper.findAll('button');
    const claimTab = tabs.find((b) => b.text().includes('Claim Box'));
    await claimTab!.trigger('click');
    await flushPromises();
    const claimBtns = wrapper.findAll('button').filter((b) => b.text() === 'Claim');
    expect(claimBtns.length).toBeGreaterThan(0);
    await claimBtns[0].trigger('click');
    await flushPromises();
    expect(apiMocks.claimEntry).toHaveBeenCalledWith('e1');
    expect(toastPushMock).toHaveBeenCalledWith({ type: 'success', text: 'claimed' });
  });
});
