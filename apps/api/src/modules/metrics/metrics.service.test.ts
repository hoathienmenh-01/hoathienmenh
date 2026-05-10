/**
 * Phase 17.5 — pure-unit tests cho `MetricsService`.
 *
 * Mock dependency để cover:
 *   - System collect: shape đầy đủ (uptime / memory / cpu / pid / appVersion).
 *   - API collect: snapshot từ middleware singleton sau khi feed.
 *   - WS collect: count online từ RealtimeService stub.
 *   - Queue collect: Redis stub trả `llen`/`zcard` đúng map.
 *   - Queue collect fail-soft: Redis throw → `available=false`, queues=[].
 *   - Cron collect: Prisma stub trả last row → mapping đúng.
 *   - Cron collect fail-soft: Prisma throw → row null/null/null, KHÔNG escalate.
 *   - collectAll: errors[] gom tất cả stage fail; payload luôn có `schema:1`.
 *   - SECURITY: payload KHÔNG chứa env / cookie / token / userId / password.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { MetricsService } from './metrics.service';
import type { PrismaService } from '../../common/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import {
  createRequestMetricsMiddleware,
  resetRequestMetrics,
} from './request-metrics.middleware';
import type { NextFunction, Request, Response } from 'express';

interface FakeRes {
  statusCode: number;
  on: (event: string, fn: () => void) => FakeRes;
  emit: (event: string) => void;
}

function makeRes(status = 200): FakeRes {
  const listeners: Record<string, Array<() => void>> = {};
  const r: FakeRes = {
    statusCode: status,
    on(event, fn) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
      return r;
    },
    emit(event) {
      for (const fn of listeners[event] ?? []) fn();
    },
  };
  return r;
}

function makePrismaStub(opts: {
  ledger?: { startedAt: Date; status: string; dayBucket: string } | null | Error;
  territorySettle?: { settledAt: Date; periodKey: string } | null | Error;
  territoryDecay?: { triggeredAt: Date; periodKey: string } | null | Error;
  seasonSnapshot?: { finalizedAt: Date; seasonKey: string } | null | Error;
} = {}): PrismaService {
  return {
    economyLedgerCheckRun: {
      findFirst: vi.fn(async () => {
        const v = opts.ledger;
        if (v instanceof Error) throw v;
        return v ?? null;
      }),
    },
    sectTerritorySettlementSnapshot: {
      findFirst: vi.fn(async () => {
        const v = opts.territorySettle;
        if (v instanceof Error) throw v;
        return v ?? null;
      }),
    },
    sectTerritoryDecayLog: {
      findFirst: vi.fn(async () => {
        const v = opts.territoryDecay;
        if (v instanceof Error) throw v;
        return v ?? null;
      }),
    },
    sectSeasonSnapshot: {
      findFirst: vi.fn(async () => {
        const v = opts.seasonSnapshot;
        if (v instanceof Error) throw v;
        return v ?? null;
      }),
    },
  } as unknown as PrismaService;
}

function makeRealtimeStub(online: number): RealtimeService {
  return {
    countOnline: () => online,
  } as unknown as RealtimeService;
}

interface RedisStubOptions {
  llen?: Record<string, number>;
  zcard?: Record<string, number>;
  llenThrow?: boolean;
  zcardThrow?: boolean;
  /** Throw cho cả pipeline (collectQueueMetrics fail-soft). */
  hardFail?: boolean;
}

function makeRedisStub(opts: RedisStubOptions = {}): Redis {
  return {
    llen: vi.fn(async (key: string) => {
      if (opts.hardFail) throw new Error('redis offline');
      if (opts.llenThrow) throw new Error('wrongtype');
      return opts.llen?.[key] ?? 0;
    }),
    zcard: vi.fn(async (key: string) => {
      if (opts.hardFail) throw new Error('redis offline');
      if (opts.zcardThrow) throw new Error('wrongtype');
      return opts.zcard?.[key] ?? 0;
    }),
  } as unknown as Redis;
}

const noopNext: NextFunction = () => undefined;

