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

> **Source of truth**: [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts) (Phase 17.1) — zod schema strict cho production. Server refuse boot nếu thiếu/placeholder. `pnpm verify:deploy` smoke gate này TRƯỚC khi cutover (xem §10.A).

| Env var | Yêu cầu |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public&sslmode=require` |
| `REDIS_URL` | `redis://...` hoặc `rediss://...` (TLS) |
| `JWT_ACCESS_SECRET` | ≥ 32 ký tự ngẫu nhiên. **KHÔNG** dùng `change-me-*` / `dev-*-secret` (server sẽ refuse start). |
| `JWT_REFRESH_SECRET` | ≥ 32 ký tự, khác `JWT_ACCESS_SECRET`. |
| `CORS_ORIGINS` | csv list (ví dụ `https://xt.example.com,https://www.xt.example.com`). Production bắt buộc, không có sẽ refuse start. |
| `SESSION_COOKIE_DOMAIN` | Domain cookie httpOnly (ví dụ `.xt.example.com`). |
| `SECURITY_IP_HASH_SALT` | ≥ 32 ký tự ngẫu nhiên (Phase 17.1 + Phase 18.1). **KHÔNG** dùng default `xuantoi-default-ip-salt` (refuse start). |
| `PORT` | (optional) mặc định `3000`. Phải nằm trong 1..65535. |

Sinh secret: `openssl rand -base64 48`.

### Optional / khuyến nghị

| Env var | Mặc định | Mô tả |
|---|---|---|
| `JWT_ACCESS_TTL` | `900` (15 phút) | Access token expiry (giây). |
| `JWT_REFRESH_TTL` | `2592000` (30 ngày) | Refresh token expiry. |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | — | Cho `pnpm bootstrap` chạy 1 lần khi deploy mới. |
| `MISSION_RESET_TZ` | `Asia/Ho_Chi_Minh` | Timezone tính DAILY/WEEKLY mission reset (DAILY 00:00, WEEKLY thứ Hai 00:00 theo zone này). Đặt `UTC` nếu muốn reset theo UTC. |
| `DAILY_REWARD_CAP_TZ` | `Asia/Ho_Chi_Minh` | (Phase 16.5) Timezone tính `dayBucket` (YYYY-MM-DD) cho daily reward cap (CULTIVATION/DUNGEON/MISSION). Mặc định đồng bộ với `MISSION_RESET_TZ`. Override sang `UTC` để dev/test có boundary reproducible. |
| `MARKET_FEE_PCT` | `0.05` | Phí giao dịch sàn `[0, 0.5]`. Đặt `0` để tắt phí trong closed beta. |
| `FEATURE_FLAG_CACHE_TTL_SEC` | `30` | (Phase 15.4) TTL cache 2-tier cho feature flag (L1 in-memory + L2 Redis). Set `0` = disable cache (force DB hit mỗi request — dev only). Admin toggle flag → server clear cache ngay; FE public flag store tự refresh khi quá TTL. |
| `RATE_LIMIT_ENABLED` | `true` | (Phase 18.1) Master toggle cho `RateLimitGuard`. `false` → mọi request pass bất kể policy (KHÔNG đụng Redis/in-memory). **CHỈ** dùng debug emergency / incident P0. Production luôn `true`. |
| `RATE_LIMIT_FAIL_OPEN` | `true` | (Phase 18.1) Khi Redis throw → fallback in-memory + `console.warn`. `false` = fail-closed (Redis lỗi → treat request as rate-limited, dễ block oan). Production khuyến nghị `true` để tránh Redis blip làm chết user thật. |
| `SECURITY_IP_HASH_SALT` | `xuantoi-default-ip-salt` | (Phase 18.1) Salt sha256 hash IP trước khi persist vào `SecurityEvent.ipHash` / `SecurityBlock.subjectHash`. **Production bắt buộc set** ≥ 32 ký tự ngẫu nhiên (`openssl rand -base64 48`). Rotate = kill switch lookup IP cũ (admin sẽ mất khả năng cross-ref hash IP cũ — chỉ rotate khi nghi salt leak). |
| `ABUSE_BLOCK_ENABLED` | `true` | (Phase 18.1) Toggle persist `SecurityEvent` + `createBlock`. `false` = rate-limit vẫn enforced (Redis counter) nhưng KHÔNG escalate to block + KHÔNG ghi DB. Dùng khi DB tải nặng tạm thời; KHÔNG dùng để "tắt bảo mật" production. |

