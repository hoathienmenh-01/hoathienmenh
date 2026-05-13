import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  PlayerReportListResponse,
  PlayerReportRow,
} from '@xuantoi/shared';

/**
 * Phase 41.0 — ReportPlayerView smoke tests.
 *
 * Covers: empty state, list render, submit creates report.
 */

const listMyReportsMock = vi.fn();
const createPlayerReportMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  listMyReports: (...a: unknown[]) => listMyReportsMock(...a),
  createPlayerReport: (...a: unknown[]) => createPlayerReportMock(...a),
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

import ReportPlayerView from '@/views/ReportPlayerView.vue';

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
        report: {
          title: 'Tố cáo',
          subtitle: 'Sub',
          form: {
            title: 'Mới',
            fields: { targetCharacterId: 'Mục tiêu', reportType: 'Loại', description: 'Mô tả' },
            errors: { tooShort: 'ngắn quá' },
            submit: 'Gửi',
            submitted: 'Đã gửi',
            disclaimer: 'Cảnh báo',
          },
          list: { title: 'Của tôi', emptyTitle: 'rỗng', emptyDescription: 'mô tả' },
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
          errors: { UNKNOWN: 'lỗi' },
        },
      },
    },
  });
}

function buildRow(): PlayerReportRow {
  return {
    id: 'r1',
    reporterCharacterId: 'c1',
    reporterDisplayName: 'Test',
    targetCharacterId: 'c2',
    targetDisplayName: 'Target',
    reportType: 'HARASSMENT',
    status: 'NEW',
    description: 'Mô tả về hành vi vi phạm',
    evidenceJson: null,
    adminNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

function emptyList(): PlayerReportListResponse {
  return { reports: [], total: 0, nextCursor: null };
}

describe('Phase 41.0 — ReportPlayerView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMyReportsMock.mockReset();
    createPlayerReportMock.mockReset();
    toastPushMock.mockReset();
  });

  it('shows empty state when no reports', async () => {
    listMyReportsMock.mockResolvedValue(emptyList());
    const wrapper = mount(ReportPlayerView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="report-list-empty"]').exists()).toBe(true);
  });

  it('renders list rows from API', async () => {
    listMyReportsMock.mockResolvedValue({
      reports: [buildRow()],
      total: 1,
      nextCursor: null,
    });
    const wrapper = mount(ReportPlayerView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="report-item"]').length).toBe(1);
    expect(wrapper.text()).toContain('Target');
  });

  it('submits form and toasts success', async () => {
    listMyReportsMock.mockResolvedValue(emptyList());
    createPlayerReportMock.mockResolvedValue(buildRow());
    const wrapper = mount(ReportPlayerView, { global: { plugins: [buildI18n()] } });
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue('c2');
    await wrapper.find('textarea').setValue('Vi phạm quy tắc rõ ràng và đủ dài.');
    await wrapper.find('[data-testid="report-submit"]').trigger('click');
    await flushPromises();

    expect(createPlayerReportMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });
});
