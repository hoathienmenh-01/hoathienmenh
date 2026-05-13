/**
 * Pure-function helpers cho `apps/api/src/main.ts`.
 *
 * Tách khỏi `main.ts` để test được không cần boot Nest / kết nối DB.
 *
 * 3 helper:
 *  - `assertProductionSecrets()` — fail-fast nếu production thiếu hoặc dùng
 *    JWT secret mặc định insecure.
 *  - `corsConfig()` — derive CORS origin từ env. Production yêu cầu
 *    `CORS_ORIGINS` (csv); dev fallback `http://localhost:5173` (Vite).
 *  - `helmetConfig()` — derive Helmet options. Dev: tắt CSP để Vite HMR
 *    không bị block. Prod: bật CSP chặt + HSTS + referrer-policy +
 *    crossOriginResourcePolicy `same-site`.
 *
 * Không import `@nestjs/core` / `helmet` runtime — chỉ kiểu để test pure-unit
 * không cần init Nest application.
 */
import type { HelmetOptions } from 'helmet';
import { buildCspDirectives } from './security/csp-config';

/**
 * JWT secret value mặc định "không-được-dùng-prod". Server sẽ throw khi
 * `NODE_ENV=production` và một trong các secret bằng giá trị này.
 *
 * Đồng bộ với `apps/api/.env.example` placeholder + `docs/SECURITY.md` §2.
 */
export const INSECURE_DEFAULTS = new Set<string>([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'dev-access-secret',
  'dev-refresh-secret',
]);

/**
 * Required env vars cho production. Server refuse start nếu thiếu bất kỳ.
 */
export const REQUIRED_PRODUCTION_SECRETS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

/**
 * Throw nếu `NODE_ENV=production` và:
 *  - thiếu `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, hoặc
 *  - giá trị thuộc `INSECURE_DEFAULTS`.
 *
 * No-op trong dev/test → không cản local dev.
 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[xuantoi/api] Production phải có env: ${missing.join(', ')}`,
    );
  }
  for (const k of REQUIRED_PRODUCTION_SECRETS) {
    const v = env[k] as string;
    if (INSECURE_DEFAULTS.has(v)) {
      throw new Error(
        `[xuantoi/api] Production không được dùng giá trị mặc định cho ${k}.`,
      );
    }
  }
}

export interface CorsConfig {
  origin: string[] | boolean;
  credentials: boolean;
}

/**
 * CORS origin từ `CORS_ORIGINS` csv list. Production bắt buộc; dev fallback
 * `http://localhost:5173` (Vite default).
 */
export function corsConfig(env: NodeJS.ProcessEnv = process.env): CorsConfig {
  const raw = env.CORS_ORIGINS;
  if (env.NODE_ENV === 'production') {
    if (!raw) {
      throw new Error(
        '[xuantoi/api] Production phải có CORS_ORIGINS (csv list).',
      );
    }
    const origins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { origin: origins, credentials: true };
  }
  if (raw) {
    const origins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { origin: origins, credentials: true };
  }
  return { origin: ['http://localhost:5173'], credentials: true };
}

/**
 * Helmet config.
 *
 * Dev: tắt CSP — Vite dev server inline script / HMR / eval sẽ bị CSP chặn.
 *
 * Production: bật CSP với policy chặt, **directive build qua
 * `buildCspDirectives()`** (M7 — env-driven CDN/API/WS origins). Khi env
 * CSP `WEB_PUBLIC_CDN_ORIGIN` / `API_PUBLIC_ORIGIN` / `WS_PUBLIC_ORIGIN`
 * trống → fallback policy `'self'` (backward-compat).
 *
 * Directive coverage (verify khi audit):
 *  - default-src 'self'
 *  - script-src 'self' + CDN (opt-in via WEB_PUBLIC_CDN_ORIGIN)
 *  - style-src 'self' + CDN
 *  - img-src 'self' data: + CDN (data: cho avatar inline base64 + favicon)
 *  - connect-src 'self' + API + WS + extra (xem CSP_EXTRA_CONNECT_SRC)
 *  - font-src 'self' data: + CDN
 *  - worker-src 'self' blob: + CDN (cho Service Worker PWA)
 *  - manifest-src 'self' + CDN (cho manifest.webmanifest)
 *  - media-src 'self' + CDN (audio cue / video)
 *  - frame-src 'none' (override qua CSP_EXTRA_FRAME_SRC — payment iframe)
 *  - object-src 'none' (chống Flash/PDF embed)
 *  - base-uri 'self'
 *  - form-action 'self'
 *  - frame-ancestors 'none' (chống clickjacking — KHÔNG cho relax)
 *  - upgrade-insecure-requests
 *
 * Khác:
 *  - HSTS 180 ngày + includeSubDomains.
 *  - referrer-policy = no-referrer.
 *  - cross-origin-resource-policy = same-site (CDN cache phân biệt origin).
 *  - cross-origin-embedder-policy disabled (API trả JSON/WS, không cần COEP).
 *
 * CSP_REPORT_ONLY=1 → đổi `Content-Security-Policy` → report-only header
 * (Helmet sẽ chuyển khi `reportOnly: true`). Dùng cho rollout dần production.
 */
export function helmetConfig(
  env: NodeJS.ProcessEnv = process.env,
): HelmetOptions {
  if (env.NODE_ENV !== 'production') {
    return { contentSecurityPolicy: false };
  }
  const cspResult = buildCspDirectives(env);
  // Helmet expects each directive value as `Iterable<string>`. Cast to
  // `Record<string, Iterable<string>>` since our types are pure `string[]`.
  return {
    contentSecurityPolicy: {
      useDefaults: true,
      reportOnly: cspResult.reportOnly,
      directives: cspResult.directives as unknown as Record<
        string,
        Iterable<string>
      >,
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 15552000,
      includeSubDomains: true,
      preload: false,
    },
  };
}
