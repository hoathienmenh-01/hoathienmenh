# INCIDENT RESPONSE (Phase 43)

Playbook ứng phó sự cố production. **Mọi action cần audit log** —
KHÔNG can thiệp dữ liệu production qua psql/redis-cli trực tiếp trừ
khi đã có incident ticket được approved bởi 2 ADMIN.

---

## P0 — Login broken (toàn bộ user không đăng nhập được)

**Triệu chứng**: tỉ lệ 5xx `/api/_auth/login` > 50% trong 5 phút, hoặc
spike SecurityEvent `AUTH_LOGIN_FAIL` không bình thường.

**Triage**:

1. Mở `/admin/system-status` → check `status` badge.
   - `down` (DB) → nhảy P0-DB.
   - `degraded` (Redis) → có thể login vẫn chạy được; check
     `recentErrors.bySeverity.FATAL`.
2. Tail Pino log filter `path=/api/_auth/login` + `statusCode>=500`.
3. Check Sentry transaction `POST /api/_auth/login` exception rate.

**Tác động**:

- KHÔNG được sửa user record raw.
- KHÔNG được clear refresh token Redis pool — gây mass logout.
- KHÔNG được tăng rate-limit policy ở runtime (re-deploy với env mới).

**Rollback**:

- Nếu vừa deploy version mới → rollback container về tag trước.
- Verify: `curl /api/version` confirm commit SHA cũ.

---

## P0-DB — DB unreachable

**Triệu chứng**: `/api/health/db` trả `status: down`. `/api/readyz`
trả 503. Pino spam `PrismaClientInitializationError`.

**Triage**:

1. Confirm DB endpoint reachable: `psql $DATABASE_URL -c 'SELECT 1'`
   từ jump host.
2. Check Postgres logs (managed DB console).
3. Check connection pool exhaustion: nhiều API instance restart
   liên tục → có thể nén connection pool.

**Mitigation**:

- Connection saturation → scale-down 1 API instance để giảm pool
  contention.
- Cấp permission DB sai → re-run terraform / migration với role
  đúng.

**KHÔNG**:

- KHÔNG `DROP TABLE`, `TRUNCATE`, `DELETE FROM` trên production.
- KHÔNG `psql -c "UPDATE Character SET linhThach = ..."` — gọi admin
  grant API qua audit log.

---

## P1-Redis — Redis down

**Triệu chứng**: `/api/health/redis` `status: down`. Login vẫn ok
(JWT cookie verify không hit Redis), nhưng rate-limit fall-back +
session count online sai.

**Triage**:

1. `redis-cli -u $REDIS_URL ping` từ jump host.
2. Check Redis logs.

**Tác động Phase 43**:

- Rate-limit fail-open (do `RateLimitGuard` reuse logger.error) →
  spam request có thể đi qua. Cảnh báo monitoring.
- `/admin/system/integrity/last-run` trả `null` (artefact Redis biến
  mất nếu Redis vừa flush).

**Rollback**:

- Restart Redis container; data ephemeral nên không backup lost.

---

## P1 — Reward claim broken

**Triệu chứng**: user báo "claim quest reward không nhận được", admin
audit log thấy `QUEST_CLAIM` thành công nhưng inventory không tăng.

**Triage**:

1. Chạy `pnpm integrity:check --scope=inventory,currency`.
2. Filter Pino log requestId từ user feedback.
3. Tra `SecurityEvent` type `LEDGER_ANOMALY` cho character đó.

**Tác động**:

- KHÔNG re-grant tự động — phải có incident ticket + admin grant
  qua `/admin/users/:id/grant` (audit log).

---

## P1 — Deploy fail

**Triệu chứng**: `pnpm verify:deploy` exit code != 0.

**Triage**:

- Step nào fail? `verify-deploy.mjs` log rõ.
- `migrate deploy` fail → check migration drift `prisma migrate status`.
- Health probe timeout → check API boot log; có thể env critical thiếu.

**Rollback**:

- Container vẫn ở tag cũ (verify gate chặn trước cutover) — không cần
  rollback DB.
- Nếu migration đã apply nhưng API fail → KHÔNG `migrate reset`;
  ticket + manual `prisma migrate resolve` với DBA review.

---

## P2 — Slow request spike

**Triệu chứng**: avg duration `/api/admin/metrics` > 500ms cho path
nóng (`/api/character`, `/api/inventory`).

**Triage**:

1. `/admin/system-status` check db latency `checks.db.latencyMs`.
2. `pnpm integrity:check` để loại trừ corruption (rare path scan
   table).
3. Check Pino slow log filter `durationMs > 1000`.

---

## Post-mortem checklist

- [ ] Timeline ghi rõ giờ phát hiện / khởi đầu / mitigation.
- [ ] requestId của 1-3 case điển hình.
- [ ] Snapshot `/admin/system/status` ở thời điểm sự cố.
- [ ] Snapshot `/api/admin/metrics`.
- [ ] Action item: deploy fix / monitoring rule / runbook update.
- [ ] Update `docs/AI_HANDOFF_REPORT.md` nếu phát hiện gap mới.
