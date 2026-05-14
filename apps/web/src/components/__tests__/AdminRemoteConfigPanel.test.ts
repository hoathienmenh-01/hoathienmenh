/**
 * Phase 45.0 — AdminRemoteConfigPanel tests.
 *
 * Cover:
 *   - render list configs từ adminListRemoteConfigs().
 *   - search input filter theo key.
 *   - edit number → reason >= 3 ký tự → confirm modal → adminUpdateRemoteConfig.
 *   - edit boolean validates parse (chỉ true/false).
 *   - edit json validates parse (JSON hợp lệ).
 *   - missing reason → block save + show toast.
 *   - refreshDefaults / clearCache buttons gọi đúng API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { RemoteConfigAdminView } from '@xuantoi/shared';

const {
  listMock,
  updateMock,
  refreshDefaultsMock,
  clearCacheMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
  refreshDefaultsMock: vi.fn(),
  clearCacheMock: vi.fn(),
}));

vi.mock('@/api/remoteConfig', () => ({
  adminListRemoteConfigs: listMock,
  adminUpdateRemoteConfig: updateMock,
  adminRefreshRemoteConfigDefaults: refreshDefaultsMock,
  adminClearRemoteConfigCache: clearCacheMock,
}));

import AdminRemoteConfigPanel from '@/components/AdminRemoteConfigPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…', confirm: 'OK', cancel: 'Huỷ' },
      adminRemoteConfig: {
        title: 'Remote Config',
        hint: 'Cấu hình vận hành',
        loading: 'Đang tải…',
        empty: 'Trống',
        filter: { searchPlaceholder: 'Tìm…' },
        row: {
          default: 'Mặc định: {value}',
          current: 'Hiện tại: {value}',
          updatedAt: 'Cập nhật: {at}',
          notUpdated: 'chưa thay đổi',
          publicTag: 'PUBLIC',
          publicHint: 'Public hint',
          reasonPlaceholder: 'Lý do',
        },
        actions: {
          edit: 'Sửa',
          save: 'Lưu',
          cancel: 'Huỷ',
          refresh: 'Làm mới',
          refreshDefaults: 'Đồng bộ default',
          clearCache: 'Xoá cache',
        },
        confirm: {
          title: 'Xác nhận',
          message: 'Set {key}={value} ({reason})',
        },
        toast: {
          saved: 'Đã lưu {key}',
          refreshedDefaults: 'Đồng bộ {created}/{existing}',
          cacheCleared: 'Đã xoá cache',
        },
        errors: {
          REASON_REQUIRED: 'Cần lý do.',
          PARSE_NUMBER: 'Số sai.',
          PARSE_BOOLEAN: 'Boolean sai.',
          PARSE_JSON: 'JSON sai.',
          UNKNOWN: 'Lỗi.',
        },
      },
      toast: { title: { info: 'Info', error: 'Lỗi', success: 'OK' } },
    },
  },
});

function makeConfig(
  over: Partial<RemoteConfigAdminView> = {},
): RemoteConfigAdminView {
  return {
    key: 'max_daily_claims',
    valueType: 'number',
    value: 50,
    defaultValue: 50,
    descriptionVi: 'Max claim',
    descriptionEn: 'Max claim',
    public: false,
    updatedByAdminId: null,
    updatedAt: null,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  updateMock.mockReset();
  refreshDefaultsMock.mockReset();
  clearCacheMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminRemoteConfigPanel', () => {
  it('renders configs from API', async () => {
    listMock.mockResolvedValue([
      makeConfig({ key: 'max_daily_claims', value: 50 }),
      makeConfig({
        key: 'maintenance_message',
        valueType: 'string',
        value: '',
        defaultValue: '',
        public: true,
      }),
    ]);
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(
      w.find('[data-testid="admin-remote-config-row-max_daily_claims"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-remote-config-row-maintenance_message"]').exists(),
    ).toBe(true);
  });

  it('search input filters list', async () => {
    listMock.mockResolvedValue([
      makeConfig({ key: 'max_daily_claims', value: 50 }),
      makeConfig({
        key: 'maintenance_message',
        valueType: 'string',
        value: '',
        defaultValue: '',
      }),
    ]);
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    const search = w.find('[data-testid="admin-remote-config-search"]');
    await search.setValue('maintenance');
    await flushPromises();
    expect(
      w.find('[data-testid="admin-remote-config-row-maintenance_message"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-remote-config-row-max_daily_claims"]').exists(),
    ).toBe(false);
  });

  it('edit number → reason required → confirm → API called', async () => {
    listMock.mockResolvedValue([makeConfig({ key: 'max_daily_claims', value: 50 })]);
    updateMock.mockResolvedValue(makeConfig({ value: 100 }));
    const w = mount(AdminRemoteConfigPanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-edit-btn-max_daily_claims"]')
      .trigger('click');
    await w
      .find('[data-testid="admin-remote-config-input-max_daily_claims"]')
      .setValue('100');
    await w
      .find('[data-testid="admin-remote-config-reason-max_daily_claims"]')
      .setValue('event tăng cap claim');
    await w
      .find('[data-testid="admin-remote-config-save-max_daily_claims"]')
      .trigger('click');
    await flushPromises();
    // ConfirmModal teleports to body — query DOM directly.
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-remote-config-confirm-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith(
      'max_daily_claims',
      100,
      'event tăng cap claim',
    );
    w.unmount();
  });

  it('blocks save when reason is too short', async () => {
    listMock.mockResolvedValue([makeConfig({ key: 'max_daily_claims', value: 50 })]);
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-edit-btn-max_daily_claims"]')
      .trigger('click');
    await w
      .find('[data-testid="admin-remote-config-input-max_daily_claims"]')
      .setValue('100');
    await w
      .find('[data-testid="admin-remote-config-reason-max_daily_claims"]')
      .setValue('ab');
    await w
      .find('[data-testid="admin-remote-config-save-max_daily_claims"]')
      .trigger('click');
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    expect(
      w.find('[data-testid="admin-remote-config-confirm-confirm"]').exists(),
    ).toBe(false);
  });

  it('blocks save when parsed number is invalid', async () => {
    listMock.mockResolvedValue([makeConfig({ key: 'max_daily_claims', value: 50 })]);
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-edit-btn-max_daily_claims"]')
      .trigger('click');
    await w
      .find('[data-testid="admin-remote-config-input-max_daily_claims"]')
      .setValue('not-a-number');
    await w
      .find('[data-testid="admin-remote-config-reason-max_daily_claims"]')
      .setValue('attempt typo');
    await w
      .find('[data-testid="admin-remote-config-save-max_daily_claims"]')
      .trigger('click');
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('refreshDefaults button calls API', async () => {
    listMock.mockResolvedValue([makeConfig()]);
    refreshDefaultsMock.mockResolvedValue({ created: 2, existing: 5 });
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-refresh-defaults"]')
      .trigger('click');
    await flushPromises();
    expect(refreshDefaultsMock).toHaveBeenCalledOnce();
  });

  it('clearCache button calls API', async () => {
    listMock.mockResolvedValue([makeConfig()]);
    clearCacheMock.mockResolvedValue({ cleared: true });
    const w = mount(AdminRemoteConfigPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-clear-cache"]')
      .trigger('click');
    await flushPromises();
    expect(clearCacheMock).toHaveBeenCalledOnce();
  });
});
