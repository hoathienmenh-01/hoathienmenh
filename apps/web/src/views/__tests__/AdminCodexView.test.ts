import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const reindexMock = vi.fn().mockResolvedValue({ entriesUpserted: 5, entriesRemoved: 0, issuesFound: 0 });
const listIssuesMock = vi.fn().mockResolvedValue([]);
const hideMock = vi.fn().mockResolvedValue(undefined);
const showMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/api/codex', () => ({
  adminReindexCodex: (...a: unknown[]) => reindexMock(...a),
  adminListCodexIssues: (...a: unknown[]) => listIssuesMock(...a),
  adminHideCodex: (...a: unknown[]) => hideMock(...a),
  adminShowCodex: (...a: unknown[]) => showMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
    isAdmin: true,
    user: { id: '1', role: 'ADMIN' },
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: { name: 'MButtonStub', template: '<button v-bind="$attrs"><slot /></button>' },
}));

import AdminCodexView from '@/views/AdminCodexView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang tải', error: 'Lỗi', all: 'Tất cả' },
      adminCodex: {
        title: 'Thiên Tịch Tổng Bác',
        reindexTitle: 'Reindex',
        reindex: 'Reindex',
        reasonPlaceholder: 'Lý do',
        reasonRequired: 'Cần lý do',
        reindexSuccess: 'OK',
        hideTitle: 'Ẩn',
        hide: 'Ẩn',
        hideSuccess: 'Đã ẩn',
        showTitle: 'Hiện',
        show: 'Hiện',
        showSuccess: 'Đã hiện',
        entryKey: 'Key',
        reason: 'Lý do',
        issuesTitle: 'Issues',
        issueType: 'Type',
        severity: 'Severity',
        message: 'Message',
        noIssues: 'Không có',
      },
    },
  },
});

function mountView() {
  return mount(AdminCodexView, { global: { plugins: [i18n] } });
}

describe('AdminCodexView — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listIssuesMock.mockResolvedValue([]);
  });

  it('render title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Thiên Tịch Tổng Bác');
    w.unmount();
  });

  it('render reindex section', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Reindex');
    w.unmount();
  });

  it('render hide/show sections', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Ẩn');
    expect(w.text()).toContain('Hiện');
    w.unmount();
  });

  it('render issues table', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Issues');
    expect(w.text()).toContain('Không có');
    w.unmount();
  });
});
