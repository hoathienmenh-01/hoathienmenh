/**
 * Phase 15.3.B — AdminLiveOpsAnnouncementsPanel tests.
 *
 * Cover:
 *   - empty state khi list rỗng.
 *   - render row với key/severity/status badges.
 *   - click "New" → form mở; submit → adminLiveOpsAnnouncementsCreate gọi
 *     đúng input.
 *   - click "Recompute" → adminLiveOpsAnnouncementsRecompute gọi + toast info.
 *   - click "Disable" → adminLiveOpsAnnouncementsDisable gọi đúng id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { AdminLiveOpsAnnouncementView } from '@/api/admin';

const listMock = vi.fn();
const createMock = vi.fn();
const disableMock = vi.fn();
const recomputeMock = vi.fn();

vi.mock('@/api/admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/admin')>(
    '@/api/admin',
  );
  return {
    ...actual,
    adminLiveOpsAnnouncementsList: (...a: unknown[]) => listMock(...a),
    adminLiveOpsAnnouncementsCreate: (...a: unknown[]) => createMock(...a),
    adminLiveOpsAnnouncementsDisable: (...a: unknown[]) => disableMock(...a),
    adminLiveOpsAnnouncementsRecompute: (...a: unknown[]) =>
      recomputeMock(...a),
  };
});

import AdminLiveOpsAnnouncementsPanel from '@/components/AdminLiveOpsAnnouncementsPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOpsAnnouncements: {
        title: 'LiveOps Announcement',
        loading: 'Đang tải announcement…',
        empty: 'Chưa có announcement nào.',
        refreshBtn: 'Làm mới',
        newBtn: 'Tạo announcement',
        form: {
          title: 'Tạo announcement',
          key: 'Khoá (unique)',
          severity: 'Mức độ',
          target: 'Đối tượng',
          titleVi: 'Tiêu đề (VI)',
          titleEn: 'Tiêu đề (EN, optional)',
          messageVi: 'Nội dung (VI)',
          messageEn: 'Nội dung (EN, optional)',
          startsAt: 'Bắt đầu (ISO)',
          endsAt: 'Kết thúc (ISO)',
          initialStatus: 'Trạng thái khởi tạo',
          submit: 'Tạo',
          cancel: 'Huỷ',
        },
        row: {
          key: 'Khoá',
          severity: 'Mức',
          status: 'Trạng thái',
          target: 'Đối tượng',
          window: 'Khung thời gian',
          actions: 'Thao tác',
        },
        actions: {
          disable: 'Tắt',
          recompute: 'Recompute',
        },
        errors: {
          UNKNOWN: 'Thao tác thất bại — thử lại.',
        },
        toast: {
          created: 'Đã tạo announcement {key}.',
          disabled: 'Đã tắt announcement {key}.',
          recomputed:
            'Recompute xong: {activated} active / {ended} ended.',
        },
      },
      toast: {
        title: {
          info: 'Thông tin',
          warning: 'Cảnh báo',
          error: 'Lỗi',
          success: 'Thành công',
          system: 'Hệ thống',
        },
      },
    },
  },
});

function makeRow(
  over: Partial<AdminLiveOpsAnnouncementView> = {},
): AdminLiveOpsAnnouncementView {
  return {
    id: 'ann1',
    key: 'announcement-001',
    severity: 'INFO',
    status: 'SCHEDULED',
    target: 'ALL',
    titleVi: 'Tiêu đề',
    titleEn: 'Title',
    messageVi: 'Nội dung',
    messageEn: 'Body',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-02T00:00:00.000Z',
    createdByAdminId: 'admin1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    disabledAt: null,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  createMock.mockReset();
  disableMock.mockReset();
  recomputeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminLiveOpsAnnouncementsPanel', () => {
  it('empty state khi list rỗng', async () => {
    listMock.mockResolvedValue([]);
    const w = mount(AdminLiveOpsAnnouncementsPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      w.find('[data-test="admin-liveops-announcements-empty"]').exists(),
    ).toBe(true);
  });

  it('render row với key/status', async () => {
    listMock.mockResolvedValue([makeRow({ key: 'ann-x', status: 'ACTIVE' })]);
    const w = mount(AdminLiveOpsAnnouncementsPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const row = w.find('[data-test="admin-liveops-announcements-row-ann-x"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('ann-x');
    expect(row.text()).toContain('ACTIVE');
  });

  it('Recompute → API gọi + toast', async () => {
    listMock.mockResolvedValue([]);
    recomputeMock.mockResolvedValue({
      scannedAt: '2026-08-01T00:01:00.000Z',
      activated: [{ key: 'a' }],
      ended: [],
    });
    const w = mount(AdminLiveOpsAnnouncementsPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-test="admin-liveops-announcements-recompute"]')
      .trigger('click');
    await flushPromises();
    expect(recomputeMock).toHaveBeenCalledTimes(1);
  });

  it('Disable → API gọi với đúng id', async () => {
    const orig = window.confirm;
    window.confirm = () => true;
    listMock.mockResolvedValue([makeRow({ key: 'ann-z', status: 'ACTIVE' })]);
    disableMock.mockResolvedValue(makeRow({ status: 'DISABLED' }));
    const w = mount(AdminLiveOpsAnnouncementsPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-test="admin-liveops-announcements-disable-ann-z"]')
      .trigger('click');
    await flushPromises();
    expect(disableMock).toHaveBeenCalledWith('ann1');
    window.confirm = orig;
  });

  it('New form → submit gọi create với input', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(makeRow({ key: 'ann-new' }));
    const w = mount(AdminLiveOpsAnnouncementsPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w.find('[data-test="admin-liveops-announcements-new"]').trigger('click');
    await w
      .find('[data-test="admin-liveops-announcements-form-key"]')
      .setValue('ann-new');
    await w
      .find('[data-test="admin-liveops-announcements-form-titleVi"]')
      .setValue('TVI');
    await w
      .find('[data-test="admin-liveops-announcements-form-messageVi"]')
      .setValue('MVI');
    await w
      .find('[data-test="admin-liveops-announcements-form-startsAt"]')
      .setValue('2026-08-01T00:00');
    await w
      .find('[data-test="admin-liveops-announcements-form-endsAt"]')
      .setValue('2026-08-02T00:00');
    await w
      .find('[data-test="admin-liveops-announcements-form"]')
      .trigger('submit.prevent');
    await flushPromises();
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.key).toBe('ann-new');
    expect(arg.titleVi).toBe('TVI');
    expect(arg.messageVi).toBe('MVI');
  });
});
