# Xuân Tôi — Production Readiness Checklist

> Companion ngắn cho [`docs/DEPLOY.md`](./DEPLOY.md) + [`docs/SECURITY.md`](./SECURITY.md). Dùng khi prep staging/production deploy hoặc audit an ninh trước beta. Mỗi mục có lý do + cách verify.

## 1. Production env checklist

### Bắt buộc — server refuse start nếu thiếu / sai

| Env var | Yêu cầu | Verify |
|---|---|---|
| `NODE_ENV` | `production` | `assertProductionSecrets()` chỉ enforce khi value này. |
| `JWT_ACCESS_SECRET` | ≥ 32 ký tự ngẫu nhiên (`openssl rand -base64 48`). KHÔNG là `change-me-*` / `dev-*-secret`. | Test `bootstrap-config.test.ts` lock-in: `INSECURE_DEFAULTS` reject. |
| `JWT_REFRESH_SECRET` | Tương tự, **khác** `JWT_ACCESS_SECRET`. | Tương tự. |
| `CORS_ORIGINS` | csv list, ví dụ `https://xt.example.com,https://www.xt.example.com`. KHÔNG dùng `*` cho prod. | `corsConfig()` throw nếu thiếu trong prod. |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public&sslmode=require` | Postgres connection fail nếu thiếu. |
| `REDIS_URL` | `redis://...` hoặc `rediss://...` (TLS preferred). | Rate-limit chat / BullMQ fail nếu thiếu. |
| `SESSION_COOKIE_DOMAIN` | Domain cookie httpOnly (ví dụ `.xt.example.com`). | Auth cookie không gắn được cross-subdomain nếu thiếu. |

### Khuyến nghị — không bắt buộc nhưng prod nên set

| Env var | Mặc định | Production set? |
|---|---|---|
| `JWT_ACCESS_TTL` | `900` (15 phút) | Có thể giữ default; rotate ngắn hơn cho high-risk app. |
| `JWT_REFRESH_TTL` | `2592000` (30 ngày) | Default OK; rút ngắn nếu cần force re-login định kỳ. |
| `MISSION_RESET_TZ` | `Asia/Ho_Chi_Minh` | Set theo timezone game LiveOps (phải đồng nhất với Sect War / Sect Season). |
| `MARKET_FEE_PCT` | `0.05` (5%) | Set theo balance team (range `[0, 0.5]`). |
| `MAIL_TRANSPORT` | `console` | Đặt `smtp` cho prod + `SMTP_HOST` thật (Mailhog chỉ dev). |
| `WEB_PUBLIC_URL` | `http://localhost:5173` | Đặt URL frontend prod (cho mail reset-password link). |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | — | Chỉ cần khi run `pnpm bootstrap` lần đầu; remove sau khi seed. |
| `APP_VERSION` / `GIT_SHA` | `0.0.1` / `unknown` | Set qua build pipeline để `/api/version` trả thông tin chính xác. |
| `PORT` | `3000` | Tùy reverse proxy. |

### Anti-pattern — KHÔNG được commit / set

- `JWT_*_SECRET` = giá trị từ `INSECURE_DEFAULTS` (`change-me-access-secret`, `change-me-refresh-secret`, `dev-access-secret`, `dev-refresh-secret`).
- `CORS_ORIGINS` = `*` hoặc rỗng trong production.
- `apps/*/.env` (file thật) commit vào git — đã có `.gitignore` cover, test `security-secret-leak.test.ts` lock-in.
- `apps/web/.env*` chứa key SECRET / PASSWORD / TOKEN không-prefix `VITE_` (Vite sẽ inline vào bundle public).
- `MAIL_TRANSPORT=console` trong prod (mail body sẽ chỉ log stdout, user không nhận được).

## 2. Deploy smoke checklist

Run **sau mỗi** deploy production/staging. Nếu bất kỳ mục nào fail → rollback (xem `DEPLOY.md` §11).

### 2.1. Health probe

- [ ] `GET /api/healthz` → 200 + `{ ok: true, uptimeMs: <number>, ts: <ISO> }`. Nên < 10s nếu vừa restart.
- [ ] `GET /api/readyz` → 200 + `{ ok: true, checks: { db: { ok: true, latencyMs }, redis: { ok: true, latencyMs } } }`.
- [ ] `GET /api/readyz` khi DB hoặc Redis down → 503 + `checks.<x>.ok=false` + `error` field set. (Force fail bằng cách stop dependency và verify load balancer rotate instance ra.)
- [ ] `GET /api/version` → commit SHA + `name: '@xuantoi/api'` khớp với deploy mới (set `GIT_SHA` env trong build).

