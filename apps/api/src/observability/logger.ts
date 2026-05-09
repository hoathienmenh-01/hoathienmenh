/**
 * Phase 17.3 — Pino structured logger với redact policy.
 *
 * Singleton Pino instance dùng cho toàn API. Redact paths dưới đây là
 * **case-sensitive** + **wildcard via pino built-in syntax** (`*.headers.cookie`,
 * `req.headers.authorization`...). Pino redact KHÔNG đệ quy theo key name —
 * phải liệt kê path tường minh để trace JSON payload không lộ secret.
 *
 * Usage: `getLogger().info({ requestId }, 'msg')`. Nest sẽ dùng adapter
 * `nest-logger.adapter.ts` để route Logger calls qua Pino.
 */
import pino from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';

/**
 * Path redact list. Bất cứ field nào match → bị thay bằng `[REDACTED]`.
 *
 * Lưu ý: pino redact match exact path. Để cover nested object phải
 * liệt kê cả `req.headers.authorization` và `res.headers["set-cookie"]`.
 * Wildcard `*.<field>` cover 1 cấp lồng — đủ cho hầu hết case.
 */
export const REDACT_PATHS = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',

  // Body / query / params common secret keys (1-level deep wildcard)
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.refresh_token',
  '*.access_token',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.session',
  '*.creditCard',
  '*.cardNumber',
  '*.cvv',

  // Direct top-level paths
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
];

/**
 * Build Pino options. Tùy environment:
 * - production / NODE_ENV=production: JSON output (1 line/log) cho log
 *   aggregator (Loki, Datadog, CloudWatch). KHÔNG pretty-print.
 * - dev / test: nếu repo có `pino-pretty` cài thì dùng (giữ readability),
 *   nếu không có → JSON cũng OK.
 *
 * `LOG_LEVEL` env: `trace|debug|info|warn|error|fatal`. Default `info`
 * (production), `debug` (development), `warn` (test).
 */
export function buildLoggerOptions(): LoggerOptions {
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const defaultLevel =
    env === 'production' ? 'info' : env === 'test' ? 'warn' : 'debug';
  const level = (process.env.LOG_LEVEL ?? defaultLevel).toLowerCase();

  return {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
      remove: false,
    },
    base: {
      service: 'xuantoi-api',
      env,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

let cached: PinoLogger | null = null;

/**
 * Singleton Pino logger. Lazy init để testing có thể `resetLogger()` rồi
 * set env mới (LOG_LEVEL, NODE_ENV) trước khi gọi lại.
 */
export function getLogger(): PinoLogger {
  if (!cached) {
    cached = pino(buildLoggerOptions());
  }
  return cached;
}

/** Reset singleton — chỉ dùng trong test. */
export function resetLogger(): void {
  cached = null;
}

/**
 * Tạo child logger gắn context (vd: `{ requestId, userId, characterId }`).
 * Nếu underlying logger chưa init, init trước.
 */
export function childLogger(
  bindings: Record<string, unknown>,
): PinoLogger {
  return getLogger().child(bindings);
}
