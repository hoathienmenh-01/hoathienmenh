# Xuân Tôi — Deployment

Hướng dẫn deploy `apps/api` (NestJS) + `apps/web` (Vite SPA + PWA) lên môi trường staging / production. Repo chưa có `Dockerfile`/`docker-compose.prod.yml` chính thức → tài liệu này mô tả nguyên tắc chung + ví dụ minimal.

> Companion: [`docs/PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) — env list bắt buộc + smoke check sau deploy + CSP troubleshooting (Phase R1).

## 1. Kiến trúc deploy đề xuất

```
                                 ┌────────────────────┐
       (HTTPS)                   │  Web (Vite static) │
   user ────────► CDN / Reverse  │  build dist/ chuẩn │
                  proxy (nginx,  └────────────────────┘
                  caddy,         ┌────────────────────┐
                  cloudflare) ─► │ API (NestJS)       │  port 3000
                                 │ + WS gateway /ws   │
                                 └────────────┬───────┘
                                              │
                                  ┌───────────┼─────────────┐
                                  ▼           ▼             ▼
                           PostgreSQL 16   Redis 7      (MinIO/S3
                          (managed RDS,    (managed,    avatar,
                           prisma migrate) BullMQ)      optional)
```

- API stateless. Có thể chạy nhiều instance miễn là Postgres + Redis chung.
- Cron BullMQ (`cultivation`, `mission`, `ops`) cũng chạy trên cùng API process → cần đảm bảo **chỉ 1 instance** chạy worker, hoặc đặt `BULLMQ_LEADER_ONLY` (chưa có flag, hiện tất cả instance đều consume → an toàn vì BullMQ lock job, nhưng tài nguyên trùng lặp). Khuyến nghị: 1 instance API + 1 instance worker tách biệt sau này.

## 2. Yêu cầu môi trường production

### Secrets bắt buộc

| Env var | Yêu cầu |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public&sslmode=require` |
| `REDIS_URL` | `redis://...` hoặc `rediss://...` (TLS) |
| `JWT_ACCESS_SECRET` | ≥ 32 ký tự ngẫu nhiên. **KHÔNG** dùng `change-me-*` / `dev-*-secret` (server sẽ refuse start). |
| `JWT_REFRESH_SECRET` | ≥ 32 ký tự, khác `JWT_ACCESS_SECRET`. |
| `CORS_ORIGINS` | csv list (ví dụ `https://xt.example.com,https://www.xt.example.com`). Production bắt buộc, không có sẽ refuse start. |
| `SESSION_COOKIE_DOMAIN` | Domain cookie httpOnly (ví dụ `.xt.example.com`). |
| `PORT` | (optional) mặc định `3000`. |

Sinh secret: `openssl rand -base64 48`.

### Optional / khuyến nghị

| Env var | Mặc định | Mô tả |
|---|---|---|
| `JWT_ACCESS_TTL` | `900` (15 phút) | Access token expiry (giây). |
| `JWT_REFRESH_TTL` | `2592000` (30 ngày) | Refresh token expiry. |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | — | Cho `pnpm bootstrap` chạy 1 lần khi deploy mới. |

### LiveOps Cron (Phase 13.2.D + 14.0.F)

Cron tự động hóa weekly cycle. **Default disabled** ở local/test — production phải explicit opt-in để tránh cron chạy nhầm khi deploy mới chưa kịp seed.

| Env var | Mặc định | Mô tả |
|---|---|---|
| `TERRITORY_CRON_ENABLED` | `false` | Bật cron territory weekly cycle (settle previous period → decay → grant owner reward mail). Truthy: `true`/`1`/`yes`/`on`. |
| `TERRITORY_CRON_TZ` | `UTC` | Timezone cho cron pattern. Đổi thành `Asia/Ho_Chi_Minh` nếu muốn pattern theo giờ VN. |
| `TERRITORY_WEEKLY_SETTLE_CRON` | `5 0 * * 1` | Pattern BullMQ repeat — Mon 00:05 UTC. Settle previous ISO week, decay, grant reward mail. |
| `SECT_SEASON_CRON_ENABLED` | `false` | Bật cron sect season snapshot (snapshot mọi season `endsAtIso ≤ now`, idempotent qua UNIQUE `seasonKey`). |
| `SECT_SEASON_SNAPSHOT_CRON` | `15 0 * * *` | Pattern — daily 00:15 UTC. Daily check rẻ vì hầu hết ngày KHÔNG có season ended (skip nhanh). |
| `LIVEOPS_CRON_LEASE_TTL_SEC` | `300` | TTL Redis lease (giây) để 2 node KHÔNG cùng leader chạy. Lease fail-open nếu Redis vắng — DB UNIQUE guard mới là final barrier. Set `0` để disable lease (dev/test). |

**Ghi chú race-safety**: cron đã idempotent ở DB layer — settlement, decay log, reward grant, season snapshot đều có UNIQUE constraint → P2002 swallow trả existing. Lease chỉ là optimistic optimization để giảm DB load khi 2 node race. An toàn để run cron song song nhiều node.

**Manual override**: vẫn giữ admin force-run endpoints sau khi enable cron — `POST /admin/liveops/run-weekly-cycle` (combo), `/admin/territory/cron/run-now`, `/admin/sect-season/cron/run-now`. Chạy lại an toàn (idempotent).

> Không commit `.env` thật. Dùng secret manager (AWS SSM, GCP Secret Manager, Vault, Doppler, Fly secrets, …).

## 3. Build artifact

```bash
pnpm install --frozen-lockfile
pnpm --filter @xuantoi/shared build              # output packages/shared/dist
pnpm --filter @xuantoi/api build                  # output apps/api/dist
pnpm --filter @xuantoi/web build                  # output apps/web/dist (static)
```

API runtime cần: `apps/api/dist`, `apps/api/node_modules`, `packages/shared/dist`, `packages/shared/package.json` (vì `@xuantoi/shared` resolve qua workspace symlink).

Web build chỉ là static files trong `apps/web/dist` — copy thẳng lên CDN/object storage hoặc serve qua nginx/caddy.

## 4. Migrate database

Trước khi khởi động API mới:

```bash
pnpm --filter @xuantoi/api exec prisma migrate deploy
```

`migrate deploy` chỉ apply migration đã commit, không tự sinh SQL. Idempotent. **Không** dùng `migrate dev` ở production.

Nếu là deploy đầu tiên / DB còn rỗng:

```bash
INITIAL_ADMIN_EMAIL=admin@xt.io INITIAL_ADMIN_PASSWORD='<strong-pass>' \
pnpm --filter @xuantoi/api bootstrap
```

→ Tạo admin đầu tiên + 3 sect mặc định. Idempotent — chạy lại an toàn.

## 5. Start API

```bash
NODE_ENV=production node apps/api/dist/main.js
```

Hoặc qua process manager (pm2 / systemd / supervisor). Health check:

- `GET /api/healthz` — liveness 200 nếu process chạy.
- `GET /api/readyz` — readiness, kiểm tra Postgres + Redis. 503 khi chưa sẵn sàng.

Đặt 2 endpoint này vào load balancer probe.

## 6. Start Web

Web là static files. Ví dụ nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name xt.example.com;
  root /var/www/xuantoi-web;
  index index.html;

  # Service worker phải là same-origin
  location /sw.js { add_header Cache-Control "no-cache"; }
  location /workbox-*.js { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
  }

  # Reverse proxy API + WS sang api.xt.example.com (hoặc cùng host khác path)
  location /api/ {
    proxy_pass http://api-upstream:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
  location /ws {
    proxy_pass http://api-upstream:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Web env:

- `apps/web/.env.production` đặt `VITE_API_URL=https://xt.example.com/api` + `VITE_WS_URL=wss://xt.example.com/ws`.

## 7. Cookie cross-origin

Nếu web và api **khác origin** (ví dụ `xt.example.com` ↔ `api.xt.example.com`):

- Cookie `xt_access` / `xt_refresh` cần `SameSite=None; Secure`. Hiện code mặc định `SameSite=Lax`. Cần điều chỉnh `apps/api/src/common/auth-cookies.ts` theo môi trường (TODO future PR).

## 8. CSP

API trả CSP nghiêm ngặt khi `NODE_ENV=production` (xem `apps/api/src/main.ts`). Nếu dùng CDN cho web hoặc gọi WS từ domain khác → phải mở `connect-src` / `script-src` tương ứng. Hiện chưa env-driven, cần sửa code khi deploy đa-domain.

## 9. Backup

| Resource | Cách backup |
|---|---|
| Postgres | `pg_dump` định kỳ (managed RDS thường tự backup point-in-time). Test restore ít nhất 1 lần / tháng. |
| Redis | Không cần backup hard state (chỉ cache + queue). Khi restart, BullMQ job đang queued sẽ mất nếu không có persistence. Bật `appendonly yes` hoặc dùng managed Redis có persistence. |
| MinIO | Backup bucket `xuantoi-*` qua `mc mirror` lên S3 thật. |

## 10. Smoke checklist sau deploy

- [ ] `GET /api/healthz` → 200, `uptimeMs` < 10s.
- [ ] `GET /api/readyz` → 200, `db: ok`, `redis: ok`.
- [ ] `GET /api/version` → commit khớp với deploy mới.
- [ ] Đăng ký 1 user test → login → `/character/onboard` → `/character/cultivate { cultivating: true }` → đợi 30s → có WS event `cultivate:tick`.
- [ ] Nhận thấy `AdminAuditLog` insert được (login admin → ban/grant 1 user thử).

## 11. Rollback

- Code: revert commit / git tag, redeploy.
- Migration: **tránh** rollback migration đã apply trên prod (Prisma không hỗ trợ down migration). Mọi migration nên là ADD-only / non-destructive. Nếu phải rollback, cần migration mới đảo ngược thủ công.

## 12. Quan sát / log

- API log JSON qua `pino` ra stdout. Pipe vào CloudWatch / Loki / Datadog.
- Metric: hiện chưa có `/metrics` endpoint. Khuyến nghị bổ sung Prometheus exporter post-beta.
- Audit nhỏ: `AdminAuditLog` table + `CurrencyLedger`.