> 3 endpoint này **không gắn** AdminGuard → load balancer + monitoring có thể probe không cần auth. Đảm bảo public-safe (chỉ trả meta, không leak DB error stack).

### 2.2. CSP header

- [ ] `curl -I https://api.xt.example.com/api/healthz` trả header `content-security-policy` chứa:
  - `default-src 'self'`
  - `script-src 'self'`
  - `style-src 'self'`
  - `img-src 'self' data:`
  - `connect-src 'self'`
  - `font-src 'self' data:`
  - `object-src 'none'`
  - `frame-ancestors 'none'`
  - `upgrade-insecure-requests`
- [ ] Header KHÔNG chứa `'unsafe-inline'` / `'unsafe-eval'` / wildcard `*`.
- [ ] Header `strict-transport-security` chứa `max-age=15552000; includeSubDomains`.
- [ ] Header `referrer-policy: no-referrer`.
- [ ] Header `cross-origin-resource-policy: same-site`.
- [ ] Header `x-content-type-options: nosniff` (helmet default).
- [ ] Header `x-frame-options: SAMEORIGIN` hoặc `DENY` (helmet default).

> Nếu FE gọi từ domain khác CDN / WS endpoint → relax `connect-src` / `script-src` cho phù hợp (xem `bootstrap-config.ts` `helmetConfig` — cần edit code, hiện chưa env-driven). Dev mode (`NODE_ENV !== 'production'`) **tắt** CSP để Vite HMR/inline script không bị chặn.

### 2.3. Auth + session

- [ ] `POST /api/_auth/register` 1 user test (`email: smoke-<ts>@xt.io`, `password: SmokeTest123!`) → 200 + `set-cookie xt_access` + `xt_refresh` (`HttpOnly`, `Secure`, `SameSite=Lax` hoặc `None+Secure` cho cross-origin).
- [ ] `GET /api/_auth/session` với cookie → 200 + `data.user`.
- [ ] `POST /api/_auth/refresh` → cookies mới (rotate jti).
- [ ] `POST /api/_auth/logout` → `clear-cookie xt_access` + `xt_refresh`.

### 2.4. Core gameplay loop (smoke level)

- [ ] `POST /api/character/onboard` → tạo nhân vật.
- [ ] `POST /api/character/cultivate { cultivating: true }` → 200.
- [ ] Đợi 30s → có WS event `cultivate:tick` (Socket.io connect tới `/ws`).
- [ ] `GET /api/leaderboard` → 200 (có thể list rỗng nếu DB fresh).

### 2.5. Admin + audit

- [ ] Login admin (`INITIAL_ADMIN_EMAIL` từ bootstrap) → `GET /api/admin/users` 200.
- [ ] Ban → unban 1 user smoke → `GET /api/admin/audit?limit=5` xuất hiện 2 row `BAN_USER` + `UNBAN_USER`.

### 2.6. Cleanup

- [ ] Delete user smoke (admin → `DELETE /api/admin/users/:id` nếu có, hoặc soft-mark).
- [ ] Lưu lại commit SHA + thời điểm deploy + checklist outcome vào ops log.

## 3. CSP troubleshooting

Khi FE bị CSP chặn (browser console: `Refused to ...`), debug theo bước này.

### 3.1. Inline script / eval bị chặn

**Triệu chứng**: console `Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self'"`.

**Nguyên nhân**:
- FE inject `<script>...</script>` literal (không qua Vite bundle).
- Lib third-party dùng `eval()` / `new Function()`.

**Fix**:
- Best: refactor bỏ inline script (Vite bundle thay).
- Nếu không thể: thêm nonce hoặc hash. Hiện `helmetConfig()` chưa support nonce → cần extend code (xem `apps/api/src/bootstrap-config.ts`):
  ```ts
  scriptSrc: ["'self'", `'nonce-${nonce}'`],
  ```
  Sau đó FE template inject `<script nonce="${nonce}">` (server-side render, không phù hợp Vite SPA).
