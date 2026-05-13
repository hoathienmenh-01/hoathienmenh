import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * AdminMailView smoke tests (Phase 31.0 PR5): tab switching + submit
 * dispatches per kind (one / bulk / global).
 */

const listLogsMock = vi.fn();
const sendOneMock = vi.fn();
const sendBulkMock = vi.fn();
const sendGlobalMock = vi.fn();

vi.mock('@/api/adminMail', () => ({
  listAdminMailLogs: (...a: unknown[]) => listLogsMock(...a),
  sendOne: (...a: unknown[]) => sendOneMock(...a),
  sendBulk: (...a: unknown[]) => sendBulkMock(...a),
  sendGlobal: (...a: unknown[]) => sendGlobalMock(...a),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}));

import AdminMailViewComponent from '@/views/AdminMailView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang xử lý…' },
      adminMail: {
        title: 'Admin Mail',
        subtitle: 'Sub',
        tabs: {
          sendOne: 'Gửi 1',
          sendBulk: 'Gửi nhiều',
          sendGlobal: 'Gửi global',
          logs: 'Logs',
        },
        form: {
          mailType: 'Type',
          subject: 'Subject',
          body: 'Body',
          reason: 'Reason',
          recipient: 'CharId',
          recipients: 'CharIds',
          targetType: 'TargetType',
          previewOnly: 'Preview',
          expiresAt: 'Expires',
          submit: 'Gửi',
        },
        toast: { sent: 'Sent {count}', preview: 'Preview {count}' },
        logs: {
          kind: 'Kind',
          subject: 'Subj',
          mailCount: 'N',
          reason: 'Reason',
          createdAt: 'When',
        },
        error: { UNKNOWN: 'Err' },
      },
    },
  },
});

function mountView() {
  return mount(AdminMailViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  listLogsMock.mockResolvedValue([]);
  authState.isAuthenticated = true;
});

describe('AdminMailView — Phase 31.0', () => {
  it('mount: render tabs + load logs', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-mail-view"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-mail-tab-sendOne"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-mail-tab-logs"]').exists()).toBe(true);
    expect(listLogsMock).toHaveBeenCalled();
  });

  it('submit sendOne: dispatch sendOne với form data', async () => {
    sendOneMock.mockResolvedValue({ logId: 'l1', mailCount: 1, targetCount: 1 });
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="admin-mail-subject"]').setValue('Test');
    await w.find('[data-testid="admin-mail-body"]').setValue('Body');
    await w.find('[data-testid="admin-mail-reason"]').setValue('test_reason_xx');
    await w.find('[data-testid="admin-mail-recipient"]').setValue('char-1');

    await w.find('[data-testid="admin-mail-submit"]').trigger('click');
    await flushPromises();

    expect(sendOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Test',
        body: 'Body',
        reason: 'test_reason_xx',
        recipientCharacterId: 'char-1',
      }),
    );
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('chuyển tab sang sendGlobal + preview: dispatch sendGlobal previewOnly', async () => {
    sendGlobalMock.mockResolvedValue({ logId: 'l2', mailCount: 0, targetCount: 5 });
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="admin-mail-tab-sendGlobal"]').trigger('click');
    await w.find('[data-testid="admin-mail-subject"]').setValue('All');
    await w.find('[data-testid="admin-mail-body"]').setValue('Bd');
    await w.find('[data-testid="admin-mail-reason"]').setValue('global_test_run');

    await w.find('[data-testid="admin-mail-submit"]').trigger('click');
    await flushPromises();

    expect(sendGlobalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previewOnly: true,
        targetRule: { type: 'ALL_PLAYERS' },
      }),
    );
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info' }),
    );
  });
});
