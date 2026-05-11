/**
 * Phase 16.1.B — AdminEconomyRangeReportPanel tests.
 *
 * Mock `/admin/economy/range-report` + `/admin/economy/ledger-check/run`
 * client; verify:
 *   - initial empty state (no report loaded yet).
 *   - load report → summary cards + source table + top delta table render.
 *   - error state: API throw → error block render + toast.
 *   - run check now → confirm prompt, call API, refresh report.
 *   - empty data after load → "no flow" message.
 *   - i18n key parity covered by parity test, here we just smoke-render VI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { EconomyReportResponse } from '@xuantoi/shared';

const adminEconomyRangeReportMock = vi.fn();
const adminLedgerCheckRunMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminEconomyRangeReport: (...a: unknown[]) =>
    adminEconomyRangeReportMock(...a),
  adminLedgerCheckRun: (...a: unknown[]) => adminLedgerCheckRunMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: (_e: unknown, def: string) => def,
}));

import AdminEconomyRangeReportPanel from '@/components/AdminEconomyRangeReportPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…' },
      toast: {
        title: {
          info: 'Info',
          warning: 'Warning',
          warn: 'Warn',
          success: 'Success',
          error: 'Error',
        },
      },
      admin: {
        economyRangeReport: {
          title: 'Báo cáo kinh tế theo khoảng ngày',
          subtitle: 'subtitle',
          from: 'Từ ngày',
          to: 'Đến ngày',
          load: 'Tải báo cáo',
          loading: 'Đang tải…',
          totalIn: 'Tổng in',
          totalOut: 'Tổng out',
          totalNet: 'Net',
          openAnomalies: 'Anomaly mở',
          latestRun: 'Ledger check gần nhất',
          noLatestRun: 'No latest run',
          marketVolume: 'Market volume',
          shopSpend: 'Shop spend',
          sectShopSpend: 'Sect shop spend',
          reforgeEnchantSpend: 'Reforge',
          adminGrantTotal: 'Admin grant',
          liveOpsRewardTotal: 'LiveOps',
          dailyLoginRewardTotal: 'Daily login',
          dungeonRewardTotal: 'Dungeon',
          bossRewardTotal: 'Boss',
          sectSeasonRewardTotal: 'Sect season',
          bySourceTitle: 'By source',
          bySourceEmpty: 'No flow',
          topDeltaTitle: 'Top delta',
          topDeltaEmpty: 'No delta',
          emptyInitial: 'Pick a date',
          emptyData: 'No flow in {from} → {to}',
          generatedAt: 'gen {generatedAt} {from} {to} {days}',
          runCheck: {
            label: 'Run check',
            running: 'Running…',
            confirm: 'Run now?',
            done: 'Done {status} {issues}',
            alreadyDone: 'Already done',
            failed: 'Failed {code}',
          },
          col: {
            source: 'Source',
            in: 'In',
            out: 'Out',
            net: 'Net',
            entries: 'Entries',
            rank: '#',
            character: 'Character',
            email: 'Email',
          },
          error: { load: 'Failed {code}' },
        },
      },
    },
  },
});

function mkReport(overrides: Partial<EconomyReportResponse> = {}): EconomyReportResponse {
  return {
    range: { from: '2026-05-05', to: '2026-05-11', days: 7 },
    bySource: [
      {
        source: 'MARKET',
        inLinhThach: '1000',
        outLinhThach: '500',
        netLinhThach: '500',
        inTienNgoc: 0,
        outTienNgoc: 0,
        netTienNgoc: 0,
        entryCount: 5,
      },
      {
        source: 'ADMIN_GRANT',
        inLinhThach: '100000',
        outLinhThach: '0',
        netLinhThach: '100000',
        inTienNgoc: 0,
        outTienNgoc: 0,
        netTienNgoc: 0,
        entryCount: 1,
      },
    ],
    totalInLinhThach: '101000',
    totalOutLinhThach: '500',
    totalNetLinhThach: '100500',
    totalInTienNgoc: 0,
    totalOutTienNgoc: 0,
    totalNetTienNgoc: 0,
    topCharacterDelta: [
      {
        characterId: 'c1',
        characterName: 'Char1',
        userEmail: 'a@b.c',
        inLinhThach: '100000',
        outLinhThach: '0',
        netLinhThach: '100000',
      },
    ],
    marketVolume: '1500',
    shopSpend: '0',
    sectShopSpend: '0',
    reforgeEnchantSpend: '0',
    adminGrantTotal: '100000',
    topupTotal: '0',
    liveOpsRewardTotal: '0',
    dailyLoginRewardTotal: '0',
    dungeonRewardTotal: '0',
    bossRewardTotal: '0',
    territoryRewardTotal: '0',
    sectSeasonRewardTotal: '0',
    anomalySummary: {
      openCount: 2,
      acknowledgedCount: 0,
      resolvedCount: 0,
      latestSeverity: 'WARN',
      latestCreatedAt: '2026-05-10T00:00:00.000Z',
    },
    latestLedgerCheckRun: {
      id: 'r1',
      dayBucket: '2026-05-10',
      status: 'OK',
      startedAt: '2026-05-10T01:00:00.000Z',
      finishedAt: '2026-05-10T01:00:01.000Z',
    },
    generatedAt: '2026-05-11T00:00:00.000Z',
    ...overrides,
  };
}

function mountPanel() {
  return mount(AdminEconomyRangeReportPanel, {
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

describe('AdminEconomyRangeReportPanel', () => {
  it('renders initial empty state (no report loaded yet)', () => {
    const w = mountPanel();
    expect(w.find('[data-testid="admin-economy-range-report-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-summary"]').exists()).toBe(false);
  });

  it('load report renders summary + source + top-delta tables', async () => {
    adminEconomyRangeReportMock.mockResolvedValue(mkReport());
    const w = mountPanel();
    await w.find('[data-testid="admin-economy-range-report-load-btn"]').trigger('click');
    await flushPromises();

    expect(adminEconomyRangeReportMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="admin-economy-range-report-summary"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-by-source"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-top-delta"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-totals"]').exists()).toBe(true);
    expect(w.text()).toContain('101000');
    expect(w.text()).toContain('MARKET');
    expect(w.text()).toContain('Char1');
  });

  it('load report passes from/to query params', async () => {
    adminEconomyRangeReportMock.mockResolvedValue(mkReport());
    const w = mountPanel();
    await w.find('[data-testid="admin-economy-range-report-from"]').setValue('2026-05-01');
    await w.find('[data-testid="admin-economy-range-report-to"]').setValue('2026-05-07');
    await w.find('[data-testid="admin-economy-range-report-load-btn"]').trigger('click');
    await flushPromises();

    expect(adminEconomyRangeReportMock).toHaveBeenCalledWith('2026-05-01', '2026-05-07');
  });

  it('load report API throws → error state renders', async () => {
    adminEconomyRangeReportMock.mockRejectedValue(new Error('boom'));
    const w = mountPanel();
    await w.find('[data-testid="admin-economy-range-report-load-btn"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="admin-economy-range-report-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-economy-range-report-summary"]').exists()).toBe(false);
  });

  it('empty data report shows "no flow" message', async () => {
    adminEconomyRangeReportMock.mockResolvedValue(
      mkReport({
        bySource: [],
        totalInLinhThach: '0',
        totalOutLinhThach: '0',
        totalNetLinhThach: '0',
        topCharacterDelta: [],
      }),
    );
    const w = mountPanel();
    await w.find('[data-testid="admin-economy-range-report-load-btn"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="admin-economy-range-report-empty-data"]').exists()).toBe(true);
  });

  it('latest ledger check run displayed in summary card', async () => {
    adminEconomyRangeReportMock.mockResolvedValue(mkReport());
    const w = mountPanel();
    await w.find('[data-testid="admin-economy-range-report-load-btn"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-testid="admin-economy-range-report-latest-run"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-economy-range-report-latest-run"]').text(),
    ).toContain('OK');
  });

  it('runCheckNow with confirm=false does NOT call API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    adminEconomyRangeReportMock.mockResolvedValue(mkReport());
    const w = mountPanel();
    await w
      .find('[data-testid="admin-economy-range-report-run-check-btn"]')
      .trigger('click');
    await flushPromises();

    expect(adminLedgerCheckRunMock).not.toHaveBeenCalled();
  });

  it('runCheckNow with confirm=true calls API then reloads report', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    adminLedgerCheckRunMock.mockResolvedValue({
      runId: 'r1',
      dayBucket: '2026-05-11',
      status: 'OK',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      charactersScanned: 0,
      itemKeysScanned: 0,
      currencyDiscrepancies: 0,
      inventoryDiscrepancies: 0,
      rewardCapInconsistencies: 0,
      negativeBalances: 0,
      suspiciousDeltas: 0,
      issuesCreated: 0,
      alreadyDone: false,
    });
    adminEconomyRangeReportMock.mockResolvedValue(mkReport());
    const w = mountPanel();
    await w
      .find('[data-testid="admin-economy-range-report-run-check-btn"]')
      .trigger('click');
    await flushPromises();

    expect(adminLedgerCheckRunMock).toHaveBeenCalledWith(false);
    expect(adminEconomyRangeReportMock).toHaveBeenCalledTimes(1);
  });
});
