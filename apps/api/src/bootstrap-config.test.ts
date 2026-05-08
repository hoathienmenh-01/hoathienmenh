/**
 * Pure-unit tests cho `bootstrap-config.ts`.
 *
 * 3 helper:
 *  - `assertProductionSecrets(env)`
 *  - `corsConfig(env)`
 *  - `helmetConfig(env)`
 *
 * Lock-in invariants (production-readiness):
 *  1. dev/test KHÔNG cản start dù env trống — không bao giờ throw khi
 *     `NODE_ENV !== 'production'`.
 *  2. production thiếu `JWT_*` → throw với tên env trong message.
 *  3. production có `JWT_*` = giá trị `change-me-*` / `dev-*` → throw.
 *  4. production thiếu `CORS_ORIGINS` → throw.
 *  5. CORS csv trim + filter empty.
 *  6. dev fallback `http://localhost:5173`.
 *  7. dev helmet `contentSecurityPolicy: false` (để Vite HMR).
 *  8. prod CSP có đủ directive: default/script/style/img/connect/font/object/
 *     base/form-action/frame-ancestors/upgrade-insecure-requests.
 *  9. prod hsts 15552000s = 180 days + includeSubDomains.
 * 10. prod referrerPolicy `no-referrer` + COEP off + CORP `same-site`.
 */
import { describe, expect, it } from 'vitest';
import type { HelmetOptions } from 'helmet';
import {
  INSECURE_DEFAULTS,
  REQUIRED_PRODUCTION_SECRETS,
  assertProductionSecrets,
  corsConfig,
  helmetConfig,
} from './bootstrap-config';

type CspObject = Exclude<HelmetOptions['contentSecurityPolicy'], boolean | undefined>;

const STRONG = {
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

function envOf(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'production', CORS_ORIGINS: 'https://x.io', ...STRONG, ...extra };
}

describe('bootstrap-config / assertProductionSecrets', () => {
  it('no-op khi NODE_ENV !== production', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionSecrets({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertProductionSecrets({})).not.toThrow();
  });

  it('throw khi production thiếu JWT_ACCESS_SECRET (message chứa tên env)', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: 'r'.repeat(48),
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throw khi production thiếu JWT_REFRESH_SECRET', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(48),
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throw khi production thiếu cả 2 → message liệt kê đủ', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production' }),
    ).toThrow(/JWT_ACCESS_SECRET, JWT_REFRESH_SECRET/);
  });

  it.each([...INSECURE_DEFAULTS])(
    'throw khi JWT_ACCESS_SECRET = insecure default %s',
    (bad) => {
      expect(() =>
        assertProductionSecrets({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: bad,
          JWT_REFRESH_SECRET: 'r'.repeat(48),
        }),
      ).toThrow(/m\u1eb7c \u0111\u1ecbnh|JWT_ACCESS_SECRET/);
    },
  );

  it.each([...INSECURE_DEFAULTS])(
    'throw khi JWT_REFRESH_SECRET = insecure default %s',
    (bad) => {
      expect(() =>
        assertProductionSecrets({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'a'.repeat(48),
          JWT_REFRESH_SECRET: bad,
        }),
      ).toThrow(/JWT_REFRESH_SECRET/);
    },
  );

  it('pass khi production có cả 2 secret strong', () => {
    expect(() => assertProductionSecrets(envOf())).not.toThrow();
  });

  it('REQUIRED_PRODUCTION_SECRETS = [JWT_ACCESS_SECRET, JWT_REFRESH_SECRET]', () => {
    expect(REQUIRED_PRODUCTION_SECRETS).toEqual([
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ]);
  });

  it('INSECURE_DEFAULTS chứa change-me-* + dev-*', () => {
    expect(INSECURE_DEFAULTS.has('change-me-access-secret')).toBe(true);
    expect(INSECURE_DEFAULTS.has('change-me-refresh-secret')).toBe(true);
    expect(INSECURE_DEFAULTS.has('dev-access-secret')).toBe(true);
    expect(INSECURE_DEFAULTS.has('dev-refresh-secret')).toBe(true);
  });
});

