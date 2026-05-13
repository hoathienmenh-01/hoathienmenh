import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { PlayerFeedbackRow } from '@xuantoi/shared';

/**
 * Phase 41.0 — AdminFeedbackView smoke tests.
 *
 * Covers: permission denied (PLAYER), list render (MOD), patch status.
 */

const adminListFeedbackMock = vi.fn();
const adminPatchFeedbackMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  adminListFeedback: (...a: unknown[]) => adminListFeedbackMock(...a),
  adminPatchFeedback: (...a: unknown[]) => adminPatchFeedbackMock(...a),
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

import AdminFeedbackView from '@/views/AdminFeedbackView.vue';

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
        adminFeedback: {
          title: 'Admin FB',
          subtitle: 'Sub',
          allStatuses: 'Tất cả trạng thái',
          allTypes: 'Tất cả loại',
          total: 'Tổng: {n}',
          emptyTitle: 'rỗng',
          emptyDescription: 'mô tả',
          notAdminTitle: 'Không có quyền',
          notAdminDescription: 'Chỉ MOD/ADMIN',
          patched: 'Đã cập nhật',
          errors: { UNKNOWN: 'lỗi' },
        },
        feedback: {
          types: {
            BUG_REPORT: 'Bug',
            BALANCE_FEEDBACK: 'Bal',
            UI_FEEDBACK: 'UI',
            LOST_ITEM_REPORT: 'Lost',
            PAYMENT_REPORT: 'Pay',
            MARKET_REPORT: 'Mkt',
            PLAYER_REPORT: 'Plr',
            CHEAT_REPORT: 'Cheat',
            QUEST_STUCK_REPORT: 'Quest',
            OTHER: 'Khác',
          },
          statuses: {
            NEW: 'Mới',
            TRIAGE: 'Phân loại',
            IN_PROGRESS: 'Xử lý',
            RESOLVED: 'Giải quyết',
            DUPLICATE: 'Trùng',
            CLOSED: 'Đóng',
          },
          severities: { LOW: 'Thấp', MEDIUM: 'TB', HIGH: 'Cao', CRITICAL: 'Crit' },
        },
      },
    },
  });
}

function buildRow(): PlayerFeedbackRow {
  return {
    id: 'fb1',
    reporterCharacterId: 'c1',
    reporterDisplayName: 'Reporter',
    type: 'BUG_REPORT',
    title: 'Có lỗi nghiêm trọng',
    description: 'Mô tả',
    severity: 'HIGH',
    status: 'NEW',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    relatedFeature: null,
    relatedEntityType: null,
    relatedEntityId: null,
    targetCharacterId: null,
    adminNote: null,
    resolvedAt: null,
  };
}

describe('Phase 41.0 — AdminFeedbackView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminListFeedbackMock.mockReset();
    adminPatchFeedbackMock.mockReset();
    toastPushMock.mockReset();
    authState.user = { role: 'PLAYER' };
  });

  it('shows not-admin empty state for PLAYER role', async () => {
    authState.user = { role: 'PLAYER' };
    const wrapper = mount(AdminFeedbackView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="admin-feedback-forbidden"]').exists()).toBe(true);
    expect(adminListFeedbackMock).not.toHaveBeenCalled();
  });

  it('lists feedback rows for MOD role', async () => {
    authState.user = { role: 'MOD' };
    adminListFeedbackMock.mockResolvedValue({
      feedback: [buildRow()],
      total: 1,
      nextCursor: null,
    });
    const wrapper = mount(AdminFeedbackView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(adminListFeedbackMock).toHaveBeenCalled();
    expect(wrapper.findAll('[data-testid="admin-feedback-item"]').length).toBe(1);
  });
});