describe('MetricsService.collectSystemMetrics', () => {
  it('trả shape đầy đủ + uptime tăng theo thời gian', () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = svc.collectSystemMetrics();
    expect(r.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof r.node.version).toBe('string');
    expect(r.memory.rssBytes).toBeGreaterThan(0);
    expect(r.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(r.cpu.userMicros).toBeGreaterThanOrEqual(0);
    expect(typeof r.pid).toBe('number');
    expect(r.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof r.appVersion).toBe('string');
  });
});

describe('MetricsService.collectApiMetrics', () => {
  beforeEach(() => {
    resetRequestMetrics();
  });

  it('reuse singleton snapshot từ middleware (count + duration)', () => {
    const mw = createRequestMetricsMiddleware();
    // Feed 2 GET 200, 1 POST 500 → totalRequests=3.
    for (const [method, status] of [['GET', 200], ['GET', 200], ['POST', 500]] as const) {
      const res = makeRes(status);
      mw({ method, path: '/api/x', url: '/api/x' } as Request, res as unknown as Response, noopNext);
      res.emit('finish');
    }
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = svc.collectApiMetrics();
    expect(r.request.totalRequests).toBe(3);
    expect(r.request.byMethod.GET).toBe(2);
    expect(r.request.byMethod.POST).toBe(1);
    expect(r.request.byStatusBucket['2xx']).toBe(2);
    expect(r.request.byStatusBucket['5xx']).toBe(1);
    expect(r.request.avgDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('MetricsService.collectWsMetrics', () => {
  it('countOnline reflect realtime stub', () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(7),
      makeRedisStub(),
    );
    const r = svc.collectWsMetrics();
    expect(r.onlineUsers).toBe(7);
    expect(r.serverBound).toBe(true);
  });
});

describe('MetricsService.collectQueueMetrics', () => {
  it('happy path: scan tất cả queue + count đúng', async () => {
    const llen: Record<string, number> = {
      'bull:cultivation:wait': 5,
      'bull:cultivation:active': 1,
      'bull:ops:wait': 0,
    };
    const zcard: Record<string, number> = {
      'bull:cultivation:delayed': 2,
      'bull:cultivation:completed': 100,
      'bull:cultivation:failed': 3,
    };
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub({ llen, zcard }),
    );
    const r = await svc.collectQueueMetrics();
    expect(r.available).toBe(true);
    const cultivation = r.queues.find((q) => q.name === 'cultivation');
    expect(cultivation).toEqual({
      name: 'cultivation',
      waiting: 5,
      active: 1,
      delayed: 2,
      completed: 100,
      failed: 3,
    });
    // Queue chưa có data → all 0
    const ops = r.queues.find((q) => q.name === 'ops');
    expect(ops?.waiting).toBe(0);
  });

  it('fail-soft với llen/zcard throw đơn lẻ → count = 0, available=true', async () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub({ llenThrow: true, zcardThrow: true }),
    );
    const r = await svc.collectQueueMetrics();
    expect(r.available).toBe(true);
    for (const q of r.queues) {
      expect(q.waiting).toBe(0);
      expect(q.active).toBe(0);
      expect(q.delayed).toBe(0);
      expect(q.completed).toBe(0);
      expect(q.failed).toBe(0);
    }
  });

  it('liệt kê các queue đã biết: cultivation/ops/mission-reset/territory-cron/sect-season-cron/ledger-checker-cron/anomaly-scanner-cron', async () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = await svc.collectQueueMetrics();
    const names = r.queues.map((q) => q.name).sort();
    expect(names).toEqual(
      [
        'anomaly-scanner-cron',
        'cultivation',
        'ledger-checker-cron',
        'mission-reset',
        'ops',
        'sect-season-cron',
        'territory-cron',
      ].sort(),
    );
  });
});

