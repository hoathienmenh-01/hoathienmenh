# Xuân Tôi — Troubleshooting

Các lỗi thường gặp khi chạy local hoặc deploy. Mỗi mục: triệu chứng → nguyên nhân → cách xử lý.

> **Production incident** (DB down / cron grant trùng / mất currency / restore disaster) **KHÔNG** ở đây — xem `docs/RUNBOOK.md` (Phase 17.4): severity P0–P3 ladder, playbook Postgres/Redis/WS/cron/reward mail/ledger/topup/deploy rollback/backup restore + escalation checklist. File này chỉ cover lỗi dev/local + symptom → fix riêng lẻ.

## 1. `pnpm install` lỗi peer dependency

**Triệu chứng**: warning `peer dependency mismatch` hoặc `ERR_PNPM_PEER_DEP_ISSUES`.

**Nguyên nhân**: Node version chưa đúng hoặc pnpm < 9.

**Xử lý**:

```bash
node -v          # cần >= 20
pnpm -v          # cần >= 9
corepack enable  # nếu pnpm chưa có
corepack prepare pnpm@9.15.1 --activate
pnpm install --frozen-lockfile
```

## 2. `Failed to resolve entry for package "@xuantoi/shared"`

**Triệu chứng**: vitest / build báo `Failed to resolve entry for package "@xuantoi/shared"`.

**Nguyên nhân**: chưa build `packages/shared/dist`. Workspace package này resolve qua `dist/index.{js,cjs}` (xem `packages/shared/package.json`).

**Xử lý**:

```bash
pnpm --filter @xuantoi/shared build
# hoặc dùng watcher khi đang dev shared:
pnpm --filter @xuantoi/shared dev
```

## 3. Postgres không kết nối được

**Triệu chứng**: `prisma migrate` / `prisma generate` fail, hoặc API log `connect ECONNREFUSED 127.0.0.1:5432`.

**Xử lý**:

```bash
docker ps                           # xem container `xuantoi-pg` đang chạy?
pnpm infra:up                       # nếu chưa chạy
docker logs xuantoi-pg --tail 50    # xem có lỗi init không
```

Reset volume nếu bị corrupt:

```bash
docker compose -f infra/docker-compose.dev.yml down -v
pnpm infra:up
pnpm --filter @xuantoi/api exec prisma migrate deploy
pnpm --filter @xuantoi/api bootstrap
```

## 4. Redis không kết nối được

**Triệu chứng**: chat rate limit fallback in-memory (warn log), BullMQ worker không tick, `/api/readyz` trả 503.

**Xử lý**:

```bash
docker ps | grep xuantoi-redis
pnpm infra:up
# hoặc test connect:
docker exec -it xuantoi-redis redis-cli ping   # phải trả PONG
```

## 5. Server production refuse start

**Triệu chứng**: lỗi `[xuantoi/api] Production phải có env: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET` hoặc `Production không được dùng giá trị mặc định cho JWT_ACCESS_SECRET.`

**Nguyên nhân**: `NODE_ENV=production` nhưng env secrets thiếu hoặc giá trị mặc định.

**Xử lý**: sinh secret ngẫu nhiên ≥ 32 ký tự rồi set qua secret manager:

```bash
openssl rand -base64 48
```

Xem `docs/DEPLOY.md` §2.

## 6. CORS reject từ web

**Triệu chứng**: Browser console `Access to fetch at 'https://api.xt.example.com/api/...' from origin 'https://xt.example.com' has been blocked by CORS policy`.

**Nguyên nhân**: production yêu cầu `CORS_ORIGINS` csv list. Nếu thiếu hoặc không khớp domain web → reject.

**Xử lý**: set `CORS_ORIGINS=https://xt.example.com,https://www.xt.example.com` rồi restart api.

## 7. Cookie không gửi từ web → api ở production

**Triệu chứng**: login thành công nhưng `/auth/session` 401, browser DevTools không thấy cookie attach vào request.

**Nguyên nhân**: web và api khác origin → cookie cần `SameSite=None; Secure` (hiện code đang đặt `SameSite=Lax`).

**Xử lý tạm thời**: deploy web + api cùng origin (qua reverse proxy nginx, xem `docs/DEPLOY.md` §6).

**Xử lý dài hạn**: sửa `apps/api/src/common/auth-cookies.ts` để theo env `COOKIE_SAMESITE` + `COOKIE_SECURE`. Backlog.

