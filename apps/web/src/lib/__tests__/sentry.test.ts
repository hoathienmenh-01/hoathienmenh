/**
 * Phase 17.3 — FE Sentry wrapper test.
 *
 * Cover:
 * - Disabled mặc định (no DSN) → init() trả false, captureException no-op.
 * - readSentryWebConfig() parse env đúng (boolean/rate clamp).
 * - Idempotent init.
 * - captureException không throw nếu Sentry SDK throw.
 *
 * Mock @sentry/vue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const captureExceptionMock = vi.fn();
const browserTracingIntegrationMock = vi.fn((..._args: unknown[]) => ({ name: 'BrowserTracing' }));
const withScopeMock = vi.fn((cb: (scope: unknown) => void) => {
  cb({
    setExtra: vi.fn(),
    setTag: vi.fn(),
    setUser: vi.fn(),
  });
});

vi.mock('@sentry/vue', () => ({
  init: (...a: unknown[]) => initMock(...a),
  captureException: (...a: unknown[]) => captureExceptionMock(...a),
  browserTracingIntegration: (...a: unknown[]) => browserTracingIntegrationMock(...a),
  withScope: (cb: (scope: unknown) => void) => withScopeMock(cb),
}));

import {
  initSentryWeb,
  isSentryWebEnabled,
  captureException,
  readSentryWebConfig,
  __resetSentryWeb,
} from '../sentry';

beforeEach(() => {
  __resetSentryWeb();
  initMock.mockReset();
  captureExceptionMock.mockReset();
  withScopeMock.mockClear();
});

afterEach(() => {
  __resetSentryWeb();
});

describe('readSentryWebConfig — env parsing', () => {
  it('default disabled khi env empty', () => {
    const cfg = readSentryWebConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.dsn).toBe('');
  });

  it('VITE_SENTRY_ENABLED=true nhưng DSN trống → disabled', () => {
    const cfg = readSentryWebConfig({ VITE_SENTRY_ENABLED: 'true' });
    expect(cfg.enabled).toBe(false);
  });

  it('DSN + VITE_SENTRY_ENABLED=true → enabled=true', () => {
    const cfg = readSentryWebConfig({
      VITE_SENTRY_DSN_WEB: 'https://abc@sentry.io/2',
      VITE_SENTRY_ENABLED: 'true',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.dsn).toBe('https://abc@sentry.io/2');
  });

  it('VITE_SENTRY_TRACES_SAMPLE_RATE clamp [0..1]', () => {
    expect(readSentryWebConfig({ VITE_SENTRY_TRACES_SAMPLE_RATE: '0.3' }).tracesSampleRate).toBe(0.3);
    expect(readSentryWebConfig({ VITE_SENTRY_TRACES_SAMPLE_RATE: '5' }).tracesSampleRate).toBe(1);
    expect(readSentryWebConfig({ VITE_SENTRY_TRACES_SAMPLE_RATE: '-1' }).tracesSampleRate).toBe(0);
    expect(readSentryWebConfig({ VITE_SENTRY_TRACES_SAMPLE_RATE: 'abc' }).tracesSampleRate).toBe(0);
  });

  it('VITE_SENTRY_ENVIRONMENT default về MODE rồi development', () => {
    expect(readSentryWebConfig({ MODE: 'staging' }).environment).toBe('staging');
    expect(readSentryWebConfig({}).environment).toBe('development');
    expect(readSentryWebConfig({ VITE_SENTRY_ENVIRONMENT: 'production' }).environment).toBe(
      'production',
    );
  });
});

describe('initSentryWeb — disabled paths', () => {
  it('disabled khi env empty → KHÔNG gọi Sentry.init', () => {
    const ok = initSentryWeb(undefined, undefined, readSentryWebConfig({}));
    expect(ok).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryWebEnabled()).toBe(false);
  });

  it('idempotent: gọi 2 lần KHÔNG re-init', () => {
    initSentryWeb(undefined, undefined, readSentryWebConfig({}));
    initSentryWeb(undefined, undefined, readSentryWebConfig({}));
    expect(initMock).not.toHaveBeenCalled();
  });
});

describe('initSentryWeb — enabled path', () => {
  it('enabled → gọi Sentry.init đúng args', () => {
    const cfg = {
      dsn: 'https://abc@sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0.05,
      enabled: true,
    };
    const ok = initSentryWeb(undefined, undefined, cfg);
    expect(ok).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: 'https://abc@sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    });
    expect(isSentryWebEnabled()).toBe(true);
  });

  it('SDK throw → app vẫn boot, isSentryWebEnabled=false', () => {
    initMock.mockImplementationOnce(() => {
      throw new Error('boom DSN');
    });
    const cfg = {
      dsn: 'https://abc@sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0,
      enabled: true,
    };
    const ok = initSentryWeb(undefined, undefined, cfg);
    expect(ok).toBe(false);
    expect(isSentryWebEnabled()).toBe(false);
  });
});

describe('captureException', () => {
  it('disabled → no-op', () => {
    captureException(new Error('boom'));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('enabled → forward đến Sentry SDK', () => {
    initSentryWeb(undefined, undefined, {
      dsn: 'https://abc@sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0,
      enabled: true,
    });
    captureException(new Error('boom'));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('không throw nếu SDK throw nội bộ', () => {
    initSentryWeb(undefined, undefined, {
      dsn: 'https://abc@sentry.io/2',
      environment: 'staging',
      tracesSampleRate: 0,
      enabled: true,
    });
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('SDK panic');
    });
    expect(() => captureException(new Error('boom'))).not.toThrow();
  });
});