> **Phase 15.5 — Maintenance Window**: KHÔNG có env var mới. Cache L1 in-memory TTL 10s hardcoded trong `MaintenanceWindowService` (tránh thrash khi nhiều request hit middleware). Cron transition (`SCHEDULED→ACTIVE` / `ACTIVE→ENDED`) **piggy-back** trên `LiveOpsEventSchedulerCronProcessor` 5'-tick — KHÔNG cần thêm queue/lease/env var mới. Tất cả config chuyển sang DB row qua admin API/panel (xem `docs/RUNBOOK.md` §2.23 + `docs/API.md` §Maintenance Window).

### LiveOps Cron (Phase 13.2.D + 14.0.F + 15.7)

Cron tự động hóa weekly cycle. **Default disabled** ở local/test — production phải explicit opt-in để tránh cron chạy nhầm khi deploy mới chưa kịp seed. Phase 15.7 default timezone đổi sang `Asia/Ho_Chi_Minh` (cùng helper TZ-aware ICT từ TZ Hotfix PR #517).

| Env var | Mặc định | Mô tả |
|---|---|---|
| `TERRITORY_CRON_ENABLED` | `false` | Bật cron territory weekly cycle (settle previous period → decay → grant owner reward mail). Truthy: `true`/`1`/`yes`/`on`. |
| `SECT_TERRITORY_CRON_TZ` | `Asia/Ho_Chi_Minh` | (Phase 15.7) Timezone unified cho cả 2 cron job. Khớp `previousTerritoryPeriodKey()` TZ-aware ICT. Override qua `SECT_TERRITORY_CRON_TZ` (priority cao nhất) hoặc legacy `TERRITORY_CRON_TZ`. |
| `TERRITORY_CRON_TZ` | `Asia/Ho_Chi_Minh` | (Legacy alias) Cùng tác dụng `SECT_TERRITORY_CRON_TZ` nhưng deprecated từ Phase 15.7. |
| `TERRITORY_WEEKLY_SETTLE_CRON` | `5 0 * * 1` | Pattern BullMQ repeat — Mon 00:05 theo timezone (= Sun 17:05 UTC khi tz=ICT). Settle previous ISO week, decay, grant reward mail. |
| `SECT_SEASON_CRON_ENABLED` | `false` | Bật cron sect season snapshot + Champion/MVP reward grant (Phase 15.7). Snapshot mọi season `endsAtIso ≤ now`, idempotent qua UNIQUE `seasonKey`. |
| `SECT_SEASON_SNAPSHOT_CRON` | `15 0 * * *` | Pattern — daily 00:15 theo timezone. Daily check rẻ vì hầu hết ngày KHÔNG có season ended (skip nhanh). |
| `LIVEOPS_CRON_LEASE_TTL_SEC` | `300` | TTL Redis lease (giây) để 2 node KHÔNG cùng leader chạy. Lease fail-open nếu Redis vắng — DB UNIQUE guard mới là final barrier. Set `0` để disable lease (dev/test). |

**Ghi chú race-safety**: cron đã idempotent ở DB layer — settlement, decay log, reward grant, season snapshot, sect season reward grant (Phase 15.7 `SectSeasonRewardGrant` UNIQUE `(seasonKey, rewardType, characterId)`) đều có UNIQUE constraint → P2002 swallow trả existing. Lease chỉ là optimistic optimization để giảm DB load khi 2 node race. An toàn để run cron song song nhiều node.

**Manual override**: vẫn giữ admin force-run endpoints sau khi enable cron — `POST /admin/liveops/run-weekly-cycle` (combo), `/admin/territory/cron/run-now`, `/admin/sect-season/cron/run-now`. Chạy lại an toàn (idempotent). Phase 15.7 thêm 2 endpoint read-only: `GET /admin/territory/cron/status` + `GET /admin/sect-season/cron/status` để monitor không cần audit log.

### Economy Anti-cheat Cron (Phase 16.6)

Cron daily auto kiểm ledger + scan anomaly. **Default disabled** ở local/test
— production phải explicit opt-in. Cả 2 cron đều idempotent qua DB UNIQUE
(ledger run `dayBucket`, anomaly `(source, characterId, windowKey)`).

| Env var | Mặc định | Mô tả |
|---|---|---|
| `LEDGER_CHECKER_CRON_ENABLED` | `false` | Bật cron daily ledger invariant check (negative balance / suspicious 24h delta). Truthy: `true`/`1`/`yes`/`on`. |
| `LEDGER_CHECKER_CRON_SCHEDULE` | `0 1 * * *` | BullMQ pattern — 01:00 UTC mỗi ngày (sau midnight reset 1h, đợi ledger flush). |
| `ECONOMY_ANOMALY_CRON_ENABLED` | `false` | Bật cron daily anomaly scanner (currency delta / rare item gain / reward-cap bypass / market outlier). |
| `ECONOMY_ANOMALY_CRON_SCHEDULE` | `0 2 * * *` | BullMQ pattern — 02:00 UTC mỗi ngày (sau ledger checker 1h, dữ liệu sạch). Đặt `0 */6 * * *` để scan mỗi 6h. |
| `ECONOMY_ANTICHEAT_CRON_TZ` | `UTC` | Timezone cho cron pattern. Đổi `Asia/Ho_Chi_Minh` nếu muốn pattern theo giờ VN. |

**Manual override**: admin force-run vẫn khả dụng — `POST /admin/economy/ledger-check/run` + `POST /admin/economy/anomalies/scan`. Idempotent — gọi lại trong cùng `dayBucket`/`windowKey` không tạo issue/anomaly trùng.

**Policy**: detection + reporting only. KHÔNG auto-ban / KHÔNG rollback / KHÔNG gửi public notify. Admin xem `EconomyLedgerCheckIssue` + `EconomyAnomaly` ở admin panel + quyết định manual.

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

> **Phase 15.5 — Maintenance Window**: migration `20260623000000_phase_15_5_maintenance_window` thêm bảng `MaintenanceWindow` (id/key UNIQUE/severity/target/status/titleVi/En/messageVi/En/startsAt/endsAt/allowAdminBypass/allowHealthcheck/allowMetrics/createdByAdminId/disabledAt + 3 index). **Additive** — KHÔNG đổi schema bảng cũ, KHÔNG cần backfill, KHÔNG ảnh hưởng data hiện tại. Reuse `AdminAuditLog` cho `ADMIN_MAINTENANCE_*`. Rollback bằng cách revert PR #515 — `DROP TABLE "MaintenanceWindow"` thủ công không bắt buộc (bảng dư không ảnh hưởng).

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
| Postgres | `pnpm backup:db` (script `scripts/backup-db.sh` Phase 17.4) định kỳ qua cron, hoặc managed RDS point-in-time. Test restore ít nhất 1 lần / tháng. |
| Redis | Không cần backup hard state (chỉ cache + queue). Khi restart, BullMQ job đang queued sẽ mất nếu không có persistence. Bật `appendonly yes` hoặc dùng managed Redis có persistence. |
| MinIO | Backup bucket `xuantoi-*` qua `mc mirror` lên S3 thật. |

### 9.1. Backup/Restore script env (Phase 17.4)

| Env | Default | Mô tả |
|---|---|---|
| `BACKUP_DIR` | `./backups` | Thư mục ghi `xuantoi-<TS>.sql.gz`. Production khuyến nghị absolute path ngoài repo. |
| `BACKUP_RETENTION_DAYS` | `0` (disabled) | Tự xoá `xuantoi-*.sql.gz` cũ hơn N ngày sau backup. Ops khuyến nghị `7`. |
| `DRY_RUN` | `0` | Backup script chỉ in plan, không chạy `pg_dump` (dùng debug cron). |
| `USE_DOCKER` | `auto` | `1`: ép `pg_dump`/`psql` qua `docker exec xuantoi-pg`; `0`: dùng host binary; `auto`: detect. |
| `CONFIRM_RESTORE` | _(empty)_ | Restore script: `YES` bypass interactive prompt (cron/CI). Legacy alias `ASSUME_YES=1` vẫn hoạt động. |
| `ALLOW_PRODUCTION_RESTORE` | _(empty)_ | Restore script: phải set `YES` tường minh khi `NODE_ENV=production` — nếu không, script CHẶN với exit 9. |
| `RUN_PRISMA_MIGRATE` | `0` | Restore script: `1` để chạy `prisma migrate deploy` ngay sau restore. |
| `STRICT` | `0` | Verify-restore: `1` ép fail (exit 6) nếu `User`/`Character` table empty. |
| `API_HEALTHCHECK_URL` | _(empty)_ | Verify-restore: optional URL `/api/healthz` để probe sau restore. |

**Cron mẫu** (closed beta, daily 02:00 + 7 ngày retention):
```cron
0 2 * * * cd /opt/xuantoi && BACKUP_DIR=/var/backups/xuantoi BACKUP_RETENTION_DAYS=7 pnpm backup:db >> /var/log/xuantoi-backup.log 2>&1
```

**Restore vào staging** (KHÔNG production trừ khi opt-in):
```bash
CONFIRM_RESTORE=YES \
  DATABASE_URL=postgresql://<user>:<pass>@<staging>:5432/mtt \
  pnpm restore:db /var/backups/xuantoi/xuantoi-<TS>.sql.gz

DATABASE_URL=... pnpm verify:restore
```

Chi tiết workflow + checklist disaster recovery xem `docs/BACKUP_RESTORE.md` + `docs/RUNBOOK.md` §2.10.

## 10. Smoke checklist sau deploy

### 10.A. `pnpm verify:deploy` — Deploy Verify Gate (Phase 17.1)

Chạy gate này **TRƯỚC** khi cutover traffic sang instance mới. Script là
1-file pure Node 20 (`scripts/verify-deploy.mjs`) — không cần cài thêm
dependency runtime. CI cũng chạy chính script này (job `verify-deploy`).

**Pre-req**:

- `DATABASE_URL` + `REDIS_URL` set trong shell (script reuse cho cả
  migrate + healthz/readyz). Script tự override mọi env critical còn lại
  (JWT/SALT/CORS/SESSION_COOKIE_DOMAIN) thành dummy strong value để đi
  qua zod schema mà không cần expose secret thật.
- `apps/api` đã build (`pnpm --filter @xuantoi/api build`).
- Port `PORT` (default 3100) free.

**Chạy**:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require \
REDIS_URL=rediss://host:6380 \
PORT=3100 \
pnpm verify:deploy
```

**7 step orchestrator** (stop ngay khi 1 step fail, exit code != 0):

1. `prisma migrate deploy` → apply mọi migration pending.
2. Spawn `node apps/api/dist/src/main.js` với `NODE_ENV=production` +
   dummy strong env. Schema strict (`apps/api/src/config/env.schema.ts`)
   refuse start nếu thiếu critical env → fail-fast.
3. Poll `GET /api/healthz` (liveness) 60s → 200 + `ok: true`.
4. Poll `GET /api/readyz` (DB + Redis) 60s → 200 + `ok: true`.
5. `GET /api/version` assert `name=@xuantoi/api` + `node` version + có
   `commit` (build info).
6. `pnpm --filter @xuantoi/api bootstrap` lần 1 — expected stdout chứa
   `created admin` hoặc `đã có`.
7. Bootstrap lần 2 — phải idempotent: expected `đã có / kept / giữ`,
   reject nếu stdout chứa `created admin` / `(mới)`.

**Output**: `✓ All 7 steps passed. Deploy Verify Gate OPEN.` → an toàn
cutover.

**Khi fail**: script in step nào fail + stack/stdout. Kiểm:

- Step 1 fail → migration conflict / DB connection / SSL cert. Verify
  `psql $DATABASE_URL` từ chính host chạy verify.
- Step 2 fail (`[xuantoi/api] Env validation FAILED`) → đọc message
  liệt kê đủ env thiếu → set trong `.env` production rồi rerun.
- Step 3/4 fail (`Health probe không pass trong 60s`) → API có log gì
  trong stdout? Có throw boot? Check `assertProductionSecrets()` /
  `assertProductionEnv()` log dòng đầu.
- Step 7 fail (`không idempotent`) → có ai sửa bootstrap script tạo
  duplicate? Check `apps/api/scripts/bootstrap.test.ts`.

### 10.B. Smoke manual sau cutover

- [ ] `GET /api/healthz` → 200, `uptimeMs` < 10s.
- [ ] `GET /api/readyz` → 200, `db: ok`, `redis: ok`.
- [ ] `GET /api/version` → commit khớp với deploy mới.
- [ ] Đăng ký 1 user test → login → `/character/onboard` → `/character/cultivate { cultivating: true }` → đợi 30s → có WS event `cultivate:tick`.
- [ ] Nhận thấy `AdminAuditLog` insert được (login admin → ban/grant 1 user thử).

## 11. Rollback

- Code: revert commit / git tag, redeploy.
- Migration: **tránh** rollback migration đã apply trên prod (Prisma không hỗ trợ down migration). Mọi migration nên là ADD-only / non-destructive. Nếu phải rollback, cần migration mới đảo ngược thủ công.

## 12. Quan sát / log

### 12.1. Pino structured logs (Phase 17.3)

Backend log JSON 1-line-per-event qua `pino`. Adapter `PinoNestLogger`
route mọi `Logger` call của NestJS xuống Pino → toàn bộ log app đều
structured + auto-redact secret.

**Env vars**:

| Env | Default | Mô tả |
|---|---|---|
| `LOG_LEVEL` | `info` (production), `debug` (dev), `warn` (test) | `trace\|debug\|info\|warn\|error\|fatal`. |

**Schema log line** (request-done):
```json
{"level":"info","time":"2026-05-09T12:34:56.789Z","service":"xuantoi-api","env":"production","requestId":"6f8c…","method":"POST","path":"/api/auth/login","statusCode":200,"durationMs":42,"userId":"…","msg":"request done"}
```

**Redact policy** (case-sensitive paths, censored `[REDACTED]`):
- `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`, `res.headers["set-cookie"]`.
- Bất cứ field nào (1-level wildcard `*.<field>` + top-level): `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `authorization`, `cookie`, `session`, `creditCard`, `cardNumber`, `cvv`.

Pipe stdout/stderr container → log aggregator (Loki, Datadog, CloudWatch).
Filter qua `service: "xuantoi-api"` + `env`. Search `requestId` để
trace 1 request từ FE → BE.

### 12.2. Sentry error tracking (Phase 17.3)

Sentry **disabled mặc định** (dev/test/CI không cần DSN). Production
opt-in qua env.

**Env vars BE** (`apps/api/.env`):

| Env | Default | Mô tả |
|---|---|---|
| `SENTRY_ENABLED` | `false` | Master switch. `true\|1\|yes\|on` → bật. |
| `SENTRY_DSN_API` | (empty) | DSN từ Sentry project. **KHÔNG commit DSN thật vào git.** |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` | Vd `staging`/`production`. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | `0..1`. Khuyến nghị `0.05`–`0.1` ở production để giảm cost. |
| `SENTRY_RELEASE` | (empty) | Tag release (vd git SHA). |

**Env vars FE** (`apps/web/.env.production`):

| Env | Default | Mô tả |
|---|---|---|
| `VITE_SENTRY_ENABLED` | `false` | Master switch. |
| `VITE_SENTRY_DSN_WEB` | (empty) | DSN frontend project (KHÁC backend DSN). **KHÔNG commit thật.** |
| `VITE_SENTRY_ENVIRONMENT` | `MODE` | Build-time. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0` | Khuyến nghị `0.05` production. |
| `VITE_SENTRY_RELEASE` | (empty) | Tag release. |

**Sample rate khuyến nghị**:
- Closed beta nhỏ (< 100 user): `1.0` (capture all) để debug nhanh.
- Soft launch (< 10k user): `0.1` (10%).
- Production scale: `0.01`–`0.05`.

**Disable nhanh** (nếu Sentry quota cạn / SDK gây sự cố): set
`SENTRY_ENABLED=false` (BE) hoặc `VITE_SENTRY_ENABLED=false` (FE) +
restart. Không cần code change.

**Tra requestId khi user báo lỗi**:
1. User báo lỗi (vd "submit form 500"). Thu thập `x-request-id` header
   từ DevTools → Network → response headers (FE auto-attach từ BE).
2. Tìm log line trong aggregator: `requestId: "6f8c…"` → thấy stack
   trace + path + userId.
3. Mở Sentry → search tag `requestId:6f8c…` → thấy event tương ứng.

### 12.3. Audit / business log

- `AdminAuditLog` table — admin action audit (immutable).
- `CurrencyLedger` — economy audit (mọi grant/spend).

Không thay thế Sentry — đây là **business audit**, không phải error tracking.

### 12.4. Metrics (Phase 17.5)

Endpoint admin-only: `GET /api/admin/metrics` — auth bằng cookie
ADMIN (`@RequireAdmin()`). Trả JSON snapshot system/api/ws/queue/cron
+ errors[] fail-soft. Không Prometheus text format (closed beta dùng
JSON poll trực tiếp để dashboard nội bộ).

Mọi collector fail-soft — Redis/BullMQ chưa init thì `queue.available=false`,
KHÔNG crash API. Chi tiết payload xem `docs/API.md` §"Phase 17.5 —
MetricsSnapshot payload".

Khuyến nghị Prometheus text exporter (`/metrics` public với label whitelist)
follow-up Phase 17.6 nếu monitoring cần Prom scrape thay vì poll JSON.

### 12.5. Load test biến môi trường (Phase 17.5)

Script k6 `scripts/load/k6-{smoke,api-baseline,ws-baseline}.js` đọc các env:

| Env | Default | Mô tả |
|-----|---------|------|
| `BASE_URL` | `http://localhost:3000` | API root, không trailing slash. Phải bao gồm scheme. |
| `WS_URL` | derive từ `BASE_URL` (http→ws, https→wss) | WebSocket root. |
| `TEST_EMAIL` | — | Email tài khoản test (cần khi không có `AUTH_TOKEN`). |
| `TEST_PASSWORD` | — | Password tài khoản test. |
| `AUTH_TOKEN` | — | JWT cookie `xt_access` value, skip login flow. |
| `VUS` | smoke=1, api=3, ws=5 | Số VU đồng thời. |
| `DURATION` | smoke=10s, api=30s, ws=20s | k6 duration string (`30s`, `2m`, `1h`). |

**KHÔNG** chạy load test nặng vào production khi chưa có phép — rate limit
có thể trigger account lock, BAN_RISK audit, hoặc làm gián đoạn người chơi
thật. Default chỉ test local / staging. Tài khoản test phải tạo riêng (note
`loadtest`), KHÔNG dùng admin / GM / staff account.

Chi tiết script xem `scripts/load/README.md` + `docs/RUNBOOK.md` §"Load
test (k6)".