## 8. Test fail với `Cannot find module '@xuantoi/shared'`

Như mục 2 — build shared trước khi chạy test.

```bash
pnpm --filter @xuantoi/shared build
pnpm --filter @xuantoi/api test
```

CI workflow đã build shared trước khi test.

## 9. Test fail với `Test timed out` / `prisma already running migrations`

**Nguyên nhân**: 1 process khác đang giữ DB (api dev đang chạy hoặc test khác).

**Xử lý**:

```bash
ps aux | grep -E "ts-node|nest start|vitest"
# kill các process còn sót
docker exec -it xuantoi-pg psql -U mtt -d mtt -c "SELECT pid, application_name FROM pg_stat_activity WHERE datname='mtt';"
```

Hoặc dùng DB riêng cho test:

```bash
docker exec -it xuantoi-pg createdb -U mtt mtt_test
TEST_DATABASE_URL=postgresql://mtt:mtt@localhost:5432/mtt_test pnpm --filter @xuantoi/api test
```

## 10. Migration deploy fail với `relation already exists`

**Nguyên nhân**: DB đã có schema từ trước (khác environment, hoặc partial migration).

**Xử lý**: kiểm tra `_prisma_migrations` table:

```sql
SELECT migration_name, applied_steps_count, finished_at FROM _prisma_migrations;
```

Nếu thấy có row pending (rolled_back_at NULL nhưng finished_at NULL) → mark resolved hoặc reset:

```bash
pnpm --filter @xuantoi/api exec prisma migrate resolve --applied <migration_name>
# hoặc nếu staging có thể xoá sạch:
pnpm --filter @xuantoi/api exec prisma migrate reset --force --skip-seed
pnpm --filter @xuantoi/api bootstrap
```

> **Không** chạy `migrate reset` ở production.

## 11. Bootstrap script báo `INITIAL_ADMIN_PASSWORD chưa được set`

**Nguyên nhân**: env chưa load (chạy ngoài `apps/api` dir mà không có `.env`).

**Xử lý**: `pnpm --filter @xuantoi/api` tự đọc `apps/api/.env`. Hoặc set inline:

```bash
INITIAL_ADMIN_EMAIL=admin@xt.local INITIAL_ADMIN_PASSWORD='strong-pass-12345' \
  pnpm --filter @xuantoi/api bootstrap
```

## 12. Login admin nhưng vào `/admin` vẫn 403

**Nguyên nhân**: token cấp trước khi promote → `passwordVersion` mismatch. Hoặc cache UI.

**Xử lý**:

```bash
# Logout + login lại (cookie sẽ lấy role mới):
curl -i -X POST http://localhost:3000/api/_auth/logout
# Rồi login lại qua UI.
```

## 13. WS không kết nối / mất event `cultivate:tick`

**Triệu chứng**: bật `cultivating: true` nhưng UI không thấy exp tăng realtime.

**Xử lý**:

```bash
# 1. Kiểm cookie xt_access còn hợp lệ:
curl -i --cookie "xt_access=..." http://localhost:3000/api/character/me

# 2. Browser DevTools → Network → WS → kiểm `/ws` status `101 Switching Protocols`.

# 3. Kiểm BullMQ worker:
docker exec -it xuantoi-redis redis-cli LLEN bull:cultivation:active
```

Cron tick mặc định 30 giây. Nếu Redis chết → worker không chạy.

## 14. PWA service worker phục vụ asset cũ

**Triệu chứng**: deploy mới nhưng UI vẫn ở version cũ.

**Xử lý**: hard refresh (`Ctrl+Shift+R`) hoặc DevTools → Application → Service Workers → Unregister, rồi reload. Build production tự bump precache hash.

## 15. Ledger drift — `audit:ledger` báo discrepancy

**Triệu chứng**: `pnpm --filter @xuantoi/api audit:ledger` exit code 1 hoặc `GET /admin/economy/audit-ledger` trả `currencyDiscrepancies.length > 0` hoặc `inventoryDiscrepancies.length > 0`.

**Nguyên nhân (thường gặp)**:
1. **Manual DB edit** — admin/dev sửa `Character.linhThach` / `tienNgoc` hoặc `InventoryItem.qty` trực tiếp qua psql, không đi qua `CurrencyService.mutate()` → ledger không có row tương ứng.
2. **Migration race** — restore backup DB nhưng quên restore `CurrencyLedger` / `ItemLedger`.
3. **Bug service thiếu ghi ledger** — một code path mới mutate balance nhưng quên gọi ledger write (regression). Hiếm nhưng nghiêm trọng.
4. **Double-spend / double-grant bug** — service ghi ledger 2 lần cho 1 action (hoặc ngược lại ghi balance 2 lần nhưng ledger 1 lần).

