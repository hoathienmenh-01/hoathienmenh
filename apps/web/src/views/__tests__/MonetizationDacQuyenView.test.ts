import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import MonetizationDacQuyenView from '@/views/MonetizationDacQuyenView.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';
import type {
  BattlePassMissionsView,
  LimitedShopListing,
  MonetizationOverview,
} from '@/api/monetization';

const getMonetizationOverviewMock = vi.fn();
const getBattlePassMissionsMock = vi.fn();
const getLimitedShopsMock = vi.fn();
const buyLimitedShopItemMock = vi.fn();

vi.mock('@/api/monetization', () => ({
  getMonetizationOverview: () => getMonetizationOverviewMock(),
  getBattlePassMissions: () => getBattlePassMissionsMock(),
  getLimitedShops: () => getLimitedShopsMock(),
  buyLimitedShopItem: (...a: unknown[]) => buyLimitedShopItemMock(...a),
}));

function overview(over: Partial<MonetizationOverview> = {}): MonetizationOverview {
  return {
    activeEntitlements: [],
    monthlyCards: [],
    battlePass: {
      seasonId: 'phase_25_1_foundation',
      level: 0,
      maxLevel: 50,
      xp: 0,
      xpPerLevel: 100,
      premiumUnlocked: false,
      endsAt: '2026-06-01T00:00:00.000Z',
    },
    growthFunds: [
      { fundKey: 'pham', purchased: false, purchasedAt: null, claimedMilestones: [] },
      { fundKey: 'tien', purchased: false, purchasedAt: null, claimedMilestones: [] },
    ],
    limitedShops: [
      { shopKey: 'DAILY_SHOP', period: 'DAILY', periodKey: '2026-05-15' },
      { shopKey: 'WEEKLY_SHOP', period: 'WEEKLY', periodKey: '2026-W20' },
      { shopKey: 'MONTHLY_SHOP', period: 'MONTHLY', periodKey: '2026-05' },
    ],
    sweepTickets: [
      { itemKey: 'BI_CANH_TICKET', quantity: 0 },
      { itemKey: 'sweep_ticket_common', quantity: 0 },
    ],
    extraAttempts: [],
    wallet: [
      { currency: 'TIEN_NGOC', amount: 0 },
      { currency: 'TIEN_NGOC_KHOA', amount: 0 },
    ],
    ...over,
  };
}

function missions(): BattlePassMissionsView {
  return {
    seasonId: 'phase_25_1_foundation',
    daily: [
      {
        mission: {
          key: 'bp_daily_autofarm',
          scope: 'DAILY',
          source: 'AUTO_FARM_SESSION',
          target: 1,
          expReward: 100,
          nameVi: 'Auto farm 1 phiên',
          nameEn: 'Auto farm 1 session',
          descriptionVi: 'Hoàn thành 1 phiên auto farm',
        },
        scopeBucket: '2026-05-15',
        progress: 0,
        target: 1,
        completed: false,
        claimed: false,
      },
    ],
    weekly: [],
    season: [],
  };
}

function shops(): LimitedShopListing[] {
  return [
    {
      shopKey: 'DAILY_SHOP',
      period: 'DAILY',
      periodKey: '2026-05-15',
      items: [
        {
          item: {
            shopKey: 'DAILY_SHOP',
            itemKey: 'sweep_ticket_common',
            nameVi: 'Vé quét nhanh',
            nameEn: 'Sweep Ticket',
            descriptionVi: 'Vé quét content đã clear.',
            priceCurrency: 'TIEN_NGOC_KHOA',
            priceAmount: 50,
            purchaseLimitCount: 5,
            reward: [{ kind: 'item', key: 'sweep_ticket_common', qty: 1 }],
            enabled: true,
          },
          periodKey: '2026-05-15',
          purchasedInPeriod: 0,
          remaining: 5,
          soldOut: false,
        },
        {
          item: {
            shopKey: 'DAILY_SHOP',
            itemKey: 'protection_charm',
            nameVi: 'Phù bảo hộ',
            nameEn: 'Protection Charm',
            descriptionVi: 'Phù bảo hộ.',
            priceCurrency: 'TIEN_NGOC_KHOA',
            priceAmount: 100,
            purchaseLimitCount: 3,
            reward: [{ kind: 'item', key: 'refine_protection_charm', qty: 1 }],
            enabled: true,
          },
          periodKey: '2026-05-15',
          purchasedInPeriod: 3,
          remaining: 0,
          soldOut: true,
        },
      ],
    },
    {
      shopKey: 'WEEKLY_SHOP',
      period: 'WEEKLY',
      periodKey: '2026-W20',
      items: [],
    },
    {
      shopKey: 'MONTHLY_SHOP',
      period: 'MONTHLY',
      periodKey: '2026-05',
      items: [],
    },
  ];
}

