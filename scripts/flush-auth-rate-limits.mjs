#!/usr/bin/env node
// QA-003 helper — flush all auth rate-limit Redis keys so smoke / E2E suites
// can run > 5 register/IP/15min without hitting 429 RATE_LIMITED.
//
// Mirrors RATE_LIMIT_PATTERNS in apps/web/e2e/helpers.ts. Keep both lists in
// sync if new auth policy added (e.g. AUTH_VERIFY_EMAIL).
//
// Usage:
//   pnpm smoke:flush-rate-limits
//   REDIS_URL=redis://prod:6379 node scripts/flush-auth-rate-limits.mjs
//
// Exit codes:
//   0 — flushed (or Redis unreachable best-effort warn).
//   2 — Redis returned error during DEL/SCAN.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RATE_LIMIT_PATTERNS = [
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

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const apiPkg = path.resolve(__dirname, '../apps/api/package.json');
const requireFromApi = createRequire(apiPkg);
const RedisMod = requireFromApi('ioredis');
const Redis = RedisMod.default ?? RedisMod;

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

try {
  await redis.connect();
} catch (err) {
  console.warn(
    `[smoke:flush-rate-limits] Redis ${redisUrl} unreachable (${err.message}). ` +
      `Skipping flush — > 5 register/IP/15min sẽ fail 429.`,
  );
  redis.disconnect();
  process.exit(0);
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
      console.log(
        `[smoke:flush-rate-limits] ${pattern}: ${perPatternDeleted} keys deleted`,
      );
    }
    totalDeleted += perPatternDeleted;
  }
  console.log(
    `[smoke:flush-rate-limits] done. Total: ${totalDeleted} keys deleted across ${RATE_LIMIT_PATTERNS.length} patterns.`,
  );
} catch (err) {
  console.error(`[smoke:flush-rate-limits] ERROR: ${err.message}`);
  await redis.quit().catch(() => undefined);
  process.exit(2);
} finally {
  await redis.quit().catch(() => undefined);
}
