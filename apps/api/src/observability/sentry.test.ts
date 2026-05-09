/**
 * Phase 17.3 — Sentry wrapper test.
 *
 * Cover:
 * - Sentry disabled khi DSN trống / SENTRY_ENABLED=false → init() trả false, capture* no-op.
 * - readSentryConfig() parse env đúng (boolean/rate clamp).
 * - captureException không throw khi Sentry init lỗi (mock SDK throw).
 * - Idempotent init.
 *
 * Mock @sentry/node để không gọi network thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();
const withScopeMock = vi.fn((cb: (scope: unknown) => void) => {
  cb({
    setTag: vi.fn(),
    setUser: vi.fn(),
    setExtra: vi.fn(),
  });
});

vi.mock('@sentry/node', () => ({
  init: (...a: unknown[]) => initMock(...a),
  captureException: (...a: unknown[]) => captureExceptionMock(...a),
  captureMessage: (...a: unknown[]) => captureMessageMock(...a),
  withScope: (cb: (scope: unknown) => void) => withScopeMock(cb),
}));

import {
  initSentry,
  isSentryEnabled,
  captureException,
  captureMessage,
  readSentryConfig,
  __resetSentry,
} from './sentry';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  __resetSentry();
  initMock.mockReset();
  captureExceptionMock.mockReset();
  captureMessageMock.mockReset();
  withScopeMock.mockClear();
  // Clear all relevant env vars
  delete process.env.SENTRY_DSN_API;
  delete process.env.SENTRY_ENABLED;
  delete process.env.SENTRY_ENVIRONMENT;
  delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  delete process.env.SENTRY_RELEASE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('readSentryConfig — env parsing', () => {
  it('default disabled khi không có env', () => {
    const cfg = readSentryConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.dsn).toBe('');
    expect(cfg.tracesSampleRate).toBe(0);
  });

  it('SENTRY_ENABLED=true nhưng DSN trống → enabled=false (DSN bắt buộc)', () => {
    process.env.SENTRY_ENABLED = 'true';
    const cfg = readSentryConfig();
    expect(cfg.enabled).toBe(false);
  });

  it('DSN có nhưng SENTRY_ENABLED=false → disabled', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'false';
    const cfg = readSentryConfig();
    expect(cfg.enabled).toBe(false);
  });

  it('DSN + SENTRY_ENABLED=true → enabled=true', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'true';
    const cfg = readSentryConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.dsn).toBe('https://abc@sentry.io/1');
  });

  it('SENTRY_TRACES_SAMPLE_RATE clamp [0..1]', () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    expect(readSentryConfig().tracesSampleRate).toBe(0.25);

    process.env.SENTRY_TRACES_SAMPLE_RATE = '5';
    expect(readSentryConfig().tracesSampleRate).toBe(1);

    process.env.SENTRY_TRACES_SAMPLE_RATE = '-1';
    expect(readSentryConfig().tracesSampleRate).toBe(0);

    process.env.SENTRY_TRACES_SAMPLE_RATE = 'abc';
    expect(readSentryConfig().tracesSampleRate).toBe(0);
  });

  it('parseBool nhận on/off/yes/no/1/0', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    for (const v of ['on', 'yes', '1', 'TRUE']) {
      process.env.SENTRY_ENABLED = v;
      expect(readSentryConfig().enabled).toBe(true);
    }
    for (const v of ['off', 'no', '0', 'FALSE', '']) {
      process.env.SENTRY_ENABLED = v;
      expect(readSentryConfig().enabled).toBe(false);
    }
  });
});

describe('initSentry — disabled paths', () => {
  it('disabled khi DSN trống → init() trả false, KHÔNG gọi Sentry.init', () => {
    const ok = initSentry();
    expect(ok).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('disabled khi SENTRY_ENABLED=false → KHÔNG gọi Sentry.init', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'false';
    const ok = initSentry();
    expect(ok).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });
});

describe('initSentry — enabled path', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'true';
    process.env.SENTRY_ENVIRONMENT = 'staging';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.1';
  });

  it('enabled → gọi Sentry.init đúng args, isSentryEnabled()=true', () => {
    const ok = initSentry();
    expect(ok).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: 'https://abc@sentry.io/1',
      environment: 'staging',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
    expect(isSentryEnabled()).toBe(true);
  });

  it('idempotent — gọi 2 lần KHÔNG double-init', () => {
    initSentry();
    initSentry();
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('Sentry.init throw → app vẫn boot, isSentryEnabled=false', () => {
    initMock.mockImplementationOnce(() => {
      throw new Error('bad DSN');
    });
    const ok = initSentry();
    expect(ok).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });
});

describe('captureException / captureMessage', () => {
  it('disabled → captureException no-op, KHÔNG gọi SDK', () => {
    captureException(new Error('boom'));
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(withScopeMock).not.toHaveBeenCalled();
  });

  it('enabled → captureException gọi withScope + captureException, set requestId tag', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'true';
    initSentry();
    captureException(new Error('boom'), { requestId: 'r-123', userId: 'u-9' });
    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('captureException không throw nếu SDK throw nội bộ', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'true';
    initSentry();
    withScopeMock.mockImplementationOnce(() => {
      throw new Error('SDK panic');
    });
    expect(() => captureException(new Error('boom'))).not.toThrow();
  });

  it('captureMessage no-op khi disabled', () => {
    captureMessage('hello', 'info');
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('captureMessage gọi SDK khi enabled', () => {
    process.env.SENTRY_DSN_API = 'https://abc@sentry.io/1';
    process.env.SENTRY_ENABLED = 'true';
    initSentry();
    captureMessage('hello', 'warning');
    expect(captureMessageMock).toHaveBeenCalledWith('hello', 'warning');
  });
});