function setupI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'en',
    messages: { vi: viMessages, en: enMessages },
  });
}

describe('MonetizationDacQuyenView — Phase 27.1–27.5', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMonetizationOverviewMock.mockReset();
    getBattlePassMissionsMock.mockReset();
    getLimitedShopsMock.mockReset();
    buyLimitedShopItemMock.mockReset();

    getMonetizationOverviewMock.mockResolvedValue(overview());
    getBattlePassMissionsMock.mockResolvedValue(missions());
    getLimitedShopsMock.mockResolvedValue(shops());
  });

  it('renders 7 tabs and defaults to entitlements', async () => {
    const wrapper = mount(MonetizationDacQuyenView, {
      global: { plugins: [setupI18n()] },
    });
    await flushPromises();
    const tabs = wrapper.findAll('.tab');
    expect(tabs).toHaveLength(7);
    expect(wrapper.find('h2').text()).toContain('Quyền lợi');
  });

  it('switches to limited shop tab and disables sold-out item', async () => {
    const wrapper = mount(MonetizationDacQuyenView, {
      global: { plugins: [setupI18n()] },
    });
    await flushPromises();
    const limitedTab = wrapper.findAll('.tab').find((b) => b.text().includes('Shop'));
    expect(limitedTab).toBeDefined();
    await limitedTab!.trigger('click');
    await flushPromises();

    const buttons = wrapper.findAll('.shop-item button');
    expect(buttons.length).toBeGreaterThan(0);
    const soldOutBtn = buttons.find((b) => b.attributes('disabled') !== undefined && b.text().includes('Hết'));
    expect(soldOutBtn).toBeDefined();
  });

  it('renders growth fund tien variant in tab', async () => {
    const wrapper = mount(MonetizationDacQuyenView, {
      global: { plugins: [setupI18n()] },
    });
    await flushPromises();
    const growthTab = wrapper.findAll('.tab').find((b) => b.text().includes('Quỹ'));
    await growthTab!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('tien');
    expect(wrapper.text()).toContain('Chưa mua');
  });

  it('shows missions in battle pass tab', async () => {
    const wrapper = mount(MonetizationDacQuyenView, {
      global: { plugins: [setupI18n()] },
    });
    await flushPromises();
    const bpTab = wrapper.findAll('.tab').find((b) => b.text().includes('Tiên Lộ Lệnh'));
    await bpTab!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Auto farm 1 phiên');
    expect(wrapper.text()).toContain('Cấp 0');
  });

  it('clicking buy on available item calls API', async () => {
    buyLimitedShopItemMock.mockResolvedValue({
      shopKey: 'DAILY_SHOP',
      itemKey: 'sweep_ticket_common',
      periodKey: '2026-05-15',
      quantity: 1,
      totalInPeriod: 1,
      limit: 5,
    });
    const wrapper = mount(MonetizationDacQuyenView, {
      global: { plugins: [setupI18n()] },
    });
    await flushPromises();
    const limitedTab = wrapper.findAll('.tab').find((b) => b.text().includes('Shop'));
    await limitedTab!.trigger('click');
    await flushPromises();

    const buyBtn = wrapper.findAll('button').find((b) => b.text() === 'Mua');
    expect(buyBtn).toBeDefined();
    await buyBtn!.trigger('click');
    await flushPromises();
    expect(buyLimitedShopItemMock).toHaveBeenCalledWith('DAILY_SHOP', 'sweep_ticket_common');
  });
});