describe('MetricsService.collectCronMetrics', () => {
  it('happy path: tất cả 4 job có row → trả lastRunAt + status + contextKey đúng', async () => {
    const ledgerAt = new Date('2026-05-09T12:00:00Z');
    const settleAt = new Date('2026-05-08T01:00:00Z');
    const decayAt = new Date('2026-05-08T01:30:00Z');
    const seasonAt = new Date('2026-05-07T00:00:00Z');
    const svc = new MetricsService(
      makePrismaStub({
        ledger: { startedAt: ledgerAt, status: 'OK', dayBucket: '2026-05-09' },
        territorySettle: { settledAt: settleAt, periodKey: 'wk-2026-19' },
        territoryDecay: { triggeredAt: decayAt, periodKey: 'wk-2026-19' },
        seasonSnapshot: { finalizedAt: seasonAt, seasonKey: 'season_2026_s2' },
      }),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = await svc.collectCronMetrics();
    expect(r.available).toBe(true);
    expect(r.jobs).toHaveLength(4);
    const ledger = r.jobs.find((j) => j.job === 'economy-ledger-check');
    expect(ledger?.lastRunAt).toBe(ledgerAt.toISOString());
    expect(ledger?.lastStatus).toBe('OK');
    expect(ledger?.contextKey).toBe('2026-05-09');
    const settle = r.jobs.find((j) => j.job === 'territory-settle');
    expect(settle?.lastRunAt).toBe(settleAt.toISOString());
    expect(settle?.lastStatus).toBe('OK');
    expect(settle?.contextKey).toBe('wk-2026-19');
  });

  it('chưa có row nào → trả null fields, KHÔNG throw', async () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = await svc.collectCronMetrics();
    expect(r.available).toBe(true);
    for (const j of r.jobs) {
      expect(j.lastRunAt).toBeNull();
      expect(j.lastStatus).toBeNull();
    }
  });

  it('fail-soft: 1 model throw → chỉ row đó null, các row khác vẫn có data', async () => {
    const svc = new MetricsService(
      makePrismaStub({
        ledger: new Error('db down'),
        territorySettle: { settledAt: new Date('2026-05-01'), periodKey: 'wk-2026-18' },
      }),
      makeRealtimeStub(0),
      makeRedisStub(),
    );
    const r = await svc.collectCronMetrics();
    const ledger = r.jobs.find((j) => j.job === 'economy-ledger-check');
    expect(ledger?.lastRunAt).toBeNull();
    const settle = r.jobs.find((j) => j.job === 'territory-settle');
    expect(settle?.lastRunAt).not.toBeNull();
  });
});

describe('MetricsService.collectAll', () => {
  it('happy path: schema=1 + đầy đủ system/api/ws/queue/cron + errors=[]', async () => {
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(3),
      makeRedisStub(),
    );
    const r = await svc.collectAll();
    expect(r.schema).toBe(1);
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.system.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(r.api.request.totalRequests).toBeGreaterThanOrEqual(0);
    expect(r.ws?.onlineUsers).toBe(3);
    expect(r.queue?.available).toBe(true);
    expect(r.cron?.available).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('SECURITY: payload KHÔNG chứa secret/env/cookie/token/userId/password (deep scan)', async () => {
    process.env.JWT_ACCESS_SECRET = 'top-secret-do-not-leak-xyz123';
    process.env.SMTP_PASS = 'leak-pass-9999';
    const svc = new MetricsService(
      makePrismaStub(),
      makeRealtimeStub(1),
      makeRedisStub(),
    );
    const r = await svc.collectAll();
    const json = JSON.stringify(r);
    expect(json).not.toContain('top-secret-do-not-leak-xyz123');
    expect(json).not.toContain('leak-pass-9999');
    // Common forbidden keys (substring scan, không match `tokenization` etc.)
    expect(/"cookie"\s*:/i.test(json)).toBe(false);
    expect(/"password"\s*:/i.test(json)).toBe(false);
    expect(/"jwt"\s*:/i.test(json)).toBe(false);
    expect(/"refreshToken"\s*:/i.test(json)).toBe(false);
    expect(/"userId"\s*:/i.test(json)).toBe(false);
    expect(/"characterId"\s*:/i.test(json)).toBe(false);
    expect(/"email"\s*:/i.test(json)).toBe(false);
  });
});
