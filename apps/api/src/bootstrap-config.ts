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
 * Production: bật CSP với policy chặt phù hợp cho REST + WebSocket API
 * không serve HTML. Nếu sau này host web static cùng domain, cần relax
 * `script-src` / `connect-src` / `style-src` theo domain CDN / WS endpoint.
 *
 * Directive coverage (verify khi audit):
 *  - default-src 'self'
 *  - script-src 'self'        (API không render HTML → no inline)
 *  - style-src 'self'         (no inline style)
 *  - img-src 'self' data:     (data: cho avatar inline base64 + favicon)
 *  - connect-src 'self'       (ajax + WS same-origin; relax khi cross-domain)
 *  - font-src 'self' data:
 *  - object-src 'none'        (chống Flash/PDF embed)
 *  - base-uri 'self'
 *  - form-action 'self'
 *  - frame-ancestors 'none'   (chống clickjacking)
 *  - upgrade-insecure-requests
 *
 * Khác:
 *  - HSTS 180 ngày + includeSubDomains.
 *  - referrer-policy = no-referrer.
 *  - cross-origin-resource-policy = same-site (CDN cache phân biệt origin).
 *  - cross-origin-embedder-policy disabled (API trả JSON/WS, không cần COEP).
 */
export function helmetConfig(
  env: NodeJS.ProcessEnv = process.env,
): HelmetOptions {
  if (env.NODE_ENV !== 'production') {
    return { contentSecurityPolicy: false };
  }
  return {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
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
