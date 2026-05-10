/**
 * Phase 14.1.D — ArenaAntiWintradeAdminController unit tests.
 *
 * Pure-unit (instantiate controller trực tiếp, bypass `AdminGuard` —
 * guard logic test riêng ở `admin.guard.test.ts`).
 *
 * Coverage:
 *   - runScan: ok + summary + audit row.
 *   - runScan: invalid body → 400.
 *   - listAlerts: filter validation (severity/status/type).
 *   - ackAlert: ok + audit + 404 nếu không tồn tại.
 *   - resolveAlert: ok + audit + 404 nếu đã RESOLVED.
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { ArenaAntiWintradeAdminController } from './arena-anti-wintrade.admin.controller';
import type {
  AntiWintradeScanSummary,
  ArenaAntiWintradeService,
} from '../arena/arena-anti-wintrade.service';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

interface AlertRow {
  id: string;
  seasonId: string | null;
  attackerCharacterId: string | null;
  defenderCharacterId: string | null;
  relatedCharacterIdsJson: unknown;
  severity: string;
  type: string;
  status: string;
  windowKey: string;
  detailsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaStubs {
  alerts?: AlertRow[];
}

interface AdminAuditCalls {
  audit: Array<{ actorUserId: string; action: string; meta: unknown }>;
}

function makePrismaStub(stubs: PrismaStubs = {}): {
  prisma: ReturnType<typeof Object>;
  audit: AdminAuditCalls;
} {
  const audit: AdminAuditCalls = { audit: [] };
  const alerts = stubs.alerts ? [...stubs.alerts] : [];
  const prisma = {
    arenaWintradeAlert: {
      findMany: async (args: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const where = args.where ?? {};
        return alerts
          .filter((a) =>
            Object.entries(where).every(([k, v]) => {
              return (a as unknown as Record<string, unknown>)[k] === v;
            }),
          )
          .slice(0, args.take ?? 50);
      },
      count: async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        return alerts.filter((a) =>
          Object.entries(where).every(
            ([k, v]) => (a as unknown as Record<string, unknown>)[k] === v,
          ),
        ).length;
      },
      updateMany: async (args: {
        where: { id: string; status?: unknown };
        data: { status: string };
      }) => {
        let count = 0;
        for (const a of alerts) {
          if (a.id !== args.where.id) continue;
          const allowed = args.where.status as
            | string
            | { in: string[] }
            | undefined;
          if (typeof allowed === 'string' && a.status !== allowed) continue;
          if (
            allowed &&
            typeof allowed === 'object' &&
            'in' in allowed &&
            !allowed.in.includes(a.status)
          ) {
            continue;
          }
          a.status = args.data.status;
          a.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    adminAuditLog: {
      create: async (args: {
        data: { actorUserId: string; action: string; meta: unknown };
      }) => {
        audit.audit.push({
          actorUserId: args.data.actorUserId,
          action: args.data.action,
          meta: args.data.meta,
        });
        return { id: `audit-${audit.audit.length}` };
      },
    },
  };
  return { prisma, audit };
}

function makeScannerStub(
  summary: AntiWintradeScanSummary = {
    scannedMatches: 0,
    alertsCreated: 0,
    alertsSkippedDuplicate: 0,
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
  },
): ArenaAntiWintradeService {
  return {
    scanAll: async () => summary,
  } as unknown as ArenaAntiWintradeService;
}

/* ----------------------------- runScan ----------------------------- */

describe('ArenaAntiWintradeAdminController.runScan', () => {
  it('runs scan and writes audit row', async () => {
    const { prisma, audit } = makePrismaStub();
    const summary: AntiWintradeScanSummary = {
      scannedMatches: 10,
      alertsCreated: 2,
      alertsSkippedDuplicate: 1,
      criticalCount: 1,
      warningCount: 1,
      infoCount: 0,
    };
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(summary),
    );
    const res = await c.runScan(makeReq(), {});
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(summary);
    expect(audit.audit.length).toBe(1);
    expect(audit.audit[0].action).toBe('ADMIN_ARENA_WINTRADE_SCAN_RUN');
  });

  it('rejects invalid body', async () => {
    const { prisma } = makePrismaStub();
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    await expect(
      c.runScan(makeReq(), { unknownField: 1 }),
    ).rejects.toThrow(HttpException);
  });

  it('accepts periodKeyOverride', async () => {
    const { prisma } = makePrismaStub();
    let received: unknown;
    const scanner = {
      scanAll: async (opts: { periodKeyOverride?: string }) => {
        received = opts.periodKeyOverride;
        return {
          scannedMatches: 0,
          alertsCreated: 0,
          alertsSkippedDuplicate: 0,
          criticalCount: 0,
          warningCount: 0,
          infoCount: 0,
        };
      },
    } as unknown as ArenaAntiWintradeService;
    const c = new ArenaAntiWintradeAdminController(prisma as never, scanner);
    await c.runScan(makeReq(), { periodKeyOverride: 'manual:2026-05-09' });
    expect(received).toBe('manual:2026-05-09');
  });
});

