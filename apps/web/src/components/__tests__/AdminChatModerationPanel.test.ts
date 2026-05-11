/**
 * Phase 19.2 — AdminChatModerationPanel smoke tests.
 *
 * Verify:
 *   - Mount → gọi summary + listReports + listMutes song song.
 *   - Render summary cards với số liệu từ server.
 *   - Render table reports row + admin actions (Ack, Resolve, Hide).
 *   - Ack confirm=false → KHÔNG gọi API.
 *   - Ack confirm=true → gọi API + refresh.
 *   - Empty state khi BE trả [].
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminChatModerationSummaryMock = vi.fn();
const adminListChatReportsMock = vi.fn();
const adminListChatMutesMock = vi.fn();
const adminAckChatReportMock = vi.fn();
const adminResolveChatReportMock = vi.fn();
const adminHideChatMessageMock = vi.fn();

vi.mock('@/api/chatModeration', () => ({
  adminChatModerationSummary: (...a: unknown[]) =>
    adminChatModerationSummaryMock(...a),
  adminListChatReports: (...a: unknown[]) => adminListChatReportsMock(...a),
  adminListChatMutes: (...a: unknown[]) => adminListChatMutesMock(...a),
  adminAckChatReport: (...a: unknown[]) => adminAckChatReportMock(...a),
  adminResolveChatReport: (...a: unknown[]) => adminResolveChatReportMock(...a),
  adminCreateChatMute: vi.fn(),
  adminRevokeChatMute: vi.fn(),
  adminHideChatMessage: (...a: unknown[]) => adminHideChatMessageMock(...a),
  adminUnhideChatMessage: vi.fn(),
  adminLockChatGroup: vi.fn(),
  adminUnlockChatGroup: vi.fn(),
  adminDissolveChatGroup: vi.fn(),
}));

import AdminChatModerationPanel from '@/components/AdminChatModerationPanel.vue';

const messages = {
  vi: {
    common: { loading: 'Đang tải…' },
    toast: {
      title: {
        info: 'Tin',
        warning: 'Cảnh báo',
        error: 'Lỗi',
        success: 'Thành công',
      },
    },
    admin: {
      chatModeration: {
        title: 'Kiểm duyệt chat',
        subtitle: 'Sub',
        summary: {
          openReports: 'Open',
          acknowledgedReports: 'Ack',
          resolvedToday: 'Resolved today',
          mutedUsers: 'Muted',
          hiddenMessages: 'Hidden',
          lockedGroups: 'Locked',
        },
        reports: { title: 'Reports', subtitle: 'Sub', empty: 'No reports.' },
        mutes: {
          title: 'Mutes',
          subtitle: 'Sub',
          empty: 'No mutes.',
          userId: 'User',
          scope: 'Scope',
          reason: 'Reason',
          expiresAt: 'Expires',
          submit: 'Create',
          active: 'Active',
          inactive: 'Inactive',
        },
        filters: {
          status: 'Status',
          reason: 'Reason',
          messageType: 'Type',
          reporterUserId: 'Reporter',
          targetUserId: 'Target',
          userId: 'User',
          scope: 'Scope',
          activeOnly: 'Active only',
          any: 'Any',
        },
        table: {
          createdAt: 'Created',
          type: 'Type',
          reason: 'Reason',
          status: 'Status',
          reporter: 'Reporter',
          target: 'Target',
          preview: 'Preview',
          hiddenAt: 'hidden {at}',
          userId: 'User',
          scope: 'Scope',
          expiresAt: 'Expires',
          actions: 'Actions',
        },
        actions: {
          refresh: 'Refresh',
          ack: 'Ack',
          resolve: 'Resolve',
          reject: 'Reject',
          hide: 'Hide',
          unhide: 'Unhide',
          lockGroup: 'Lock',
          unlockGroup: 'Unlock',
          dissolveGroup: 'Dissolve',
          revokeMute: 'Revoke',
        },
        confirm: {
          ack: 'Ack?',
          resolve: 'Resolve?',
          reject: 'Reject?',
          hide: 'Hide?',
          unhide: 'Unhide?',
          lock: 'Lock?',
          unlock: 'Unlock?',
          dissolve: 'Dissolve?',
          mute: 'Mute?',
          revokeMute: 'Revoke?',
        },
        prompt: {
          note: 'Note?',
          hideReason: 'Reason?',
          lockReason: 'Reason?',
          dissolveReason: 'Reason?',
        },
        toast: {
          ack: 'Acked.',
          resolve: 'Resolved.',
          reject: 'Rejected.',
          hide: 'Hidden.',
          unhide: 'Unhidden.',
          lock: 'Locked.',
          unlock: 'Unlocked.',
          dissolve: 'Dissolved.',
          mute: 'Muted.',
          revokeMute: 'Revoked.',
        },
        errors: {
          NOT_FOUND: 'Not found.',
          NOT_AUTHORIZED: 'No auth.',
          INVALID_TRANSITION: 'Bad transition.',
          INVALID_INPUT: 'Bad input.',
          DUPLICATE_REPORT: 'Duplicate.',
          GROUP_LOCKED: 'Locked.',
          GROUP_DISSOLVED: 'Dissolved.',
          MUTED: 'Muted.',
          RATE_LIMITED: 'Rate limited.',
          ABUSE_BLOCKED: 'Abuse blocked.',
          UNKNOWN: 'Unknown.',
        },
      },
    },
  },
};

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages,
});

function mountPanel() {
  setActivePinia(createPinia());
  return mount(AdminChatModerationPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

function summary() {
  return {
    openReports: 3,
    acknowledgedReports: 1,
    resolvedToday: 2,
    mutedUsers: 4,
    hiddenMessages: 5,
    lockedGroups: 0,
  };
}

function reportItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-1',
    reporterUserId: 'u-reporter',
    targetUserId: 'u-target',
    messageType: 'PRIVATE' as const,
    privateMessageId: 'pm-1',
    groupMessageId: null,
    groupId: null,
    reason: 'SPAM' as const,
    detailsText: null,
    status: 'OPEN' as const,
    createdAt: '2026-09-01T00:00:00Z',
    resolvedAt: null,
    resolvedByAdminId: null,
    resolutionNote: null,
    messagePreview: 'hello',
    messageHiddenAt: null,
    reporterDisplayName: 'Alice',
    targetDisplayName: 'Bob',
    ...overrides,
  };
}

describe('AdminChatModerationPanel', () => {
  beforeEach(() => {
    adminChatModerationSummaryMock.mockReset();
    adminListChatReportsMock.mockReset();
    adminListChatMutesMock.mockReset();
    adminAckChatReportMock.mockReset();
    adminResolveChatReportMock.mockReset();
    adminHideChatMessageMock.mockReset();
    adminChatModerationSummaryMock.mockResolvedValue(summary());
    adminListChatReportsMock.mockResolvedValue({ items: [], total: 0 });
    adminListChatMutesMock.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads summary + reports + mutes on mount', async () => {
    const w = mountPanel();
    await flushPromises();
    expect(adminChatModerationSummaryMock).toHaveBeenCalledTimes(1);
    expect(adminListChatReportsMock).toHaveBeenCalledTimes(1);
    expect(adminListChatMutesMock).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-testid="admin-chat-moderation-summary"]'),
    ).toBeTruthy();
    w.unmount();
  });

  it('renders empty states when BE returns no items', async () => {
    const w = mountPanel();
    await flushPromises();
    expect(
      document.querySelector(
        '[data-testid="admin-chat-moderation-reports-empty"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-testid="admin-chat-moderation-mutes-empty"]',
      ),
    ).toBeTruthy();
    w.unmount();
  });

  it('renders report row with Ack + Resolve + Hide buttons for OPEN status', async () => {
    adminListChatReportsMock.mockResolvedValue({
      items: [reportItem()],
      total: 1,
    });
    const w = mountPanel();
    await flushPromises();
    expect(
      document.querySelector('[data-testid="admin-chat-moderation-report-row"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="admin-chat-moderation-ack-btn"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-testid="admin-chat-moderation-resolve-btn"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="admin-chat-moderation-hide-btn"]'),
    ).toBeTruthy();
    w.unmount();
  });

  it('Ack: confirm=false → NO API call', async () => {
    adminListChatReportsMock.mockResolvedValue({
      items: [reportItem()],
      total: 1,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const w = mountPanel();
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="admin-chat-moderation-ack-btn"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(adminAckChatReportMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('Ack: confirm=true → call adminAckChatReport + refresh', async () => {
    adminListChatReportsMock.mockResolvedValue({
      items: [reportItem()],
      total: 1,
    });
    adminAckChatReportMock.mockResolvedValue({ id: 'rep-1' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const w = mountPanel();
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="admin-chat-moderation-ack-btn"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(adminAckChatReportMock).toHaveBeenCalledWith('rep-1');
    // refresh = 2nd call sau initial
    expect(adminListChatReportsMock).toHaveBeenCalledTimes(2);
    w.unmount();
  });

  it('Hide message: prompts for reason, sends messageType + messageId', async () => {
    adminListChatReportsMock.mockResolvedValue({
      items: [reportItem()],
      total: 1,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('bad content');
    adminHideChatMessageMock.mockResolvedValue({
      messageId: 'pm-1',
      messageType: 'PRIVATE',
    });
    const w = mountPanel();
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="admin-chat-moderation-hide-btn"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(adminHideChatMessageMock).toHaveBeenCalledWith(
      'PRIVATE',
      'pm-1',
      'bad content',
    );
    w.unmount();
  });

  it('Surfaces summary load error inline', async () => {
    adminChatModerationSummaryMock.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'NOT_AUTHORIZED' }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(
      document.querySelector(
        '[data-testid="admin-chat-moderation-summary-error"]',
      ),
    ).toBeTruthy();
    w.unmount();
  });
});
