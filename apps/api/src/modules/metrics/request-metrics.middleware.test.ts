/**
 * Phase 17.5 — pure-unit tests cho `request-metrics.middleware`.
 *
 * Lock-in:
 *   - Singleton state đếm tổng request + duration.
 *   - Bucket method đúng (GET/POST/.../OTHER).
 *   - Bucket status đúng (1xx..5xx + other).
 *   - inFlight gauge: tăng start, giảm finish; close path không leak.
 *   - skipPathPrefixes default: healthz/readyz/admin/metrics không count.
 *   - resetRequestMetrics() trả lại state empty + lastResetAt set.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  createRequestMetricsMiddleware,
  readRequestMetricsSnapshot,
  resetRequestMetrics,
} from './request-metrics.middleware';

interface FakeRes {
  statusCode: number;
  listeners: Record<string, Array<() => void>>;
  on: (event: string, fn: () => void) => FakeRes;
  emit: (event: string) => void;
}

function makeRes(statusCode = 200): FakeRes {
  const listeners: Record<string, Array<() => void>> = {};
  const res: FakeRes = {
    statusCode,
    listeners,
    on(event, fn) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
      return res;
    },
    emit(event) {
      const list = listeners[event] ?? [];
      for (const fn of list) fn();
    },
  };
  return res;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/character',
    url: '/api/character',
    ...overrides,
  } as unknown as Request;
}

const noopNext: NextFunction = () => undefined;

describe('request-metrics middleware', () => {
  beforeEach(() => {
    resetRequestMetrics();
  });

  it('count 1 request, duration tăng, method/status bucket đúng', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(200);
    mw(makeReq({ method: 'POST', path: '/api/character/state' }), res as unknown as Response, noopNext);
    res.emit('finish');
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(snap.byMethod.POST).toBe(1);
    expect(snap.byStatusBucket['2xx']).toBe(1);
    expect(snap.inFlight).toBe(0);
  });

  it('avg duration = total/count', () => {
    const mw = createRequestMetricsMiddleware();
    for (let i = 0; i < 3; i += 1) {
      const res = makeRes(200);
      mw(makeReq(), res as unknown as Response, noopNext);
      res.emit('finish');
    }
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(3);
    expect(snap.avgDurationMs).toBeCloseTo(snap.totalDurationMs / 3);
  });

  it('finish + close cùng request KHÔNG double count (idempotent record)', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(200);
    mw(makeReq(), res as unknown as Response, noopNext);
    res.emit('finish');
    res.emit('close');
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.byStatusBucket['2xx']).toBe(1);
  });

  it('client abort → close fires, vẫn count 1, inFlight=0', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(0);
    mw(makeReq(), res as unknown as Response, noopNext);
    res.emit('close');
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.byStatusBucket.other).toBe(1); // status 0 → other
    expect(snap.inFlight).toBe(0);
  });

  it('skip default prefixes: healthz / readyz / admin/metrics → KHÔNG count', () => {
    const mw = createRequestMetricsMiddleware();
    for (const path of ['/api/healthz', '/api/readyz', '/api/admin/metrics']) {
      const res = makeRes(200);
      mw(makeReq({ path, url: path }), res as unknown as Response, noopNext);
      res.emit('finish');
    }
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(0);
  });

  it('method lạ (vd CONNECT) → bucket OTHER', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(200);
    mw(makeReq({ method: 'CONNECT' }), res as unknown as Response, noopNext);
    res.emit('finish');
    const snap = readRequestMetricsSnapshot();
    expect(snap.byMethod.OTHER).toBe(1);
  });

  it('status bucket: 200=2xx, 304=3xx, 404=4xx, 500=5xx, 100=1xx', () => {
    const mw = createRequestMetricsMiddleware();
    const cases: Array<[number, string]> = [
      [100, '1xx'],
      [200, '2xx'],
      [304, '3xx'],
      [404, '4xx'],
      [500, '5xx'],
    ];
    for (const [s] of cases) {
      const res = makeRes(s);
      mw(makeReq({ method: 'GET' }), res as unknown as Response, noopNext);
      res.emit('finish');
    }
    const snap = readRequestMetricsSnapshot();
    for (const [, bucket] of cases) {
      expect(snap.byStatusBucket[bucket]).toBe(1);
    }
  });

  it('inFlight tăng khi chưa finish, về 0 sau finish', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(200);
    mw(makeReq(), res as unknown as Response, noopNext);
    let snap = readRequestMetricsSnapshot();
    expect(snap.inFlight).toBe(1);
    res.emit('finish');
    snap = readRequestMetricsSnapshot();
    expect(snap.inFlight).toBe(0);
  });

  it('resetRequestMetrics → state empty + lastResetAt set', () => {
    const mw = createRequestMetricsMiddleware();
    const res = makeRes(200);
    mw(makeReq(), res as unknown as Response, noopNext);
    res.emit('finish');
    resetRequestMetrics();
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.totalDurationMs).toBe(0);
    expect(snap.byMethod).toEqual({});
    expect(snap.byStatusBucket).toEqual({});
    expect(snap.inFlight).toBe(0);
    expect(snap.lastResetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('avg = 0 khi totalRequests = 0', () => {
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(0);
    expect(snap.avgDurationMs).toBe(0);
  });

  it('skipPathPrefixes custom override', () => {
    const mw = createRequestMetricsMiddleware({
      skipPathPrefixes: ['/api/quiet'],
    });
    // /api/healthz KHÔNG bị skip vì caller override
    const res1 = makeRes(200);
    mw(makeReq({ path: '/api/healthz', url: '/api/healthz' }), res1 as unknown as Response, noopNext);
    res1.emit('finish');
    // /api/quiet bị skip
    const res2 = makeRes(200);
    mw(makeReq({ path: '/api/quiet/poll', url: '/api/quiet/poll' }), res2 as unknown as Response, noopNext);
    res2.emit('finish');
    const snap = readRequestMetricsSnapshot();
    expect(snap.totalRequests).toBe(1);
  });
});
