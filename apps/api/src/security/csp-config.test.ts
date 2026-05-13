/**
 * Phase M7 — Unit tests cho `csp-config.ts`.
 *
 * Pure logic, không boot Nest. Coverage:
 *  - default `'self'` khi env trống (backward-compat với Phase 17.1).
 *  - parse csv WEB_PUBLIC_CDN_ORIGIN / WEB_ASSET_CDN_ORIGINS / API / WS.
 *  - reject `'unsafe-inline'` / `'unsafe-eval'` / `*` / `https://*` glob.
 *  - reject `data:` ngoài directive img/font/media (ok cho img/font/worker
 *    qua blob:).
 *  - PWA: worker-src + manifest-src derive.
 *  - report-only flag từ CSP_REPORT_ONLY.
 *  - serializeCspHeader → CSP spec format.
 */
import { describe, expect, it } from 'vitest';
import { buildCspDirectives, serializeCspHeader } from './csp-config';

describe('buildCspDirectives — empty env (backward-compat)', () => {
  it('defaults: chỉ self + data: cho img/font + none cho frame/object', () => {
    const r = buildCspDirectives({});
    expect(r.directives.defaultSrc).toEqual(["'self'"]);
    expect(r.directives.scriptSrc).toEqual(["'self'"]);
    expect(r.directives.styleSrc).toEqual(["'self'"]);
    expect(r.directives.imgSrc).toEqual(["'self'", 'data:']);
    expect(r.directives.fontSrc).toEqual(["'self'", 'data:']);
    expect(r.directives.connectSrc).toEqual(["'self'"]);
    expect(r.directives.workerSrc).toEqual(["'self'", 'blob:']);
    expect(r.directives.manifestSrc).toEqual(["'self'"]);
    expect(r.directives.mediaSrc).toEqual(["'self'"]);
    expect(r.directives.frameSrc).toEqual(["'none'"]);
    expect(r.directives.objectSrc).toEqual(["'none'"]);
    expect(r.directives.baseUri).toEqual(["'self'"]);
    expect(r.directives.formAction).toEqual(["'self'"]);
    expect(r.directives.frameAncestors).toEqual(["'none'"]);
    expect(r.directives.upgradeInsecureRequests).toEqual([]);
    expect(r.reportOnly).toBe(false);
    expect(r.reportUri).toBeNull();
    expect(r.rejectedOrigins).toEqual([]);
  });
});

describe('buildCspDirectives — CDN origin', () => {
  it('parse WEB_PUBLIC_CDN_ORIGIN → propagate to script/style/img/font/worker/manifest/media', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://cdn.xuantoi.io',
    });
    expect(r.directives.scriptSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.styleSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.imgSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.fontSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.workerSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.manifestSrc).toContain('https://cdn.xuantoi.io');
    expect(r.directives.mediaSrc).toContain('https://cdn.xuantoi.io');
  });

  it('WEB_ASSET_CDN_ORIGINS csv → multiple origins, dedupe', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://cdn.xuantoi.io',
      WEB_ASSET_CDN_ORIGINS:
        'https://cdn.xuantoi.io, https://static.xuantoi.io,https://r2.xuantoi.io',
    });
    expect(r.directives.imgSrc).toEqual(
      expect.arrayContaining([
        "'self'",
        'data:',
        'https://cdn.xuantoi.io',
        'https://static.xuantoi.io',
        'https://r2.xuantoi.io',
      ]),
    );
    // Dedup: cdn.xuantoi.io chỉ xuất hiện 1 lần.
    const count = r.directives.imgSrc.filter(
      (s) => s === 'https://cdn.xuantoi.io',
    ).length;
    expect(count).toBe(1);
  });
});

