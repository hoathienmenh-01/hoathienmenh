/**
 * Phase 13.1.B — SectShopPanel tests.
 *
 * Mock /sect/shop client; verify:
 *   - render entries table (item, cost, daily/weekly limit, qty input).
 *   - render contribution balance + maxBuyable hint.
 *   - buy success → emit `bought` + toast + refresh.
 *   - buy disabled khi insufficient contribution / daily limit.
 *   - loading/error state KHÔNG crash.
 *   - non-stackable disabled qty input.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getSectShopMock = vi.fn();
const buySectShopEntryMock = vi.fn();

vi.mock('@/api/sectShop', () => ({
  getSectShop: (...a: unknown[]) => getSectShopMock(...a),
  buySectShopEntry: (...a: unknown[]) => buySectShopEntryMock(...a),
}));

import SectShopPanel from '@/components/SectShopPanel.vue';
import type { SectShopListView } from '@/api/sectShop';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      sectShop: {
        title: 'Shop Tông Môn',
        loading: 'Đang tải Shop…',
        empty: 'Shop Tông trống.',
        noSect: 'Cần gia nhập Tông Môn để mở Shop.',
        balance: 'Cống hiến khả dụng: {balance}',
        cost: '{n} cống hiến',
        daily: 'Ngày: {n}/{m}',
        weekly: 'Tuần: {n}/{m}',
        minLevel: 'Yêu cầu Tông cấp ≥{n}',
        nonStackable: 'Không cộng dồn',
        buyBtn: 'Mua',
        maxBuyable: 'Có thể mua tối đa {n}',
        col: {
          item: 'Vật phẩm',
          cost: 'Giá',
          limit: 'Giới hạn',
          qty: 'SL',
        },
        toast: { bought: 'Mua {item} ×{qty} — −{cost} cống hiến.' },
        errors: {
          NO_CHARACTER: 'Chưa có nhân vật.',
          SECT_REQUIRED: 'Cần gia nhập Tông Môn.',
          ENTRY_NOT_FOUND: 'Mặt hàng không còn.',
          INVALID_QTY: 'Số lượng không hợp lệ.',
          NON_STACKABLE_QTY_GT_1: 'Vật phẩm không cộng dồn — chỉ mua 1.',
          INSUFFICIENT_CONTRIBUTION: 'Không đủ điểm cống hiến.',
          DAILY_LIMIT: 'Đã đạt giới hạn ngày.',
          WEEKLY_LIMIT: 'Đã đạt giới hạn tuần.',
          SECT_LEVEL_REQUIRED: 'Tông cấp chưa đủ.',
          RATE_LIMITED: 'Quá nhiều yêu cầu — chờ vài giây.',
          UNKNOWN: 'Không thể mua — thử lại.',
        },
      },
    },
  },
});

const SAMPLE: SectShopListView = {
  contribBalance: 200,
  sectLevel: 1,
  sectId: 'sect-1',
  entries: [
    {
      key: 'sect_shop_huyet_chi_dan',
      itemKey: 'huyet_chi_dan',
      itemNameI18nKey: null,
      contributionCost: 50,
      dailyLimit: 5,
      weeklyLimit: null,
      boughtToday: 1,
      boughtThisWeek: 1,
      requiredSectLevel: null,
      stackable: true,
    },
    {
      key: 'sect_shop_thanh_lam_dan',
      itemKey: 'thanh_lam_dan',
      itemNameI18nKey: null,
      contributionCost: 250,
      dailyLimit: 3,
      weeklyLimit: null,
      boughtToday: 0,
      boughtThisWeek: 0,
      requiredSectLevel: null,
      stackable: true,
    },
    {
      key: 'sect_shop_than_dan',
      itemKey: 'than_dan',
      itemNameI18nKey: null,
      contributionCost: 5000,
      dailyLimit: null,
      weeklyLimit: 1,
      boughtToday: 0,
      boughtThisWeek: 0,
      requiredSectLevel: null,
      stackable: false,
    },
  ],
};

function mountPanel() {
  return mount(SectShopPanel, {
    global: { plugins: [i18n] },
  });
}

describe('SectShopPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getSectShopMock.mockReset();
    buySectShopEntryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render entries table với cost + limit + qty input', async () => {
    getSectShopMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-shop-panel"]').exists()).toBe(true);
    expect(w.text()).toContain('Shop Tông Môn');

    const rows = w.findAll('[data-test="sect-shop-row"]');
    expect(rows.length).toBe(3);

    // Cost render đúng từng entry (50/250/5000 cống hiến).
    expect(w.text()).toContain('50 cống hiến');
    expect(w.text()).toContain('250 cống hiến');
    expect(w.text()).toContain('5000 cống hiến');
    // Daily/weekly limit hint render.
    expect(w.text()).toContain('Ngày: 1/5');
    expect(w.text()).toContain('Tuần: 0/1');
  });

  it('render balance + maxBuyable hint', async () => {
    getSectShopMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    // Header balance.
    expect(w.text()).toContain('Cống hiến khả dụng: 200');
    // Max buyable shown for entry buy-able (huyet_chi_dan: 200/50=4, daily rem 4 → 4).
    expect(w.text()).toContain('Có thể mua tối đa 4');
  });

  it('buy success → emit `bought` payload + refresh', async () => {
    getSectShopMock
      .mockResolvedValueOnce(SAMPLE)
      .mockResolvedValueOnce({ ...SAMPLE, contribBalance: 150 });
    buySectShopEntryMock.mockResolvedValueOnce({
      entryKey: 'sect_shop_huyet_chi_dan',
      itemKey: 'huyet_chi_dan',
      qty: 1,
      totalCost: 50,
      contribBalanceAfter: 150,
      boughtTodayAfter: 2,
      boughtThisWeekAfter: 1,
    });

    const w = mountPanel();
    await flushPromises();

    const buyBtns = w.findAll('[data-test="sect-shop-buy"]');
    // huyet_chi_dan first row enabled.
    await buyBtns[0].trigger('click');
    await flushPromises();

    expect(buySectShopEntryMock).toHaveBeenCalledWith(
      'sect_shop_huyet_chi_dan',
      1,
    );
    expect(getSectShopMock).toHaveBeenCalledTimes(2); // initial + refresh
    const events = w.emitted('bought');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual([{ contribBalance: 150 }]);
  });

  it('insufficient contribution → buy button disabled, hiển thị error i18n', async () => {
    getSectShopMock.mockResolvedValueOnce({
      ...SAMPLE,
      contribBalance: 10, // chỉ đủ < 50 cost.
    });
    const w = mountPanel();
    await flushPromises();

    const buyBtns = w.findAll('[data-test="sect-shop-buy"]');
    // 3 entries — toàn bộ disabled vì balance < cost.
    for (const b of buyBtns) {
      expect(b.attributes('disabled')).toBeDefined();
    }
    expect(w.text()).toContain('Không đủ điểm cống hiến.');
  });

  it('disabled item nếu daily limit hit (boughtToday == dailyLimit) → button disabled + hint DAILY_LIMIT', async () => {
    getSectShopMock.mockResolvedValueOnce({
      ...SAMPLE,
      entries: SAMPLE.entries.map((e) =>
        e.key === 'sect_shop_huyet_chi_dan'
          ? { ...e, boughtToday: 5, dailyLimit: 5 } // hit daily limit
          : e,
      ),
    });
    const w = mountPanel();
    await flushPromises();

    const buyBtns = w.findAll('[data-test="sect-shop-buy"]');
    // First row (huyet_chi_dan) phải disabled khi daily exhausted.
    expect(buyBtns[0].attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Đã đạt giới hạn ngày.');
  });

  it('non-stackable item: qty input disabled (stackable=false) + hint nonStackable', async () => {
    getSectShopMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    const qtyInputs = w.findAll('[data-test="sect-shop-qty"]');
    expect(qtyInputs.length).toBe(3);
    // Index 2 = than_dan (stackable=false).
    expect(qtyInputs[2].attributes('disabled')).toBeDefined();
    // Index 0/1 stackable=true → KHÔNG disabled.
    expect(qtyInputs[0].attributes('disabled')).toBeUndefined();
    expect(w.text()).toContain('Không cộng dồn');
  });

  it('loading/error state KHÔNG crash', async () => {
    let resolveFn: ((v: SectShopListView) => void) | null = null;
    getSectShopMock.mockReturnValueOnce(
      new Promise<SectShopListView>((r) => {
        resolveFn = r;
      }),
    );
    const w = mountPanel();
    expect(w.find('[data-test="sect-shop-loading"]').exists()).toBe(true);
    resolveFn!({ ...SAMPLE, sectId: null, entries: [] });
    await flushPromises();
    expect(w.find('[data-test="sect-shop-loading"]').exists()).toBe(false);
    expect(w.text()).toContain('Cần gia nhập Tông Môn để mở Shop.');
  });
});
