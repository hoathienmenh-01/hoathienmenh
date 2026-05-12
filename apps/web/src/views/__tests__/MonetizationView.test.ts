import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import MonetizationView from '@/views/MonetizationView.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';
import type { BattlePassState, MonthlyCardState, VipState } from '@/api/monetization';

const getBattlePassMock = vi.fn();
const claimBattlePassMock = vi.fn();
const claimAllBattlePassMock = vi.fn();
const getMonthlyCardMock = vi.fn();
const claimMonthlyCardMock = vi.fn();
const getVipMock = vi.fn();

vi.mock('@/api/monetization', () => ({
  getBattlePass: () => getBattlePassMock(),
  claimBattlePass: (...a: unknown[]) => claimBattlePassMock(...a),
  claimAllBattlePass: () => claimAllBattlePassMock(),
  getMonthlyCard: () => getMonthlyCardMock(),
  claimMonthlyCard: () => claimMonthlyCardMock(),
  getVip: () => getVipMock(),
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

function battlePass(over: Partial<BattlePassState['progress']> = {}): BattlePassState {
  return {
    season: {
      seasonId: 'phase_25_1_foundation',
      nameVi: 'Tiên Lộ Lệnh',
      nameEn: 'Battle Pass',
      startAt: '2026-05-01T00:00:00.000Z',
      endAt: '2026-06-01T00:00:00.000Z',
      xpPerLevel: 100,
      maxLevel: 10,
      rewards: [
        {
          level: 1,
          free: [{ kind: 'currency', key: 'linhThach', qty: 500 }],
          premium: [{ kind: 'item', key: 'tinh_thiet', qty: 6 }],
        },
        {
          level: 2,
          free: [{ kind: 'item', key: 'yeu_dan', qty: 2 }],
          premium: [{ kind: 'item', key: 'refine_protection_charm', qty: 1 }],
        },
      ],
    },
    progress: {
      xp: 100,
      level: 1,
      premiumUnlocked: false,
      claimedFreeLevels: [],
      claimedPremiumLevels: [],
      ...over,
    },
  };
}

function monthly(over: Partial<MonthlyCardState> = {}): MonthlyCardState {
  return {
    subscription: {
      activeUntil: '2026-06-01T00:00:00.000Z',
      lastClaimAt: null,
      totalClaimedDays: 0,
    },
    active: true,
    daysRemaining: 20,
    canClaimToday: true,
    todayReward: [{ kind: 'currency', key: 'tienNgocKhoa', qty: 10 }],
    ...over,
  };
}

function vip(over: Partial<VipState> = {}): VipState {
  return {
    profile: { vipLevel: 2, lifetimeTopupAmount: 150000, grantedByAdmin: true },
    perks: {
      autoSweepBonus: 1,
      inventorySlotBonus: 20,
      gemUnsocketFeeDiscountPct: 8,
      reforgeFeeDiscountPct: 8,
      dungeonEntryBonusDaily: 0,
    },
    nextLevel: 3,
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
  const w = mount(MonetizationView, { global: { plugins: [makeI18n(locale)] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getBattlePassMock.mockReset().mockResolvedValue(battlePass());
  claimBattlePassMock.mockReset();
  claimAllBattlePassMock.mockReset();
  getMonthlyCardMock.mockReset().mockResolvedValue(monthly());
  claimMonthlyCardMock.mockReset();
  getVipMock.mockReset().mockResolvedValue(vip());
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
});

describe('MonetizationView', () => {
  it('renders Battle Pass progress and locks unavailable premium/level rewards', async () => {
    const w = await mountView();

    expect(w.get('[data-testid="battle-pass-panel"]').text()).toContain('Tiên Lộ Lệnh');
    const buttons = w.findAll('button');
    const claimButtons = buttons.filter((b) => b.text() === 'Nhận');
    expect(claimButtons.some((b) => b.attributes('disabled') === undefined)).toBe(true);
    expect(claimButtons.some((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('claims Battle Pass free reward and refreshes displayed state', async () => {
    const claimed = battlePass({ claimedFreeLevels: [1] });
    claimBattlePassMock.mockResolvedValue(claimed);
    const w = await mountView();

    const claimButton = w.findAll('button').find((b) => b.text() === 'Nhận' && !b.attributes('disabled'));
    expect(claimButton).toBeDefined();
    await claimButton!.trigger('click');
    await flushPromises();

    expect(claimBattlePassMock).toHaveBeenCalledWith(1, 'free');
    expect(w.text()).toContain('Đã nhận');
  });

  it('renders Monthly Card claim state', async () => {
    const w = await mountView();
    await w.findAll('button').find((b) => b.text() === 'Nguyệt Tạp')!.trigger('click');
    await flushPromises();

    expect(w.get('[data-testid="monthly-card-panel"]').text()).toContain('Còn 20 ngày');
    expect(w.get('[data-testid="monthly-card-panel"]').text()).toContain('Tiên Ngọc');
  });

  it('renders VIP light perk list', async () => {
    const w = await mountView();
    await w.findAll('button').find((b) => b.text() === 'VIP Light')!.trigger('click');
    await flushPromises();

    const panel = w.get('[data-testid="vip-panel"]').text();
    expect(panel).toContain('VIP 2');
    expect(panel).toContain('+20 ô túi');
  });

  it('renders English locale keys for i18n parity', async () => {
    const w = await mountView('en');
    expect(w.text()).toContain('Battle Pass');
    await w.findAll('button').find((b) => b.text() === 'Monthly Card')!.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Active for 20 more days');
  });
});
