/**
 * Phase 15.1–15.2 — AdminLiveOpsEventsPanel tests.
 *
 * Cover:
 *   - render danh sách event (status badge, time window, config JSON).
 *   - empty state khi list rỗng.
 *   - disable button gọi adminLiveOpsEventsDisable + refresh.
 *   - recompute button gọi adminLiveOpsEventsRecomputeStatus.
 *   - i18n key tồn tại đầy đủ (smoke test) — VI/EN parity test riêng ở
 *     `i18n/__tests__/parity.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLiveOpsEventsListMock = vi.fn();
const adminLiveOpsEventsCreateMock = vi.fn();
const adminLiveOpsEventsDisableMock = vi.fn();
const adminLiveOpsEventsRecomputeStatusMock = vi.fn();
const adminLiveOpsEventsUpdateMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLiveOpsEventsList: (...a: unknown[]) => adminLiveOpsEventsListMock(...a),
  adminLiveOpsEventsCreate: (...a: unknown[]) =>
    adminLiveOpsEventsCreateMock(...a),
  adminLiveOpsEventsDisable: (...a: unknown[]) =>
    adminLiveOpsEventsDisableMock(...a),
  adminLiveOpsEventsRecomputeStatus: (...a: unknown[]) =>
    adminLiveOpsEventsRecomputeStatusMock(...a),
  adminLiveOpsEventsUpdate: (...a: unknown[]) =>
    adminLiveOpsEventsUpdateMock(...a),
}));

import AdminLiveOpsEventsPanel from '@/components/AdminLiveOpsEventsPanel.vue';
import type { LiveOpsScheduledEventView } from '@/api/admin';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOpsEvents: {
        title: 'LiveOps Event Scheduler',
        help: 'help',
        loading: 'Đang tải sự kiện…',
        empty: 'Chưa có sự kiện nào.',
        recomputeBtn: 'Recompute',
        recomputing: 'Đang recompute…',
        disableBtn: 'Disable',
        disabling: '…',
        confirmCreate: 'Tạo {key}?',
        confirmDisable: 'Disable {key}?',
        confirmRecompute: 'Force-run cron?',
        runtimeLegend: '7/7 wired',
        runtimeWired: 'runtime ✓',
        runtimeNotWired: 'chưa wire',
        col: {
          key: 'Key',
          type: 'Loại',
          status: 'Status',
          window: 'Window',
          config: 'Config',
          actions: 'Actions',
        },
        form: {
          title: 'Tạo event mới',
          key: 'Key',
          keyPlaceholder: 'event-...',
          type: 'Type',
          titleField: 'Title',
          description: 'Description',
          startsAt: 'Starts',
          endsAt: 'Ends',
          multiplier: 'Multiplier',
          multiplierWithCap: 'Multiplier ({min}-{max})',
          rewardJson: 'Reward JSON',
          rewardJsonHelp: 'help json',
          initialStatus: 'Initial status',
          submitBtn: 'Tạo event',
          submitting: 'Đang tạo…',
          runtimeNotWiredWarn: 'not wired warn',
        },
        toast: {
          created: 'Đã tạo.',
          disabled: 'Đã disable.',
          recomputed: 'activated={activated}, ended={ended}',
        },
        errors: {
          UNKNOWN: 'Lỗi.',
          INVALID_INPUT: 'Invalid input',
          EVENT_KEY_DUPLICATE: 'Key duplicate',
          MULTIPLIER_OUT_OF_RANGE: 'Multiplier over cap',
          EVENT_REWARD_JSON_REQUIRED: 'reward json required',
          EVENT_REWARD_JSON_INVALID: 'reward json invalid',
          EVENT_REWARD_ITEM_INVALID: 'reward item invalid',
          EVENT_REWARD_QTY_INVALID: 'reward qty invalid',
          EVENT_REWARD_CURRENCY_INVALID: 'reward currency invalid',
          EVENT_REWARD_EMPTY: 'reward empty',
          EVENT_REWARD_OVER_CAP: 'reward over cap',
        },
      },
      toast: {
        title: {
          info: 'Info',
          warning: 'Warn',
          error: 'Error',
          success: 'OK',
          system: 'System',
        },
      },
    },
  },
});

const SAMPLE_EVENT: LiveOpsScheduledEventView = {
  id: 'ev_1',
  key: 'event_test_001',
  type: 'DOUBLE_DUNGEON_DROP',
  title: 'Test Event',
  description: 'desc',
  status: 'ACTIVE',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  configJson: { multiplier: 1.5 },
  createdByAdminId: 'admin-1',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

const ENDED_EVENT: LiveOpsScheduledEventView = {
  ...SAMPLE_EVENT,
  id: 'ev_2',
  key: 'event_test_002',
  status: 'ENDED',
};

function mountPanel() {
  return mount(AdminLiveOpsEventsPanel, { global: { plugins: [i18n] } });
}

describe('AdminLiveOpsEventsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminLiveOpsEventsListMock.mockReset();
    adminLiveOpsEventsCreateMock.mockReset();
    adminLiveOpsEventsDisableMock.mockReset();
    adminLiveOpsEventsRecomputeStatusMock.mockReset();
    adminLiveOpsEventsUpdateMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders events table với status badge + time window', async () => {
    adminLiveOpsEventsListMock.mockResolvedValueOnce([SAMPLE_EVENT, ENDED_EVENT]);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="admin-liveops-events-panel"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-liveops-events-table"]').exists()).toBe(
      true,
    );
    // 2 rows.
    expect(
      w.findAll(`[data-testid^="admin-liveops-event-row-"]`).length,
    ).toBe(2);
    // Status badges.
    expect(
      w.find('[data-testid="admin-liveops-event-status-event_test_001"]').text(),
    ).toBe('ACTIVE');
    expect(
      w.find('[data-testid="admin-liveops-event-status-event_test_002"]').text(),
    ).toBe('ENDED');
    // Disable button only present cho ACTIVE event (không cho ENDED).
    expect(
      w.find('[data-testid="admin-liveops-event-disable-event_test_001"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-liveops-event-disable-event_test_002"]').exists(),
    ).toBe(false);
  });

  it('empty state khi list rỗng', async () => {
    adminLiveOpsEventsListMock.mockResolvedValueOnce([]);
    const w = mountPanel();
    await flushPromises();
    expect(
      w.find('[data-testid="admin-liveops-events-empty"]').exists(),
    ).toBe(true);
  });

  it('disable button gọi API + refresh', async () => {
    adminLiveOpsEventsListMock
      .mockResolvedValueOnce([SAMPLE_EVENT])
      .mockResolvedValueOnce([{ ...SAMPLE_EVENT, status: 'DISABLED' }]);
    adminLiveOpsEventsDisableMock.mockResolvedValueOnce({
      ...SAMPLE_EVENT,
      status: 'DISABLED',
    });
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="admin-liveops-event-disable-event_test_001"]')
      .trigger('click');
    await flushPromises();
    expect(adminLiveOpsEventsDisableMock).toHaveBeenCalledWith('ev_1');
    expect(adminLiveOpsEventsListMock).toHaveBeenCalledTimes(2);
  });

  it('recompute button gọi API', async () => {
    adminLiveOpsEventsListMock.mockResolvedValue([SAMPLE_EVENT]);
    adminLiveOpsEventsRecomputeStatusMock.mockResolvedValueOnce({
      scannedAt: '2026-08-01T00:00:00.000Z',
      toActivated: 1,
      toEnded: 0,
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="admin-liveops-events-recompute"]').trigger('click');
    await flushPromises();
    expect(adminLiveOpsEventsRecomputeStatusMock).toHaveBeenCalledTimes(1);
  });

  it('create form submit gọi adminLiveOpsEventsCreate với multiplier config', async () => {
    adminLiveOpsEventsListMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SAMPLE_EVENT]);
    adminLiveOpsEventsCreateMock.mockResolvedValueOnce(SAMPLE_EVENT);
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-liveops-events-form-key"]')
      .setValue('event_new_001');
    await w
      .find('[data-testid="admin-liveops-events-form-title"]')
      .setValue('New Event');
    await w
      .find('[data-testid="admin-liveops-events-form-starts-at"]')
      .setValue('2026-08-01T00:00');
    await w
      .find('[data-testid="admin-liveops-events-form-ends-at"]')
      .setValue('2026-08-02T00:00');
    await w
      .find('[data-testid="admin-liveops-events-form-multiplier"]')
      .setValue(1.5);
    await w.find('[data-testid="admin-liveops-events-form"]').trigger('submit');
    await flushPromises();

    expect(adminLiveOpsEventsCreateMock).toHaveBeenCalledTimes(1);
    const call = adminLiveOpsEventsCreateMock.mock.calls[0][0];
    expect(call.key).toBe('event_new_001');
    expect(call.title).toBe('New Event');
    expect(call.type).toBe('DOUBLE_DUNGEON_DROP');
    expect(call.configJson).toEqual({ multiplier: 1.5 });
  });

  // Phase 15.3.A — runtime support badge per row.
  it('renders runtime ✓ badge cho mọi event row (Phase 15.3.A wired 7/7)', async () => {
    adminLiveOpsEventsListMock.mockResolvedValueOnce([SAMPLE_EVENT]);
    const w = mountPanel();
    await flushPromises();
    expect(
      w
        .find('[data-testid="admin-liveops-event-runtime-event_test_001"]')
        .text(),
    ).toBe('runtime ✓');
    expect(
      w.find('[data-testid="admin-liveops-events-runtime-legend"]').exists(),
    ).toBe(true);
  });

  // Phase 15.3.A — FE rewardJson validation mirror server (defense-in-depth).
  it('FESTIVAL_GIFT submit với rewardJson rỗng items + 0 currency → reject FE-side, không gọi API', async () => {
    adminLiveOpsEventsListMock.mockResolvedValueOnce([]);
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-liveops-events-form-key"]')
      .setValue('event_gift_invalid');
    await w
      .find('[data-testid="admin-liveops-events-form-title"]')
      .setValue('Empty Gift');
    await w
      .find('[data-testid="admin-liveops-events-form-type"]')
      .setValue('FESTIVAL_GIFT');
    await w
      .find('[data-testid="admin-liveops-events-form-starts-at"]')
      .setValue('2026-08-01T00:00');
    await w
      .find('[data-testid="admin-liveops-events-form-ends-at"]')
      .setValue('2026-08-02T00:00');
    // Empty reward = 0 linhThach, 0 tienNgoc, no items → EVENT_REWARD_EMPTY.
    await w
      .find('[data-testid="admin-liveops-events-form-reward-json"]')
      .setValue(JSON.stringify({ linhThach: 0, tienNgoc: 0, items: [] }));
    await w.find('[data-testid="admin-liveops-events-form"]').trigger('submit');
    await flushPromises();

    expect(adminLiveOpsEventsCreateMock).not.toHaveBeenCalled();
  });

  // Phase 15.3.A — FE clamps multiplier range from shared cap.
  it('SHOP_DISCOUNT multiplier > 0.5 → reject FE-side, không gọi API', async () => {
    adminLiveOpsEventsListMock.mockResolvedValueOnce([]);
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="admin-liveops-events-form-key"]')
      .setValue('event_shop_overcap');
    await w
      .find('[data-testid="admin-liveops-events-form-title"]')
      .setValue('Shop overcap');
    await w
      .find('[data-testid="admin-liveops-events-form-type"]')
      .setValue('SHOP_DISCOUNT');
    await w
      .find('[data-testid="admin-liveops-events-form-starts-at"]')
      .setValue('2026-08-01T00:00');
    await w
      .find('[data-testid="admin-liveops-events-form-ends-at"]')
      .setValue('2026-08-02T00:00');
    await w
      .find('[data-testid="admin-liveops-events-form-multiplier"]')
      .setValue(0.7); // > shared cap 0.5
    await w.find('[data-testid="admin-liveops-events-form"]').trigger('submit');
    await flushPromises();

    expect(adminLiveOpsEventsCreateMock).not.toHaveBeenCalled();
  });
});
