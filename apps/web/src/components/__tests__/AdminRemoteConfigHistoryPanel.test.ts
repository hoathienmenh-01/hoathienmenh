/**
 * Phase 45.0 finish (beta safe integration sweep) —
 * AdminRemoteConfigHistoryPanel tests.
 *
 * Cover:
 *   - render audit rows từ adminListRemoteConfigAudit().
 *   - filter key + action + limit → API gọi đúng params.
 *   - empty + error states render đúng testid.
 *   - apply button gọi lại API (refresh).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));

vi.mock('@/api/remoteConfig', () => ({
  adminListRemoteConfigAudit: auditMock,
}));

import AdminRemoteConfigHistoryPanel from '@/components/AdminRemoteConfigHistoryPanel.vue';
import type { RemoteConfigAuditEntry } from '@/api/remoteConfig';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…' },
      toast: { title: { info: 'I', error: 'E', success: 'S' } },
      adminRemoteConfigHistory: {
        title: 'Lịch sử',
        hint: 'Audit',
        loading: 'Đang tải…',
        empty: 'Trống',
        filter: {
          keyPlaceholder: 'Lọc key',
          actionLabel: 'Loại',
          actionAll: 'Tất cả',
          actionUpdate: 'Update',
          actionRefreshDefaults: 'Sync',
          actionClearCache: 'Clear',
          limitLabel: 'Rows',
          apply: 'Áp dụng',
        },
        columns: {
          changedAt: 'Khi',
          actor: 'Admin',
          action: 'Hành động',
          key: 'Key',
          value: 'Giá trị',
          reason: 'Lý do',
        },
        row: { noKey: '—', noReason: '—', valuePlaceholder: '—' },
        errors: {
          INVALID_INPUT: 'Filter sai',
          FORBIDDEN: 'Forbidden',
          UNAUTHENTICATED: 'Auth',
          UNKNOWN: 'Lỗi',
        },
      },
    },
  },
});

function makeEntry(
  over: Partial<RemoteConfigAuditEntry> = {},
): RemoteConfigAuditEntry {
  return {
    id: 'audit-1',
    actorUserId: 'admin-uuid-1',
    action: 'ADMIN_REMOTE_CONFIG_UPDATE',
    key: 'max_daily_claims',
    value: 100,
    valueType: 'number',
    reason: 'event spike',
    createdAt: '2026-05-16T00:00:00.000Z',
    meta: { key: 'max_daily_claims', value: 100, valueType: 'number' },
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  auditMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminRemoteConfigHistoryPanel', () => {
  it('renders rows returned from API', async () => {
    auditMock.mockResolvedValue([
      makeEntry({ id: 'audit-1' }),
      makeEntry({
        id: 'audit-2',
        action: 'ADMIN_REMOTE_CONFIG_CLEAR_CACHE',
        key: null,
        value: null,
        reason: null,
      }),
    ]);
    const w = mount(AdminRemoteConfigHistoryPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      w.find('[data-testid="admin-remote-config-history-panel"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-remote-config-history-row-audit-1"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-remote-config-history-row-audit-2"]').exists(),
    ).toBe(true);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('apply button passes filter (key + action + limit)', async () => {
    auditMock.mockResolvedValue([]);
    const w = mount(AdminRemoteConfigHistoryPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-history-key"]')
      .setValue('max_daily_claims');
    await w
      .find('[data-testid="admin-remote-config-history-action"]')
      .setValue('ADMIN_REMOTE_CONFIG_UPDATE');
    await w
      .find('[data-testid="admin-remote-config-history-limit"]')
      .setValue('25');
    await w
      .find('[data-testid="admin-remote-config-history-apply"]')
      .trigger('click');
    await flushPromises();
    expect(auditMock).toHaveBeenLastCalledWith({
      key: 'max_daily_claims',
      action: 'ADMIN_REMOTE_CONFIG_UPDATE',
      limit: 25,
    });
  });

  it('clamps limit into [1,200] before calling API', async () => {
    auditMock.mockResolvedValue([]);
    const w = mount(AdminRemoteConfigHistoryPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-testid="admin-remote-config-history-limit"]')
      .setValue('9999');
    await w
      .find('[data-testid="admin-remote-config-history-apply"]')
      .trigger('click');
    await flushPromises();
    expect(auditMock).toHaveBeenLastCalledWith({ limit: 200 });
  });

  it('shows empty state when API returns no rows', async () => {
    auditMock.mockResolvedValue([]);
    const w = mount(AdminRemoteConfigHistoryPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      w.find('[data-testid="admin-remote-config-history-empty"]').exists(),
    ).toBe(true);
  });

  it('shows error state when API rejects', async () => {
    auditMock.mockRejectedValue(new Error('boom'));
    const w = mount(AdminRemoteConfigHistoryPanel, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      w.find('[data-testid="admin-remote-config-history-error"]').exists(),
    ).toBe(true);
  });
});
