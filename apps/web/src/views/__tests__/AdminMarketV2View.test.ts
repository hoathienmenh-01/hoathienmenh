import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const listAuctionsMock = vi.fn().mockResolvedValue([]);
const cancelMock = vi.fn().mockResolvedValue(undefined);
const finalizeMock = vi.fn().mockResolvedValue({ finalized: 0, candidates: 0 });
const refundMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/api/marketV2', () => ({
  adminListAuctions: (...a: unknown[]) => listAuctionsMock(...a),
  adminCancelAuction: (...a: unknown[]) => cancelMock(...a),
  adminFinalizeExpired: (...a: unknown[]) => finalizeMock(...a),
  adminRefundClaim: (...a: unknown[]) => refundMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
    isAdmin: true,
    user: { id: '1', role: 'ADMIN' },
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: { name: 'MButtonStub', template: '<button v-bind="$attrs"><slot /></button>' },
}));

import AdminMarketV2View from '@/views/AdminMarketV2View.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang tải', error: 'Lỗi', all: 'Tất cả', refresh: 'Tải lại', actions: 'Hành động' },
      marketV2: { itemKey: 'Item', qty: 'Qty', currentBid: 'Bid', status: 'Status', noAuctions: 'Trống' },
      adminMarket: {
        title: 'Thương Tập Tổng Khiển',
        cancel: 'Hủy',
        cancelReasonPrompt: 'Lý do',
        cancelSuccess: 'Đã hủy',
        finalizeExpired: 'Finalize',
        finalizedCount: '{n}/{total}',
        refundTitle: 'Hoàn',
        characterId: 'CID',
        itemKey: 'Item',
        itemQty: 'Qty',
        selectCurrency: 'Chọn',
        amount: 'Amount',
        reason: 'Lý do',
        refund: 'Hoàn',
        refundSuccess: 'OK',
      },
    },
  },
});

function mountView() {
  return mount(AdminMarketV2View, { global: { plugins: [i18n] } });
}

describe('AdminMarketV2View — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listAuctionsMock.mockResolvedValue([]);
  });

  it('render title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Thương Tập Tổng Khiển');
    w.unmount();
  });

  it('render status filter and buttons', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('select').exists()).toBe(true);
    expect(w.text()).toContain('Finalize');
    w.unmount();
  });

  it('render empty auctions table', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Trống');
    w.unmount();
  });

  it('render refund form', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Hoàn');
    w.unmount();
  });
});
