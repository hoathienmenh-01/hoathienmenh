/**
 * Phase M7 — Production CSP builder (env-driven CDN / API / WS / extra
 * connect-src whitelist).
 *
 * Vấn đề trước M7: `helmetConfig()` trong `bootstrap-config.ts` set hết
 * directive `'self'` mọi domain. Khi production deploy:
 *   - Web serve qua CDN (Cloudflare / Vercel / Bunny / R2 + custom domain).
 *   - PWA fetch JSON từ API origin khác.
 *   - WebSocket upgrade tới WS origin (wss://ws.xuantoi.io).
 *   - PWA Service Worker manifest + icon từ static CDN.
 *
 * → CSP `'self'` chặn nhầm các fetch / connect / image hợp lệ → app vỡ.
 *
 * Mục tiêu module này:
 *   1. Read env vars opt-in (xem `apps/api/.env.example`):
 *        WEB_PUBLIC_CDN_ORIGIN, WEB_ASSET_CDN_ORIGINS (csv),
 *        API_PUBLIC_ORIGIN, WS_PUBLIC_ORIGIN,
 *        CSP_EXTRA_CONNECT_SRC, CSP_EXTRA_IMG_SRC, CSP_EXTRA_SCRIPT_SRC,
 *        CSP_EXTRA_STYLE_SRC, CSP_EXTRA_FRAME_SRC,
 *        CSP_REPORT_ONLY, CSP_REPORT_URI.
 *   2. Validate từng origin: scheme phải https hoặc wss, không wildcard
 *      schema (`http://*`), không cho `data:` ngoài directive img/font.
 *   3. Trả về directives map + report-only flag để `helmetConfig()` build
 *      ra `HelmetOptions`.
 *
 * Pure function — KHÔNG import @nestjs / helmet runtime. Test được không
 * boot Nest.
 *
 * Non-goals:
 *  - KHÔNG disable CSP ở production (chỉ env `CSP_REPORT_ONLY=1` mới đổi
 *    `Content-Security-Policy` → `Content-Security-Policy-Report-Only`).
 *  - KHÔNG cho phép `'unsafe-inline'`, `'unsafe-eval'`, wildcard `*`.
 *  - KHÔNG mở rộng `frame-ancestors` (chống clickjacking — vẫn `'none'`).
 *  - KHÔNG đụng StoryV2 UI / runtime / Story Runtime PR B/C/D.
 */

export type CspSource = string;

export interface CspDirectiveMap {
  defaultSrc: CspSource[];
  scriptSrc: CspSource[];
  styleSrc: CspSource[];
  imgSrc: CspSource[];
  fontSrc: CspSource[];
  connectSrc: CspSource[];
  workerSrc: CspSource[];
  manifestSrc: CspSource[];
  mediaSrc: CspSource[];
  frameSrc: CspSource[];
  objectSrc: CspSource[];
  baseUri: CspSource[];
  formAction: CspSource[];
  frameAncestors: CspSource[];
  upgradeInsecureRequests: never[];
}

export interface CspBuildResult {
  /** Directive map đầy đủ — đã dedupe, đã filter validation. */
  directives: CspDirectiveMap;
  /** True khi CSP_REPORT_ONLY=1 → bật mode report-only (no enforcement). */
  reportOnly: boolean;
  /** Optional report-uri / report-to endpoint. */
  reportUri: string | null;
  /** Origin không hợp lệ bị filter (cho ops audit log). */
  rejectedOrigins: string[];
}

/**
 * Bộ regex validate origin theo từng directive group:
 *  - `connect-src`: cho phép http/https/ws/wss (dev mode tới prod proxy
 *    đôi khi cần ws://). Trong production server validate thêm scheme.
 *  - `script/style/img/font/frame/manifest/worker/media-src`: chỉ https
 *    (production), khuyến nghị TLS-only.
 *  - Mọi directive: KHÔNG cho `'unsafe-inline'`, `'unsafe-eval'`, `*`,
 *    `https://*` glob (CSP wildcard mức scheme bị cấm tuyệt đối).
 */
const HTTPS_ORIGIN_RE = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const WS_ORIGIN_RE = /^(wss|https):\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
/** Pattern cho 'self' / 'none' / 'strict-dynamic' / nonce-/sha256- expressions. */
const KEYWORD_SOURCE_RE =
  /^('self'|'none'|'strict-dynamic'|'nonce-[A-Za-z0-9+/=_-]+'|'sha(256|384|512)-[A-Za-z0-9+/=_-]+')$/;
/** Forbidden tokens — reject mọi directive. */
const FORBIDDEN_SET = new Set([
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  '*',
  'http:',
  'https:',
  'data:*',
]);

export type CspKind =
  | 'origin-https'
  | 'origin-ws'
  | 'origin-https-data'
  | 'origin-https-blob';

function isValidOriginToken(token: string, kind: CspKind): boolean {
  if (FORBIDDEN_SET.has(token)) return false;
  if (token.includes('*')) return false;
  if (KEYWORD_SOURCE_RE.test(token)) return true;
  // Allow `data:` and `blob:` only for img/font/media directives (passed as kind).
  if (token === 'data:') {
    return kind === 'origin-https-data';
  }
  if (token === 'blob:') {
    return kind === 'origin-https-blob' || kind === 'origin-https-data';
  }
  if (kind === 'origin-ws') return WS_ORIGIN_RE.test(token);
  return HTTPS_ORIGIN_RE.test(token);
}

