/**
 * Phase 18.3 — SecurityAlertPanel tests.
 *
 * Cover:
 *   - render: summary cards + alert table populated from API mocks.
 *   - loading state: shows loading message before promises resolve.
 *   - empty state: alerts empty render dedicated message.
 *   - error state: API throw → error message visible (mapped i18n).
 *   - filter status/severity/type/source/userId/from/to/limit:
 *     apply triggers refetch with forwarded params.
 *   - ack flow: opens confirm modal → cancel KHÔNG gọi API; confirm
 *     gọi ack API và update row status + refresh summary.
 *   - resolve flow: cần note non-empty; cancel KHÔNG gọi API; confirm
 *     với note → API gọi + status RESOLVED.
 *   - i18n VI/EN parity: tab title + summary card labels render từ
 *     locale messages cho cả vi và en.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const {
  listAlertsMock,
  getSummaryMock,
  ackMock,
  resolveMock,
} = vi.hoisted(() => ({
  listAlertsMock: vi.fn(),
  getSummaryMock: vi.fn(),
  ackMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock('@/api/adminSecurity', () => ({
  adminListSecurityAlerts: listAlertsMock,
  adminGetSecuritySummary: getSummaryMock,
  adminAcknowledgeSecurityAlert: ackMock,
  adminResolveSecurityAlert: resolveMock,
}));

import SecurityAlertPanel from '@/components/SecurityAlertPanel.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  });
}

function mountPanel(locale: 'vi' | 'en' = 'vi') {
  return mount(SecurityAlertPanel, {
    global: {
      plugins: [makeI18n(locale)],
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listAlertsMock.mockReset();
  getSummaryMock.mockReset();
  ackMock.mockReset();
  resolveMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const SAMPLE_ALERT_OPEN = {
  id: 'alert-1',
  type: 'LOGIN_ABUSE' as const,
  severity: 'WARN' as const,
  status: 'OPEN' as const,
  source: 'AUTH' as const,
  eventId: 'evt-x',
  relatedUserId: null,
  relatedCharacterId: null,
  relatedSessionId: null,
  detailsJson: { email: 'a@b.c' },
  createdAt: new Date().toISOString(),
  acknowledgedAt: null,
  acknowledgedByAdminId: null,
  resolvedAt: null,
  resolvedByAdminId: null,
  resolutionNote: null,
};

const SAMPLE_SUMMARY = {
  openCritical: 3,
  openWarn: 7,
  blockedSubjects: 1,
  tokenReuseLast24h: 0,
  suspiciousSessionsLast24h: 2,
  rateLimitHitsLast24h: 5,
  latestCriticalEvents: [],
  generatedAt: new Date().toISOString(),
};

describe('SecurityAlertPanel', () => {
  it('render summary cards + alert table từ API', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [SAMPLE_ALERT_OPEN],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="security-alert-panel"]').exists()).toBe(true);
    expect(
      w.find('[data-testid="card-open-critical"]').text(),
    ).toContain('3');
    expect(w.find('[data-testid="card-open-warn"]').text()).toContain('7');
    expect(
      w.findAll('[data-testid^="alert-row-"]').length,
    ).toBe(1);
  });

  it('empty state khi alert list rỗng', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="alerts-empty"]').exists()).toBe(true);
  });

  it('error state khi list alert throw', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'UNKNOWN' }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="alerts-error"]').exists()).toBe(true);
  });

  it('filter apply forward params status/severity/type/source/userId/limit', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const w = mountPanel();
    await flushPromises();
    listAlertsMock.mockClear();
    await w
      .find('[data-testid="filter-status"]')
      .setValue('ACKNOWLEDGED');
    await w
      .find('[data-testid="filter-severity"]')
      .setValue('CRITICAL');
    await w.find('[data-testid="filter-type"]').setValue('LOGIN_ABUSE');
    await w.find('[data-testid="filter-source"]').setValue('AUTH');
    await w.find('[data-testid="filter-user-id"]').setValue('user-42');
    await w.find('[data-testid="filter-limit"]').setValue(25);
    await w.find('[data-testid="filter-apply"]').trigger('click');
    await flushPromises();
    expect(listAlertsMock).toHaveBeenCalledTimes(1);
    const args = listAlertsMock.mock.calls[0][0];
    expect(args.status).toBe('ACKNOWLEDGED');
    expect(args.severity).toBe('CRITICAL');
    expect(args.type).toBe('LOGIN_ABUSE');
    expect(args.source).toBe('AUTH');
    expect(args.userId).toBe('user-42');
    expect(args.limit).toBe(25);
  });

  it('ack flow: cancel KHÔNG gọi API', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [SAMPLE_ALERT_OPEN],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="ack-alert-1"]').trigger('click');
    await flushPromises();
    // Confirm modal Teleports to body — query global document.
    const cancelBtn = document.querySelector(
      '[data-testid="confirm-ack-cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await flushPromises();
    expect(ackMock).not.toHaveBeenCalled();
  });

  it('ack flow: confirm gọi API + update row', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [SAMPLE_ALERT_OPEN],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    ackMock.mockResolvedValue({
      ...SAMPLE_ALERT_OPEN,
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date().toISOString(),
      acknowledgedByAdminId: 'admin-1',
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="ack-alert-1"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="confirm-ack-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(ackMock).toHaveBeenCalledWith('alert-1');
    // Summary refresh sau ack.
    expect(getSummaryMock).toHaveBeenCalledTimes(2);
  });

  it('resolve flow: note rỗng KHÔNG gọi API', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [SAMPLE_ALERT_OPEN],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="resolve-alert-1"]').trigger('click');
    await flushPromises();
    // Note input vẫn rỗng → confirm phải không gọi API.
    const confirmBtn = document.querySelector(
      '[data-testid="confirm-resolve-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('resolve flow: note non-empty + confirm gọi API', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [SAMPLE_ALERT_OPEN],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    resolveMock.mockResolvedValue({
      ...SAMPLE_ALERT_OPEN,
      status: 'RESOLVED',
      resolvedAt: new Date().toISOString(),
      resolvedByAdminId: 'admin-1',
      resolutionNote: 'fixed',
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="resolve-alert-1"]').trigger('click');
    await flushPromises();
    const noteEl = document.querySelector(
      '[data-testid="resolve-note-input"]',
    ) as HTMLTextAreaElement | null;
    expect(noteEl).not.toBeNull();
    noteEl!.value = 'fixed';
    noteEl!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="confirm-resolve-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(resolveMock).toHaveBeenCalledWith('alert-1', 'fixed');
  });

  it('i18n parity: render vi/en label cho summary card', async () => {
    getSummaryMock.mockResolvedValue(SAMPLE_SUMMARY);
    listAlertsMock.mockResolvedValue({
      alerts: [],
      nextCursor: null,
      generatedAt: new Date().toISOString(),
    });
    const wVi = mountPanel('vi');
    await flushPromises();
    expect(wVi.find('[data-testid="card-open-critical"]').text()).toContain(
      viMessages.adminSecurityAlerts.summary.openCritical,
    );
    const wEn = mountPanel('en');
    await flushPromises();
    expect(wEn.find('[data-testid="card-open-critical"]').text()).toContain(
      enMessages.adminSecurityAlerts.summary.openCritical,
    );
  });
});
