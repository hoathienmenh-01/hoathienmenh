/**
 * Phase 17.3 — logger redact + level smoke test.
 *
 * Cover:
 * - Redact paths áp dụng đúng cho các secret-ish fields.
 * - LOG_LEVEL từ env override default.
 * - resetLogger() cho phép re-init với env mới.
 * - childLogger() inherit redact policy.
 *
 * Approach: capture Pino output qua custom destination (Buffer-like
 * stream). Pino's `pino()` chấp nhận stream làm second arg; nhưng vì
 * `getLogger()` không expose stream, dùng `pino()` trực tiếp với cùng
 * options để verify behavior, plus small smoke trên singleton.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildLoggerOptions, REDACT_PATHS, getLogger, resetLogger, childLogger } from './logger';

describe('logger — redact paths cover canonical secret fields', () => {
  it('REDACT_PATHS bao gồm authorization/cookie/password/token/refreshToken/accessToken/apiKey/secret', () => {
    const expected = [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.secret',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'secret',
    ];
    for (const p of expected) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
});

describe('logger — output redaction', () => {
  let chunks: string[];

  function makeStream() {
    chunks = [];
    return {
      write(s: string) {
        chunks.push(s);
      },
    };
  }

  /** Force level=trace để mọi log được emit khi test (NODE_ENV=test default warn). */
  function debugLogger(stream: { write: (s: string) => void }) {
    return pino({ ...buildLoggerOptions(), level: 'trace' }, stream);
  }

  it('redact authorization header trong req object', () => {
    const stream = makeStream();
    const log = debugLogger(stream);
    log.warn({ req: { headers: { authorization: 'Bearer secret-token-xyz' } } }, 'req');
    const output = chunks.join('');
    expect(output).not.toContain('secret-token-xyz');
    expect(output).toContain('[REDACTED]');
  });

  it('redact password field bất kể level lồng (1-level deep)', () => {
    const stream = makeStream();
    const log = debugLogger(stream);
    log.warn({ user: { password: 'super-secret-pass' } }, 'login attempt');
    const output = chunks.join('');
    expect(output).not.toContain('super-secret-pass');
    expect(output).toContain('[REDACTED]');
  });

  it('redact accessToken/refreshToken trong response body', () => {
    const stream = makeStream();
    const log = debugLogger(stream);
    log.warn(
      {
        response: {
          accessToken: 'AAA-very-secret',
          refreshToken: 'RRR-very-secret',
        },
      },
      'auth',
    );
    const output = chunks.join('');
    expect(output).not.toContain('AAA-very-secret');
    expect(output).not.toContain('RRR-very-secret');
  });

  it('redact top-level password directly', () => {
    const stream = makeStream();
    const log = debugLogger(stream);
    log.warn({ password: 'top-level-pass' }, 'top');
    const output = chunks.join('');
    expect(output).not.toContain('top-level-pass');
  });

  it('non-secret data PASS-THROUGH (KHÔNG nhầm redact dữ liệu thường)', () => {
    const stream = makeStream();
    const log = debugLogger(stream);
    log.warn({ requestId: 'req-abc-123', userId: 'user-456', durationMs: 42 }, 'ok');
    const output = chunks.join('');
    expect(output).toContain('req-abc-123');
    expect(output).toContain('user-456');
    expect(output).toContain('"durationMs":42');
  });
});

describe('logger — getLogger singleton + reset', () => {
  beforeEach(() => {
    resetLogger();
  });

  afterEach(() => {
    resetLogger();
  });

  it('getLogger() trả cùng instance khi gọi 2 lần', () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });

  it('resetLogger() force re-init', () => {
    const a = getLogger();
    resetLogger();
    const b = getLogger();
    expect(a).not.toBe(b);
  });

  it('childLogger() inherit redact + thêm bindings', () => {
    const child = childLogger({ requestId: 'r-1' });
    // Smoke — chỉ kiểm tra child trả về object có method log.
    expect(typeof child.info).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  it('logger không throw khi gặp circular reference (Pino tự handle)', () => {
    const log = getLogger();
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => log.info(obj, 'circular')).not.toThrow();
  });
});

describe('logger — LOG_LEVEL env', () => {
  let originalLevel: string | undefined;

  beforeEach(() => {
    originalLevel = process.env.LOG_LEVEL;
    resetLogger();
  });

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    resetLogger();
  });

  it('LOG_LEVEL=warn → buildLoggerOptions level=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    const opts = buildLoggerOptions();
    expect(opts.level).toBe('warn');
  });

  it('LOG_LEVEL=trace → level=trace', () => {
    process.env.LOG_LEVEL = 'trace';
    const opts = buildLoggerOptions();
    expect(opts.level).toBe('trace');
  });
});

describe('logger — smoke (chấp nhận mọi shape, không throw)', () => {
  beforeEach(() => resetLogger());

  it('log.info nhận string only', () => {
    const log = getLogger();
    expect(() => log.info('plain string message')).not.toThrow();
  });

  it('log.error nhận Error instance + msg', () => {
    const log = getLogger();
    const err = new Error('boom');
    expect(() => log.error({ err }, 'handler error')).not.toThrow();
  });

  it('log.warn nhận object KHÔNG có msg key — vẫn ok', () => {
    const log = getLogger();
    expect(() => log.warn({ foo: 'bar' })).not.toThrow();
  });

  // Suppress noisy stderr nếu chạy với LOG_LEVEL thấp
  it('không throw khi log empty object', () => {
    const log = getLogger();
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(() => log.info({})).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
