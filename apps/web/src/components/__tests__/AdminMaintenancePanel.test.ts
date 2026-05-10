/**
 * Phase 15.5 — AdminMaintenancePanel tests.
 *
 * Cover:
 *   - render list maintenance windows từ API.
 *   - empty state khi list trả mảng rỗng.
 *   - submit form non-major (DRAFT) → adminCreateMaintenanceWindow gọi
 *     trực tiếp (không cần confirm).
 *   - submit form major (CRITICAL) → confirm modal hiện, click confirm
 *     mới gọi API.
 *   - disable button → confirm modal → API gọi với id đúng.
 *   - recompute button gọi API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { MaintenanceWindowAdminView } from '@xuantoi/shared';

const { listMock, createMock, disableMock, recomputeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  disableMock: vi.fn(),
  recomputeMock: vi.fn(),
}));

vi.mock('@/api/maintenance', () => ({
  adminListMaintenanceWindows: listMock,
  adminCreateMaintenanceWindow: createMock,
  adminDisableMaintenanceWindow: disableMock,
  adminRecomputeMaintenanceStatus: recomputeMock,
}));

import AdminMaintenancePanel from '@/components/AdminMaintenancePanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…', confirm: 'OK', cancel: 'Huỷ' },
      adminMaintenance: {
        title: 'Bảo trì',
        hint: 'Hint',
        actions: {
          create: 'Tạo',
          refresh: 'Tải lại',
          recompute: 'Recompute',
          disable: 'Tắt',
        },
        form: {
          title: 'Tạo lịch',
          key: 'Key',
          severity: 'Severity',
          target: 'Target',
          initialStatus: 'InitialStatus',
          titleVi: 'TitleVi',
          titleEn: 'TitleEn',
          messageVi: 'MessageVi',
          messageEn: 'MessageEn',
          startsAt: 'StartsAt',
          endsAt: 'EndsAt',
          allowAdminBypass: 'AdminBypass',
          allowHealthcheck: 'Healthcheck',
          allowMetrics: 'Metrics',
        },
        list: {
          title: 'Windows',
          empty: 'Chưa có window.',
          window: '{from} → {to}',
        },
        confirm: {
          create: { title: 'Confirm', message: 'Confirm: {description}' },
          disable: { title: 'Disable', message: 'Disable {key}?' },
        },
        toast: {
          created: 'Đã tạo {key}.',
          disabled: 'Đã tắt {key}.',
          recomputed: 'Recompute +{activated} -{ended}.',
        },
        errors: { UNKNOWN: 'Lỗi.' },
      },
      toast: { title: { info: 'Info', error: 'Lỗi', success: 'OK' } },
    },
  },
});

function makeWindow(
  over: Partial<MaintenanceWindowAdminView> = {},
): MaintenanceWindowAdminView {
  return {
    id: 'w-1',
    key: 'mw-2026-08-01',
    status: 'SCHEDULED',
    severity: 'WARNING',
    target: 'ALL_PLAYERS',
    titleVi: 'Bảo trì',
    titleEn: 'Maintenance',
    messageVi: 'Vui lòng quay lại.',
    messageEn: 'Please come back.',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-01T02:00:00.000Z',
    allowAdminBypass: true,
    allowHealthcheck: true,
    allowMetrics: true,
    createdByAdminId: 'admin-1',
    disabledAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
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

describe('AdminMaintenancePanel', () => {
  it('render list window từ API', async () => {
    listMock.mockResolvedValue([makeWindow({ id: 'w-1', key: 'mw-a' })]);
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(w.find('[data-testid="admin-maintenance-row-w-1"]').exists()).toBe(true);
    w.unmount();
  });

  it('empty state', async () => {
    listMock.mockResolvedValue([]);
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(w.find('[data-testid="admin-maintenance-empty"]').exists()).toBe(true);
    w.unmount();
  });

  it('submit form SCHEDULED → confirm modal hiện trước khi gọi API', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(makeWindow({ id: 'w-2', key: 'mw-b' }));
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w.find('[data-testid="admin-maintenance-form-key"]').setValue('mw-b');
    await w.find('[data-testid="admin-maintenance-form-titleVi"]').setValue('Bảo trì');
    await w.find('[data-testid="admin-maintenance-form-messageVi"]').setValue('Vui lòng quay lại.');
    await w.find('[data-testid="admin-maintenance-form-startsAt"]').setValue('2026-08-01T00:00');
    await w.find('[data-testid="admin-maintenance-form-endsAt"]').setValue('2026-08-01T02:00');
    await w.find('[data-testid="admin-maintenance-form-submit"]').trigger('click');
    await flushPromises();
    // SCHEDULED là major → confirm modal phải hiện, API chưa được gọi.
    expect(createMock).not.toHaveBeenCalled();
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-maintenance-confirm-create-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0].key).toBe('mw-b');
    w.unmount();
  });

  it('submit DRAFT non-major → bỏ confirm, gọi API ngay', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(makeWindow({ id: 'w-3', key: 'mw-c', status: 'DRAFT' }));
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w.find('[data-testid="admin-maintenance-form-key"]').setValue('mw-c');
    await w.find('[data-testid="admin-maintenance-form-titleVi"]').setValue('Bảo trì');
    await w.find('[data-testid="admin-maintenance-form-messageVi"]').setValue('msg');
    await w.find('[data-testid="admin-maintenance-form-startsAt"]').setValue('2026-08-01T00:00');
    await w.find('[data-testid="admin-maintenance-form-endsAt"]').setValue('2026-08-01T02:00');
    // Severity WARNING + target ALL_PLAYERS + initialStatus DRAFT → non-major.
    const initSelect = w.find<HTMLSelectElement>(
      '[data-testid="admin-maintenance-form-initialStatus"]',
    );
    await initSelect.setValue('DRAFT');
    await w.find('[data-testid="admin-maintenance-form-submit"]').trigger('click');
    await flushPromises();
    expect(createMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('disable button → confirm → API gọi với id đúng', async () => {
    listMock.mockResolvedValue([makeWindow({ id: 'w-1', key: 'mw-a', status: 'ACTIVE' })]);
    disableMock.mockResolvedValue(makeWindow({ id: 'w-1', status: 'DISABLED' }));
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w.find('[data-testid="admin-maintenance-disable-w-1"]').trigger('click');
    await flushPromises();
    expect(disableMock).not.toHaveBeenCalled();
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-maintenance-confirm-disable-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(disableMock).toHaveBeenCalledWith('w-1');
    w.unmount();
  });

  it('recompute button gọi adminRecomputeMaintenanceStatus', async () => {
    listMock.mockResolvedValue([]);
    recomputeMock.mockResolvedValue({
      scannedAt: '2026-08-01T00:00:00.000Z',
      activatedKeys: ['a'],
      endedKeys: ['b', 'c'],
    });
    const w = mount(AdminMaintenancePanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w.find('[data-testid="admin-maintenance-recompute"]').trigger('click');
    await flushPromises();
    expect(recomputeMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
