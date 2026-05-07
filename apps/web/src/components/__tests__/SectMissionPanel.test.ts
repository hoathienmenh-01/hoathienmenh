/**
 * Phase 13.1.B — SectMissionPanel tests.
 *
 * Mock /sect/missions client; verify:
 *   - render daily/weekly mission list + balance/lifetime header.
 *   - render progress bar + progress text.
 *   - claim success → emit `claimed` + toast success + refresh.
 *   - claim error → toast error i18n.
 *   - empty state khi sect=null không crash; loading/error skeleton render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getSectMissionsMock = vi.fn();
const claimSectMissionMock = vi.fn();

vi.mock('@/api/sectMissions', () => ({
  getSectMissions: (...a: unknown[]) => getSectMissionsMock(...a),
  claimSectMission: (...a: unknown[]) => claimSectMissionMock(...a),
}));

import SectMissionPanel from '@/components/SectMissionPanel.vue';
import type { SectMissionListView } from '@/api/sectMissions';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      sectMission: {
        title: 'Nhiệm vụ Tông Môn',
        loading: 'Đang tải nhiệm vụ Tông Môn…',
        balance: 'Cống hiến: {balance} (lifetime {lifetime})',
        noSect: 'Cần gia nhập Tông Môn để nhận nhiệm vụ.',
        empty: 'Chưa có nhiệm vụ.',
        dailyHeader: 'Nhiệm vụ ngày',
        weeklyHeader: 'Nhiệm vụ tuần',
        progress: '{cur}/{tar}',
        claimBtn: 'Nhận thưởng',
        claimed: 'Đã nhận',
        notReady: 'Chưa đủ',
        reward: {
          contrib: '{n} cống hiến',
          linhThach: '{n} Linh Thạch',
          tienNgoc: '{n} Tiên Ngọc',
          item: '{k} ×{n}',
        },
        toast: { claimed: 'Hoàn thành: {title} — +{contrib} cống hiến.' },
        missions: {
          daily_dungeon_clear_3: {
            title: 'Quét 3 Bí Cảnh hôm nay',
            desc: 'Hoàn thành 3 lần Bí Cảnh.',
          },
          daily_boss_damage_500: {
            title: 'Đả thương boss thế giới 25',
            desc: 'Tích lũy đả thương boss.',
          },
          weekly_quest_clear_5: {
            title: 'Hoàn thành 5 Nhiệm Vụ tuần',
            desc: '5 lần claim trong tuần.',
          },
        },
        errors: {
          ALREADY_CLAIMED: 'Đã nhận thưởng nhiệm vụ này.',
          UNKNOWN: 'Không thể nhận thưởng — thử lại.',
        },
      },
    },
  },
});

const SAMPLE: SectMissionListView = {
  contribLifetime: 480,
  contribBalance: 220,
  sectId: 'sect-1',
  sectName: 'Thanh Liên Tông',
  missions: [
    {
      key: 'sect_daily_dungeon_3',
      cadence: 'DAILY',
      activityKey: 'dungeon_clear',
      target: 3,
      rewardContribution: 30,
      rewardCurrency: null,
      rewardCurrencyAmount: null,
      rewardItemKey: null,
      rewardItemQty: null,
      titleI18nKey: 'sectMission.missions.daily_dungeon_clear_3.title',
      descriptionI18nKey: 'sectMission.missions.daily_dungeon_clear_3.desc',
      progress: 3,
      ready: true,
      claimed: false,
      periodKey: '2030-01-01',
      periodStartIso: '2030-01-01T00:00:00.000Z',
      periodEndIso: '2030-01-02T00:00:00.000Z',
    },
    {
      key: 'sect_daily_boss_damage',
      cadence: 'DAILY',
      activityKey: 'boss_damage',
      target: 25,
      rewardContribution: 35,
      rewardCurrency: null,
      rewardCurrencyAmount: null,
      rewardItemKey: null,
      rewardItemQty: null,
      titleI18nKey: 'sectMission.missions.daily_boss_damage_500.title',
      descriptionI18nKey: 'sectMission.missions.daily_boss_damage_500.desc',
      progress: 10,
      ready: false,
      claimed: false,
      periodKey: '2030-01-01',
      periodStartIso: '2030-01-01T00:00:00.000Z',
      periodEndIso: '2030-01-02T00:00:00.000Z',
    },
    {
      key: 'sect_weekly_quest_5',
      cadence: 'WEEKLY',
      activityKey: 'quest_complete',
      target: 5,
      rewardContribution: 150,
      rewardCurrency: 'LINH_THACH',
      rewardCurrencyAmount: 500,
      rewardItemKey: null,
      rewardItemQty: null,
      titleI18nKey: 'sectMission.missions.weekly_quest_clear_5.title',
      descriptionI18nKey: 'sectMission.missions.weekly_quest_clear_5.desc',
      progress: 5,
      ready: true,
      claimed: true,
      periodKey: '2030-W01',
      periodStartIso: '2029-12-30T00:00:00.000Z',
      periodEndIso: '2030-01-06T00:00:00.000Z',
    },
  ],
};

function mountPanel() {
  return mount(SectMissionPanel, {
    global: { plugins: [i18n] },
  });
}

describe('SectMissionPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getSectMissionsMock.mockReset();
    claimSectMissionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render mission list daily + weekly + balance/lifetime header', async () => {
    getSectMissionsMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-mission-panel"]').exists()).toBe(true);
    expect(w.text()).toContain('Nhiệm vụ Tông Môn');
    // Balance + lifetime hiển thị từ payload.
    expect(w.text()).toContain('220');
    expect(w.text()).toContain('480');

    const rows = w.findAll('[data-test="sect-mission-row"]');
    // 3 mission rows total (2 daily + 1 weekly).
    expect(rows.length).toBe(3);

    expect(w.text()).toContain('Nhiệm vụ ngày');
    expect(w.text()).toContain('Nhiệm vụ tuần');
    expect(w.text()).toContain('Quét 3 Bí Cảnh hôm nay');
    expect(w.text()).toContain('Hoàn thành 5 Nhiệm Vụ tuần');
  });

  it('render progress text + claim/notReady/claimed button gate đúng theo flag', async () => {
    getSectMissionsMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.text()).toContain('3/3');
    expect(w.text()).toContain('10/25');
    expect(w.text()).toContain('5/5');

    const claimBtns = w.findAll('[data-test="sect-mission-claim"]');
    // 1 ready (daily_dungeon_3) + 1 notReady (boss_damage) + 1 claimed (weekly_quest_5).
    const labels = claimBtns.map((b) => b.text());
    expect(labels).toContain('Nhận thưởng');
    expect(labels).toContain('Chưa đủ');
    expect(labels).toContain('Đã nhận');

    // Disabled state mirror !ready || claimed.
    const notReadyBtn = claimBtns.find((b) => b.text() === 'Chưa đủ');
    const claimedBtn = claimBtns.find((b) => b.text() === 'Đã nhận');
    expect(notReadyBtn!.attributes('disabled')).toBeDefined();
    expect(claimedBtn!.attributes('disabled')).toBeDefined();
  });

  it('claim success → claimSectMission gọi đúng key + emit `claimed` payload + refresh', async () => {
    getSectMissionsMock
      .mockResolvedValueOnce(SAMPLE)
      .mockResolvedValueOnce({ ...SAMPLE, contribBalance: 250 });
    claimSectMissionMock.mockResolvedValueOnce({
      missionKey: 'sect_daily_dungeon_3',
      cadence: 'DAILY',
      periodKey: '2030-01-01',
      rewardContribution: 30,
      contribBalanceAfter: 250,
      contribLifetimeAfter: 510,
    });

    const w = mountPanel();
    await flushPromises();

    const claimBtns = w.findAll('[data-test="sect-mission-claim"]');
    const ready = claimBtns.find((b) => b.text() === 'Nhận thưởng')!;
    await ready.trigger('click');
    await flushPromises();

    expect(claimSectMissionMock).toHaveBeenCalledWith('sect_daily_dungeon_3');
    expect(getSectMissionsMock).toHaveBeenCalledTimes(2); // initial + post-claim refresh
    const events = w.emitted('claimed');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual([
      { contribBalance: 250, contribLifetime: 510 },
    ]);
  });

  it('claim error (ALREADY_CLAIMED) → toast error i18n; KHÔNG emit claimed', async () => {
    getSectMissionsMock.mockResolvedValueOnce(SAMPLE);
    const err = Object.assign(new Error('ALREADY_CLAIMED'), {
      code: 'ALREADY_CLAIMED',
    });
    claimSectMissionMock.mockRejectedValueOnce(err);

    const w = mountPanel();
    await flushPromises();
    const claimBtns = w.findAll('[data-test="sect-mission-claim"]');
    const ready = claimBtns.find((b) => b.text() === 'Nhận thưởng')!;
    await ready.trigger('click');
    await flushPromises();

    expect(claimSectMissionMock).toHaveBeenCalled();
    expect(w.emitted('claimed')).toBeFalsy();
  });

  it('empty/loading state KHÔNG crash; sect=null hiển thị `noSect` notice', async () => {
    // Loading state: trước khi promise resolve thì panel render loading skeleton.
    let resolveFn: ((v: SectMissionListView) => void) | null = null;
    getSectMissionsMock.mockReturnValueOnce(
      new Promise<SectMissionListView>((r) => {
        resolveFn = r;
      }),
    );
    const w = mountPanel();
    expect(w.find('[data-test="sect-mission-loading"]').exists()).toBe(true);

    // Resolve với sectId=null → render noSect notice, không crash.
    resolveFn!({
      ...SAMPLE,
      sectId: null,
      sectName: null,
      missions: [],
    });
    await flushPromises();
    expect(w.find('[data-test="sect-mission-loading"]').exists()).toBe(false);
    expect(w.text()).toContain('Cần gia nhập Tông Môn để nhận nhiệm vụ.');
    // Không có row nào.
    expect(w.findAll('[data-test="sect-mission-row"]').length).toBe(0);
  });
});