function parseCsvOrigins(
  raw: string | undefined,
  kind: CspKind,
  rejected: string[],
): string[] {
  if (!raw) return [];
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const accepted: string[] = [];
  for (const tok of tokens) {
    if (isValidOriginToken(tok, kind)) {
      accepted.push(tok);
    } else {
      rejected.push(tok);
    }
  }
  return accepted;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function parseBool(raw: string | undefined): boolean {
  if (!raw) return false;
  return TRUTHY.has(raw.toLowerCase().trim());
}

/**
 * Build CSP directive map từ env. Pure — không đọc process.env trừ khi
 * caller pass.
 *
 * Khi mọi env CSP_* / WEB_*_CDN / API/WS origin đều trống → trả về policy
 * legacy `'self'` (giống hành vi `bootstrap-config.helmetConfig` trước M7)
 * → safe backward-compat cho deploy không config CDN.
 */
export function buildCspDirectives(
  env: NodeJS.ProcessEnv = process.env,
): CspBuildResult {
  const rejected: string[] = [];

  const webCdn = parseCsvOrigins(env.WEB_PUBLIC_CDN_ORIGIN, 'origin-https', rejected);
  const assetCdn = parseCsvOrigins(env.WEB_ASSET_CDN_ORIGINS, 'origin-https', rejected);
  const apiOrigin = parseCsvOrigins(env.API_PUBLIC_ORIGIN, 'origin-https', rejected);
  const wsOrigin = parseCsvOrigins(env.WS_PUBLIC_ORIGIN, 'origin-ws', rejected);

  const extraConnect = parseCsvOrigins(
    env.CSP_EXTRA_CONNECT_SRC,
    'origin-ws',
    rejected,
  );
  const extraImg = parseCsvOrigins(
    env.CSP_EXTRA_IMG_SRC,
    'origin-https-data',
    rejected,
  );
  const extraScript = parseCsvOrigins(
    env.CSP_EXTRA_SCRIPT_SRC,
    'origin-https',
    rejected,
  );
  const extraStyle = parseCsvOrigins(
    env.CSP_EXTRA_STYLE_SRC,
    'origin-https',
    rejected,
  );
  const extraFrame = parseCsvOrigins(
    env.CSP_EXTRA_FRAME_SRC,
    'origin-https',
    rejected,
  );

  // CDN combo cho img/font (cho phép `data:` cho avatar inline base64 +
  // favicon SVG inline đã có sẵn).
  const cdnSources = dedupe([...webCdn, ...assetCdn]);

  const directives: CspDirectiveMap = {
    defaultSrc: ["'self'"],
    scriptSrc: dedupe(["'self'", ...cdnSources, ...extraScript]),
    styleSrc: dedupe(["'self'", ...cdnSources, ...extraStyle]),
    imgSrc: dedupe(["'self'", 'data:', ...cdnSources, ...extraImg]),
    fontSrc: dedupe(["'self'", 'data:', ...cdnSources]),
    // connect-src cần API origin + WS origin + extra (push API / metrics).
    connectSrc: dedupe([
      "'self'",
      ...apiOrigin,
      ...wsOrigin,
      ...extraConnect,
    ]),
    // worker-src + manifest-src: Service Worker + manifest.webmanifest có
    // thể serve từ same-origin hoặc CDN.
    workerSrc: dedupe(["'self'", 'blob:', ...cdnSources]),
    manifestSrc: dedupe(["'self'", ...cdnSources]),
    // Media (audio cue effect / video): cho phép CDN.
    mediaSrc: dedupe(["'self'", ...cdnSources]),
    // frame-src: mặc định 'none'; chỉ mở khi env CSP_EXTRA_FRAME_SRC set
    // (e.g. payment gateway iframe).
    frameSrc: extraFrame.length > 0 ? extraFrame : ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  };

  return {
    directives,
    reportOnly: parseBool(env.CSP_REPORT_ONLY),
    reportUri: env.CSP_REPORT_URI?.trim() || null,
    rejectedOrigins: rejected,
  };
}

/**
 * Convert directive map → header string format theo CSP spec.
 *
 * Sử dụng cho logging audit + middleware `helmet`-style nếu cần override.
 * Format: `default-src 'self'; script-src 'self' https://cdn.io; ...`.
 */
export function serializeCspHeader(map: CspDirectiveMap): string {
  const KEY_MAP: Record<keyof CspDirectiveMap, string> = {
    defaultSrc: 'default-src',
    scriptSrc: 'script-src',
    styleSrc: 'style-src',
    imgSrc: 'img-src',
    fontSrc: 'font-src',
    connectSrc: 'connect-src',
    workerSrc: 'worker-src',
    manifestSrc: 'manifest-src',
    mediaSrc: 'media-src',
    frameSrc: 'frame-src',
    objectSrc: 'object-src',
    baseUri: 'base-uri',
    formAction: 'form-action',
    frameAncestors: 'frame-ancestors',
    upgradeInsecureRequests: 'upgrade-insecure-requests',
  };
  const parts: string[] = [];
  for (const key of Object.keys(map) as Array<keyof CspDirectiveMap>) {
    const cspKey = KEY_MAP[key];
    const values = map[key];
    if (cspKey === 'upgrade-insecure-requests') {
      parts.push(cspKey);
      continue;
    }
    parts.push(`${cspKey} ${(values as string[]).join(' ')}`);
  }
  return parts.join('; ');
}
