/**
 * Phase 19.2 — ChatReportModal smoke tests.
 *
 * Verify:
 *   - Modal hiển thị khi open=true với reason dropdown + details field.
 *   - Submit gọi API với payload đúng + emit 'submitted' + toast success.
 *   - Lỗi RATE_LIMITED → toast error i18n không crash.
 *   - Cancel emit 'cancel' + không gọi API.
 *   - Details > 500 ký tự → disable submit button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const submitChatReportMock = vi.fn();

vi.mock('@/api/chatModeration', () => ({
  submitChatReport: (...a: unknown[]) => submitChatReportMock(...a),
}));

import ChatReportModal from '@/components/ChatReportModal.vue';

const messages = {
  vi: {
    common: { confirm: 'Đồng ý', cancel: 'Huỷ' },
    toast: {
      title: {
        info: 'Tin',
        warning: 'Cảnh báo',
        error: 'Lỗi',
        success: 'Thành công',
      },
    },
    chatReport: {
      title: 'Báo cáo tin nhắn',
      subtitle: 'Report sẽ được moderator xem xét.',
      submit: 'Gửi report',
      action: { report: 'Report' },
      field: {
        reason: 'Lý do',
        details: 'Mô tả (tuỳ chọn)',
        detailsPlaceholder: 'Thêm ngữ cảnh.',
      },
      reason: {
        SPAM: 'Spam',
        HARASSMENT: 'Quấy rối',
        SCAM: 'Lừa đảo',
        OFFENSIVE: 'Phản cảm',
        OTHER: 'Khác',
      },
      toast: { submitted: 'Đã gửi report.' },
      errors: {
        NOT_FOUND: 'Không tìm thấy.',
        NOT_AUTHORIZED: 'Không có quyền.',
        INVALID_INPUT: 'Dữ liệu lỗi.',
        DUPLICATE_REPORT: 'Đã report rồi.',
        RATE_LIMITED: 'Quá nhanh.',
        ABUSE_BLOCKED: 'Bị khoá tạm.',
        UNKNOWN: 'Lỗi không xác định.',
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

function mountModal(props: {
  open: boolean;
  messageType?: 'PRIVATE' | 'GROUP';
  privateMessageId?: string | null;
  groupMessageId?: string | null;
  messagePreview?: string | null;
}) {
  setActivePinia(createPinia());
  return mount(ChatReportModal, {
    attachTo: document.body,
    props: {
      messageType: 'PRIVATE',
      ...props,
    },
    global: { plugins: [i18n] },
  });
}

describe('ChatReportModal', () => {
  beforeEach(() => {
    submitChatReportMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders dropdown + details + submit/cancel when open', async () => {
    const w = mountModal({
      open: true,
      privateMessageId: 'pm-1',
      messagePreview: 'hello world',
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="chat-report-modal"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="chat-report-reason"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="chat-report-details"]')).toBeTruthy();
    expect(
      document.querySelector('[data-testid="chat-report-message-preview"]')!
        .textContent,
    ).toContain('hello world');
    w.unmount();
  });

  it('does NOT render when open=false', async () => {
    const w = mountModal({ open: false, privateMessageId: 'pm-1' });
    await flushPromises();
    expect(document.querySelector('[data-testid="chat-report-modal"]')).toBeNull();
    w.unmount();
  });

  it('submits with reason + details payload for PRIVATE message', async () => {
    submitChatReportMock.mockResolvedValueOnce({ id: 'r1' });
    const w = mountModal({
      open: true,
      messageType: 'PRIVATE',
      privateMessageId: 'pm-1',
    });
    await flushPromises();
    const select = document.querySelector(
      '[data-testid="chat-report-reason"]',
    ) as HTMLSelectElement;
    select.value = 'HARASSMENT';
    select.dispatchEvent(new Event('change'));
    const textarea = document.querySelector(
      '[data-testid="chat-report-details"]',
    ) as HTMLTextAreaElement;
    textarea.value = '  abusive language  ';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="chat-report-submit"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(submitChatReportMock).toHaveBeenCalledTimes(1);
    const payload = submitChatReportMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      messageType: 'PRIVATE',
      privateMessageId: 'pm-1',
      groupMessageId: null,
      reason: 'HARASSMENT',
      detailsText: 'abusive language',
    });
    expect(w.emitted('submitted')).toBeTruthy();
    w.unmount();
  });

  it('submits with groupMessageId for GROUP message', async () => {
    submitChatReportMock.mockResolvedValueOnce({ id: 'r2' });
    const w = mountModal({
      open: true,
      messageType: 'GROUP',
      groupMessageId: 'gm-1',
    });
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="chat-report-submit"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(submitChatReportMock).toHaveBeenCalledTimes(1);
    const payload = submitChatReportMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      messageType: 'GROUP',
      privateMessageId: null,
      groupMessageId: 'gm-1',
      reason: 'SPAM',
      detailsText: null,
    });
    w.unmount();
  });

  it('emits cancel and does not call API on cancel click', async () => {
    const w = mountModal({ open: true, privateMessageId: 'pm-1' });
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="chat-report-cancel"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(submitChatReportMock).not.toHaveBeenCalled();
    expect(w.emitted('cancel')).toBeTruthy();
    w.unmount();
  });

  it('disables submit when details over limit', async () => {
    const w = mountModal({ open: true, privateMessageId: 'pm-1' });
    await flushPromises();
    const textarea = document.querySelector(
      '[data-testid="chat-report-details"]',
    ) as HTMLTextAreaElement;
    textarea.value = 'x'.repeat(501);
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();
    const submit = document.querySelector(
      '[data-testid="chat-report-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    w.unmount();
  });

  it('surfaces RATE_LIMITED error via toast (no crash)', async () => {
    submitChatReportMock.mockRejectedValueOnce(
      Object.assign(new Error('rate'), { code: 'RATE_LIMITED' }),
    );
    const w = mountModal({ open: true, privateMessageId: 'pm-1' });
    await flushPromises();
    (
      document.querySelector(
        '[data-testid="chat-report-submit"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(submitChatReportMock).toHaveBeenCalled();
    // Modal vẫn open — không emit submitted.
    expect(w.emitted('submitted')).toBeFalsy();
    w.unmount();
  });
});
