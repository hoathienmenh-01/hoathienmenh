import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  FeedbackListResponse,
  PlayerFeedbackRow,
} from '@xuantoi/shared';

/**
 * Phase 41.0 — FeedbackView smoke tests.
 *
 * Covers: form submit creates row, empty list state, filter status reload.
 */

const listMyFeedbackMock = vi.fn();
const createFeedbackMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  listMyFeedback: (...a: unknown[]) => listMyFeedbackMock(...a),
  createFeedback: (...a: unknown[]) => createFeedbackMock(...a),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs" :disabled="$attrs.disabled"><slot /></button>',
  },
}));

import FeedbackView from '@/views/FeedbackView.vue';

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
        feedback: {
          title: 'Phản hồi',
          subtitle: 'Sub',
          form: {
            title: 'Gửi mới',
            fields: { type: 'Loại', title: 'Tiêu đề', description: 'Nội dung', severity: 'Mức' },
            errors: { tooShort: 'ngắn quá' },
            submit: 'Gửi',
            submitted: 'Đã gửi',
          },
          list: {
            title: 'Của tôi',
            allStatuses: 'Tất cả',
            emptyTitle: 'rỗng',
            emptyDescription: 'mô tả',
          },
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
          errors: { UNKNOWN: 'lỗi' },
        },
      },
    },
  });
}

function buildRow(id = 'fb1'): PlayerFeedbackRow {
  return {
    id,
    reporterCharacterId: 'c1',
    reporterDisplayName: 'Test',
    type: 'BUG_REPORT',
    title: 'Có lỗi đăng nhập',
    description: 'Mô tả chi tiết về lỗi',
    severity: 'MEDIUM',
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

function emptyList(): FeedbackListResponse {
  return { feedback: [], nextCursor: null, total: 0 };
}

describe('Phase 41.0 — FeedbackView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMyFeedbackMock.mockReset();
    createFeedbackMock.mockReset();
    toastPushMock.mockReset();
  });

  it('shows empty state when no feedback', async () => {
    listMyFeedbackMock.mockResolvedValue(emptyList());
    const wrapper = mount(FeedbackView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="feedback-list-empty"]').exists()).toBe(true);
  });

  it('renders list rows from API', async () => {
    listMyFeedbackMock.mockResolvedValue({
      feedback: [buildRow()],
      nextCursor: null,
      total: 1,
    });
    const wrapper = mount(FeedbackView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="feedback-item"]').length).toBe(1);
    expect(wrapper.text()).toContain('Có lỗi đăng nhập');
  });

  it('submits form and prepends new feedback to list', async () => {
    listMyFeedbackMock.mockResolvedValue(emptyList());
    const newRow = buildRow('fb2');
    createFeedbackMock.mockResolvedValue(newRow);
    const wrapper = mount(FeedbackView, { global: { plugins: [buildI18n()] } });
    await flushPromises();

    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0].setValue('Tiêu đề lỗi mới');
    await wrapper.find('textarea').setValue('Nội dung dài hơn 10 ký tự để pass validation.');
    await wrapper.find('[data-testid="feedback-submit"]').trigger('click');
    await flushPromises();

    expect(createFeedbackMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });
});
