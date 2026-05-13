# CSP Production Runbook — M7 (Fix CDN/API/WS unblocked)

> **Phase M7** — Production CSP đã được env-driven. Vẫn an toàn theo default; mở rộng chỉ khi env CSP_* được set.
>
> Source code: `apps/api/src/security/csp-config.ts` (pure validator + builder), `apps/api/src/bootstrap-config.ts` (helmet wiring).

---

## Vấn đề trước M7

`helmetConfig()` ở production hard-code mọi directive `'self'`:

```
default-src 'self';
script-src 'self';
style-src 'self';
connect-src 'self';
...
```

Khi deploy production:
- Web bundle serve qua CDN (Cloudflare / Vercel / Bunny CDN / R2 + custom domain).
- PWA fetch tới API khác origin (`https://api.xuantoi.io`).
- WebSocket upgrade tới WS origin (`wss://ws.xuantoi.io`).
- Service Worker / `manifest.webmanifest` từ static CDN.

→ Browser block hết → app vỡ ngay lúc bật CSP.

## Giải pháp M7

`buildCspDirectives(env)` đọc env opt-in:

| Env | Đi vào directive |
|---|---|
| `WEB_PUBLIC_CDN_ORIGIN` | `script-src`, `style-src`, `img-src`, `font-src`, `worker-src`, `manifest-src`, `media-src` |
| `WEB_ASSET_CDN_ORIGINS` | same (csv list, dedupe) |
| `API_PUBLIC_ORIGIN` | `connect-src` |
| `WS_PUBLIC_ORIGIN` | `connect-src` (chấp nhận `wss://` hoặc `https://`) |
| `CSP_EXTRA_CONNECT_SRC` | `connect-src` |
| `CSP_EXTRA_IMG_SRC` | `img-src` (cho phép `data:`) |
| `CSP_EXTRA_SCRIPT_SRC` | `script-src` (chấp nhận keyword `'strict-dynamic'` / `'nonce-...'` / `'sha256-...'`) |
| `CSP_EXTRA_STYLE_SRC` | `style-src` |
| `CSP_EXTRA_FRAME_SRC` | `frame-src` (override default `'none'`) |

**Vẫn enforce an toàn:**
- `default-src 'self'` luôn cố định.
- `object-src 'none'` luôn cố định (chống Flash/PDF embed).
- `frame-ancestors 'none'` luôn cố định (chống clickjacking — KHÔNG có env relax).
- `base-uri 'self'`, `form-action 'self'`.

**Reject auto:**
- `'unsafe-inline'`, `'unsafe-eval'`, `'wasm-unsafe-eval'`.
- `*`, `https://*` glob.
- `http://` ngoài WS directive.
- `data:` ngoài `img/font/media-src`.

---

## Rollout Plan (production)

### Phase 1 — Report-only (rollout audit)

Mục đích: tìm domain CDN/API/WS thật sự app fetch → log violations → adjust env.

```bash
# .env production
NODE_ENV=production
WEB_PUBLIC_CDN_ORIGIN=https://cdn.xuantoi.io
WEB_ASSET_CDN_ORIGINS=https://static.xuantoi.io
API_PUBLIC_ORIGIN=https://api.xuantoi.io
WS_PUBLIC_ORIGIN=wss://ws.xuantoi.io
CSP_REPORT_ONLY=1
CSP_REPORT_URI=https://sentry.io/api/<project>/security/?sentry_key=<key>
```

Deploy → monitor Sentry CSP-report endpoint trong 24–48h. Mỗi violation log:
- Document URL.
- Blocked URI.
- Effective directive.

→ Adjust env (thêm domain vào CSP_EXTRA_*) cho đến khi violation = 0.

### Phase 2 — Enforce

```bash
CSP_REPORT_ONLY=0           # ← bật enforce
CSP_REPORT_URI=...          # giữ để monitor regression
```

Deploy → header chuyển từ `Content-Security-Policy-Report-Only` → `Content-Security-Policy` (block thực sự).

### Phase 3 — Tighten (optional)

Nếu chấp nhận hi-effort:
- Thêm `'strict-dynamic'` + nonce-based scripts (yêu cầu rework FE để inject nonce qua HTML template).
- Disable `'data:'` ở `img-src` (yêu cầu rework avatar inline base64).

---

## Verify Manual

### Local

```bash
# Build CSP from .env và in header dạng spec.
node -e "
const { buildCspDirectives, serializeCspHeader } = require('./apps/api/dist/security/csp-config');
const r = buildCspDirectives(process.env);
console.log('Report-only:', r.reportOnly);
console.log('Report URI:', r.reportUri);
console.log('Rejected origins:', r.rejectedOrigins);
console.log('Header:');
console.log(serializeCspHeader(r.directives));
"
```

### Production

```bash
curl -sI https://api.xuantoi.io/api/health \
  | grep -i "content-security-policy"
```

Kết quả mong đợi (1 dòng):

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.xuantoi.io; ... ; upgrade-insecure-requests
```

Hoặc `Content-Security-Policy-Report-Only` nếu phase 1.

---

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| FE fetch API fail "Refused to connect to 'https://api...' because it violates the document's CSP" | `API_PUBLIC_ORIGIN` không set hoặc sai scheme | Set `API_PUBLIC_ORIGIN=https://api.xuantoi.io` + restart pod |
| WebSocket fail "Refused to connect" | `WS_PUBLIC_ORIGIN` chưa set | Set `WS_PUBLIC_ORIGIN=wss://ws.xuantoi.io` |
| CDN font block | Font hosted ngoài CDN chính (vd Google Fonts) | Thêm vào `CSP_EXTRA_STYLE_SRC` + `CSP_EXTRA_IMG_SRC` |
| Sentry log spam "blocked: inline" | `'unsafe-inline'` được code FE inject inline `<style>` / `<script>` | KHÔNG mở `'unsafe-inline'`. Fix FE: dùng external file hoặc nonce. |
| Payment iframe block | `frame-src 'none'` default | Set `CSP_EXTRA_FRAME_SRC=https://payment.example.com` |

---

## Hard Constraints (không vi phạm)

- KHÔNG bao giờ set `default-src *`.
- KHÔNG bao giờ thêm `'unsafe-inline'` / `'unsafe-eval'` vào env (validator reject auto, nhưng vẫn có người cố tình tắt validator → KHÔNG được).
- KHÔNG bao giờ relax `frame-ancestors` (clickjacking).
- KHÔNG đụng StoryV2 UI / runtime — module M7 chỉ chỉnh header CSP.
- KHÔNG phá CORS (CORS_ORIGINS độc lập với CSP; cả 2 đều cần đúng).

---

## Test Coverage

- `apps/api/src/security/csp-config.test.ts` — 25 test cases (default, CDN, API/WS, extra, rejects, report-only, serialize, anti-regression).
- `apps/api/src/bootstrap-config.test.ts` — 26 test cases (existing — vẫn pass vì empty env fallback `'self'`).

Run: `pnpm --filter @xuantoi/api vitest run src/security src/bootstrap-config.test.ts`.
