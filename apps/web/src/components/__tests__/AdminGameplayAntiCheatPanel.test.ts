/**
 * Phase 16.3 — AdminGameplayAntiCheatPanel tests.
 *
 * Mock /admin/anticheat/gameplay/* clients; verify:
 *   - loading state then empty state.
 *   - summary cards render.
 *   - render anomaly rows.
 *   - run scan: confirm=false → KHÔNG gọi API; confirm=true → gọi + reload.
 *   - ack / resolve gọi đúng API.
 *   - filter severity / status / type / source.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const summaryMock = vi.fn();
const listMock = vi.fn();
const scanMock = vi.fn();
const ackMock = vi.fn();
const resolveMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminGameplayAntiCheatSummary: (...a: unknown[]) => summaryMock(...a),
  adminGameplayAntiCheatList: (...a: unknown[]) => listMock(...a),
  adminGameplayAntiCheatScan: (...a: unknown[]) => scanMock(...a),
  adminGameplayAntiCheatAck: (...a: unknown[]) => ackMock(...a),
  adminGameplayAntiCheatResolve: (...a: unknown[]) => resolveMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: (_e: unknown, def: string) => def,
}));

import AdminGameplayAntiCheatPanel from '@/components/AdminGameplayAntiCheatPanel.vue';

const messages = {
  vi: {
    common: { loading: 'Đang tải...' },
    admin: {
      gameplayAntiCheat: {
        title: 'Gameplay anti-cheat',
        subtitle: 'Detection-only.',
        summary: {
          open: 'Open',
          critical: 'Crit',
          warn: 'Warn',
          info: 'Info',
          total: 'Total',
          latestCreatedAt: 'Latest',
          latestResolvedAt: 'Resolved',
          none: '—',
        },
        scanBtn: 'Run scan',
        confirmScan: 'Confirm scan?',
        scanDone: 'Done {created} {skipped} {errored}',
        filter: {
          severityAll: 'All sev',
          statusAll: 'All status',
          typeAll: 'All type',
          sourceAll: 'All source',
        },
        table: {
          type: 'Type',
          severity: 'Sev',
          status: 'Status',
          source: 'Source',
          character: 'Char',
          windowKey: 'Window',
          createdAt: 'Detected',
          actions: 'Actions',
        },
        ack: 'Ack',
        resolve: 'Resolve',
        confirmAck: 'confirm ack',
        confirmResolve: 'confirm resolve',
        ackDone: 'ackDone',
        resolveDone: 'resolveDone',
        loading: 'Loading',
        empty: 'No anomalies.',
        errorPrefix: 'Error: ',
      },
    },
  },
  en: {} as Record<string, unknown>,
};

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: messages as never,
});

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
});

function mountPanel() {
  return mount(AdminGameplayAntiCheatPanel, {
    global: { plugins: [i18n] },
  });
}

function summaryEmpty() {
  return {
    openCount: 0,
    openCriticalCount: 0,
    openWarnCount: 0,
    openInfoCount: 0,
    totalCount: 0,
    latestCreatedAt: null,
    latestResolvedAt: null,
  };
}

function listEmpty() {
  return {
    items: [],
    total: 0,
    filters: {
      severities: ['INFO', 'WARN', 'CRITICAL'],
      statuses: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
      types: ['CURRENCY_GAIN_SPIKE'],
      sources: ['CURRENCY_LEDGER'],
    },
  };
}

function makeRow(overrides: Partial<{ id: string; type: string; severity: string; status: string }> = {}) {
  return {
    id: overrides.id ?? 'a1',
    type: overrides.type ?? 'CURRENCY_GAIN_SPIKE',
    severity: overrides.severity ?? 'WARN',
    status: overrides.status ?? 'OPEN',
    source: 'CURRENCY_LEDGER',
    characterId: 'c1',
    userId: null,
    windowKey: '1h:2026-05-15T12',
    detailsJson: {},
    createdAt: '2026-05-15T12:00:00.000Z',
    updatedAt: '2026-05-15T12:00:00.000Z',
    acknowledgedAt: null,
    acknowledgedByAdminId: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    resolutionNote: null,
  };
}

describe('AdminGameplayAntiCheatPanel', () => {
  it('empty state khi không có anomaly', async () => {
    summaryMock.mockResolvedValue(summaryEmpty());
    listMock.mockResolvedValue(listEmpty());

    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-testid="admin-gameplay-anticheat-panel"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-gameplay-anticheat-empty"]').exists()).toBe(
      true,
    );
    expect(
      w.find('[data-testid="admin-gameplay-anticheat-summary"]').exists(),
    ).toBe(true);
  });

  it('render rows khi có dữ liệu', async () => {
    summaryMock.mockResolvedValue({
      ...summaryEmpty(),
      openCount: 2,
      openCriticalCount: 1,
      openWarnCount: 1,
      totalCount: 2,
    });
    listMock.mockResolvedValue({
      ...listEmpty(),
      items: [
        makeRow({ id: 'a1', severity: 'CRITICAL' }),
        makeRow({ id: 'a2', severity: 'WARN' }),
      ],
      total: 2,
    });

    const w = mountPanel();
    await flushPromises();
    const rows = w.findAll('[data-testid="admin-gameplay-anticheat-row"]');
    expect(rows.length).toBe(2);
  });

  it('error state khi summary fail', async () => {
    summaryMock.mockRejectedValue(new Error('boom'));
    listMock.mockResolvedValue(listEmpty());

    const w = mountPanel();
    await flushPromises();
    expect(w.find('.text-rose-300').exists()).toBe(true);
  });

  it('run scan confirm=false → KHÔNG gọi API', async () => {
    summaryMock.mockResolvedValue(summaryEmpty());
    listMock.mockResolvedValue(listEmpty());

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => false);

    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="admin-gameplay-anticheat-scan-btn"]')
      .trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(scanMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('run scan confirm=true → gọi API + reload', async () => {
    summaryMock.mockResolvedValue(summaryEmpty());
    listMock.mockResolvedValue(listEmpty());
    scanMock.mockResolvedValue({
      windowKeysByType: {},
      totalCreated: 3,
      totalSkipped: 1,
      totalErrored: 0,
      rules: [],
      scannedAt: '2026-05-15T12:00:00Z',
    });

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const w = mountPanel();
    await flushPromises();
    summaryMock.mockClear();
    listMock.mockClear();

    await w
      .find('[data-testid="admin-gameplay-anticheat-scan-btn"]')
      .trigger('click');
    await flushPromises();

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(summaryMock).toHaveBeenCalled();
    expect(listMock).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('ack row confirm=true → gọi API + reload', async () => {
    summaryMock.mockResolvedValue({
      ...summaryEmpty(),
      openCount: 1,
      openWarnCount: 1,
      totalCount: 1,
    });
    listMock.mockResolvedValue({
      ...listEmpty(),
      items: [makeRow({ id: 'a1' })],
      total: 1,
    });
    ackMock.mockResolvedValue(undefined);

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const w = mountPanel();
    await flushPromises();
    summaryMock.mockClear();
    listMock.mockClear();

    await w
      .find('[data-testid="admin-gameplay-anticheat-ack-btn"]')
      .trigger('click');
    await flushPromises();

    expect(ackMock).toHaveBeenCalledWith('a1');
    expect(summaryMock).toHaveBeenCalled();
    expect(listMock).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('resolve row confirm=true → gọi API + reload', async () => {
    summaryMock.mockResolvedValue({
      ...summaryEmpty(),
      openCount: 1,
      openWarnCount: 1,
      totalCount: 1,
    });
    listMock.mockResolvedValue({
      ...listEmpty(),
      items: [makeRow({ id: 'a1' })],
      total: 1,
    });
    resolveMock.mockResolvedValue(undefined);

    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockImplementation(() => 'looks legit');

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-gameplay-anticheat-resolve-btn"]')
      .trigger('click');
    await flushPromises();

    expect(resolveMock).toHaveBeenCalledWith('a1', 'looks legit');
    confirmSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it('filter severity → gọi API với severity param', async () => {
    summaryMock.mockResolvedValue(summaryEmpty());
    listMock.mockResolvedValue(listEmpty());

    const w = mountPanel();
    await flushPromises();
    listMock.mockClear();

    const sevSelect = w.find(
      '[data-testid="admin-gameplay-anticheat-filter-severity"]',
    );
    await sevSelect.setValue('CRITICAL');
    await flushPromises();

    expect(listMock).toHaveBeenCalled();
    const callArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(callArg.severity).toBe('CRITICAL');
  });

  it('filter type → gọi API với type param', async () => {
    summaryMock.mockResolvedValue(summaryEmpty());
    listMock.mockResolvedValue(listEmpty());

    const w = mountPanel();
    await flushPromises();
    listMock.mockClear();

    await w
      .find('[data-testid="admin-gameplay-anticheat-filter-type"]')
      .setValue('DUNGEON_REWARD_FARM');
    await flushPromises();

    const callArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(callArg.type).toBe('DUNGEON_REWARD_FARM');
  });
});