describe('bootstrap-config / corsConfig', () => {
  it('throw khi production thiếu CORS_ORIGINS', () => {
    expect(() => corsConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
  });

  it('production csv parse + trim + filter empty', () => {
    const c = corsConfig({
      NODE_ENV: 'production',
      CORS_ORIGINS: ' https://a.io , ,https://b.io ',
    });
    expect(c).toEqual({
      origin: ['https://a.io', 'https://b.io'],
      credentials: true,
    });
  });

  it('production single origin', () => {
    expect(
      corsConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://x.io' }),
    ).toEqual({ origin: ['https://x.io'], credentials: true });
  });

  it('dev fallback Vite default khi không CORS_ORIGINS', () => {
    expect(corsConfig({ NODE_ENV: 'development' })).toEqual({
      origin: ['http://localhost:5173'],
      credentials: true,
    });
    expect(corsConfig({})).toEqual({
      origin: ['http://localhost:5173'],
      credentials: true,
    });
  });

  it('dev override khi có CORS_ORIGINS', () => {
    expect(
      corsConfig({
        NODE_ENV: 'development',
        CORS_ORIGINS: 'http://localhost:5174,http://localhost:5175',
      }),
    ).toEqual({
      origin: ['http://localhost:5174', 'http://localhost:5175'],
      credentials: true,
    });
  });
});

describe('bootstrap-config / helmetConfig', () => {
  it('dev → contentSecurityPolicy: false (để Vite HMR / inline script)', () => {
    expect(helmetConfig({ NODE_ENV: 'development' })).toEqual({
      contentSecurityPolicy: false,
    });
    expect(helmetConfig({})).toEqual({ contentSecurityPolicy: false });
    expect(helmetConfig({ NODE_ENV: 'test' })).toEqual({
      contentSecurityPolicy: false,
    });
  });

  it('production CSP có đủ 11 directive', () => {
    const cfg = helmetConfig(envOf());
    const csp = cfg.contentSecurityPolicy as CspObject;
    expect(csp.useDefaults).toBe(true);
    const d = csp.directives as Record<string, string[]>;
    expect(d.defaultSrc).toEqual(["'self'"]);
    expect(d.scriptSrc).toEqual(["'self'"]);
    expect(d.styleSrc).toEqual(["'self'"]);
    expect(d.imgSrc).toEqual(["'self'", 'data:']);
    expect(d.connectSrc).toEqual(["'self'"]);
    expect(d.fontSrc).toEqual(["'self'", 'data:']);
    expect(d.objectSrc).toEqual(["'none'"]);
    expect(d.baseUri).toEqual(["'self'"]);
    expect(d.formAction).toEqual(["'self'"]);
    expect(d.frameAncestors).toEqual(["'none'"]);
    expect(d.upgradeInsecureRequests).toEqual([]);
  });

  it('production CSP không cho phép unsafe-inline / unsafe-eval / wildcard', () => {
    const cfg = helmetConfig(envOf());
    const csp = cfg.contentSecurityPolicy as CspObject;
    const directives = csp.directives as Record<string, string[]>;
    const flat = Object.values(directives)
      .flat()
      .map((s) => String(s));
    expect(flat).not.toContain("'unsafe-inline'");
    expect(flat).not.toContain("'unsafe-eval'");
    expect(flat.filter((s) => s === '*' || s.includes('://*'))).toEqual([]);
  });

  it('production HSTS 180 ngày + includeSubDomains + preload off', () => {
    const cfg = helmetConfig(envOf());
    expect(cfg.hsts).toEqual({
      maxAge: 15552000,
      includeSubDomains: true,
      preload: false,
    });
  });

  it('production referrer-policy = no-referrer + CORP same-site + COEP off', () => {
    const cfg = helmetConfig(envOf());
    expect(cfg.referrerPolicy).toEqual({ policy: 'no-referrer' });
    expect(cfg.crossOriginResourcePolicy).toEqual({ policy: 'same-site' });
    expect(cfg.crossOriginEmbedderPolicy).toBe(false);
  });

  it('directive object-src none + frame-ancestors none → chống Flash + clickjacking', () => {
    const cfg = helmetConfig(envOf());
    const csp = cfg.contentSecurityPolicy as CspObject;
    const d = csp.directives as Record<string, string[]>;
    expect(d.objectSrc).toEqual(["'none'"]);
    expect(d.frameAncestors).toEqual(["'none'"]);
  });
});
