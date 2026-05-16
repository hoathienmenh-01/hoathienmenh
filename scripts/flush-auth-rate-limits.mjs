#!/usr/bin/env node
// QA-003 helper — flush all auth rate-limit Redis keys so smoke / E2E suites
// can run > 5 register/IP/15min without hitting 429 RATE_LIMITED.
//
// Mirrors RATE_LIMIT_PATTERNS in apps/web/e2e/helpers.ts. Keep both lists in
// sync if new auth policy added (e.g. AUTH_VERIFY_EMAIL).
//
// Usage (CLI):
//   pnpm smoke:flush-rate-limits
//   REDIS_URL=redis://prod:6379 node scripts/flush-auth-rate-limits.mjs
//
// Usage (programmatic — imported by smoke-auth.mjs + smoke-all.mjs):
//   import { flushAuthRateLimits } from './flush-auth-rate-limits.mjs';
//   await flushAuthRateLimits();   // no-op when NODE_ENV === 'production'
//
// Exit codes (CLI mode):
//   0 — flushed (or Redis unreachable best-effort warn / production skip).
//   2 — Redis returned error during DEL/SCAN.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RATE_LIMIT_PATTERNS = [
  // Legacy AuthModule per-route limiters (kept for backwards compat).
  'rl:register:*',
  'rl:login:*',
  'rl:forgot-password:*',
  // Unified `@RateLimitPolicy(...)` keys (Phase 15.x+ security guard) —
  // canonical Redis prefix is `ratelimit:{policy}:{scope}:{subject}`,
  // see `buildRateLimitKey()` in `packages/shared/src/security-rate-limit.ts`.
  'ratelimit:AUTH_REGISTER:*',
  'ratelimit:AUTH_LOGIN:*',
  'ratelimit:AUTH_REFRESH:*',
  'ratelimit:AUTH_PASSWORD_RESET:*',
];

/**
 * QA-003 — flush AUTH_* rate-limit Redis keys. No-op in production.
 *
 * Smoke + E2E suites call this at the start so multiple register/login
 * attempts per process don't hit the unified rate-limit guard (defaults:
 * 5/IP/15m register, 3/IP/15m forgot-password).
 *
 * Production NEVER calls this. We hard-guard on `NODE_ENV === 'production'`
 * to prevent accidentally nuking real player rate-limit state.
 *
 * Behavior:
 *   - production env → log + return (NO Redis contact).
 *   - Redis unreachable → log warn + return (best-effort, smoke continues).
 *   - SCAN/DEL throw → caller catches via try/finally on Redis quit.
 *
 * The caller may inject `redisFactory` for testing without touching real
 * Redis. Default uses ioredis from apps/api.
 *
 * @param {{
 *   redisUrl?: string;
 *   env?: NodeJS.ProcessEnv;
 *   logger?: Pick<Console, 'log' | 'warn' | 'error'>;
 *   redisFactory?: (url: string) => any;
 * }} [opts]
 * @returns {Promise<{ skipped: boolean; reason?: string; totalDeleted: number }>}
 */
export async function flushAuthRateLimits(opts = {}) {
  const env = opts.env ?? process.env;
  const logger = opts.logger ?? console;
  if (env.NODE_ENV === 'production') {
    logger.log(
      '[smoke:flush-rate-limits] NODE_ENV=production — refuse to flush real rate-limit keys.',
    );
    return { skipped: true, reason: 'production', totalDeleted: 0 };
  }

  const redisUrl = opts.redisUrl ?? env.REDIS_URL ?? 'redis://localhost:6379';

  const factory =
    opts.redisFactory ??
    ((url) => {
      const apiPkg = path.resolve(__dirname, '../apps/api/package.json');
      const requireFromApi = createRequire(apiPkg);
      const RedisMod = requireFromApi('ioredis');
      const Redis = RedisMod.default ?? RedisMod;
      return new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    });

  const redis = factory(redisUrl);

  try {
    await redis.connect();
  } catch (err) {
    logger.warn(
      `[smoke:flush-rate-limits] Redis ${redisUrl} unreachable (${err instanceof Error ? err.message : String(err)}). ` +
        `Skipping flush — > 5 register/IP/15min sẽ fail 429.`,
    );
    redis.disconnect?.();
    return { skipped: true, reason: 'redis-unreachable', totalDeleted: 0 };
  }

  let totalDeleted = 0;
  try {
    for (const pattern of RATE_LIMIT_PATTERNS) {
      let cursor = '0';
      let perPatternDeleted = 0;
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200,
        );
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
          perPatternDeleted += keys.length;
        }
      } while (cursor !== '0');
      if (perPatternDeleted > 0) {
        logger.log(
          `[smoke:flush-rate-limits] ${pattern}: ${perPatternDeleted} keys deleted`,
        );
      }
      totalDeleted += perPatternDeleted;
    }
    logger.log(
      `[smoke] flushed AUTH_REGISTER rate limits — total ${totalDeleted} keys across ${RATE_LIMIT_PATTERNS.length} patterns.`,
    );
  } finally {
    await redis.quit().catch(() => undefined);
  }
  return { skipped: false, totalDeleted };
}

// CLI entry point. Only runs when invoked directly (`node scripts/...mjs`),
// NOT when imported by smoke-auth.mjs / smoke-all.mjs.
const isDirectCli = (() => {
  try {
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return invoked === __filename;
  } catch {
    return false;
  }
})();

if (isDirectCli) {
  try {
    await flushAuthRateLimits();
    process.exit(0);
  } catch (err) {
    console.error(
      `[smoke:flush-rate-limits] ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}
