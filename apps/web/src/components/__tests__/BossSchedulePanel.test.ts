/**
 * BossSchedulePanel tests — Phase 13.0 §E BossView "Lịch Boss hôm nay".
 *
 * Mock /liveops/today; verify render slot list + status badge + countdown
 * + API error fallback (panel ẩn, không crash).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

const getLiveOpsTodayMock = vi.fn();

vi.mock('@/api/liveops', () => ({
  getLiveOpsToday: (...a: unknown[]) => getLiveOpsTodayMock(...a),
}));

import BossSchedulePanel from '@/components/BossSchedulePanel.vue';
import type { LiveOpsTodayResponse } from '@/api/liveops';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      liveopsToday: {
        loading: 'Đang tải lịch sự kiện…',
        bossScheduleTitle: 'Lịch Boss hôm nay',
        startIn: 'khởi {time}',
        bossStatus: {
          upcoming: 'Sắp tới',
          active: 'Đang mở',
          completed: 'Đã qua',
        },
      },
      liveops: {
        event: {
          boss_daily_noon_hoa_diem_son: { title: 'Boss Trưa: Hỏa Long' },
          boss_daily_evening_kim_son_mach: { title: 'Boss Tối: Kim Phách' },
        },
        boss: {
          hoa_long_to_su: 'Hỏa Long Tổ Sư',
          kim_phach_long_dieu: 'Kim Phách Long Điêu',
        },
        region: {
          hoa_diem_son: 'Hỏa Diệm Sơn',
          kim_son_mach: 'Kim Sơn Mạch',
        },
      },
    },
  },
});

const SAMPLE: LiveOpsTodayResponse = {
  nowIso: '2026-05-06T05:15:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  todayEvents: [],
  activeEvents: [],
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
  suggestedActivities: [],
};

function mountPanel() {
  return mount(BossSchedulePanel, {
    global: { plugins: [i18n] },
  });
}

describe('BossSchedulePanel', () => {
  beforeEach(() => {
    getLiveOpsTodayMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render schedule list với active + upcoming + status badge', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="boss-schedule-panel"]').exists()).toBe(true);
    expect(w.find('h3').text()).toBe('Lịch Boss hôm nay');

    const noon = w.find(
      '[data-testid="boss-schedule-item-boss_daily_noon_hoa_diem_son"]',
    );
    expect(noon.exists()).toBe(true);
    expect(noon.text()).toContain('Hỏa Long Tổ Sư');
    expect(noon.text()).toContain('Hỏa Diệm Sơn');
    expect(noon.text()).toContain('Đang mở');

    const eve = w.find(
      '[data-testid="boss-schedule-item-boss_daily_evening_kim_son_mach"]',
    );
    expect(eve.exists()).toBe(true);
    expect(eve.text()).toContain('Sắp tới');
    expect(eve.text()).toContain('khởi 6h 45m');
  });

  it('API error → panel ẩn (không crash)', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(null);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="boss-schedule-panel"]').exists()).toBe(false);
  });

  it('empty schedule → panel ẩn', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce({
      ...SAMPLE,
      bossSchedule: [],
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="boss-schedule-panel"]').exists()).toBe(false);
  });

  it('slot time format theo tz từ API (Asia/Ho_Chi_Minh) — không theo browser TZ', async () => {
    // Repro Bug #2: slot ISO `05:00:00Z` = ICT 12:00 (UTC+7). User browser ở
    // bất kỳ TZ nào cũng phải thấy 12:00 (đúng theo catalog VN), không phải
    // 05:00 (UTC) hay 13:00 (CEST) v.v.
    getLiveOpsTodayMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    const noon = w.find(
      '[data-testid="boss-schedule-item-boss_daily_noon_hoa_diem_son"]',
    );
    expect(noon.text()).toContain('12:00'); // 05:00 UTC → ICT 12:00.

    const eve = w.find(
      '[data-testid="boss-schedule-item-boss_daily_evening_kim_son_mach"]',
    );
    expect(eve.text()).toContain('19:00'); // 12:00 UTC → ICT 19:00.
  });
});
