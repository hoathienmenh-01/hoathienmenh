#!/usr/bin/env node
// QA-003 helper — flush ALL rate-limit Redis keys so smoke / E2E suites
// can run multiple scripts back-to-back without hitting 429 RATE_LIMITED.
//
// This is a more general version of flush-auth-rate-limits.mjs that flushes
// ALL rate-limit patterns (auth, shop, profile, etc.) to prevent cumulative
// rate-limit errors when running multiple smoke scripts sequentially.
//
// Usage (CLI):
//   pnpm smoke:flush-rate-limits
//   REDIS_URL=redis://prod:6379 node scripts/smoke-flush-rate-limits.mjs
//
// Exit codes (CLI mode):
//   0 — flushed (or Redis unreachable best-effort warn / production skip).
//   2 — Redis returned error during DEL/SCAN.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// All rate-limit key patterns used across the app.
// Covers both legacy `rl:*` and unified `ratelimit:*` patterns.
export const ALL_RATE_LIMIT_PATTERNS = [
  // Legacy per-route limiters
  'rl:*',
  // Unified @RateLimitPolicy(...) keys (Phase 15.x+ security guard)
  'ratelimit:*',
];

/**
 * QA-003 — flush ALL rate-limit Redis keys. No-op in production.
 *
 * Smoke + E2E suites call this at the start so multiple API calls
 * across different smoke scripts don't hit cumulative rate-limits.
 *
 * Production NEVER calls this. We hard-guard on `NODE_ENV === 'production'`
 * to prevent accidentally nuking real player rate-limit state.
 *
 * Behavior:
 *   - production env → log + return (NO Redis contact).
 *   - Redis unreachable → log warn + return (best-effort, smoke continues).
 *   - SCAN/DEL throw → caller catches via try/finally on Redis quit.
 *
 * @param {{
 *   redisUrl?: string;
 *   env?: NodeJS.ProcessEnv;
 *   logger?: Pick<Console, 'log' | 'warn' | 'error'>;
 *   redisFactory?: (url: string) => any;
 * }} [opts]
 * @returns {Promise<{ skipped: boolean; reason?: string; totalDeleted: number }>}
 */
export async function flushAllRateLimits(opts = {}) {
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
        `Skipping flush — rate-limit errors may occur.`,
    );
    redis.disconnect?.();
    return { skipped: true, reason: 'redis-unreachable', totalDeleted: 0 };
  }

  let totalDeleted = 0;
  try {
    for (const pattern of ALL_RATE_LIMIT_PATTERNS) {
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
      `[smoke:flush-rate-limits] Flushed all rate-limit keys — total ${totalDeleted} keys across ${ALL_RATE_LIMIT_PATTERNS.length} patterns.`,
    );
  } finally {
    await redis.quit().catch(() => undefined);
  }
  return { skipped: false, totalDeleted };
}

// CLI entry point. Only runs when invoked directly (`node scripts/...mjs`),
// NOT when imported by other scripts.
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
    await flushAllRateLimits();
    process.exit(0);
  } catch (err) {
    console.error(
      `[smoke:flush-rate-limits] ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}