**Xử lý**:

```bash
# 1) Chạy audit với JSON output để grep/filter cụ thể
pnpm --filter @xuantoi/api audit:ledger -- --json > /tmp/audit.json
cat /tmp/audit.json | jq '.summary'

# 2) Xem character cụ thể bị drift
cat /tmp/audit.json | jq '.currencyDiscrepancies[] | select(.characterId == "<id>")'

# 3) Cross-check với admin activity log
curl -H "Authorization: Bearer <admin>" "http://<api>/api/admin/audit?email=<owner>"
```

Nếu root cause là (1) manual edit — **không** vá bằng cách sửa ngược ledger. Thay vào đó: dùng admin `POST /admin/users/:id/grant` với `reason="ledger-repair: <detail>"` để tạo ledger row chính thức bù/trừ. Tạo audit trail rõ ràng cho sau này.

Nếu root cause là (3) bug service — mở issue ngay, PR fix service + viết test reproduce. Không được deploy tới khi fix.

**Runbook**: xem `docs/ADMIN_GUIDE.md §11`.

## 16. `GET /admin/economy/alerts` trả quá nhiều topup stale

**Triệu chứng**: AdminView Stats red dot báo 50+ cảnh báo; list `stalePendingTopups` toàn item > 24h.

**Nguyên nhân**: soft-launch / weekend thiếu admin duyệt topup thủ công → queue pending nhiều.

**Xử lý**:
1. **Tạm thời**: set env `ECONOMY_ALERTS_DEFAULT_STALE_HOURS=48` restart API để alert threshold lên 48h (nghỉ cuối tuần), đợi admin vào duyệt. Xem `docs/ADMIN_GUIDE.md §11.3`.
2. **Lâu dài**: thêm thêm MOD role có quyền `approveTopup`, rotate ca trực. Hoặc bật auto-approve (chưa có, cần dev).

Không nên **tắt alerts** — thresholds là guard rail phát hiện deadlock payment.

## 17. Sentry không gửi event / log thiếu requestId (Phase 17.3)

**Triệu chứng A**: Production lỗi 5xx, nhưng Sentry dashboard trống.

**Nguyên nhân**: Sentry mặc định **disabled**. Cần explicit env.

**Xử lý**:
```bash
# Backend
SENTRY_ENABLED=true
SENTRY_DSN_API=https://<key>@<host>/<project>
SENTRY_ENVIRONMENT=production

# Frontend (build-time)
VITE_SENTRY_ENABLED=true
VITE_SENTRY_DSN_WEB=https://<key>@<host>/<project>
```

Sau khi set, restart API + rebuild FE. Xem `docs/DEPLOY.md §12.2`.

**Triệu chứng B**: Log line không có `requestId`.

**Nguyên nhân**: Endpoint nằm trong skip list (`/api/healthz`, `/api/readyz`)
hoặc middleware chưa register (custom Express `app.use()` trước
`createRequestLoggerMiddleware`).

**Xử lý**: kiểm tra `apps/api/src/main.ts` có gọi
`app.use(createRequestLoggerMiddleware())` ngay sau `cookieParser`.

**Triệu chứng C**: Log line chứa raw `authorization: Bearer xxx` (KHÔNG redact).

**Nguyên nhân nghiêm trọng** — secret leak. Pino redact paths phải
exact-match. Nếu có nested 2-level (vd `req.user.headers.authorization`),
1-level wildcard `*.authorization` KHÔNG cover.

**Xử lý**:
1. **Khẩn**: rotate token bị leak ngay.
2. Mở `apps/api/src/observability/logger.ts`, thêm path tường minh
   vào `REDACT_PATHS`.
3. Add test reproduce → assertions `expect(output).not.toContain('<token>')`.

## 18. Liên kết khác

- Setup local: `docs/RUN_LOCAL.md`.
- Deploy: `docs/DEPLOY.md`.
- Admin ops: `docs/ADMIN_GUIDE.md`.
- Bảo mật: `docs/SECURITY.md`.
- Observability: `docs/DEPLOY.md §12` (Pino + Sentry).
