/**
 * Phase 17.3 — Request logger middleware test.
 *
 * Cover:
 * - Gán requestId mới khi không có upstream header.
 * - Tôn trọng upstream `x-request-id` nếu shape an toàn.
 * - Reject upstream `x-request-id` malformed → sinh UUID mới.
 * - Set response header `x-request-id`.
 * - Log info "request done" khi response finish với { method, path, statusCode, durationMs, userId, characterId }.
 * - Skip path /api/healthz.
 * - Strip query string khỏi log path (tránh leak query secret).
 * - Không throw khi response chưa finish.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EventEmitter } from 'events';
import { createRequestLoggerMiddleware } from './request-logger.middleware';

interface MockReq {
  headers: Record<string, string | undefined>;
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  user?: { sub?: string; id?: string };
  characterId?: string;
  requestId?: string;
  log?: unknown;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let finishCb: (() => void) | null = null;
  const res = {
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    getHeader(k: string) {
      return headers[k];
    },
    on(evt: string, cb: () => void) {
      if (evt === 'finish') finishCb = cb;
      return res as unknown as EventEmitter;
    },
    triggerFinish() {
      if (finishCb) finishCb();
    },
    headers,
  };
  return res;
}

function makeMockLogger() {
  const calls: Array<{ bindings: unknown; level: string; obj: unknown; msg: string }> = [];
  const logger = {
    info: vi.fn((obj: unknown, msg: string) => {
      calls.push({ bindings: undefined, level: 'info', obj, msg });
    }),
    child: vi.fn((bindings: Record<string, unknown>) => ({
      info: vi.fn((obj: unknown, msg: string) => {
        calls.push({ bindings, level: 'info', obj, msg });
      }),
    })),
  };
  return { logger, calls };
}

describe('requestLogger — requestId generation', () => {
  it('sinh UUID khi không có upstream x-request-id', () => {
    const { logger } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = { headers: {}, method: 'GET', url: '/api/foo', path: '/api/foo' };
    const res = makeRes();
    const next = vi.fn();
    mw(req as never, res as never, next);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.getHeader('x-request-id')).toBe(req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('tôn trọng upstream x-request-id nếu match shape an toàn', () => {
    const { logger } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: { 'x-request-id': 'upstream-req-abc-123' },
      method: 'GET',
      url: '/api/foo',
      path: '/api/foo',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    expect(req.requestId).toBe('upstream-req-abc-123');
  });

  it('reject upstream x-request-id có ký tự nguy hiểm (CRLF inject) → UUID mới', () => {
    const { logger } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: { 'x-request-id': 'evil\r\ninjection' },
      method: 'GET',
      url: '/api/foo',
      path: '/api/foo',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    expect(req.requestId).not.toBe('evil\r\ninjection');
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('truncate upstream x-request-id quá dài (> 64 chars)', () => {
    const { logger } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const long = 'a'.repeat(200);
    const req: MockReq = {
      headers: { 'x-request-id': long },
      method: 'GET',
      url: '/api/foo',
      path: '/api/foo',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    // Sau slice(0, 64) → 64 chars 'a'. Match isSafeRequestId pattern → giữ nguyên.
    // Nếu kết quả >64 char → fallback UUID (36 char).
    expect((req.requestId ?? '').length).toBeLessThanOrEqual(64);
  });
});

describe('requestLogger — request done log payload', () => {
  it('log { method, path, statusCode, durationMs } khi response finish', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = { headers: {}, method: 'POST', url: '/api/foo', path: '/api/foo' };
    const res = makeRes();
    res.statusCode = 201;
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    const last = calls[calls.length - 1];
    expect(last.msg).toBe('request done');
    expect(last.obj).toMatchObject({
      method: 'POST',
      path: '/api/foo',
      statusCode: 201,
    });
    expect((last.obj as Record<string, number>).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('strip query string từ path log (tránh leak query token)', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: {},
      method: 'GET',
      url: '/api/login?token=secret-xyz',
      originalUrl: '/api/login?token=secret-xyz',
      path: '/api/login',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    const last = calls[calls.length - 1];
    expect((last.obj as Record<string, string>).path).toBe('/api/login');
    expect(JSON.stringify(last.obj)).not.toContain('secret-xyz');
  });

  it('attach userId từ req.user.sub (JWT decoded)', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: {},
      method: 'GET',
      url: '/api/me',
      path: '/api/me',
      user: { sub: 'user-abc' },
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    const last = calls[calls.length - 1];
    expect((last.obj as Record<string, string>).userId).toBe('user-abc');
  });

  it('attach characterId nếu có req.characterId', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: {},
      method: 'GET',
      url: '/api/me',
      path: '/api/me',
      characterId: 'char-xyz',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    const last = calls[calls.length - 1];
    expect((last.obj as Record<string, string>).characterId).toBe('char-xyz');
  });

  it('SKIP log path /api/healthz', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: {},
      method: 'GET',
      url: '/api/healthz',
      path: '/api/healthz',
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    expect(calls.find((c) => c.msg === 'request done')).toBeUndefined();
  });
});

describe('requestLogger — never throws', () => {
  it('next() called even nếu req không có method/url', () => {
    const { logger } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = { headers: {} };
    const res = makeRes();
    const next = vi.fn();
    expect(() => mw(req as never, res as never, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });

  it('không throw khi userId quá dài (skip attach)', () => {
    const { logger, calls } = makeMockLogger();
    const mw = createRequestLoggerMiddleware({ logger: logger as never });
    const req: MockReq = {
      headers: {},
      method: 'GET',
      url: '/api/x',
      path: '/api/x',
      user: { sub: 'a'.repeat(500) },
    };
    const res = makeRes();
    mw(req as never, res as never, vi.fn());
    res.triggerFinish();
    const last = calls[calls.length - 1];
    expect((last.obj as Record<string, unknown>).userId).toBeUndefined();
  });
});