describe('buildCspDirectives — API / WS origin', () => {
  it('API_PUBLIC_ORIGIN → connect-src', () => {
    const r = buildCspDirectives({
      API_PUBLIC_ORIGIN: 'https://api.xuantoi.io',
    });
    expect(r.directives.connectSrc).toContain('https://api.xuantoi.io');
  });

  it('WS_PUBLIC_ORIGIN scheme wss:// allowed', () => {
    const r = buildCspDirectives({
      WS_PUBLIC_ORIGIN: 'wss://ws.xuantoi.io',
    });
    expect(r.directives.connectSrc).toContain('wss://ws.xuantoi.io');
  });

  it('Multiple connect origins csv', () => {
    const r = buildCspDirectives({
      API_PUBLIC_ORIGIN: 'https://api.xuantoi.io,https://api2.xuantoi.io',
      WS_PUBLIC_ORIGIN: 'wss://ws.xuantoi.io',
      CSP_EXTRA_CONNECT_SRC: 'https://sentry.io,wss://push.xuantoi.io',
    });
    expect(r.directives.connectSrc).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://api.xuantoi.io',
        'https://api2.xuantoi.io',
        'wss://ws.xuantoi.io',
        'https://sentry.io',
        'wss://push.xuantoi.io',
      ]),
    );
  });
});

describe('buildCspDirectives — extra directives', () => {
  it('CSP_EXTRA_IMG_SRC: cho phép data:', () => {
    const r = buildCspDirectives({
      CSP_EXTRA_IMG_SRC: 'data:,https://gravatar.com',
    });
    expect(r.directives.imgSrc).toContain('https://gravatar.com');
    expect(r.directives.imgSrc).toContain('data:');
  });

  it('CSP_EXTRA_SCRIPT_SRC: cho phép keyword strict-dynamic', () => {
    const r = buildCspDirectives({
      CSP_EXTRA_SCRIPT_SRC: "'strict-dynamic',https://cdn.example.com",
    });
    expect(r.directives.scriptSrc).toContain("'strict-dynamic'");
  });

  it('CSP_EXTRA_FRAME_SRC: override default none', () => {
    const r = buildCspDirectives({
      CSP_EXTRA_FRAME_SRC: 'https://payment.example.com',
    });
    expect(r.directives.frameSrc).toEqual(['https://payment.example.com']);
  });
});

describe('buildCspDirectives — security rejects', () => {
  it("reject 'unsafe-inline'", () => {
    const r = buildCspDirectives({
      CSP_EXTRA_SCRIPT_SRC: "'unsafe-inline'",
    });
    expect(r.directives.scriptSrc).not.toContain("'unsafe-inline'");
    expect(r.rejectedOrigins).toContain("'unsafe-inline'");
  });

  it("reject 'unsafe-eval'", () => {
    const r = buildCspDirectives({
      CSP_EXTRA_SCRIPT_SRC: "'unsafe-eval'",
    });
    expect(r.directives.scriptSrc).not.toContain("'unsafe-eval'");
    expect(r.rejectedOrigins).toContain("'unsafe-eval'");
  });

  it('reject wildcard *', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: '*',
    });
    expect(r.directives.scriptSrc).not.toContain('*');
    expect(r.rejectedOrigins).toContain('*');
  });

  it('reject https:// scheme-only (CSP "https:" wildcard)', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https:',
    });
    expect(r.directives.scriptSrc).not.toContain('https:');
    expect(r.rejectedOrigins).toContain('https:');
  });

  it('reject https://* glob', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://*.evil.com',
    });
    expect(r.directives.scriptSrc).not.toContain('https://*.evil.com');
    expect(r.rejectedOrigins).toContain('https://*.evil.com');
  });

  it('reject http:// (TLS-required) cho directive CDN', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'http://insecure.example.com',
    });
    expect(r.directives.scriptSrc).not.toContain('http://insecure.example.com');
    expect(r.rejectedOrigins).toContain('http://insecure.example.com');
  });

  it("reject 'unsafe-inline' even ở style-src", () => {
    const r = buildCspDirectives({
      CSP_EXTRA_STYLE_SRC: "'unsafe-inline',https://cdn.io",
    });
    expect(r.directives.styleSrc).not.toContain("'unsafe-inline'");
    expect(r.directives.styleSrc).toContain('https://cdn.io');
    expect(r.rejectedOrigins).toContain("'unsafe-inline'");
  });

  it('multiple invalid → all rejected, valid pass', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: '*,https://cdn.ok.io,javascript:alert',
    });
    expect(r.directives.scriptSrc).toContain('https://cdn.ok.io');
    expect(r.rejectedOrigins).toContain('*');
    expect(r.rejectedOrigins).toContain('javascript:alert');
  });
});

