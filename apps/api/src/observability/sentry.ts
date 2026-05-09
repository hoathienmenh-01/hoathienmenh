/**
 * Phase 17.3 — Sentry wrapper cho NestJS API.
 *
 * Thiết kế "fail-closed by default":
 * - Sentry CHỈ active khi `SENTRY_ENABLED=true` (truthy) AND `SENTRY_DSN_API`
 *   non-empty.
 * - Default ở local/test: disabled. `init()` no-op, `capture*()` no-op.
 * - Không bao giờ throw — Sentry init lỗi sẽ log warn nhưng app vẫn boot.
 *
 * Wrap qua module-level state `enabled` để test có thể `__resetSentry()`.
 */
import * as Sentry from '@sentry/node';
import { getLogger } from './logger';

export interface SentryConfig {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  enabled: boolean;
  /** Release tag (vd: git sha). Optional. */
  release?: string;
}

let enabledFlag = false;
let initializedFlag = false;

/**
 * Đọc env và build SentryConfig. KHÔNG init.
 */
export function readSentryConfig(): SentryConfig {
  const dsn = (process.env.SENTRY_DSN_API ?? '').trim();
  const environment = (process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development').trim();
  const enabled =
    parseBool(process.env.SENTRY_ENABLED, false) && dsn.length > 0;
  const tracesSampleRate = clampRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    0,
  );
  const release =
    typeof process.env.SENTRY_RELEASE === 'string' &&
    process.env.SENTRY_RELEASE.trim().length > 0
      ? process.env.SENTRY_RELEASE.trim()
      : undefined;

  return { dsn, environment, tracesSampleRate, enabled, release };
}

/**
 * Init Sentry SDK NẾU enabled. No-op nếu disabled hoặc DSN empty.
 *
 * Idempotent: gọi lại không double-init. Nếu init lỗi (vd DSN malformed),
 * log warn KHÔNG throw — app phải boot bình thường ngay cả khi Sentry hỏng.
 */
export function initSentry(cfg: SentryConfig = readSentryConfig()): boolean {
  if (initializedFlag) return enabledFlag;
  initializedFlag = true;

  if (!cfg.enabled || !cfg.dsn) {
    enabledFlag = false;
    getLogger().info(
      { sentryEnabled: false, reason: cfg.dsn ? 'SENTRY_ENABLED=false' : 'SENTRY_DSN_API empty' },
      'Sentry disabled',
    );
    return false;
  }

  try {
    Sentry.init({
      dsn: cfg.dsn,
      environment: cfg.environment,
      tracesSampleRate: cfg.tracesSampleRate,
      ...(cfg.release ? { release: cfg.release } : {}),
      // Disable default body capturing — body có thể chứa password/token.
      // App tự chọn what to send qua `captureException` với context an toàn.
      sendDefaultPii: false,
    });
    enabledFlag = true;
    getLogger().info(
      {
        sentryEnabled: true,
        environment: cfg.environment,
        tracesSampleRate: cfg.tracesSampleRate,
      },
      'Sentry initialized',
    );
    return true;
  } catch (err) {
    enabledFlag = false;
    getLogger().warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Sentry init failed — continuing without error tracking',
    );
    return false;
  }
}

export function isSentryEnabled(): boolean {
  return enabledFlag;
}

/**
 * Capture exception nếu Sentry enabled. No-op nếu disabled.
 * KHÔNG throw — bọc try/catch defensive.
 */
export function captureException(
  err: unknown,
  context?: { requestId?: string; userId?: string; tags?: Record<string, string> },
): void {
  if (!enabledFlag) return;
  try {
    Sentry.withScope((scope) => {
      if (context?.requestId) scope.setTag('requestId', context.requestId);
      if (context?.userId) scope.setUser({ id: context.userId });
      if (context?.tags) {
        for (const [k, v] of Object.entries(context.tags)) {
          scope.setTag(k, v);
        }
      }
      Sentry.captureException(err);
    });
  } catch (innerErr) {
    getLogger().warn(
      { err: innerErr instanceof Error ? innerErr.message : String(innerErr) },
      'Sentry captureException failed',
    );
  }
}

/**
 * Capture message (warn/info level event). No-op nếu disabled.
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
): void {
  if (!enabledFlag) return;
  try {
    Sentry.captureMessage(message, level);
  } catch (innerErr) {
    getLogger().warn(
      { err: innerErr instanceof Error ? innerErr.message : String(innerErr) },
      'Sentry captureMessage failed',
    );
  }
}

/** Reset module state — chỉ dùng trong test. */
export function __resetSentry(): void {
  enabledFlag = false;
  initializedFlag = false;
}

function parseBool(v: string | undefined, defaultVal: boolean): boolean {
  if (v === undefined) return defaultVal;
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off', ''].includes(s)) return false;
  return defaultVal;
}

function clampRate(v: string | undefined, defaultVal: number): number {
  if (v === undefined) return defaultVal;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return defaultVal;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
