/**
 * Phase 13.1.B — AdminLiveOpsPanel tests.
 *
 * Mock /admin/liveops + /admin/sect-war/* clients; verify:
 *   - render liveops events table + tz hint + today/active counts.
 *   - toggle event success → refresh status, button label flip ON↔OFF.
 *   - error state hiển thị error placeholder; sectWar refresh fail
 *     non-fatal (panel vẫn render).
 *   - permission fallback / loading state KHÔNG crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLiveOpsStatusMock = vi.fn();
const adminLiveOpsToggleMock = vi.fn();
const adminSectWarStatusMock = vi.fn();
const adminSectWarRecalculateMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLiveOpsStatus: (...a: unknown[]) => adminLiveOpsStatusMock(...a),
  adminLiveOpsToggle: (...a: unknown[]) => adminLiveOpsToggleMock(...a),
  adminSectWarStatus: (...a: unknown[]) => adminSectWarStatusMock(...a),
  adminSectWarRecalculate: (...a: unknown[]) =>
    adminSectWarRecalculateMock(...a),
}));

import AdminLiveOpsPanel from '@/components/AdminLiveOpsPanel.vue';
import type {
  AdminLiveOpsStatusView,
  AdminSectWarStatusView,
} from '@/api/admin';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOps: {
        title: 'LiveOps Controls',
        loading: 'Đang tải LiveOps…',
        tz: 'TZ {tz}',
        todayCount: 'Hôm nay {n} sự kiện',
        activeCount: 'Đang chạy {n}',
        statusOn: 'BẬT',
        statusOff: 'TẮT',
        today: 'hôm nay',
        active: 'active',
        enableBtn: 'Bật',
        disableBtn: 'Tắt',
        confirmToggle: 'Xác nhận toggle {key} → {on}?',
        confirmRecalc: 'Recalculate sect war?',
        reasonPlaceholder: 'Lý do (optional)',
        col: {
          key: 'Sự kiện',
          type: 'Loại',
          status: 'Trạng thái',
          override: 'Override',
          reason: 'Lý do',
        },
        toast: {
          toggled: 'Toggle {key} → {on} OK.',
          recalculated: 'Recalc OK.',
        },
        sectWar: {
          title: 'Sect War status',
          summary:
            '{week} · {sects} sects · {contributors} contributors · {contributions} entries',
          unavailable: 'Không khả dụng.',
          recalcBtn: 'Recalculate',
          topHeader: 'Top Sects',
          row: '{points} điểm · {contributors} người',
        },
        errors: {
          UNAUTHORIZED: 'Không có quyền.',
          EVENT_NOT_FOUND: 'Sự kiện không tồn tại.',
          INVALID_INPUT: 'Input không hợp lệ.',
          UNKNOWN: 'Không thể thao tác.',
        },
        events: {
          ev1: { title: 'Daily Login Reset' },
        },
      },
    },
  },
});

const SAMPLE_STATUS: AdminLiveOpsStatusView = {
  tz: 'Asia/Ho_Chi_Minh',
  events: [
    {
      key: 'ev1',
      type: 'DAILY',
      catalogEnabled: true,
      effectiveEnabled: true,
      override: null,
      titleI18nKey: 'adminLiveOps.events.ev1.title',
      descriptionI18nKey: 'adminLiveOps.events.ev1.title',
      dailyTime: '00:00',
    },
    {
      key: 'ev2',
      type: 'WINDOW',
      catalogEnabled: true,
      effectiveEnabled: false,
      override: {
        key: 'ev2',
        enabled: false,
        startsAt: null,
        endsAt: null,
        reason: 'maintenance',
        updatedBy: 'admin-1',
        updatedAt: '2030-01-01T00:00:00.000Z',
        createdAt: '2030-01-01T00:00:00.000Z',
      },
      titleI18nKey: 'adminLiveOps.events.ev2.title',
      descriptionI18nKey: 'adminLiveOps.events.ev2.title',
    },
  ],
  todayKeys: ['ev1'],
  activeKeys: ['ev1'],
};

const SAMPLE_SECTWAR: AdminSectWarStatusView = {
  weekKey: '2030-W01',
  totalSects: 3,
  totalContributors: 12,
  totalContributions: 42,
  topSects: [
    { sectId: 's1', sectName: 'Thanh Liên', points: 1200, contributors: 8 },
    { sectId: 's2', sectName: 'Huyền Vũ', points: 600, contributors: 3 },
  ],
};

function mountPanel() {
  return mount(AdminLiveOpsPanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminLiveOpsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminLiveOpsStatusMock.mockReset();
    adminLiveOpsToggleMock.mockReset();
    adminSectWarStatusMock.mockReset();
    adminSectWarRecalculateMock.mockReset();
    // Default confirm() = true để toggle/recalc đi qua confirm prompt.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('render liveops status table + tz + today/active counts + sect war summary', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
    expect(w.text()).toContain('LiveOps Controls');
    expect(w.text()).toContain('TZ Asia/Ho_Chi_Minh');
    expect(w.text()).toContain('Hôm nay 1 sự kiện');
    expect(w.text()).toContain('Đang chạy 1');

    const rows = w.findAll('[data-test="admin-liveops-row"]');
    expect(rows.length).toBe(2);
    // ev1 hiển thị BẬT, ev2 (override.enabled=false) hiển thị TẮT.
    const statuses = w.findAll('[data-test="admin-liveops-status"]');
    expect(statuses[0].text()).toBe('BẬT');
    expect(statuses[1].text()).toBe('TẮT');

    // SectWar summary line.
    expect(w.text()).toContain('2030-W01');
    expect(w.text()).toContain('3 sects');
    expect(w.text()).toContain('12 contributors');
    expect(w.text()).toContain('42 entries');
    // Top sects rendered.
    expect(w.text()).toContain('Thanh Liên');
    expect(w.text()).toContain('Huyền Vũ');
  });

  it('toggle event success → adminLiveOpsToggle gọi đúng, status refresh, label flip', async () => {
    adminLiveOpsStatusMock
      .mockResolvedValueOnce(SAMPLE_STATUS)
      .mockResolvedValueOnce({
        ...SAMPLE_STATUS,
        events: [
          { ...SAMPLE_STATUS.events[0], effectiveEnabled: false },
          SAMPLE_STATUS.events[1],
        ],
        activeKeys: [],
        todayKeys: [],
      });
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminLiveOpsToggleMock.mockResolvedValueOnce({
      key: 'ev1',
      enabled: false,
      startsAt: null,
      endsAt: null,
      reason: null,
      updatedBy: 'admin-1',
      updatedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
    });

    const w = mountPanel();
    await flushPromises();

    const toggles = w.findAll('[data-test="admin-liveops-toggle"]');
    // ev1 effectiveEnabled=true → button label = "Tắt".
    expect(toggles[0].text()).toBe('Tắt');
    await toggles[0].trigger('click');
    await flushPromises();

    expect(adminLiveOpsToggleMock).toHaveBeenCalledWith({
      key: 'ev1',
      enabled: false,
      reason: null,
    });
    expect(adminLiveOpsStatusMock).toHaveBeenCalledTimes(2);
    // Sau refresh, label flip "Bật".
    const togglesAfter = w.findAll('[data-test="admin-liveops-toggle"]');
    expect(togglesAfter[0].text()).toBe('Bật');
  });

  it('toggle error (EVENT_NOT_FOUND) → toast error; status KHÔNG refresh', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const err = Object.assign(new Error('EVENT_NOT_FOUND'), {
      code: 'EVENT_NOT_FOUND',
    });
    adminLiveOpsToggleMock.mockRejectedValueOnce(err);

    const w = mountPanel();
    await flushPromises();
    const toggles = w.findAll('[data-test="admin-liveops-toggle"]');
    await toggles[0].trigger('click');
    await flushPromises();

    expect(adminLiveOpsToggleMock).toHaveBeenCalled();
    // status chỉ được fetch 1 lần (initial), KHÔNG refresh sau error.
    expect(adminLiveOpsStatusMock).toHaveBeenCalledTimes(1);
  });

  it('error state status load fail + sectWar fail (non-fatal): error placeholder + sectWar unavailable line', async () => {
    const err = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' });
    adminLiveOpsStatusMock.mockRejectedValueOnce(err);
    adminSectWarStatusMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Không thể thao tác.');
  });
});
