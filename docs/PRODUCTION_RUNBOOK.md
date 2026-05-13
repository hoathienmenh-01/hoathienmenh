# PRODUCTION RUNBOOK (Phase 43)

Tài liệu vận hành commercial cho `xuantoi`. Áp dụng cho mọi cluster
production (game server, admin panel, DB, Redis). Tài liệu này
**không** thay thế `RUNBOOK.md` (smoke gameplay) — bổ sung lớp vận
hành chuyên sâu.

> Đối tượng đọc: SRE / on-call / lead. Cần permission ADMIN trên cluster
> để thực thi các bước reproductive.

---

## 1. Health Check & Version

Service expose **8 endpoints** chuyên health (Phase 43 alias):

| Path | Mô tả | Rate-limit |
| --- | --- | --- |
| `GET /api/healthz`         | Legacy liveness (Phase 18.1). | Bypass |
| `GET /api/readyz`          | Legacy readiness (DB + Redis). | Bypass |
| `GET /api/version`         | Legacy version (`name`, `version`, `commit`, `node`). | Bypass |
| `GET /api/health`          | **Phase 43** light liveness alias. | Bypass |
| `GET /api/health/db`       | **Phase 43** DB probe (timeout 2s). | Bypass |
| `GET /api/health/redis`    | **Phase 43** Redis probe (timeout 2s). | Bypass |
| `GET /api/health/version`  | **Phase 43** version alias. | Bypass |
| `GET /api/health/full`     | **Phase 43** aggregate snapshot. | Bypass |

**Quy ước status**:
- `ok` — dependency reachable + latency normal.
- `degraded` — phản hồi chậm (DB > 1s, Redis > 500ms) hoặc Redis down
  nhưng DB ok (Redis là dep optional cho liveness).
- `down` — dependency hết timeout / fail.

**HTTP code**:
- `200` khi `status === 'ok'`.
- `503` khi `degraded` / `down`. Monitoring (Prometheus/Datadog) treat
  `503` là alert.

**KHÔNG bao giờ leak** connection string / env value / secret ra
response. Mọi error message đã được scrub (`sanitizeError` cắt prefix
URL password).

Verify nhanh local:

```bash
curl -fsS http://localhost:3000/api/health        # liveness
curl -fsS http://localhost:3000/api/health/full   # snapshot
curl -fsS http://localhost:3000/api/health/version
```

Smoke runner:

```bash
pnpm smoke:health     # 8 endpoint checks
```

---

## 2. Environment Validation

`apps/api/src/config/env.schema.ts` enforce strict ở production. Mọi
boot production sẽ throw nếu thiếu:

- `DATABASE_URL`           — connection string Postgres.
- `REDIS_URL`              — connection string Redis.
- `JWT_ACCESS_SECRET`      — ≥ 32 ký tự, không chứa `change-me-` / `dev-*-secret`.
- `JWT_REFRESH_SECRET`     — ≥ 32 ký tự, khác `JWT_ACCESS_SECRET`.
- `SECURITY_IP_HASH_SALT`  — ≥ 32 ký tự.
- `CORS_ORIGINS`           — danh sách origin allow-list, `https://*`.
- `SESSION_COOKIE_DOMAIN`  — domain cookie session (vd `.xuantoi.com`).
- `INITIAL_ADMIN_EMAIL`    — email admin bootstrap.
- `INITIAL_ADMIN_PASSWORD` — password admin bootstrap (≥ 12 ký tự).

Optional (warn nếu thiếu):
- `SENTRY_DSN_API`         — error tracking.
- `APP_VERSION` / `GIT_SHA`— version metadata cho `/version`.
- `STORAGE_*`              — backup S3 credentials.

Verify pre-deploy:

```bash
NODE_ENV=production node -e "require('./apps/api/dist/config/env.schema').assertProductionEnv()"
```

Hoặc dùng wrapper `pnpm verify:deploy` — script tự inject dummy secret
+ smoke `/healthz`, `/readyz`, `/version`.

---

## 3. Request ID & Structured Logging

Mọi request được middleware `request-logger.middleware.ts` (Phase 17.3)
gắn:

- Header response `x-request-id` (UUID v4 hoặc lấy từ header request).
- Pino log line: `requestId`, `method`, `path`, `statusCode`,
  `durationMs`, `userId?`, `characterId?`, `ipHash` (đã sha256 + salt).

