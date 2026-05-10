/**
 * Phase 14.1.D — AdminArenaAntiWintradePanel tests.
 *
 * Mock /admin/arena/anti-wintrade/* clients; verify:
 *   - empty state (no alerts).
 *   - render alert rows after fetch.
 *   - run scan button gọi API + trigger refresh.
 *   - ack / resolve buttons gọi đúng API + refresh.
 *   - error state hiển thị khi list throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminArenaWintradeListAlertsMock = vi.fn();
const adminArenaWintradeScanMock = vi.fn();
const adminArenaWintradeAckMock = vi.fn();
const adminArenaWintradeResolveMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminArenaWintradeListAlerts: (...a: unknown[]) =>
    adminArenaWintradeListAlertsMock(...a),
  adminArenaWintradeScan: (...a: unknown[]) =>
    adminArenaWintradeScanMock(...a),
  adminArenaWintradeAck: (...a: unknown[]) =>
    adminArenaWintradeAckMock(...a),
  adminArenaWintradeResolve: (...a: unknown[]) =>
    adminArenaWintradeResolveMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: (_e: unknown, def: string) => def,
}));

import AdminArenaAntiWintradePanel from '@/components/AdminArenaAntiWintradePanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải...' },
      admin: {
        arenaAntiWintrade: {
          alerts: 'Alerts',
          total: 'total',
          lastScan: 'Last scan',
          scannedMatches: 'Scanned',
          alertsCreated: 'Created',
          alertsSkipped: 'Skipped',
          severity: 'Sev',
          type: 'Type',
          attackerCharacterId: 'Atk',
          defenderCharacterId: 'Def',
          status: 'Status',
          createdAt: 'CreatedAt',
          actions: 'Actions',
          ack: 'Ack',
          resolve: 'Resolve',
          scanBtn: 'Scan',
          confirmScan: 'confirm scan',
          confirmAck: 'confirm ack',
          confirmResolve: 'confirm resolve',
          scanSuccess: 'Done {created}/{skipped}',
          ackSuccess: 'Acked',
          resolveSuccess: 'Resolved',
          empty: 'No alerts',
          filter: {
            severityAll: 'All sev',
            statusAll: 'All status',
            typeAll: 'All type',
          },
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
  return mount(AdminArenaAntiWintradePanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminArenaAntiWintradePanel', () => {
  it('renders panel + empty state khi không có alert', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    const w = mountPanel();
    await flushPromises();
    expect(
      w.find('[data-testid="admin-arena-anti-wintrade-panel"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-arena-anti-wintrade-empty"]').exists(),
    ).toBe(true);
  });

  it('renders alert rows khi list returns data', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'atkA',
          defenderCharacterId: 'defB',
          relatedCharacterIds: ['atkA', 'defB'],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w1',
          details: { matchCount: 5 },
          createdAt: '2026-05-09T12:00:00.000Z',
          updatedAt: '2026-05-09T12:00:00.000Z',
        },
        {
          id: 'a2',
          seasonId: null,
          attackerCharacterId: 'atkA',
          defenderCharacterId: 'defC',
          relatedCharacterIds: ['atkA', 'defC'],
          severity: 'CRITICAL',
          type: 'REWARD_FARM_PATTERN',
          status: 'OPEN',
          windowKey: 'w2',
          details: { matchCount: 12 },
          createdAt: '2026-05-09T12:00:00.000Z',
          updatedAt: '2026-05-09T12:00:00.000Z',
        },
      ],
      total: 2,
    });
    const w = mountPanel();
    await flushPromises();
    const rows = w.findAll('[data-testid="admin-arena-anti-wintrade-alert-row"]');
    expect(rows.length).toBe(2);
  });

  it('Run scan button gọi API + refresh', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    adminArenaWintradeScanMock.mockResolvedValue({
      scannedMatches: 10,
      alertsCreated: 1,
      alertsSkippedDuplicate: 2,
      criticalCount: 0,
      warningCount: 1,
      infoCount: 0,
    });
    vi.stubGlobal('confirm', () => true);

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-arena-anti-wintrade-scan-btn"]')
      .trigger('click');
    await flushPromises();

    expect(adminArenaWintradeScanMock).toHaveBeenCalled();
    expect(
      adminArenaWintradeListAlertsMock.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('Ack button gọi adminArenaWintradeAck + refresh', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'atkA',
          defenderCharacterId: 'defB',
          relatedCharacterIds: [],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w1',
          details: {},
          createdAt: '2026-05-09T12:00:00.000Z',
          updatedAt: '2026-05-09T12:00:00.000Z',
        },
      ],
      total: 1,
    });
    adminArenaWintradeAckMock.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-arena-anti-wintrade-alert-ack"]')
      .trigger('click');
    await flushPromises();

    expect(adminArenaWintradeAckMock).toHaveBeenCalledWith('a1');
    expect(
      adminArenaWintradeListAlertsMock.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('Resolve button gọi adminArenaWintradeResolve + refresh', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'atkA',
          defenderCharacterId: 'defB',
          relatedCharacterIds: [],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'ACKNOWLEDGED',
          windowKey: 'w1',
          details: {},
          createdAt: '2026-05-09T12:00:00.000Z',
          updatedAt: '2026-05-09T12:00:00.000Z',
        },
      ],
      total: 1,
    });
    adminArenaWintradeResolveMock.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);

    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="admin-arena-anti-wintrade-alert-resolve"]')
      .trigger('click');
    await flushPromises();

    expect(adminArenaWintradeResolveMock).toHaveBeenCalledWith('a1');
  });

  it('hiển thị error state khi list throw', async () => {
    adminArenaWintradeListAlertsMock.mockRejectedValue(new Error('boom'));
    const w = mountPanel();
    await flushPromises();
    expect(
      w.find('[data-testid="admin-arena-anti-wintrade-error"]').exists(),
    ).toBe(true);
  });

  it('cancel confirm dialog không gọi API', async () => {
    adminArenaWintradeListAlertsMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.stubGlobal('confirm', () => false);
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="admin-arena-anti-wintrade-scan-btn"]')
      .trigger('click');
    await flushPromises();
    expect(adminArenaWintradeScanMock).not.toHaveBeenCalled();
  });
});