- **KHÔNG dùng `'unsafe-inline'`** — defeat toàn bộ XSS protection.

### 3.2. WebSocket bị chặn (FE khác domain với API)

**Triệu chứng**: `Refused to connect to 'wss://api.xt.example.com/ws' because it violates ... "connect-src 'self'"`.

**Nguyên nhân**: FE host `https://xt.example.com`, API + WS host `https://api.xt.example.com` (subdomain khác). CSP `connect-src 'self'` chỉ cho phép same-origin.

**Fix**: Edit `bootstrap-config.ts` `helmetConfig` directive `connectSrc`:
```ts
connectSrc: ["'self'", 'wss://api.xt.example.com', 'https://api.xt.example.com'],
```
Hoặc env-driven (TODO future PR — hiện chưa).

### 3.3. Style từ CDN bị chặn

**Triệu chứng**: `Refused to load the stylesheet '...' because it violates ... "style-src 'self'"`.

**Nguyên nhân**: FE load Google Fonts CSS hoặc CDN CSS (`fonts.googleapis.com`).

**Fix**: Self-host font (best, no leak referrer) hoặc thêm domain vào `styleSrc`:
```ts
styleSrc: ["'self'", 'https://fonts.googleapis.com'],
fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
```

### 3.4. Image data: URI bị chặn

**Triệu chứng**: `Refused to load image 'data:image/png;base64,...' because it violates ... "img-src 'self'"`.

**Nguyên nhân**: Code FE generate base64 data: URI cho avatar/icon nhưng directive thiếu `data:`.

**Fix**: Đã có sẵn `imgSrc: ["'self'", 'data:']` — verify production config, không cần đổi.

### 3.5. iframe embed bị chặn

**Triệu chứng**: `Refused to display '...' in a frame because an ancestor violates ... "frame-ancestors 'none'"`.

**Nguyên nhân**: Trang khác cố nhúng `<iframe src="https://api.xt.example.com">` (clickjacking attempt). API không serve HTML nên KHÔNG có nhu cầu hợp lệ.

**Fix**: Giữ `frame-ancestors 'none'` — đây là **mong đợi**.

### 3.6. Verify CSP nhanh local

```bash
# Build production locally
NODE_ENV=production \
JWT_ACCESS_SECRET=$(openssl rand -base64 48) \
JWT_REFRESH_SECRET=$(openssl rand -base64 48) \
CORS_ORIGINS=http://localhost:5173 \
node apps/api/dist/main.js &

curl -sI http://localhost:3000/api/healthz | grep -i "content-security-policy"
```

## 4. Lock-in tests

| Test file | Cover |
|---|---|
| `apps/api/src/bootstrap-config.test.ts` | 26 case: JWT secret missing/insecure default, CORS_ORIGINS missing/csv parse, dev fallback, prod CSP có đủ 11 directive, không có unsafe-inline/eval/wildcard, HSTS 180 days, referrer-policy no-referrer, CORP same-site, COEP off. |
| `apps/api/src/security-secret-leak.test.ts` | 6 case: `.env.example` không leak secret >= 32 ký tự, `apps/web/.env*` không có key SECRET/PASSWORD/TOKEN, `.env` files được `.gitignore`, root `.gitignore` có rule `.env` + whitelist `!.env.example`. |
| `apps/api/src/modules/health/health.controller.unit.test.ts` | 10 case: failure path readyz (DB down → 503, Redis down → 503, Redis non-PONG → 503, cả 2 fail, non-Error throw), happy `healthz`, version env override. |
| `apps/api/src/modules/health/health.controller.test.ts` | 3 case: integration với real Postgres + Redis (yêu cầu `pnpm infra:up`). |

Run targeted:
```bash
pnpm --filter @xuantoi/api test -- --run bootstrap-config security-secret-leak health
```

## 5. Rollback

Xem `docs/DEPLOY.md` §11. Nguyên tắc:
- Code: revert PR / git tag, redeploy.
- Migration: ADD-only — KHÔNG rollback migration đã apply trên prod (Prisma không hỗ trợ down). Nếu phải rollback, viết migration mới đảo ngược thủ công.
- Secret rotate: bump `JWT_ACCESS_SECRET` → kill toàn bộ access token; bump `JWT_REFRESH_SECRET` → kill toàn bộ refresh chain.
