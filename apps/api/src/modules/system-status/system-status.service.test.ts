/**
 * Phase 43 — pure-unit tests cho SystemStatusService.
 *
 * Mock PrismaService + Redis để verify:
 *   - getStatus() rollup ok / degraded / down.
 *   - listErrors() scrub detailJson allow-list.
 *   - getIntegrityLastRun() parse Redis artefact + reject malformed.
 *   - Service fail-soft khi probe / count throw.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  INTEGRITY_LAST_RUN_REDIS_KEY,
  SystemStatusService,
} from './system-status.service';
import { PrismaService } from '../../common/prisma.service';

interface FakePrismaState {
  events?: Array<{
    id: string;
    type: string;
    severity: string;
    policy: string | null;
    userId: string | null;
    characterId: string | null;
    createdAt: Date;
    detailJson: unknown;
  }>;
  groupedSeverities?: Array<{ severity: string; _count: { _all: number } }>;
  adminAuditCount?: number;
  failQueryRaw?: boolean;
}

function makePrisma(state: FakePrismaState): PrismaService {
  const events = state.events ?? [];
  return {
    $queryRaw: vi.fn(async () => {
      if (state.failQueryRaw) throw new Error('db down');
      return [{ '?column?': 1 }];
    }),
    securityEvent: {
      findMany: vi.fn(async () => events),
      count: vi.fn(async () => events.length),
      groupBy: vi.fn(async () => state.groupedSeverities ?? []),
    },
    adminAuditLog: {
      count: vi.fn(async () => state.adminAuditCount ?? 0),
    },
  } as unknown as PrismaService;
}

function makeRedis(opts: {
  pingOk?: boolean;
  artefact?: string | null;
  getThrows?: boolean;
}): Redis {
  return {
    ping: vi.fn(async () => {
      if (opts.pingOk === false) throw new Error('redis offline');
      return 'PONG';
    }),
    get: vi.fn(async (key: string) => {
      if (key !== INTEGRITY_LAST_RUN_REDIS_KEY) return null;
      if (opts.getThrows) throw new Error('redis get error');
      return opts.artefact ?? null;
    }),
  } as unknown as Redis;
}

describe('Phase 43 — SystemStatusService.getStatus rollup', () => {
  it('healthy DB+Redis+empty events → status=ok', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({});
    const svc = new SystemStatusService(prisma, redis);
    const snap = await svc.getStatus();
    expect(snap.status).toBe('ok');
    expect(snap.serviceName).toBe('xuantoi-api');
    expect(snap.checks.api.status).toBe('ok');
    expect(snap.checks.db.status).toBe('ok');
    expect(snap.checks.redis.status).toBe('ok');
    expect(snap.recentErrors.last24h).toBe(0);
  });

  it('Redis down + DB ok → status=degraded (fail-soft)', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({ pingOk: false });
    const svc = new SystemStatusService(prisma, redis);
    const snap = await svc.getStatus();
    expect(snap.status).toBe('degraded');
    expect(snap.checks.db.status).toBe('ok');
    expect(snap.checks.redis.status).toBe('down');
  });

  it('counts errors by severity within 24h window', async () => {
    const prisma = makePrisma({
      groupedSeverities: [
        { severity: 'WARN', _count: { _all: 3 } },
        { severity: 'ERROR', _count: { _all: 2 } },
        { severity: 'FATAL', _count: { _all: 1 } },
      ],
      adminAuditCount: 7,
    });
    const redis = makeRedis({});
    const svc = new SystemStatusService(prisma, redis);
    const snap = await svc.getStatus();
    expect(snap.recentErrors.last24h).toBe(6);
    expect(snap.recentErrors.bySeverity.WARN).toBe(3);
    expect(snap.recentErrors.bySeverity.ERROR).toBe(2);
    expect(snap.recentErrors.bySeverity.FATAL).toBe(1);
    expect(snap.recentErrors.bySeverity.INFO).toBe(0);
    expect(snap.adminActivity.last24h).toBe(7);
  });
});

describe('Phase 43 — SystemStatusService.listErrors scrub allow-list', () => {
  it('drops keys not in allow-list (token/password/cookie)', async () => {
    const prisma = makePrisma({
      events: [
        {
          id: 'evt_1',
          type: 'AUTH_RATE_LIMIT',
          severity: 'WARN',
          policy: 'auth.login',
          userId: 'u_1',
          characterId: null,
          createdAt: new Date('2025-01-15T08:00:00Z'),
          detailJson: {
            reason: 'too-many-login',
            code: 'LIMIT',
            requestId: 'req_xxx',
            token: 'SHOULD_BE_DROPPED',
            password: 'SHOULD_BE_DROPPED',
            cookie: 'session=abc',
            authorization: 'Bearer xxx',
          },
        },
      ],
    });
    const redis = makeRedis({});
    const svc = new SystemStatusService(prisma, redis);
    const out = await svc.listErrors({ limit: 5 });
    expect(out.rows).toHaveLength(1);
    const detail = out.rows[0].detailJson;
    expect(detail.reason).toBe('too-many-login');
    expect(detail.code).toBe('LIMIT');
    expect(detail.requestId).toBe('req_xxx');
    expect(detail).not.toHaveProperty('token');
    expect(detail).not.toHaveProperty('password');
    expect(detail).not.toHaveProperty('cookie');
    expect(detail).not.toHaveProperty('authorization');
  });

  it('clamps limit to 100 max + 1 min', async () => {
    const prisma = makePrisma({ events: [] });
    const redis = makeRedis({});
    const svc = new SystemStatusService(prisma, redis);
    await svc.listErrors({ limit: 9999 });
    const call = (prisma.securityEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(call.take).toBeLessThanOrEqual(100);
    await svc.listErrors({ limit: -5 });
    const call2 = (prisma.securityEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[1][0];
    expect(call2.take).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 43 — SystemStatusService.getIntegrityLastRun parse', () => {
  it('returns null when artefact missing', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({ artefact: null });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r).toBeNull();
  });

  it('parses valid CLEAN artefact', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({
      artefact: JSON.stringify({
        runAt: '2025-01-15T08:00:00Z',
        status: 'CLEAN',
        scopes: ['currency', 'inventory'],
        issueCount: 0,
        issues: [],
      }),
    });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r?.status).toBe('CLEAN');
    expect(r?.scopes).toEqual(['currency', 'inventory']);
    expect(r?.issueCount).toBe(0);
  });

  it('parses valid ISSUES artefact + clamps issues to 50', async () => {
    const prisma = makePrisma({});
    const longIssues = Array.from({ length: 80 }, (_, i) => ({
      scope: 'currency',
      severity: 'ERROR',
      message: `row ${i}`,
      count: 1,
    }));
    const redis = makeRedis({
      artefact: JSON.stringify({
        runAt: '2025-01-15T09:00:00Z',
        status: 'ISSUES',
        scopes: ['currency'],
        issueCount: 80,
        issues: longIssues,
      }),
    });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r?.status).toBe('ISSUES');
    expect(r?.issues.length).toBeLessThanOrEqual(50);
    expect(r?.issueCount).toBe(80);
  });

  it('rejects malformed artefact (missing runAt)', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({
      artefact: JSON.stringify({ status: 'CLEAN' }),
    });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r).toBeNull();
  });

  it('rejects invalid JSON (returns null, not throws)', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({ artefact: 'not-json{{' });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r).toBeNull();
  });

  it('Redis get throws → null (fail-soft)', async () => {
    const prisma = makePrisma({});
    const redis = makeRedis({ getThrows: true });
    const svc = new SystemStatusService(prisma, redis);
    const r = await svc.getIntegrityLastRun();
    expect(r).toBeNull();
  });
});