**Redact policy** trong `apps/api/src/observability/logger.ts`:
`authorization`, `cookie`, `password`, `token`, `apiKey`, `secret`,
`creditCard`, `cvv`, `*.password`, `*.token`, `*.secret`, `*.salt`,
`req.body.password`, `req.headers.authorization`, …

**KHÔNG log**: request body raw, response body, JWT raw, refresh token,
session cookie value.

Khi cần debug request:

1. Lấy `x-request-id` từ user / client.
2. Filter Pino log: `requestId=<id>`.
3. Filter Sentry: tag `request_id=<id>`.

---

## 4. Error Log Foundation

Nguồn duy nhất cho admin error viewer: `SecurityEvent` (Phase 18.1).
Schema:

| Field | Mô tả |
| --- | --- |
| `id`          | cuid |
| `type`        | `AUTH_RATE_LIMIT`, `BAN_PROBE`, `LEDGER_ANOMALY`, … |
| `severity`    | `INFO` / `WARN` / `ERROR` / `FATAL` |
| `ipHash`      | sha256(salt ‖ ip) — không lưu IP raw |
| `userId`      | optional |
| `characterId` | optional |
| `policy`      | `RateLimitPolicyKey` nếu liên quan rate-limit |
| `detailJson`  | sanitized, allow-list key cố định ở service |
| `createdAt`   | timestamp |

Phase 43 admin viewer (`/admin/system/errors`) thêm một lớp scrub bổ
sung — chỉ pass-through 15 key allow-list (`reason`, `code`, `route`,
`method`, `statusCode`, `durationMs`, `requestId`, …).

**KHÔNG xoá** SecurityEvent row — retention được control bởi
maintenance cron, không phải admin action.

---

## 5. Admin System Status Dashboard

Phase 43 thêm dashboard read-only ở `/admin/system-status`:

- Permission: ADMIN hoặc MOD (đọc-only ops). KHÔNG cần
  `ADMIN_VIEW_DASHBOARD` permission grant của Phase 27.6.
- Hiển thị: health badge, dependency check (api/db/redis), version,
  uptime, recent errors 24h breakdown by severity, admin activity
  count, integrity last-run summary.
- **KHÔNG** có nút "fix" / "restart" — đây là dashboard read-only.

API consume:
- `GET /admin/system/status`              — snapshot.
- `GET /admin/system/errors?limit=20`     — recent events.
- `GET /admin/system/integrity/last-run`  — artefact Redis.

---

## 6. Data Integrity Check

Xem chi tiết: [`docs/DATA_INTEGRITY_CHECKS.md`](./DATA_INTEGRITY_CHECKS.md).

Tóm tắt:

```bash
pnpm integrity:check              # human-readable
pnpm integrity:check --json       # JSON output
pnpm integrity:check --scope=currency,inventory
INTEGRITY_STRICT=1 pnpm integrity:check  # exit 1 nếu có issue
```

**Default: report-only.** KHÔNG auto-mutate dữ liệu production trong
PR này. Mọi rollback / fix phải qua migration explicit + admin grant.

---

## 7. Smoke Test Runner

Xem chi tiết: [`docs/QA_REGRESSION_CHECKLIST.md`](./QA_REGRESSION_CHECKLIST.md).

```bash
pnpm smoke:health     # health endpoints only
pnpm smoke:auth       # auth flow
pnpm smoke:admin      # admin login + read-only endpoints
pnpm smoke:economy    # ledger invariants nền
pnpm smoke:all        # 4 suites trên (60s timeout/suite)
```

CI gate: workflow `e2e-smoke` chạy Playwright + smoke runtime trước
khi merge. Nếu smoke fail → block merge.

---

## 8. Deployment Verification

Xem `scripts/verify-deploy.mjs` (Phase 17.1) — pre-cutover gate:

1. `prisma migrate deploy`.
2. Boot `apps/api` background.
3. Poll `/api/healthz`.
4. Poll `/api/readyz` (DB + Redis).
5. Poll `/api/version`.
6. `pnpm --filter @xuantoi/api bootstrap` lần 1 (tạo admin + sects).
7. `pnpm --filter @xuantoi/api bootstrap` lần 2 (idempotent verify).
8. Kill API process.

Failure ở bất kỳ step → exit code != 0 → block deploy.

---

## 9. Backup / Restore

Xem [`docs/BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).

---

## 10. Incident Response

Xem [`docs/INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md).

---

## 11. Observability

Xem [`docs/OBSERVABILITY.md`](./OBSERVABILITY.md).
