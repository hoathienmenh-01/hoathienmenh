/**
 * Phase 13.1.D — AdminLiveOpsSchedulePreviewPanel tests.
 *
 * Mock /admin/liveops/schedule-preview client; verify:
 *   - render active/upcoming/boss/sectWar/overrides sections after success.
 *   - error placeholder + retry button khi load fail.
 *   - refresh button gọi adminLiveOpsSchedulePreview lại.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLiveOpsSchedulePreviewMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLiveOpsSchedulePreview: (...a: unknown[]) =>
    adminLiveOpsSchedulePreviewMock(...a),
}));

import AdminLiveOpsSchedulePreviewPanel from '@/components/AdminLiveOpsSchedulePreviewPanel.vue';
import type { AdminLiveOpsSchedulePreviewView } from '@/api/admin';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOpsPreview: {
        title: 'Schedule Preview',
        loading: 'Đang tải lịch…',
        tz: 'TZ {tz}',
        now: 'Now {iso}',
        refresh: 'Refresh',
        retry: 'Thử lại',
        activeHeader: 'Active {n}',
        activeEmpty: 'Chưa có sự kiện active.',
        upcomingHeader: 'Upcoming {n}',
        upcomingEmpty: 'Không có upcoming.',
        bossTodayHeader: 'Boss hôm nay {n}',
        bossTodayEmpty: 'Không có boss hôm nay.',
        bossWeekHeader: 'Boss tuần {n}',
        bossWeekEmpty: 'Không có boss tuần này.',
        sectWarHeader: 'Sect War',
        sectWarRow: '{week} ({tz}) {start}→{end}',
        sectWarSummary:
          '{sects} sects · {contributors} contributors · {contributions} entries',
        overridesHeader: 'Overrides {n}',
        overridesEmpty: 'Không có override.',
        errors: {
          UNAUTHORIZED: 'Không có quyền.',
          UNKNOWN: 'Không thể tải.',
        },
      },
    },
  },
});

const SAMPLE_PREVIEW: AdminLiveOpsSchedulePreviewView = {
  nowIso: '2030-01-01T00:00:00.000Z',
  tz: 'Asia/Ho_Chi_Minh',
  activeEvents: [
    {
      key: 'ev_active_1',
      type: 'DAILY',
      titleI18nKey: 'adminLiveOpsPreview.events.ev_active_1.title',
      descriptionI18nKey: 'adminLiveOpsPreview.events.ev_active_1.title',
      slotStartIso: '2030-01-01T00:00:00.000Z',
      slotEndIso: '2030-01-01T01:00:00.000Z',
    },
  ],
  upcomingEvents: [
    {
      key: 'ev_upcoming_1',
      type: 'WEEKLY',
      titleI18nKey: 'adminLiveOpsPreview.events.ev_upcoming_1.title',
      descriptionI18nKey: 'adminLiveOpsPreview.events.ev_upcoming_1.title',
      catalogEnabled: true,
      effectiveEnabled: false,
      slotStartIso: '2030-01-02T00:00:00.000Z',
      slotEndIso: '2030-01-02T01:00:00.000Z',
    },
  ],
  bossScheduleToday: [
    {
      key: 'boss_today_1',
      bossKey: 'sky_dragon',
      regionKey: 'son_coc',
      slotStartIso: '2030-01-01T08:00:00.000Z',
      slotEndIso: '2030-01-01T09:00:00.000Z',
      status: 'upcoming',
      catalogEnabled: true,
      effectiveEnabled: true,
      localDate: '2030-01-01',
    },
  ],
  bossScheduleWeek: [
    {
      key: 'boss_today_1',
      bossKey: 'sky_dragon',
      regionKey: 'son_coc',
      slotStartIso: '2030-01-01T08:00:00.000Z',
      slotEndIso: '2030-01-01T09:00:00.000Z',
      status: 'upcoming',
      catalogEnabled: true,
      effectiveEnabled: true,
      localDate: '2030-01-01',
    },
    {
      key: 'boss_week_2',
      bossKey: 'sea_dragon',
      regionKey: 'thuy_phu',
      slotStartIso: '2030-01-03T08:00:00.000Z',
      slotEndIso: '2030-01-03T09:00:00.000Z',
      status: 'upcoming',
      catalogEnabled: true,
      effectiveEnabled: true,
      localDate: '2030-01-03',
    },
  ],
  sectWar: {
    season: {
      weekKey: '2030-W01',
      startsAtIso: '2030-01-01T00:00:00.000Z',
      endsAtIso: '2030-01-08T00:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    status: {
      weekKey: '2030-W01',
      totalSects: 3,
      totalContributors: 12,
      totalContributions: 42,
      topSects: [
        { sectId: 's1', sectName: 'Thanh Liên', points: 1200, contributors: 8 },
      ],
    },
  },
  overrides: [
    {
      key: 'ev_off',
      enabled: false,
      startsAt: null,
      endsAt: null,
      reason: 'maintenance',
      updatedBy: 'admin-1',
      updatedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
    },
  ],
};

function mountPanel() {
  return mount(AdminLiveOpsSchedulePreviewPanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminLiveOpsSchedulePreviewPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminLiveOpsSchedulePreviewMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('render full preview: tz + active + upcoming + boss today + boss week + sectWar + overrides', async () => {
    adminLiveOpsSchedulePreviewMock.mockResolvedValueOnce(SAMPLE_PREVIEW);
    const w = mountPanel();
    await flushPromises();

    expect(
      w.find('[data-test="admin-liveops-schedule-preview-panel"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-test="admin-liveops-schedule-preview-content"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('TZ Asia/Ho_Chi_Minh');

    // Active event row.
    expect(
      w.findAll('[data-test="admin-liveops-schedule-preview-active-row"]')
        .length,
    ).toBe(1);
    expect(w.text()).toContain('ev_active_1');

    // Upcoming event row.
    expect(
      w.findAll('[data-test="admin-liveops-schedule-preview-upcoming-row"]')
        .length,
    ).toBe(1);
    expect(w.text()).toContain('ev_upcoming_1');

    // Boss today rendered.
    expect(
      w.findAll('[data-test="admin-liveops-schedule-preview-boss-today-row"]')
        .length,
    ).toBe(1);
    expect(w.text()).toContain('sky_dragon');

    // Boss week grouped by date — 2 distinct dates.
    expect(
      w.findAll('[data-test="admin-liveops-schedule-preview-boss-week-row"]')
        .length,
    ).toBe(2);

    // Sect war season + summary.
    expect(w.text()).toContain('2030-W01');
    expect(w.text()).toContain('3 sects');

    // Override row.
    expect(
      w.findAll('[data-test="admin-liveops-schedule-preview-overrides-row"]')
        .length,
    ).toBe(1);
    expect(w.text()).toContain('ev_off');
    expect(w.text()).toContain('maintenance');
  });

  it('error state load fail → render error placeholder + retry button; retry refetch', async () => {
    const err = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' });
    adminLiveOpsSchedulePreviewMock
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(SAMPLE_PREVIEW);

    const w = mountPanel();
    await flushPromises();

    expect(
      w.find('[data-test="admin-liveops-schedule-preview-error"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('Không thể tải.');

    await w
      .find('[data-test="admin-liveops-schedule-preview-retry"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsSchedulePreviewMock).toHaveBeenCalledTimes(2);
    expect(
      w.find('[data-test="admin-liveops-schedule-preview-content"]').exists(),
    ).toBe(true);
  });

  it('refresh button gọi adminLiveOpsSchedulePreview lại', async () => {
    adminLiveOpsSchedulePreviewMock
      .mockResolvedValueOnce(SAMPLE_PREVIEW)
      .mockResolvedValueOnce(SAMPLE_PREVIEW);

    const w = mountPanel();
    await flushPromises();
    expect(adminLiveOpsSchedulePreviewMock).toHaveBeenCalledTimes(1);

    await w
      .find('[data-test="admin-liveops-schedule-preview-refresh"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsSchedulePreviewMock).toHaveBeenCalledTimes(2);
  });

  it('empty arrays → render empty placeholders cho tất cả sections', async () => {
    adminLiveOpsSchedulePreviewMock.mockResolvedValueOnce({
      ...SAMPLE_PREVIEW,
      activeEvents: [],
      upcomingEvents: [],
      bossScheduleToday: [],
      bossScheduleWeek: [],
      overrides: [],
    });
    const w = mountPanel();
    await flushPromises();

    expect(
      w.find('[data-test="admin-liveops-schedule-preview-active-empty"]').exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-test="admin-liveops-schedule-preview-upcoming-empty"]')
        .exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-test="admin-liveops-schedule-preview-boss-today-empty"]')
        .exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-test="admin-liveops-schedule-preview-boss-week-empty"]')
        .exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-test="admin-liveops-schedule-preview-overrides-empty"]')
        .exists(),
    ).toBe(true);
  });
});
