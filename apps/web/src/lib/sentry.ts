/**
 * Phase 17.3 — Sentry wrapper cho Vue 3 frontend.
 *
 * Thiết kế tương tự backend (`apps/api/src/observability/sentry.ts`):
 * - Disabled khi `VITE_SENTRY_DSN_WEB` trống hoặc `VITE_SENTRY_ENABLED=false`.
 * - `init(app)` no-op nếu disabled — KHÔNG throw.
 * - `captureException()` no-op nếu disabled.
 * - Default ở local/dev: disabled (không cần DSN thật để dev).
 *
 * KHÔNG capture:
 * - Body request (axios interceptor không log).
 * - Cookies / localStorage tokens.
 * - PII fields (email/password/phone).
 *
 * `sendDefaultPii: false` mặc định ở Sentry SDK — tự động strip IP/cookie.
 */
import * as Sentry from '@sentry/vue';
import type { App } from 'vue';
import type { Router } from 'vue-router';

export interface SentryWebConfig {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  enabled: boolean;
  release?: string;
}

let enabledFlag = false;
let initializedFlag = false;

/**
 * Đọc Vite env. KHÔNG init.
 */
export function readSentryWebConfig(env?: Record<string, unknown>): SentryWebConfig {
  // Trong test, env có thể inject. Production lấy import.meta.env.
  const e: Record<string, unknown> =
    env ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, unknown>)
      : {});

  const dsn = typeof e.VITE_SENTRY_DSN_WEB === 'string' ? e.VITE_SENTRY_DSN_WEB.trim() : '';
  const environment =
    (typeof e.VITE_SENTRY_ENVIRONMENT === 'string' && e.VITE_SENTRY_ENVIRONMENT) ||
    (typeof e.MODE === 'string' && e.MODE) ||
    'development';
  const enabled = parseBool(e.VITE_SENTRY_ENABLED, false) && dsn.length > 0;
  const tracesSampleRate = clampRate(e.VITE_SENTRY_TRACES_SAMPLE_RATE, 0);
  const release =
    typeof e.VITE_SENTRY_RELEASE === 'string' && e.VITE_SENTRY_RELEASE.trim().length > 0
      ? e.VITE_SENTRY_RELEASE.trim()
      : undefined;

  return { dsn, environment, tracesSampleRate, enabled, release };
}

/**
 * Init Sentry Vue NẾU enabled. No-op nếu disabled.
 *
 * `app` & `router` optional — nếu thiếu, `attachProps`/router integration
 * tắt (vẫn capture exceptions toàn cục qua window.onerror).
 *
 * Idempotent: gọi 2 lần không double-init.
 */
export function initSentryWeb(
  app?: App,
  router?: Router,
  cfg: SentryWebConfig = readSentryWebConfig(),
): boolean {
  if (initializedFlag) return enabledFlag;
  initializedFlag = true;

  if (!cfg.enabled || !cfg.dsn) {
    enabledFlag = false;
    // Dùng console.info — chưa có FE logger structured (để open scope).
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[sentry/web] disabled', cfg.dsn ? '(VITE_SENTRY_ENABLED=false)' : '(no DSN)');
    }
    return false;
  }

  try {
    Sentry.init({
      app,
      dsn: cfg.dsn,
      environment: cfg.environment,
      tracesSampleRate: cfg.tracesSampleRate,
      ...(cfg.release ? { release: cfg.release } : {}),
      // Tắt PII send mặc định (IP/cookie/header).
      sendDefaultPii: false,
      ...(router ? { integrations: [Sentry.browserTracingIntegration({ router })] } : {}),
    });
    enabledFlag = true;
    return true;
  } catch (err) {
    enabledFlag = false;
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[sentry/web] init failed — continuing without error tracking', err);
    }
    return false;
  }
}

export function isSentryWebEnabled(): boolean {
  return enabledFlag;
}

export function captureException(err: unknown, extras?: Record<string, unknown>): void {
  if (!enabledFlag) return;
  try {
    if (extras) {
      Sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(extras)) {
          scope.setExtra(k, v);
        }
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // Swallow — Sentry không bao giờ block app.
  }
}

/** Reset module state — chỉ dùng trong test. */
export function __resetSentryWeb(): void {
  enabledFlag = false;
  initializedFlag = false;
}

function parseBool(v: unknown, defaultVal: boolean): boolean {
  if (typeof v !== 'string') return defaultVal;
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off', ''].includes(s)) return false;
  return defaultVal;
}

function clampRate(v: unknown, defaultVal: number): number {
  if (typeof v !== 'string') return defaultVal;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return defaultVal;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
