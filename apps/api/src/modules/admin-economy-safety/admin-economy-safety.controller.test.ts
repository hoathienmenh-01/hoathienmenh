/**
 * Phase 16.6 — AdminEconomySafetyController unit tests.
 *
 * Test pure-unit (instantiate controller trực tiếp + bypass `AdminGuard`
 * — guard logic test riêng ở `admin.guard.test.ts`). Cover:
 *   - runLedgerCheck: ok + audit row.
 *   - runLedgerCheck: forceRerun pass-through.
 *   - getLatestRun: empty + has-run.
 *   - listIssues / listAnomalies: filter validation (severity/status/source).
 *   - ack/resolve: ok + 404 nếu không tìm thấy.
 *   - runAnomalyScan: ok + audit row.
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminEconomySafetyController } from './admin-economy-safety.controller';
import type {
  LedgerCheckRunSummary,
  LedgerCheckerService,
} from '../economy/ledger-checker.service';
import type {
  AnomalyScanSummary,
  EconomyAnomalyScannerService,
} from '../economy/economy-anomaly-scanner.service';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

interface PrismaStubs {
  runs?: Array<{
    id: string;
    dayBucket: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    summaryJson: unknown;
    triggeredBy: string | null;
  }>;
  issues?: Array<{
    id: string;
    runId: string;
    severity: string;
    type: string;
    characterId: string | null;
    detailsJson: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  anomalies?: Array<{
    id: string;
    severity: string;
    source: string;
    characterId: string | null;
    userId: string | null;
    detailsJson: unknown;
    status: string;
    windowKey: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

interface ControllerStubs {
  runCheck?: LedgerCheckerService['runCheck'];
  scanAll?: EconomyAnomalyScannerService['scanAll'];
  rangeReportGenerate?: (
    range: import('@xuantoi/shared').EconomyReportRange,
  ) => Promise<import('@xuantoi/shared').EconomyReportResponse>;
  prisma?: PrismaStubs;
  auditCreated?: { count: number; actions: string[] };
}

function emptySummary(dayBucket = '2026-01-01'): LedgerCheckRunSummary {
  return {
    runId: 'run-1',
    dayBucket,
    status: 'OK',
    startedAt: new Date('2026-01-01T01:00:00.000Z'),
    finishedAt: new Date('2026-01-01T01:00:01.000Z'),
    charactersScanned: 0,
    itemKeysScanned: 0,
    currencyDiscrepancies: 0,
    inventoryDiscrepancies: 0,
    rewardCapInconsistencies: 0,
    negativeBalances: 0,
    suspiciousDeltas: 0,
    issuesCreated: 0,
    alreadyDone: false,
  };
}

function emptyScan(windowKey = '2026-01-01'): AnomalyScanSummary {
  return {
    windowKey,
    topCurrencyDelta: 0,
    rareItemGain: 0,
    rewardCapBypass: 0,
    marketOutlier: 0,
    totalAnomaliesCreated: 0,
    totalAnomaliesSkipped: 0,
  };
}

function makeController(stubs: ControllerStubs = {}): {
  c: AdminEconomySafetyController;
  audit: { count: number; actions: string[] };
  state: PrismaStubs;
} {
  const audit = stubs.auditCreated ?? { count: 0, actions: [] };
  const state: PrismaStubs = {
    runs: stubs.prisma?.runs ?? [],
    issues: stubs.prisma?.issues ?? [],
    anomalies: stubs.prisma?.anomalies ?? [],
  };

  const ledger = {
    runCheck:
      stubs.runCheck ??
      (async (opts): Promise<LedgerCheckRunSummary> => ({
        ...emptySummary(),
        runId: 'run-' + (opts?.triggeredBy ?? 'sys'),
      })),
  } as unknown as LedgerCheckerService;

  const scanner = {
    scanAll:
      stubs.scanAll ??
      (async (): Promise<AnomalyScanSummary> => emptyScan()),
  } as unknown as EconomyAnomalyScannerService;

  const prisma = {
    economyLedgerCheckRun: {
      findFirst: async () => state.runs?.[0] ?? null,
    },
    economyLedgerCheckIssue: {
      count: async (args: { where: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return (state.issues ?? []).filter((i) => {
          for (const [k, v] of Object.entries(where)) {
            if ((i as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        }).length;
      },
      findMany: async (args: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const where = args?.where ?? {};
        const items = (state.issues ?? []).filter((i) => {
          for (const [k, v] of Object.entries(where)) {
            if ((i as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        });
        return items.slice(0, args?.take ?? items.length);
      },
      updateMany: async (args: {
        where: { id: string; status?: unknown };
        data: { status: string };
      }) => {
        const target = (state.issues ?? []).find((i) => i.id === args.where.id);
        if (!target) return { count: 0 };
        const expectedStatus = args.where.status;
        if (
          expectedStatus &&
          typeof expectedStatus === 'object' &&
          'in' in (expectedStatus as Record<string, unknown>)
        ) {
          const allowed = (expectedStatus as { in: string[] }).in;
          if (!allowed.includes(target.status)) return { count: 0 };
        } else if (
          typeof expectedStatus === 'string' &&
          target.status !== expectedStatus
        ) {
          return { count: 0 };
        }
        target.status = args.data.status;
        return { count: 1 };
      },
    },
    economyAnomaly: {
      count: async (args: { where: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return (state.anomalies ?? []).filter((a) => {
          for (const [k, v] of Object.entries(where)) {
            if ((a as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        }).length;
      },
      findMany: async (args: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const where = args?.where ?? {};
        const items = (state.anomalies ?? []).filter((a) => {
          for (const [k, v] of Object.entries(where)) {
            if ((a as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        });
        return items.slice(0, args?.take ?? items.length);
      },
      updateMany: async (args: {
        where: { id: string; status?: unknown };
        data: { status: string };
      }) => {
        const target = (state.anomalies ?? []).find(
          (a) => a.id === args.where.id,
        );
        if (!target) return { count: 0 };
        const expectedStatus = args.where.status;
        if (
          expectedStatus &&
          typeof expectedStatus === 'object' &&
          'in' in (expectedStatus as Record<string, unknown>)
        ) {
          const allowed = (expectedStatus as { in: string[] }).in;
          if (!allowed.includes(target.status)) return { count: 0 };
        } else if (
          typeof expectedStatus === 'string' &&
          target.status !== expectedStatus
        ) {
          return { count: 0 };
        }
        target.status = args.data.status;
        return { count: 1 };
      },
    },
    adminAuditLog: {
      create: async (input: { data: { action: string } }) => {
        audit.count++;
        audit.actions.push(input.data.action);
        return {};
      },
    },
  } as unknown as ConstructorParameters<
    typeof AdminEconomySafetyController
  >[0];
  return {
    c: new AdminEconomySafetyController(
      prisma,
      ledger,
      scanner,
      stubs.rangeReportGenerate
        ? ({ generate: stubs.rangeReportGenerate } as unknown as ConstructorParameters<
            typeof AdminEconomySafetyController
          >[3])
        : ({
            generate: async () =>
              ({
                range: { from: '2026-05-05', to: '2026-05-11', days: 7 },
                bySource: [],
                totalInLinhThach: '0',
                totalOutLinhThach: '0',
                totalNetLinhThach: '0',
                totalInTienNgoc: 0,
                totalOutTienNgoc: 0,
                totalNetTienNgoc: 0,
                topCharacterDelta: [],
                marketVolume: '0',
                shopSpend: '0',
                sectShopSpend: '0',
                reforgeEnchantSpend: '0',
                adminGrantTotal: '0',
                topupTotal: '0',
                liveOpsRewardTotal: '0',
                dailyLoginRewardTotal: '0',
                dungeonRewardTotal: '0',
                bossRewardTotal: '0',
                territoryRewardTotal: '0',
                sectSeasonRewardTotal: '0',
                anomalySummary: {
                  openCount: 0,
                  acknowledgedCount: 0,
                  resolvedCount: 0,
                  latestSeverity: null,
                  latestCreatedAt: null,
                },
                latestLedgerCheckRun: null,
                generatedAt: '2026-05-11T00:00:00.000Z',
              }) as unknown as Awaited<
                ReturnType<
                  ConstructorParameters<
                    typeof AdminEconomySafetyController
                  >[3]['generate']
                >
              >,
          } as unknown as ConstructorParameters<
            typeof AdminEconomySafetyController
          >[3]),
    ),
    audit,
    state,
  };
}

describe('AdminEconomySafetyController.runLedgerCheck', () => {
  it('ok → trả summary + audit row', async () => {
    let captured: { triggeredBy?: string | null; forceRerun?: boolean } = {};
    const { c, audit } = makeController({
      runCheck: async (opts) => {
        captured = {
          triggeredBy: opts?.triggeredBy,
          forceRerun: opts?.forceRerun,
        };
        return { ...emptySummary(), runId: 'run-x' };
      },
    });
    const r = await c.runLedgerCheck(makeReq('admin42'), {
      forceRerun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.data.runId).toBe('run-x');
    expect(captured.triggeredBy).toBe('admin42');
    expect(captured.forceRerun).toBe(true);
    expect(audit.count).toBe(1);
    expect(audit.actions[0]).toBe('ADMIN_ECONOMY_LEDGER_CHECK_RUN');
  });

  it('INVALID_INPUT khi body có key extra', async () => {
    const { c } = makeController();
    await expect(
      c.runLedgerCheck(makeReq(), {
        evilKey: 'x',
      } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('AdminEconomySafetyController.getLatestRun', () => {
  it('null khi chưa có run', async () => {
    const { c } = makeController();
    const r = await c.getLatestRun();
    expect(r.data.run).toBeNull();
    expect(r.data.openIssues).toBe(0);
  });

  it('trả run + đếm openIssues', async () => {
    const now = new Date('2026-01-01T01:00:00.000Z');
    const { c } = makeController({
      prisma: {
        runs: [
          {
            id: 'r1',
            dayBucket: '2026-01-01',
            status: 'ISSUE_FOUND',
            startedAt: now,
            finishedAt: now,
            summaryJson: { foo: 1 },
            triggeredBy: null,
          },
        ],
        issues: [
          {
            id: 'i1',
            runId: 'r1',
            severity: 'WARN',
            type: 'CURRENCY_MISMATCH',
            characterId: null,
            detailsJson: {},
            status: 'OPEN',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'i2',
            runId: 'r1',
            severity: 'INFO',
            type: 'NEGATIVE_BALANCE',
            characterId: null,
            detailsJson: {},
            status: 'RESOLVED',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    const r = await c.getLatestRun();
    expect(r.data.run?.id).toBe('r1');
    expect(r.data.run?.status).toBe('ISSUE_FOUND');
    expect(r.data.openIssues).toBe(1); // only i1 (i2 resolved)
  });
});

describe('AdminEconomySafetyController.listIssues + ack + resolve', () => {
  function seed() {
    const now = new Date('2026-01-01T00:00:00.000Z');
    return makeController({
      prisma: {
        issues: [
          {
            id: 'i1',
            runId: 'r1',
            severity: 'CRITICAL',
            type: 'CURRENCY_MISMATCH',
            characterId: null,
            detailsJson: {},
            status: 'OPEN',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'i2',
            runId: 'r1',
            severity: 'INFO',
            type: 'NEGATIVE_BALANCE',
            characterId: 'c1',
            detailsJson: {},
            status: 'RESOLVED',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
  }

  it('list không filter → all', async () => {
    const { c } = seed();
    const r = await c.listIssues({});
    expect(r.data.total).toBe(2);
  });

  it('list filter severity=CRITICAL', async () => {
    const { c } = seed();
    const r = await c.listIssues({ severity: 'CRITICAL' });
    expect(r.data.total).toBe(1);
    expect(r.data.items[0].id).toBe('i1');
  });

  it('list filter severity invalid → bỏ qua filter (không crash)', async () => {
    const { c } = seed();
    const r = await c.listIssues({ severity: 'NOT_REAL' });
    expect(r.data.total).toBe(2);
  });

  it('ackIssue: OPEN → ACKNOWLEDGED + audit', async () => {
    const { c, audit, state } = seed();
    const r = await c.ackIssue(makeReq(), 'i1');
    expect(r.data.status).toBe('ACKNOWLEDGED');
    expect(state.issues?.[0].status).toBe('ACKNOWLEDGED');
    expect(audit.actions).toContain('ADMIN_ECONOMY_ISSUE_ACK');
  });

  it('ackIssue: RESOLVED → 404', async () => {
    const { c } = seed();
    await expect(c.ackIssue(makeReq(), 'i2')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('resolveIssue: OPEN → RESOLVED + audit', async () => {
    const { c, audit, state } = seed();
    const r = await c.resolveIssue(makeReq(), 'i1');
    expect(r.data.status).toBe('RESOLVED');
    expect(state.issues?.[0].status).toBe('RESOLVED');
    expect(audit.actions).toContain('ADMIN_ECONOMY_ISSUE_RESOLVE');
  });

  it('resolveIssue: not-exist → 404', async () => {
    const { c } = seed();
    await expect(c.resolveIssue(makeReq(), 'unknown')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('AdminEconomySafetyController.runAnomalyScan + listAnomalies', () => {
  it('runAnomalyScan ok + audit row', async () => {
    const { c, audit } = makeController({
      scanAll: async () => ({
        ...emptyScan('2026-01-01'),
        totalAnomaliesCreated: 3,
      }),
    });
    const r = await c.runAnomalyScan(makeReq('admin42'), {});
    expect(r.data.totalAnomaliesCreated).toBe(3);
    expect(audit.actions).toContain('ADMIN_ECONOMY_ANOMALY_SCAN_RUN');
  });

  it('listAnomalies filter source=CURRENCY_DELTA_24H', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { c } = makeController({
      prisma: {
        anomalies: [
          {
            id: 'a1',
            severity: 'CRITICAL',
            source: 'CURRENCY_DELTA_24H',
            characterId: 'c1',
            userId: 'u1',
            detailsJson: {},
            status: 'OPEN',
            windowKey: 'w1',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'a2',
            severity: 'WARN',
            source: 'MARKET_OUTLIER',
            characterId: 'c2',
            userId: 'u2',
            detailsJson: {},
            status: 'OPEN',
            windowKey: 'w1',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    const r = await c.listAnomalies({ source: 'CURRENCY_DELTA_24H' });
    expect(r.data.total).toBe(1);
    expect(r.data.items[0].id).toBe('a1');
  });

  it('ackAnomaly + resolveAnomaly chain ok + audit', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { c, audit, state } = makeController({
      prisma: {
        anomalies: [
          {
            id: 'a1',
            severity: 'WARN',
            source: 'CURRENCY_DELTA_24H',
            characterId: 'c1',
            userId: 'u1',
            detailsJson: {},
            status: 'OPEN',
            windowKey: 'w1',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    await c.ackAnomaly(makeReq(), 'a1');
    expect(state.anomalies?.[0].status).toBe('ACKNOWLEDGED');
    await c.resolveAnomaly(makeReq(), 'a1');
    expect(state.anomalies?.[0].status).toBe('RESOLVED');
    expect(audit.actions).toContain('ADMIN_ECONOMY_ANOMALY_ACK');
    expect(audit.actions).toContain('ADMIN_ECONOMY_ANOMALY_RESOLVE');
  });
});
