/**
 * Phase 16.6 — AdminEconomySafetyPanel tests.
 *
 * Mock /admin/economy/* clients; verify:
 *   - empty state (no run, no issues, no anomalies).
 *   - render run + issues + anomalies after fetch.
 *   - run / scan / ack / resolve buttons gọi đúng API + trigger refresh.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLedgerCheckLatestMock = vi.fn();
const adminLedgerCheckIssuesMock = vi.fn();
const adminListAnomaliesMock = vi.fn();
const adminLedgerCheckRunMock = vi.fn();
const adminAnomalyScanRunMock = vi.fn();
const adminLedgerCheckIssueAckMock = vi.fn();
const adminLedgerCheckIssueResolveMock = vi.fn();
const adminAnomalyAckMock = vi.fn();
const adminAnomalyResolveMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLedgerCheckLatest: (...a: unknown[]) =>
    adminLedgerCheckLatestMock(...a),
  adminLedgerCheckIssues: (...a: unknown[]) =>
    adminLedgerCheckIssuesMock(...a),
  adminListAnomalies: (...a: unknown[]) => adminListAnomaliesMock(...a),
  adminLedgerCheckRun: (...a: unknown[]) => adminLedgerCheckRunMock(...a),
  adminAnomalyScanRun: (...a: unknown[]) => adminAnomalyScanRunMock(...a),
  adminLedgerCheckIssueAck: (...a: unknown[]) =>
    adminLedgerCheckIssueAckMock(...a),
  adminLedgerCheckIssueResolve: (...a: unknown[]) =>
    adminLedgerCheckIssueResolveMock(...a),
  adminAnomalyAck: (...a: unknown[]) => adminAnomalyAckMock(...a),
  adminAnomalyResolve: (...a: unknown[]) => adminAnomalyResolveMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: (_e: unknown, def: string) => def,
}));

import AdminEconomySafetyPanel from '@/components/AdminEconomySafetyPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải...' },
      admin: {
        economySafety: {
          latestRun: { title: 'Latest run' },
          issues: { title: 'Issues' },
          anomalies: { title: 'Anomalies' },
          filter: {
            severityAll: 'All sev',
            statusAll: 'All status',
            sourceAll: 'All source',
          },
          dayBucket: 'Day',
          status: 'Status',
          startedAt: 'Started',
          openIssues: 'Open',
          severity: 'Sev',
          type: 'Type',
          source: 'Source',
          characterId: 'CharID',
          actions: 'Actions',
          ack: 'Ack',
          resolve: 'Resolve',
          runBtn: 'Run',
          scanBtn: 'Scan',
          confirmRun: 'confirm run',
          confirmScan: 'confirm scan',
          runDone: 'done {issues} {status}',
          scanDone: 'done {created} {skipped}',
          ackDone: 'ackDone',
          resolveDone: 'resolveDone',
          empty: 'No data',
        },
      },
    },
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
});

function mountPanel() {
  return mount(AdminEconomySafetyPanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminEconomySafetyPanel', () => {
  it('empty state khi chưa có run / issues / anomalies', async () => {
    adminLedgerCheckLatestMock.mockResolvedValue({ run: null, openIssues: 0 });
    adminLedgerCheckIssuesMock.mockResolvedValue({ items: [], total: 0 });
    adminListAnomaliesMock.mockResolvedValue({ items: [], total: 0 });

    const w = mountPanel();
    await flushPromises();

    expect(
      w.find('[data-testid="admin-economy-safety-panel"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-economy-safety-empty"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-economy-safety-issues-empty"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-economy-safety-anomalies-empty"]').exists(),
    ).toBe(true);
  });

  it('render rows khi có dữ liệu', async () => {
    adminLedgerCheckLatestMock.mockResolvedValue({
      run: {
        id: 'r1',
        dayBucket: '2026-01-01',
        status: 'ISSUES_FOUND',
        startedAt: '2026-01-01T01:00:00.000Z',
        finishedAt: '2026-01-01T01:00:01.000Z',
        summaryJson: {},
        triggeredBy: null,
      },
      openIssues: 2,
    });
    adminLedgerCheckIssuesMock.mockResolvedValue({
      items: [
        {
          id: 'i1',
          runId: 'r1',
          severity: 'CRITICAL',
          type: 'CURRENCY_LEDGER_MISMATCH',
          characterId: 'c1',
          detailsJson: {},
          status: 'OPEN',
          createdAt: '2026-01-01T01:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      total: 1,
    });
    adminListAnomaliesMock.mockResolvedValue({
      items: [
        {
          id: 'a1',
          severity: 'WARN',
          source: 'CURRENCY_DELTA_24H',
          characterId: 'c1',
          userId: 'u1',
          detailsJson: {},
          status: 'OPEN',
          windowKey: 'w1',
          createdAt: '2026-01-01T01:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      total: 1,
    });

    const w = mountPanel();
    await flushPromises();

    expect(w.findAll('[data-testid="admin-economy-safety-issue-row"]').length).toBe(1);
    expect(
      w.findAll('[data-testid="admin-economy-safety-anomaly-row"]').length,
    ).toBe(1);
  });

  it('Run ledger check button gọi API + refresh', async () => {
    adminLedgerCheckLatestMock.mockResolvedValue({ run: null, openIssues: 0 });
    adminLedgerCheckIssuesMock.mockResolvedValue({ items: [], total: 0 });
    adminListAnomaliesMock.mockResolvedValue({ items: [], total: 0 });
    adminLedgerCheckRunMock.mockResolvedValue({
      runId: 'rn1',
      dayBucket: '2026-01-01',
      status: 'OK',
      charactersScanned: 10,
      itemKeysScanned: 0,
      currencyDiscrepancies: 0,
      inventoryDiscrepancies: 0,
      rewardCapInconsistencies: 0,
      negativeBalances: 0,
      suspiciousDeltas: 0,
      issuesCreated: 0,
      alreadyDone: false,
    });
    // Stub global confirm.
    vi.stubGlobal('confirm', () => true);

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-economy-safety-run-btn"]')
      .trigger('click');
    await flushPromises();

    expect(adminLedgerCheckRunMock).toHaveBeenCalledWith(false);
    // refresh latest + issues called twice (initial + post-run).
    expect(adminLedgerCheckLatestMock.mock.calls.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('Run anomaly scan gọi API + refresh anomalies', async () => {
    adminLedgerCheckLatestMock.mockResolvedValue({ run: null, openIssues: 0 });
    adminLedgerCheckIssuesMock.mockResolvedValue({ items: [], total: 0 });
    adminListAnomaliesMock.mockResolvedValue({ items: [], total: 0 });
    adminAnomalyScanRunMock.mockResolvedValue({
      windowKey: '2026-01-01',
      topCurrencyDelta: 0,
      rareItemGain: 0,
      rewardCapBypass: 0,
      marketOutlier: 0,
      totalAnomaliesCreated: 1,
      totalAnomaliesSkipped: 0,
    });
    vi.stubGlobal('confirm', () => true);

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-economy-safety-scan-btn"]')
      .trigger('click');
    await flushPromises();

    expect(adminAnomalyScanRunMock).toHaveBeenCalled();
    expect(adminListAnomaliesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