describe('buildCspDirectives — report-only', () => {
  it('CSP_REPORT_ONLY=1 → reportOnly true', () => {
    const r = buildCspDirectives({ CSP_REPORT_ONLY: '1' });
    expect(r.reportOnly).toBe(true);
  });

  it('CSP_REPORT_ONLY=true → reportOnly true (case-insensitive)', () => {
    expect(buildCspDirectives({ CSP_REPORT_ONLY: 'TRUE' }).reportOnly).toBe(
      true,
    );
    expect(buildCspDirectives({ CSP_REPORT_ONLY: 'yes' }).reportOnly).toBe(
      true,
    );
  });

  it('CSP_REPORT_ONLY=0 / empty → reportOnly false', () => {
    expect(buildCspDirectives({ CSP_REPORT_ONLY: '0' }).reportOnly).toBe(false);
    expect(buildCspDirectives({}).reportOnly).toBe(false);
  });

  it('CSP_REPORT_URI propagate', () => {
    const r = buildCspDirectives({
      CSP_REPORT_URI: 'https://sentry.io/csp-report/123',
    });
    expect(r.reportUri).toBe('https://sentry.io/csp-report/123');
  });
});

describe('serializeCspHeader', () => {
  it('format theo CSP spec — kebab-case key + values + semicolon', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://cdn.xuantoi.io',
      API_PUBLIC_ORIGIN: 'https://api.xuantoi.io',
      WS_PUBLIC_ORIGIN: 'wss://ws.xuantoi.io',
    });
    const header = serializeCspHeader(r.directives);
    expect(header).toContain("default-src 'self'");
    expect(header).toContain("script-src 'self' https://cdn.xuantoi.io");
    expect(header).toContain(
      "connect-src 'self' https://api.xuantoi.io wss://ws.xuantoi.io",
    );
    expect(header).toContain('upgrade-insecure-requests');
    expect(header).toMatch(/; /);
  });
});

describe('Phase M7 — anti-regression', () => {
  it('no directive contains forbidden tokens', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://cdn.io',
      API_PUBLIC_ORIGIN: 'https://api.io',
      WS_PUBLIC_ORIGIN: 'wss://ws.io',
      CSP_EXTRA_CONNECT_SRC: 'https://sentry.io',
      CSP_EXTRA_IMG_SRC: 'data:,https://gravatar.com',
    });
    const allValues = Object.values(r.directives).flat().map(String);
    expect(allValues).not.toContain("'unsafe-inline'");
    expect(allValues).not.toContain("'unsafe-eval'");
    expect(allValues).not.toContain('*');
    expect(allValues.filter((s) => s.endsWith('/*'))).toEqual([]);
  });

  it('frame-ancestors luôn none (chống clickjacking)', () => {
    // KHÔNG có env nào cho phép relax frame-ancestors (intentional).
    const r1 = buildCspDirectives({});
    const r2 = buildCspDirectives({
      CSP_EXTRA_FRAME_SRC: 'https://payment.io',
    });
    expect(r1.directives.frameAncestors).toEqual(["'none'"]);
    expect(r2.directives.frameAncestors).toEqual(["'none'"]);
  });

  it('object-src luôn none (chống Flash/PDF embed)', () => {
    const r = buildCspDirectives({
      WEB_PUBLIC_CDN_ORIGIN: 'https://cdn.io',
    });
    expect(r.directives.objectSrc).toEqual(["'none'"]);
  });
});
