/**
 * Phase 29.0 — AdminPvpCenterView smoke tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const toastPushMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  adminGetPolicy: vi.fn(),
  adminListBattleLogs: vi.fn(),
  adminInvalidateBattle: vi.fn(),
  adminListAnomalies: vi.fn(),
  adminResolveAnomaly: vi.fn(),
}));

vi.mock('@/api/pvp', () => apiMocks);
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { role: 'ADMIN' },
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    props: ['disabled', 'size', 'variant'],
    template: '<button :disabled="disabled"><slot /></button>',
  },
}));

import AdminPvpCenterView from '@/views/AdminPvpCenterView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { cancel: 'Cancel' },
      adminPvp: {
        title: 'Admin PvP',
        intro: 'i',
        loading: 'Loading',
        policy: {
          title: 'Policy',
          maxDailyChallenge: 'A',
          maxDailyPaidChallenge: 'B',
          sameTargetCooldown: 'C',
          maxArenaTokenPerDay: 'D',
          powerGapBlock: 'E',
          maxSeasonRewardTierDelta: 'F',
        },
        battles: {
          title: 'Battles',
          modeFilter: 'Mode',
          allModes: 'All',
          characterFilter: 'Char',
          characterPlaceholder: 'cid',
          search: 'Search',
          empty: 'No battles',
          invalidate: 'Invalidate',
        },
        anomalies: {
          title: 'Anomalies',
          statusFilter: 'Status',
          empty: 'No anomalies',
          resolve: 'Resolve',
        },
        invalidate: {
          title: 'Invalidate',
          warning: 'w',
          reasonPlaceholder: 'r',
          confirm: 'Confirm',
        },
        resolve: {
          title: 'Resolve',
          resolutionLabel: 'rsl',
          reasonPlaceholder: 'r',
          confirm: 'Confirm',
        },
        toast: { invalidated: 'inv', resolved: 'res' },
        errors: {
          load: 'load',
          search: 'search',
          invalidate: 'inv',
          resolve: 'res',
          reasonRequired: 'req',
        },
      },
    },
  },
});

const POLICY = {
  maxDailyChallenge: 12,
  maxDailyPaidChallenge: 6,
  paidChallengeCostKey: 'TIEN_NGOC',
  paidChallengeCostValue: 50,
  sameTargetCooldownMinutes: 60,
  powerGapWarningThreshold: 1.5,
  powerGapMatchBlockThreshold: 3.0,
  forbiddenRewardItemKeys: [],
  maxArenaTokenPerDay: 100,
  maxArenaTokenPerWeek: 500,
  maxSeasonRewardTierDelta: 1,
};

beforeEach(() => {
  setActivePinia(createPinia());
  toastPushMock.mockClear();
  apiMocks.adminGetPolicy
    .mockReset()
    .mockResolvedValue({ current: POLICY, default: POLICY });
  apiMocks.adminListBattleLogs.mockReset().mockResolvedValue([]);
  apiMocks.adminListAnomalies.mockReset().mockResolvedValue([]);
  apiMocks.adminInvalidateBattle.mockReset().mockResolvedValue({});
  apiMocks.adminResolveAnomaly.mockReset().mockResolvedValue({});
});

describe('AdminPvpCenterView smoke', () => {
  it('renders without crashing and fetches 3 endpoints on mount', async () => {
    const w = mount(AdminPvpCenterView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(apiMocks.adminGetPolicy).toHaveBeenCalledTimes(1);
    expect(apiMocks.adminListBattleLogs).toHaveBeenCalledTimes(1);
    expect(apiMocks.adminListAnomalies).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="admin-pvp-view"]').exists()).toBe(true);
    expect(w.find('[data-test="admin-pvp-policy"]').exists()).toBe(true);
  });

  it('renders empty state cho battles + anomalies', async () => {
    const w = mount(AdminPvpCenterView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(w.find('[data-test="admin-pvp-battles-empty"]').exists()).toBe(true);
    expect(w.find('[data-test="admin-pvp-anomalies-empty"]').exists()).toBe(true);
  });

  it('triggers search when button clicked', async () => {
    const w = mount(AdminPvpCenterView, { global: { plugins: [i18n] } });
    await flushPromises();
    apiMocks.adminListBattleLogs.mockClear();
    await w.find('[data-test="admin-pvp-search"]').trigger('click');
    await flushPromises();
    expect(apiMocks.adminListBattleLogs).toHaveBeenCalledTimes(1);
  });
});
