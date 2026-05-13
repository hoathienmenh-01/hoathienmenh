/**
 * Phase 29.0 — PvpView smoke tests.
 *
 * Bao phủ:
 *   - View render được khi không có defense profile (empty state).
 *   - Policy hints render từ getPvpPolicy.
 *   - Battle logs list render hoặc empty state.
 *   - Click "Lưu thế trận" gọi upsertDefenseProfile + push toast success.
 *   - Click "Khiêu chiến" với target empty → toast error, không gọi API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const toastPushMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  getPvpPolicy: vi.fn(),
  getDefenseProfile: vi.fn(),
  upsertDefenseProfile: vi.fn(),
  challengePvp: vi.fn(),
  listBattleLogs: vi.fn(),
}));

vi.mock('@/api/pvp', () => apiMocks);
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
    props: ['disabled', 'variant', 'size', 'type', 'loading'],
    template: '<button :disabled="disabled"><slot /></button>',
  },
}));

import PvpView from '@/views/PvpView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      pvp: {
        title: 'PvP',
        intro: 'intro',
        loading: 'Loading',
        modes: { DUEL: 'Duel', FRIENDLY_SPARRING: 'Friendly' },
        policy: {
          title: 'Policy',
          maxDailyChallenge: 'Max/Day',
          sameTargetCooldownMinutes: 'Cooldown',
          powerGapWarning: 'Warn',
          powerGapBlock: 'Block',
        },
        defense: {
          title: 'Defense',
          hint: 'hint',
          empty: 'Chưa lưu thế trận.',
          label: 'Label',
          labelPlaceholder: 'PL',
          save: 'Save',
          snapshotPower: 'Power',
          snapshotRealm: 'Realm',
          updatedAt: 'Updated',
        },
        challenge: {
          title: 'Challenge',
          hint: 'hint',
          target: 'Target',
          targetPlaceholder: 'id',
          mode: 'Mode',
          submit: 'Submit',
          lastResult: 'Last',
          result: 'Result',
          powerGap: 'Gap',
          rewardGranted: 'Reward',
          ratingDelta: 'Delta',
        },
        logs: {
          title: 'Logs',
          filter: 'F',
          all: 'All',
          empty: 'No logs.',
          mode: 'Mode',
          result: 'Result',
          powerGap: 'Gap',
          reward: 'Reward',
          createdAt: 'When',
        },
        toast: {
          defenseSaved: 'saved',
          challengeResolved: 'resolved {result}',
        },
        errors: {
          load: 'load',
          defenseSave: 'def err',
          challenge: 'cha err',
          targetRequired: 'target required',
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
  apiMocks.getPvpPolicy.mockReset().mockResolvedValue(POLICY);
  apiMocks.getDefenseProfile.mockReset().mockResolvedValue(null);
  apiMocks.upsertDefenseProfile.mockReset().mockResolvedValue({
    characterId: 1,
    snapshot: {
      characterId: 1,
      realmOrder: 0,
      totalPower: 100,
      snapshotType: 'DEFENDER',
      createdAt: new Date().toISOString(),
    },
    label: 'L',
    updatedAt: new Date().toISOString(),
  });
  apiMocks.listBattleLogs.mockReset().mockResolvedValue({
    logs: [],
    characterId: 'c1',
  });
  apiMocks.challengePvp.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function mountView() {
  return mount(PvpView, { global: { plugins: [i18n] } });
}

describe('PvpView smoke', () => {
  it('renders without crashing và gọi 3 API khi mount', async () => {
    const w = mountView();
    await flushPromises();
    expect(apiMocks.getPvpPolicy).toHaveBeenCalledTimes(1);
    expect(apiMocks.getDefenseProfile).toHaveBeenCalledTimes(1);
    expect(apiMocks.listBattleLogs).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="pvp-view"]').exists()).toBe(true);
    expect(w.find('[data-test="pvp-policy"]').exists()).toBe(true);
  });

  it('renders empty defense + empty logs state', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-test="pvp-defense-empty"]').exists()).toBe(true);
    expect(w.find('[data-test="pvp-logs-empty"]').exists()).toBe(true);
  });

  it('blocks submit khi target empty và push error toast', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="pvp-challenge-submit"]').trigger('click');
    await flushPromises();
    expect(apiMocks.challengePvp).not.toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('saves defense profile and push success toast', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="pvp-defense-save"]').trigger('click');
    await flushPromises();
    expect(apiMocks.upsertDefenseProfile).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });
});
