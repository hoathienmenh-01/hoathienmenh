import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { PlayerReportRow } from '@xuantoi/shared';

/**
 * Phase 41.0 — AdminReportsView smoke tests.
 *
 * Covers: permission denied (PLAYER), list render (MOD).
 */

const adminListReportsMock = vi.fn();
const adminPatchReportMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  adminListReports: (...a: unknown[]) => adminListReportsMock(...a),
  adminPatchReport: (...a: unknown[]) => adminPatchReportMock(...a),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  user: { role: 'PLAYER' as 'PLAYER' | 'MOD' | 'ADMIN' },
  hydrate: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}));

import AdminReportsView from '@/views/AdminReportsView.vue';

function buildI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    missingFallbackWarn: false,
    messages: {
      vi: {
        common: {
          loading: '...',
          empty: { title: 'trống', description: 'mô tả' },
          error: { UNKNOWN: 'lỗi' },
          retry: 'Thử lại',
        },
        adminReports: {
          title: 'Admin Reports',
          subtitle: 'Sub',
          allStatuses: 'Tất cả',
          total: 'Tổng: {n}',
          emptyTitle: 'rỗng',
          emptyDescription: 'mô tả',
          notAdminTitle: 'Không có quyền',
          notAdminDescription: 'Chỉ MOD/ADMIN',
          patched: 'Đã cập nhật',
          errors: { UNKNOWN: 'lỗi' },
        },
        report: {
          types: {
            HARASSMENT: 'Quấy rối',
            CHEATING: 'Hack',
            SCAM: 'Lừa đảo',
            MARKET_ABUSE: 'Lạm dụng chợ',
            BUG_EXPLOIT: 'Lỗi',
            OFFENSIVE_NAME: 'Tên',
            SPAM: 'Spam',
            OTHER: 'Khác',
          },
          statuses: {
            NEW: 'Mới',
            REVIEWING: 'Đang xem',
            ACTION_TAKEN: 'Đã xử lý',
            DISMISSED: 'Bác',
            DUPLICATE: 'Trùng',
          },
        },
      },
    },
  });
}

function buildRow(): PlayerReportRow {
  return {
    id: 'r1',
    reporterCharacterId: 'c1',
    reporterDisplayName: 'Reporter',
    targetCharacterId: 'c2',
    targetDisplayName: 'Target',
    reportType: 'HARASSMENT',
    status: 'NEW',
    description: 'Mô tả',
    evidenceJson: null,
    adminNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

describe('Phase 41.0 — AdminReportsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminListReportsMock.mockReset();
    adminPatchReportMock.mockReset();
    toastPushMock.mockReset();
    authState.user = { role: 'PLAYER' };
  });

  it('shows not-admin empty state for PLAYER role', async () => {
    authState.user = { role: 'PLAYER' };
    const wrapper = mount(AdminReportsView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="admin-reports-forbidden"]').exists()).toBe(true);
    expect(adminListReportsMock).not.toHaveBeenCalled();
  });

  it('lists report rows for ADMIN role', async () => {
    authState.user = { role: 'ADMIN' };
    adminListReportsMock.mockResolvedValue({
      reports: [buildRow()],
      total: 1,
      nextCursor: null,
    });
    const wrapper = mount(AdminReportsView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(adminListReportsMock).toHaveBeenCalled();
    expect(wrapper.findAll('[data-testid="admin-reports-item"]').length).toBe(1);
  });
});
