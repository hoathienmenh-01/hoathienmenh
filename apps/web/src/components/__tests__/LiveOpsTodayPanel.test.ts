/**
 * LiveOpsTodayPanel tests — Phase 13.0 §D Today Activity Panel.
 *
 * Mock /liveops/today client; verify render shape (suggested CTA, active
 * events, boss schedule list) + error fallback + CTA button click route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const getLiveOpsTodayMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock('@/api/liveops', () => ({
  getLiveOpsToday: (...a: unknown[]) => getLiveOpsTodayMock(...a),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import LiveOpsTodayPanel from '@/components/LiveOpsTodayPanel.vue';
import type { LiveOpsTodayResponse } from '@/api/liveops';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      liveopsToday: {
        title: 'Hoạt Động Hôm Nay',
        loading: 'Đang tải lịch sự kiện…',
        error: 'Không tải được lịch sự kiện. Mời thử lại sau.',
        noSuggestion: 'Hiện chưa có sự kiện hot.',
        activeEventsTitle: 'Sự kiện đang mở',
        bossScheduleTitle: 'Lịch Boss hôm nay',
        startIn: 'Còn {time}',
        rewardHintLabel: 'Thưởng',
        bossStatus: {
          upcoming: 'Sắp tới',
          active: 'Đang mở',
          completed: 'Đã qua',
        },
        cta: {
          goBoss: 'Đi Boss',
          goDungeon: 'Vào Bí Cảnh',
          goMission: 'Xem Nhiệm Vụ',
          goSectWar: 'Tông Môn Chiến',
        },
      },
      liveops: {
        event: {
          boss_daily_noon_hoa_diem_son: {
            title: 'Boss Trưa: Hỏa Long',
            reward: 'Linh thạch + đồ luyện đan hỏa hệ.',
          },
          daily_exp_rush_morning: {
            title: 'Triêu Quang Lộ Khí',
            reward: 'Tu vi tăng nhanh trong giờ vàng buổi sáng.',
          },
        },
        boss: { hoa_long_to_su: 'Hỏa Long Tổ Sư' },
        region: { hoa_diem_son: 'Hỏa Diệm Sơn' },
      },
    },
  },
});

const NOW = new Date('2026-05-06T05:15:00Z'); // Wed 12:15 ICT — noon active.

const SAMPLE_RESPONSE: LiveOpsTodayResponse = {
  nowIso: NOW.toISOString(),
  timezone: 'Asia/Ho_Chi_Minh',
  todayEvents: [
    {
      key: 'boss_daily_noon_hoa_diem_son',
      type: 'BOSS',
      titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
      descriptionI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.desc',
      bossKey: 'hoa_long_to_su',
      regionKey: 'hoa_diem_son',
    },
    {
      key: 'daily_exp_rush_morning',
      type: 'DAILY',
      titleI18nKey: 'liveops.event.daily_exp_rush_morning.title',
      descriptionI18nKey: 'liveops.event.daily_exp_rush_morning.desc',
    },
  ],
  activeEvents: [
    {
      key: 'boss_daily_noon_hoa_diem_son',
      type: 'BOSS',
      titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
      descriptionI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.desc',
      bossKey: 'hoa_long_to_su',
      regionKey: 'hoa_diem_son',
    },
  ],
  nextEvent: null,
  bossSchedule: [
    {
      key: 'boss_daily_noon_hoa_diem_son',
      bossKey: 'hoa_long_to_su',
      regionKey: 'hoa_diem_son',
      slotStartIso: '2026-05-06T05:00:00.000Z',
      slotEndIso: '2026-05-06T05:30:00.000Z',
      status: 'active',
      secondsUntilStart: 0,
    },
    {
      key: 'boss_daily_evening_kim_son_mach',
      bossKey: 'kim_phach_long_dieu',
      regionKey: 'kim_son_mach',
      slotStartIso: '2026-05-06T12:00:00.000Z',
      slotEndIso: '2026-05-06T12:30:00.000Z',
      status: 'upcoming',
      secondsUntilStart: 6 * 3600 + 45 * 60,
    },
  ],
  suggestedActivities: [
    {
      key: 'boss_active_boss_daily_noon_hoa_diem_son',
      kind: 'boss',
      titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
      bossKey: 'hoa_long_to_su',
      regionKey: 'hoa_diem_son',
    },
  ],
};

function mountPanel() {
  return mount(LiveOpsTodayPanel, {
    global: { plugins: [i18n] },
  });
}

describe('LiveOpsTodayPanel', () => {
  beforeEach(() => {
    getLiveOpsTodayMock.mockReset();
    routerPushMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render Today Activity panel với suggested boss + active boss schedule', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="liveops-today-panel"]').exists()).toBe(true);
    expect(w.find('h3').text()).toBe('Hoạt Động Hôm Nay');

    const sug = w.find('[data-testid="liveops-suggestions"]');
    expect(sug.exists()).toBe(true);
    expect(sug.text()).toContain('Boss Trưa: Hỏa Long');

    const sched = w.find('[data-testid="liveops-boss-schedule"]');
    expect(sched.exists()).toBe(true);
    expect(sched.text()).toContain('Đang mở');
    expect(sched.text()).toContain('Sắp tới');
  });

  it('next boss countdown render với secondsUntilStart > 0', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      activeEvents: [],
      suggestedActivities: [
        {
          key: 'boss_upcoming_boss_daily_evening_kim_son_mach',
          kind: 'boss',
          titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
          bossKey: 'kim_phach_long_dieu',
          regionKey: 'kim_son_mach',
          secondsUntilStart: 6 * 3600 + 45 * 60,
        },
      ],
    });
    const w = mountPanel();
    await flushPromises();

    const sug = w.find('[data-testid="liveops-suggestions"]');
    expect(sug.exists()).toBe(true);
    expect(sug.text()).toContain('Còn 6h 45m');
  });

  it('API error → render error placeholder, KHÔNG crash', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(null);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="liveops-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="liveops-error"]').text()).toBe(
      'Không tải được lịch sự kiện. Mời thử lại sau.',
    );
    expect(w.find('[data-testid="liveops-boss-schedule"]').exists()).toBe(false);
  });

  it('CTA button "Đi Boss" gọi router.push name=boss', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();
    const btns = w.findAll('button');
    const goBossBtn = btns.find((b) => b.text() === 'Đi Boss');
    expect(goBossBtn).toBeDefined();
    await goBossBtn!.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'boss' });
  });

  it('CTA button "Vào Bí Cảnh" gọi router.push name=dungeon', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();
    const btns = w.findAll('button');
    const goDun = btns.find((b) => b.text() === 'Vào Bí Cảnh');
    await goDun!.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'dungeon' });
  });

  it('CTA button "Xem Nhiệm Vụ" gọi router.push name=missions', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();
    const btns = w.findAll('button');
    const goMis = btns.find((b) => b.text() === 'Xem Nhiệm Vụ');
    await goMis!.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'missions' });
  });

  it('Phase 13.1.A — CTA "Tông Môn Chiến" hiện trên LiveOps panel + click route name=sect-war', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();
    const cta = w.find('[data-testid="liveops-cta-sect-war"]');
    expect(cta.exists()).toBe(true);
    expect(cta.text()).toBe('Tông Môn Chiến');
    await cta.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'sect-war' });
  });

  it('boss schedule slot time format theo tz từ API (Asia/Ho_Chi_Minh = ICT) — không theo browser TZ', async () => {
    // ISO `05:00:00Z` = ICT 12:00 (UTC+7). User browser dù ở UTC hay ICT đều
    // thấy 12:00 — slot time consistent giữa các region.
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();

    const sched = w.find('[data-testid="liveops-boss-schedule"]');
    expect(sched.exists()).toBe(true);
    expect(sched.text()).toContain('12:00'); // 05:00 UTC → ICT 12:00.
    expect(sched.text()).toContain('19:00'); // 12:00 UTC → ICT 19:00.
  });

  it('Phase 13.0 audit pass #5 — render rewardHintI18nKey (suggested + active non-boss + bossSchedule)', async () => {
    // Repro: trước fix, FE catalog/API/i18n đều có rewardHint nhưng 2 panel
    // không bao giờ render → feature dead. Sau fix: render 3 vị trí.
    getLiveOpsTodayMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      activeEvents: [
        {
          key: 'daily_exp_rush_morning',
          type: 'DAILY',
          titleI18nKey: 'liveops.event.daily_exp_rush_morning.title',
          descriptionI18nKey: 'liveops.event.daily_exp_rush_morning.desc',
          rewardHintI18nKey: 'liveops.event.daily_exp_rush_morning.reward',
        },
      ],
      bossSchedule: [
        {
          ...SAMPLE_RESPONSE.bossSchedule[0],
          rewardHintI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.reward',
        },
      ],
      suggestedActivities: [
        {
          key: 'boss_active_boss_daily_noon_hoa_diem_son',
          kind: 'boss',
          titleI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.title',
          bossKey: 'hoa_long_to_su',
          regionKey: 'hoa_diem_son',
          rewardHintI18nKey: 'liveops.event.boss_daily_noon_hoa_diem_son.reward',
        },
      ],
    });
    const w = mountPanel();
    await flushPromises();

    // 1. Suggested CTA reward hint render.
    const sugReward = w.find(
      '[data-testid="liveops-suggestion-reward-boss_active_boss_daily_noon_hoa_diem_son"]',
    );
    expect(sugReward.exists()).toBe(true);
    expect(sugReward.text()).toContain('Thưởng');
    expect(sugReward.text()).toContain('Linh thạch + đồ luyện đan hỏa hệ');

    // 2. Active non-boss event reward hint render.
    const evReward = w.find(
      '[data-testid="liveops-active-event-reward-daily_exp_rush_morning"]',
    );
    expect(evReward.exists()).toBe(true);
    expect(evReward.text()).toContain('Tu vi tăng nhanh trong giờ vàng buổi sáng');

    // 3. Boss schedule slot reward hint render.
    const schedReward = w.find(
      '[data-testid="liveops-schedule-reward-boss_daily_noon_hoa_diem_son"]',
    );
    expect(schedReward.exists()).toBe(true);
    expect(schedReward.text()).toContain('Linh thạch + đồ luyện đan hỏa hệ');
  });

  it('rewardHintI18nKey absent (legacy/empty) → KHÔNG render reward row', async () => {
    // SAMPLE_RESPONSE base không có rewardHintI18nKey → no reward rows render.
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE_RESPONSE);
    const w = mountPanel();
    await flushPromises();

    expect(
      w.find('[data-testid="liveops-suggestion-reward-boss_active_boss_daily_noon_hoa_diem_son"]')
        .exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="liveops-schedule-reward-boss_daily_noon_hoa_diem_son"]').exists(),
    ).toBe(false);
  });

  it('per-suggestion CTA button KHÔNG render cho non-boss kind (active daily event)', async () => {
    // Repro Bug #3: trước khi fix, non-boss suggestion vẫn render nút "Đi Boss"
    // nhưng click không làm gì → dead button. Sau fix: ẩn nút per-row.
    getLiveOpsTodayMock.mockResolvedValueOnce({
      ...SAMPLE_RESPONSE,
      suggestedActivities: [
        {
          key: 'event_active_daily_exp_rush_morning',
          kind: 'daily',
          titleI18nKey: 'liveops.event.daily_exp_rush_morning.title',
        },
      ],
    });
    const w = mountPanel();
    await flushPromises();

    const sug = w.find('[data-testid="liveops-suggestions"]');
    expect(sug.exists()).toBe(true);
    // Suggestion li tồn tại nhưng không có button bên trong.
    const sugButtons = sug.findAll('button');
    expect(sugButtons.length).toBe(0);

    // Bottom CTA strip vẫn render 3 generic button.
    const allButtons = w.findAll('button');
    const labels = allButtons.map((b) => b.text());
    expect(labels).toContain('Đi Boss');
    expect(labels).toContain('Vào Bí Cảnh');
    expect(labels).toContain('Xem Nhiệm Vụ');
  });
});
