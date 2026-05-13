# OBSERVABILITY (Phase 43)

Hệ thống observability cho `xuantoi/api`. Mục tiêu:

- Mọi request gắn `requestId` nhất quán giữa Pino log + Sentry + admin
  log viewer + response header.
- Mọi exception 5xx được capture Sentry với context redact.
- KHÔNG bao giờ log secret / token / cookie raw.
- Admin có thể tra cứu nhanh trạng thái + lỗi gần đây không cần grep
  Pino raw.

---

## 1. Logger — Pino + redact

File: `apps/api/src/observability/logger.ts`.

- `getLogger()` trả Pino singleton (`pino-pretty` ở dev, JSON ở prod).
- `childLogger({ requestId, userId, characterId })` — bindings thêm
  context cho từng module.

Redact paths (truncated — xem source cho list đầy đủ):

```
authorization, cookie, password, token, apiKey, secret,
creditCard, cvv, salt, hash, *.password, *.token, *.secret,
req.body.password, req.body.token, req.headers.authorization,
req.headers.cookie, res.headers['set-cookie']
```

Output sample (prod):

```json
{
  "level": "info",
  "time": "2025-01-15T08:23:11.123Z",
  "requestId": "8a1f...",
  "method": "POST",
  "path": "/api/_auth/login",
  "statusCode": 200,
  "durationMs": 87,
  "userId": "user_xxx",
  "ipHash": "abc123..."
}
```

---

## 2. Request ID Middleware

File: `apps/api/src/observability/request-logger.middleware.ts`.

Pipeline:

1. Đọc `x-request-id` header. Nếu vắng → generate UUID v4.
2. Gắn vào `req.requestId` (TypeScript augmentation).
3. Set response header `x-request-id`.
4. Bind logger child với `requestId`.
5. Sau response → log 1 line summary (method/path/status/duration).

KHÔNG log body / header / cookie. KHÔNG log JWT raw.

---

## 3. Sentry

File: `apps/api/src/observability/sentry.ts`.

- `initSentry()` — gọi trước `NestFactory.create()` để cover lỗi
  bootstrap. No-op nếu `SENTRY_DSN_API` trống hoặc `SENTRY_ENABLED=false`.
- `AllExceptionsFilter` (Phase 17.x) capture 5xx với tag `request_id`
  + `userId` + `route` để cross-link Pino log.

---

## 4. Metrics

File: `apps/api/src/modules/metrics/`.

Endpoint admin-only: `GET /api/admin/metrics`.

Track:
- System: process.uptime, memoryUsage, cpuUsage.
- API: request count, avg duration, byMethod, byStatusBucket, inFlight.
- WS: online count.
- Queue: BullMQ depth.
- Cron: lastRunAt từ 4 model.

Phase 43 thêm dashboard view `/admin/system-status` đọc subset:
health badge + recent errors count.

---

## 5. Admin System Status

Phase 43 — read-only ops dashboard. Tách khỏi metrics để focus vào
**operational status** (health + version + recent errors + integrity)
thay vì runtime counter.

API:
- `GET /admin/system/status`              — aggregate snapshot.
- `GET /admin/system/errors`              — paginated SecurityEvent.
- `GET /admin/system/errors/:id`          — single event detail.
- `GET /admin/system/integrity/last-run`  — Redis artefact.

UI: `/admin/system-status` (xem `AdminSystemStatusView.vue`).

---

## 6. Tracing requestId end-to-end

1. **Client logs** — nếu UI có error toast, gắn `requestId` từ
   header `x-request-id` của response.
2. **Pino log** — search `requestId=<id>` ở log aggregator.
3. **Sentry** — search tag `request_id=<id>`.
4. **Admin log viewer** — filter `requestId=<id>` qua
   `/admin/system/errors?type=...&since=...` (mở rộng filter ở Phase
   44+).

---

## 7. Alerting Recommendations

Sample Prometheus / Datadog alert rules:

```
alert: api_health_degraded
expr: probe_success{job="api-health-full"} == 0
for: 2m

alert: api_error_spike
expr: rate(security_events_total{severity="FATAL"}[5m]) > 1
for: 5m
```

Phase 43 **không** wire alerting infra — chỉ chuẩn hoá data source.
Cấu hình alert thuộc nhánh `ops/` của org.
