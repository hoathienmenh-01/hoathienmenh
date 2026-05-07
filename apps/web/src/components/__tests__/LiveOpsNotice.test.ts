/**
 * LiveOpsNotice tests — Phase 13.0 §F notification component.
 *
 * Mock toast store + /liveops/today; verify:
 *   - upcoming boss ≤ 15 min → push toast 1 lần.
 *   - đã notify trong session → không push lần 2 (anti-spam).
 *   - upcoming boss > 15 min → không push.
 *   - active/completed slot → không push.
 *   - i18n format đúng (vi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getLiveOpsTodayMock = vi.fn();
const toastPushMock = vi.fn();

vi.mock('@/api/liveops', () => ({
  getLiveOpsToday: (...a: unknown[]) => getLiveOpsTodayMock(...a),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

import LiveOpsNotice from '@/components/LiveOpsNotice.vue';
import type { LiveOpsTodayResponse } from '@/api/liveops';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      liveopsToday: {
        spawnSoonToast: 'Boss sắp xuất hiện trong {time}.',
      },
      liveops: {
        boss: {
          hoa_long_to_su: 'Hỏa Long Tổ Sư',
          kim_phach_long_dieu: 'Kim Phách Long Điêu',
        },
      },
    },
  },
});

function makeResponse(overrides: Partial<LiveOpsTodayResponse> = {}): LiveOpsTodayResponse {
  return {
    nowIso: '2026-05-06T05:15:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    todayEvents: [],
    activeEvents: [],
    nextEvent: null,
    bossSchedule: [],
    suggestedActivities: [],
    ...overrides,
  };
}

const UPCOMING_10_MIN = {
  key: 'boss_daily_evening_kim_son_mach',
  bossKey: 'kim_phach_long_dieu',
  regionKey: 'kim_son_mach',
  slotStartIso: '2026-05-06T12:00:00.000Z',
  slotEndIso: '2026-05-06T12:30:00.000Z',
  status: 'upcoming' as const,
  secondsUntilStart: 10 * 60,
};

const UPCOMING_30_MIN = {
  ...UPCOMING_10_MIN,
  key: 'boss_daily_far',
  slotStartIso: '2026-05-06T13:00:00.000Z',
  secondsUntilStart: 30 * 60,
};

const ACTIVE_NOON = {
  key: 'boss_daily_noon_hoa_diem_son',
  bossKey: 'hoa_long_to_su',
  regionKey: 'hoa_diem_son',
  slotStartIso: '2026-05-06T05:00:00.000Z',
  slotEndIso: '2026-05-06T05:30:00.000Z',
  status: 'active' as const,
  secondsUntilStart: 0,
};

function mountNotice() {
  return mount(LiveOpsNotice, { global: { plugins: [i18n] } });
}

describe('LiveOpsNotice', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getLiveOpsTodayMock.mockReset();
    toastPushMock.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('upcoming boss ≤ 15 min → push toast 1 lần với time format', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(
      makeResponse({ bossSchedule: [UPCOMING_10_MIN] }),
    );
    mountNotice();
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledTimes(1);
    const arg = toastPushMock.mock.calls[0][0];
    expect(arg.type).toBe('warning');
    expect(arg.text).toContain('Boss sắp xuất hiện trong 10m');
    expect(arg.text).toContain('Kim Phách Long Điêu');
  });

  it('cùng slot tick lần 2 không push lần 2 (sessionStorage flag)', async () => {
    getLiveOpsTodayMock.mockResolvedValue(
      makeResponse({ bossSchedule: [UPCOMING_10_MIN] }),
    );
    const w = mountNotice();
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledTimes(1);

    // Manually re-tick (simulate poll interval)
    await (w.vm as unknown as { tick(): Promise<void> }).tick();
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledTimes(1);
  });

  it('upcoming > 15 min → KHÔNG push', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(
      makeResponse({ bossSchedule: [UPCOMING_30_MIN] }),
    );
    mountNotice();
    await flushPromises();

    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('active boss → KHÔNG push (chỉ upcoming)', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(
      makeResponse({ bossSchedule: [ACTIVE_NOON] }),
    );
    mountNotice();
    await flushPromises();

    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('API error (null response) → KHÔNG push, không crash', async () => {
    getLiveOpsTodayMock.mockResolvedValueOnce(null);
    mountNotice();
    await flushPromises();

    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('multiple upcoming slots ≤ 15 min → push từng slot riêng', async () => {
    const second = { ...UPCOMING_10_MIN, key: 'boss_other', slotStartIso: '2026-05-06T13:00:00.000Z' };
    getLiveOpsTodayMock.mockResolvedValueOnce(
      makeResponse({ bossSchedule: [UPCOMING_10_MIN, second] }),
    );
    mountNotice();
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledTimes(2);
  });
});