/* ----------------------------- listAlerts ----------------------------- */

describe('ArenaAntiWintradeAdminController.listAlerts', () => {
  it('returns items + total', async () => {
    const now = new Date();
    const { prisma } = makePrismaStub({
      alerts: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'attA',
          defenderCharacterId: 'defB',
          relatedCharacterIdsJson: ['x', 'y'],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w1',
          detailsJson: { matchCount: 5 },
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    const res = await c.listAlerts({});
    expect(res.ok).toBe(true);
    expect(res.data.total).toBe(1);
    expect(res.data.items[0].id).toBe('a1');
    expect(res.data.items[0].severity).toBe('WARN');
    expect(res.data.items[0].relatedCharacterIds).toEqual(['x', 'y']);
  });

  it('filters by severity (ignores invalid)', async () => {
    const now = new Date();
    const { prisma } = makePrismaStub({
      alerts: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'A',
          defenderCharacterId: 'B',
          relatedCharacterIdsJson: [],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w',
          detailsJson: {},
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'a2',
          seasonId: null,
          attackerCharacterId: 'A',
          defenderCharacterId: 'C',
          relatedCharacterIdsJson: [],
          severity: 'CRITICAL',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w2',
          detailsJson: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    const onlyWarn = await c.listAlerts({ severity: 'WARN' });
    expect(onlyWarn.data.total).toBe(1);
    expect(onlyWarn.data.items[0].id).toBe('a1');
    // Invalid severity → filter dropped (returns all).
    const all = await c.listAlerts({ severity: 'BOGUS' });
    expect(all.data.total).toBe(2);
  });
});

/* ----------------------------- ack ----------------------------- */

describe('ArenaAntiWintradeAdminController.ackAlert', () => {
  it('ack OPEN → ACKNOWLEDGED + audit', async () => {
    const now = new Date();
    const { prisma, audit } = makePrismaStub({
      alerts: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'A',
          defenderCharacterId: 'B',
          relatedCharacterIdsJson: [],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w',
          detailsJson: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    const res = await c.ackAlert(makeReq(), 'a1');
    expect(res.data.status).toBe('ACKNOWLEDGED');
    expect(audit.audit[0].action).toBe('ADMIN_ARENA_WINTRADE_ALERT_ACK');
  });

  it('throws 404 when alert not found', async () => {
    const { prisma } = makePrismaStub();
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    await expect(c.ackAlert(makeReq(), 'missing')).rejects.toThrow(
      HttpException,
    );
  });
});

/* ----------------------------- resolve ----------------------------- */

describe('ArenaAntiWintradeAdminController.resolveAlert', () => {
  it('resolve OPEN → RESOLVED + audit', async () => {
    const now = new Date();
    const { prisma, audit } = makePrismaStub({
      alerts: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'A',
          defenderCharacterId: 'B',
          relatedCharacterIdsJson: [],
          severity: 'CRITICAL',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'OPEN',
          windowKey: 'w',
          detailsJson: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    const res = await c.resolveAlert(makeReq(), 'a1');
    expect(res.data.status).toBe('RESOLVED');
    expect(audit.audit[0].action).toBe('ADMIN_ARENA_WINTRADE_ALERT_RESOLVE');
  });

  it('throws 404 when alert already RESOLVED', async () => {
    const now = new Date();
    const { prisma } = makePrismaStub({
      alerts: [
        {
          id: 'a1',
          seasonId: null,
          attackerCharacterId: 'A',
          defenderCharacterId: 'B',
          relatedCharacterIdsJson: [],
          severity: 'WARN',
          type: 'REPEATED_OPPONENT_PAIR',
          status: 'RESOLVED',
          windowKey: 'w',
          detailsJson: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const c = new ArenaAntiWintradeAdminController(
      prisma as never,
      makeScannerStub(),
    );
    await expect(c.resolveAlert(makeReq(), 'a1')).rejects.toThrow(
      HttpException,
    );
  });
});
