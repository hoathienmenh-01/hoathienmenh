/**
 * QA-003 — unit tests cho `scripts/flush-auth-rate-limits.mjs`.
 *
 * Invariants được verify:
 *   1. `pnpm smoke:flush-rate-limits` package script tồn tại trong root
 *      `package.json` (smoke runners / E2E gọi command này).
 *   2. `scripts/flush-auth-rate-limits.mjs` exists + export `flushAuthRateLimits`
 *      + `RATE_LIMIT_PATTERNS` (consistency với `apps/web/e2e/helpers.ts`).
 *   3. `flushAuthRateLimits()` NO-OP khi `NODE_ENV='production'` — KHÔNG
 *      gọi Redis (mock factory không bị invoked). Production never wipes
 *      real auth rate-limit state.
 *   4. `flushAuthRateLimits()` ở non-production env → gọi `redis.connect()`
 *      + scan/del cho mỗi pattern + emit canonical log
 *      `[smoke] flushed AUTH_REGISTER rate limits` (smoke-auth/smoke-all
 *      grep được).
 *   5. Redis unreachable → log warn + return `{ skipped: true, reason:
 *      'redis-unreachable' }` (KHÔNG throw — smoke vẫn tiếp tục).
 *   6. `scripts/smoke-auth.mjs` import + invoke `flushAuthRateLimits` ở
 *      `main()` (regression — đã wire vào trước flow register).
 *   7. `scripts/smoke-all.mjs` import `flushAuthRateLimits` (sẵn sàng để
 *      gọi trong tương lai khi aggregator cần).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const FLUSH_SCRIPT = resolve(REPO_ROOT, 'scripts', 'flush-auth-rate-limits.mjs');
const SMOKE_AUTH = resolve(REPO_ROOT, 'scripts', 'smoke-auth.mjs');
const SMOKE_ALL = resolve(REPO_ROOT, 'scripts', 'smoke-all.mjs');
const ROOT_PKG = resolve(REPO_ROOT, 'package.json');

interface FlushModule {
  flushAuthRateLimits: (opts?: {
    redisUrl?: string;
    env?: NodeJS.ProcessEnv;
    logger?: { log: (m: string) => void; warn: (m: string) => void; error?: (m: string) => void };
    redisFactory?: (url: string) => unknown;
  }) => Promise<{ skipped: boolean; reason?: string; totalDeleted: number }>;
  RATE_LIMIT_PATTERNS: readonly string[];
}

async function loadFlushModule(): Promise<FlushModule> {
  // Dynamic import from absolute file URL so vitest resolves .mjs at runtime
  // without bundling. URL form is required for cross-platform.
  return (await import(`file://${FLUSH_SCRIPT}`)) as FlushModule;
}

describe('QA-003 — flush-auth-rate-limits.mjs invariants', () => {
  it('package.json root has `smoke:flush-rate-limits` script', () => {
    const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['smoke:flush-rate-limits']).toBe(
      'node scripts/flush-auth-rate-limits.mjs',
    );
  });

  it('scripts/flush-auth-rate-limits.mjs exists', () => {
    expect(existsSync(FLUSH_SCRIPT)).toBe(true);
  });

  it('module exports `flushAuthRateLimits` + `RATE_LIMIT_PATTERNS`', async () => {
    const mod = await loadFlushModule();
    expect(typeof mod.flushAuthRateLimits).toBe('function');
    expect(Array.isArray(mod.RATE_LIMIT_PATTERNS)).toBe(true);
    // Sanity — must include the canonical unified AUTH_REGISTER prefix.
    expect(mod.RATE_LIMIT_PATTERNS).toContain('ratelimit:AUTH_REGISTER:*');
    expect(mod.RATE_LIMIT_PATTERNS).toContain('ratelimit:AUTH_LOGIN:*');
  });
});

describe('QA-003 — flushAuthRateLimits() behavior', () => {
  let logSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;
  let logger: { log: typeof logSpy; warn: typeof warnSpy; error: typeof errorSpy };

  beforeEach(() => {
    logSpy = vi.fn();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    logger = { log: logSpy, warn: warnSpy, error: errorSpy };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('production env → NO-OP, KHÔNG gọi redis factory', async () => {
    const { flushAuthRateLimits } = await loadFlushModule();
    const factory = vi.fn();

    const result = await flushAuthRateLimits({
      env: { NODE_ENV: 'production' },
      logger,
      redisFactory: factory,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('production');
    expect(result.totalDeleted).toBe(0);
    // Critical invariant — factory MUST NOT be called in production.
    expect(factory).not.toHaveBeenCalled();
    // Production log present.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('NODE_ENV=production'),
    );
  });

  it('non-production + Redis OK → scan + del all patterns + canonical log', async () => {
    const { flushAuthRateLimits, RATE_LIMIT_PATTERNS } = await loadFlushModule();

    // Mock Redis client. scan returns 5 keys for AUTH_REGISTER on first
    // pattern, 0 for the rest. We emulate cursor='0' (single-page) for all.
    const scanCalls: string[] = [];
    const delCalls: string[][] = [];
    const fakeRedis = {
      connect: vi.fn().mockResolvedValue(undefined),
      scan: vi.fn().mockImplementation(async (..._args: unknown[]) => {
        const pattern = _args[2] as string;
        scanCalls.push(pattern);
        if (pattern === 'ratelimit:AUTH_REGISTER:*') {
          return ['0', ['ratelimit:AUTH_REGISTER:ip:1.2.3.4', 'ratelimit:AUTH_REGISTER:ip:5.6.7.8']];
        }
        return ['0', []];
      }),
      del: vi.fn().mockImplementation(async (...keys: string[]) => {
        delCalls.push(keys);
        return keys.length;
      }),
      quit: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    const result = await flushAuthRateLimits({
      env: { NODE_ENV: 'test' },
      logger,
      redisFactory: () => fakeRedis,
    });

    expect(result.skipped).toBe(false);
    expect(result.totalDeleted).toBe(2);
    expect(fakeRedis.connect).toHaveBeenCalledTimes(1);
    // Every pattern got scanned at least once.
    expect(scanCalls).toEqual([...RATE_LIMIT_PATTERNS]);
    // Only the pattern with keys triggered a del.
    expect(delCalls).toEqual([
      ['ratelimit:AUTH_REGISTER:ip:1.2.3.4', 'ratelimit:AUTH_REGISTER:ip:5.6.7.8'],
    ]);
    expect(fakeRedis.quit).toHaveBeenCalledTimes(1);
    // Canonical log format that smoke runners grep for.
    expect(
      logSpy.mock.calls.some((args) =>
        String(args[0] ?? '').includes('[smoke] flushed AUTH_REGISTER rate limits'),
      ),
    ).toBe(true);
  });

  it('Redis unreachable → warn + skipped, KHÔNG throw', async () => {
    const { flushAuthRateLimits } = await loadFlushModule();
    const fakeRedis = {
      connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      scan: vi.fn(),
      del: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    const result = await flushAuthRateLimits({
      env: { NODE_ENV: 'test' },
      logger,
      redisFactory: () => fakeRedis,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('redis-unreachable');
    expect(result.totalDeleted).toBe(0);
    expect(fakeRedis.scan).not.toHaveBeenCalled();
    expect(fakeRedis.del).not.toHaveBeenCalled();
    expect(fakeRedis.disconnect).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unreachable'),
    );
  });
});

describe('QA-003 — smoke scripts wire flushAuthRateLimits()', () => {
  it('smoke-auth.mjs imports flushAuthRateLimits + calls it in main()', () => {
    const src = readFileSync(SMOKE_AUTH, 'utf-8');
    expect(src).toMatch(
      /import\s*\{\s*flushAuthRateLimits\s*\}\s*from\s*['"]\.\/flush-auth-rate-limits\.mjs['"]/,
    );
    // Must invoke before any /_auth/register http call.
    const flushIdx = src.indexOf('await flushAuthRateLimits()');
    const firstRegisterIdx = src.indexOf("/api/_auth/register");
    expect(flushIdx).toBeGreaterThan(-1);
    expect(firstRegisterIdx).toBeGreaterThan(-1);
    // Note: smoke-auth.mjs has the JSDoc comments referring to /_auth/register
    // at the top of the file, BEFORE the function. So we can't trivially
    // assert flushIdx < firstRegisterIdx using `indexOf` — instead, locate
    // the `async function main` block and check flush is the first thing.
    const mainIdx = src.indexOf('async function main(');
    expect(mainIdx).toBeGreaterThan(-1);
    // The first `await flushAuthRateLimits()` must occur INSIDE main() AFTER
    // the `async function main(` declaration, and before any `await http(`.
    const afterMain = src.slice(mainIdx);
    const localFlushIdx = afterMain.indexOf('await flushAuthRateLimits()');
    const localHttpIdx = afterMain.indexOf('await http(');
    expect(localFlushIdx).toBeGreaterThan(-1);
    expect(localHttpIdx).toBeGreaterThan(-1);
    expect(localFlushIdx).toBeLessThan(localHttpIdx);
  });

  it('smoke-all.mjs imports flushAuthRateLimits', () => {
    const src = readFileSync(SMOKE_ALL, 'utf-8');
    expect(src).toMatch(
      /import\s*\{\s*flushAuthRateLimits\s*\}\s*from\s*['"]\.\/flush-auth-rate-limits\.mjs['"]/,
    );
  });
});
