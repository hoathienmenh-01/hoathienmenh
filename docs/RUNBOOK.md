# Xuân Tôi — Production Runbook (Closed Beta)

> Mục đích: hướng dẫn **on-call / ops / dev trực** xử lý sự cố production
> trong closed beta. Ưu tiên: **giảm thiệt hại người chơi (mất data /
> mất currency / mất item) > khôi phục dịch vụ > điều tra root cause**.
>
> Pair docs:
> - `docs/DEPLOY.md` — deploy + env baseline.
> - `docs/BACKUP_RESTORE.md` — backup/restore script chi tiết.
> - `docs/TROUBLESHOOTING.md` — symptom → fix cho các lỗi thường gặp.
> - `docs/ADMIN_GUIDE.md` — admin endpoint / FE panel.
> - `docs/SECURITY.md` — chính sách secret + rotate key.
>
> **KHÔNG đưa secret thật / DSN / DATABASE_URL production vào file này.**
> Mọi command ví dụ dùng placeholder kiểu `<host>`, `<user>`, `<pass>`.

---

## 1. Severity ladder

| Level | Định nghĩa | Ví dụ | SLO phản hồi |
|---|---|---|---|
| **P0** | Toàn bộ user không dùng được, hoặc data mất. | API down 100%, DB unreachable, mất backup, JWT secret leak. | < 15 phút phát hiện → escalate ngay. |
| **P1** | Một phần lớn user bị ảnh hưởng. | Cron chạy trùng grant 2x reward, ledger drift > 100 character, WS không connect. | < 30 phút. |
| **P2** | User cá biệt mất item / currency / mail trùng / progress lỗi. | 1 user mất 1000 linh thạch sau topup, 1 mail reward gửi 2 lần. | < 2 giờ giờ làm việc. |
| **P3** | UX nhỏ, không mất data. | i18n thiếu key, badge sai màu, tooltip lệch. | < 1 ngày làm việc. |

> **Quyết định severity** dựa trên impact thực tế (số user / tiền / data),
> không phải độ phức tạp kỹ thuật.

### Khi nào escalate

- P0 → ngay lập tức gọi on-call → nếu không reach được trong 10 phút →
  thông báo team channel + tag tech lead.
- P1 → message team channel, tag on-call.
- P2 → mở issue + assign on-call cho ngày làm việc.
- P3 → mở issue backlog, không gọi đêm.

---

## 1.5. Closed Beta Operator Quick Reference (Phase 24.1)

> Trang nhanh cho **on-call closed beta** — gom các flow ops thường gặp
> thành 1 chỗ với link sang section chi tiết. Đọc xong section này có
> thể xử lý 80% sự cố tier P2/P3 mà không cần đào sâu codebase.

### 1.5.1. User abuse / kỷ luật

| Tình huống | Action | Tham chiếu chi tiết |
|---|---|---|
| Player toxic / cheat / chat spam | Admin `POST /admin/chat-moderation/mute` (mute user N phút) + `POST /admin/users/:id/ban` (P2) | §2.30 Phase 18.1 (rate-limit / abuse block), §2.31 Phase 18.2 (session revoke) |
| User bị nghi exploit economy | Kiểm `EconomyAnomaly` → admin grant unlock nếu false-positive | §2.29 Phase 16.1.B (Economy Range Report) |
| User bị nghi farm coop (anti-leech) | Kiểm `CoopRewardCapCounter` + `EconomyAnomaly` type=`COOP_LEECH_HIGH` | §2.41 Phase 20.2 + Phase 20.3 anti-leech (xem §1.5.4 dưới) |
| User báo lỗi Battle Pass/Monthly/VIP | Kiểm `BattlePassProgress`, `MonthlyCardSubscription`, `VipProfile`, `CurrencyLedger.reason IN ('BATTLE_PASS_REWARD','MONTHLY_CARD_REWARD')`, và `AdminAuditLog action LIKE 'admin.%'` | Phase 25.1 Monetization; xem `docs/API.md` + `docs/ADMIN_GUIDE.md` §5.1 |
| User bị block nhầm / false-positive rate-limit | Admin lift block | §2.30.3 + §2.30.4 |
| Logout 1 user khỏi mọi thiết bị (incident response) | Admin revoke all sessions | §2.31.2 |

### 1.5.2. Security alert / audit

| Tình huống | Action | Tham chiếu |
|---|---|---|
| Xem SecurityEvent gần đây | `GET /admin/security/events` hoặc kiểm `SecurityEvent` table SQL | §2.30.7 |
| Brute-force / IP attack | Kiểm rate-limit metrics + tăng policy threshold tạm thời (chú ý cần code change, không hot-config) | §2.30.7 + §2.30.8 |
| Admin grant nhầm | Kiểm `AuditLog` + ledger reverse manual | §2.29.7 + §2.6 |
| JWT secret nghi leak | Rotate `JWT_SECRET` + revoke all sessions | §2.8 |
| Maintenance window bật | Admin `POST /admin/maintenance-window/enable` | §2.23 Phase 15.5 |

### 1.5.3. Chat report / moderation

| Tình huống | Action | Tham chiếu |
|---|---|---|
| Player report tin nhắn xấu | Admin `GET /admin/chat-moderation/reports` → review → mute / delete msg | Phase 19.1 chat-moderation module |
| Spam flood public chat | Admin mute user 30 phút + tăng `CHAT_WORLD_SEND` rate-limit policy nếu lặp lại | §2.30 + Phase 19.x rate-limit policy |
| Private chat lạm dụng | Block user (per-user feature) + admin xem chat-private thread | Phase 19.2 chat-private |
| Group chat lạm dụng | Owner kick + admin mute room | Phase 19.3 chat-group |

### 1.5.4. Reward cap / co-op abuse (Phase 20.3)

| Tình huống | Action | SQL probe |
|---|---|---|
| User báo "claim coop reward bị reject DAILY_CAP_REACHED" | Kiểm `CoopRewardCapCounter` cho user + dayKey hôm nay (ISO UTC+7) | `SELECT * FROM "CoopRewardCapCounter" WHERE "userId"=$1 AND "dayKey"=to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') ORDER BY "source";` |
| User báo "weekly reward claim bị reject" | Kiểm `CoopWeeklyContributionEntry` + `CoopWeeklyRewardClaim` cho user + weekKey hiện tại | `SELECT * FROM "CoopWeeklyContributionEntry" WHERE "userId"=$1 AND "seasonId"=$2;` |
| Anomaly `COOP_LEECH_HIGH` xuất hiện nhiều | Review `EconomyAnomaly` `WHERE type='COOP_LEECH_HIGH'` 24h gần nhất → quyết định revert reward tier hoặc tăng threshold | §2.29 EconomyAnomaly investigation |
| Admin force-settle 1 weekly season | `POST /admin/coop/rewards/seasons/:id/settle` (audit log) | Phase 20.3 admin runbook |

**KHÔNG**: tự ý reset `CoopRewardCapCounter` row — cap reset tự động qua dayKey/weekKey rollover ICT. Reset tay sẽ làm grant double reward.

### 1.5.5. Backup / restore verify (closed beta cadence)

| Tình huống | Command | Tham chiếu |
|---|---|---|
| Verify cron daily backup chạy đúng | `ls -la /backups/postgres/` + check size + `pg_restore --list` test | §3.1 + §3.3 |
| Manual backup trước migration nhạy cảm | `pnpm backup:db` (script `scripts/backup-db.sh`) | §3.2 |
| Weekly restore verify | `pnpm verify:restore` (script `scripts/verify-restore.sh`) + check `BackupVerification` table | §3.4 Phase 17.2 |
| Restore khẩn 1 backup vào DB tạm | `pnpm restore:db -- --backup-file <path> --target-db <name>` | §2.10 |
| Đọc lịch sử verify | `SELECT * FROM "BackupVerification" ORDER BY "verifiedAt" DESC LIMIT 14;` (admin FE: `/admin/backup-verifications`) | §3.4 |

### 1.5.6. Deploy readiness check (trước cutover beta)

Trước cutover, chạy **tất cả** các check sau theo thứ tự:

1. `git status` + `git log -1 --oneline` — verify commit deploy.
2. `pnpm verify:deploy` — Deploy Verify Gate Phase 17.1 (xem §2.99). Phải PASS toàn bộ 12 invariant (env / migration / seed / health / ws / admin auth / rate-limit / cron / backup script / Redis / Postgres / observability).
3. `pnpm smoke:health` (nếu có) hoặc `curl <api>/api/healthz` + `/api/readyz` → expect 200.
4. `pnpm smoke:admin` — 30 step admin contract smoke.
5. `pnpm smoke:economy` — 20 step ledger invariant smoke.
6. `pnpm smoke:ws` — 19 step WS smoke.
7. `pnpm smoke:social` + `pnpm smoke:coop` (Phase 24.1) — social/coop golden path. Tolerant: graceful SKIP nếu infra unavailable.
8. CI build status: branch `main` phải xanh (5/5 GREEN — xem `docs/QA_CHECKLIST.md` §A).
9. Backup mới nhất < 24h cũ (`/admin/backup-verifications`).
10. `/admin/metrics` queue depth `failed` < 10 trong 24h gần nhất.

Nếu bất kỳ check fail → **KHÔNG cutover**, escalate dev on-call.

### 1.5.7. Rollback migration additive (an toàn)

Mọi migration trong codebase phải **additive** (không drop column, không drop table, không rename non-nullable). Nếu cần rollback:

1. Verify migration **chỉ thêm** column/table/index (đọc `apps/api/prisma/migrations/*/migration.sql`).
2. Soft rollback (giữ schema, revert code): `git revert <commit>` → deploy lại. Schema thừa column nhưng app không đọc → safe (additive contract). Document `KNOWN ORPHAN COLUMN` trong handoff.
3. Hard rollback (drop column thừa): chỉ làm sau ≥ 7 ngày soak + backup verify. Migration `ALTER TABLE ... DROP COLUMN` mới, deploy.
4. KHÔNG `prisma migrate reset` production. KHÔNG `prisma db push` production. KHÔNG drop table tay khi còn data thật.

Xem §2.9 (Deploy rollback) + Phase 17.1 Deploy Verify Gate §2.99 cho cutover playbook.

### 1.5.8. CI / smoke before beta

Trước khi mark "ready for beta":

- [ ] `main` branch CI 5/5 GREEN (build + e2e-smoke + e2e-full nếu trigger).
- [ ] `pnpm smoke:beta` PASS (`docs/QA_CHECKLIST.md` §9).
- [ ] `pnpm smoke:economy` + `smoke:ws` + `smoke:admin` + `smoke:combat` PASS.
- [ ] `pnpm smoke:social` + `smoke:coop` PASS hoặc graceful SKIP với note rõ trong handoff.
- [ ] E2E Playwright `pnpm --filter @xuantoi/web e2e` PASS (`docs/QA_CHECKLIST.md` §12).
- [ ] Mobile sanity check (375x667 viewport): 9 critical screen pass (`docs/QA_CHECKLIST.md` §17).
- [ ] Backup script smoke (`pnpm backup:db` + `pnpm verify:restore` trên staging).
- [ ] Manual regression matrix (`docs/QA_CHECKLIST.md` §14) — ≥ 80% category PASS, không có category MAJOR fail.

Nếu blocker xuất hiện → tạo issue `closed-beta-blocker-<slug>` + escalate ngay, KHÔNG cutover.

---


### 1.5.9. Phase 21 content verification

Before marking PR #538 ready, run: `pnpm --filter @xuantoi/shared test -- phase21-content-integrity.test.ts`, then full `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. If content-count or reward-ratio tests fail, treat as P3 content regression pre-release; do not hotfix by skipping tests.

## 2. Common incident playbooks

Mỗi playbook theo cấu trúc: **Triệu chứng → Verify → Mitigate → Investigate → Postmortem**.

### 2.1. Postgres down (P0)

**Triệu chứng**: `/api/readyz` trả 503 với `db: error`. API log
`connect ECONNREFUSED 5432` hoặc `Prisma error P1001/P1017`. Player
không login được.

**Verify**:
```bash
# Container/VM Postgres còn alive?
docker ps | grep xuantoi-pg                # local
# hoặc managed RDS: console provider, kiểm metrics CPU/connection.

# Connectivity probe (KHÔNG embed password, dùng file pgpass / env):
psql "$DATABASE_URL" -c 'SELECT 1;'
```

**Mitigate**:
1. Restart container/instance (managed: provider console; local: `pnpm infra:up`).
2. Nếu volume corrupted hoặc instance fail vĩnh viễn → restore từ backup gần
   nhất (xem §2.10 + `docs/BACKUP_RESTORE.md`).
3. Sau khi DB up → restart API (drain Prisma stale connection):
   ```bash
   # systemd / pm2 / fly: rolling restart
   ```
4. `curl https://<host>/api/readyz` phải trả 200 với `db: ok`, `redis: ok`.

**Investigate** (sau khi service ổn): tail Postgres log, kiểm WAL/disk
free, kiểm pg_stat_activity dài hạn, audit migration gần nhất.

**Postmortem**: ghi root cause vào `docs/AI_HANDOFF_REPORT.md` Known
Issues, mở action item (vd "thêm alert disk-free < 20%").

### 2.2. Redis down (P1)

**Triệu chứng**: `/api/readyz` trả 503 `redis: error`. Chat rate
limit fallback in-memory (warn log). BullMQ worker không tick → cron
LiveOps (territory/season) **không chạy** → cảnh báo P1 nếu kéo dài >
window cron (1 ngày cho daily, 1 tuần cho weekly).

**Impact**:
- Chat rate limit → từng instance memory (kém chính xác đa-node).
- BullMQ → cultivation tick miss, mission reset miss, territory weekly
  miss, season snapshot miss.
- WS subscribe channel có thể stale.

**Verify**:
```bash
docker exec -it xuantoi-redis redis-cli ping             # PONG?
docker exec -it xuantoi-redis redis-cli LLEN bull:cultivation:active
docker exec -it xuantoi-redis redis-cli INFO server | head -20
```

**Mitigate**:
1. Restart Redis. Nếu managed → provider console; local: `pnpm infra:up`.
2. Sau khi up, kiểm BullMQ resume (queue length giảm dần).
3. Nếu **đã miss cron window**: không chờ cron tự bù — gọi admin
   force-run endpoints (idempotent qua DB UNIQUE):
   ```
   POST /api/admin/liveops/run-weekly-cycle
   POST /api/admin/territory/cron/run-now
   POST /api/admin/sect-season/cron/run-now
   ```
   Xem `docs/DEPLOY.md` §LiveOps Cron + `docs/ADMIN_GUIDE.md`.

**Investigate**: kiểm Redis OOM, AOF persistence (`appendonly yes`
khuyến nghị production), evictions/sec.

### 2.3. WebSocket không realtime (P1)

**Triệu chứng**: bật `cultivating: true` mà UI không thấy exp tăng,
chat không in-time. DevTools → WS không status `101 Switching
Protocols`, hoặc `4xx` close ngay.

**Verify** (xem chi tiết `docs/TROUBLESHOOTING.md` §13):
```bash
# 1. Cookie xt_access còn hợp lệ?
curl -i --cookie "xt_access=..." https://<host>/api/character/me

# 2. WS handshake:
# DevTools → Network → WS → check status 101.

# 3. BullMQ worker:
docker exec -it xuantoi-redis redis-cli LLEN bull:cultivation:active
```

**Mitigate**:
- Reverse proxy (nginx/caddy) **bắt buộc** có `Upgrade: websocket` +
  `Connection: upgrade` headers (`docs/DEPLOY.md` §6).
- Nếu chỉ 1 user gặp → user logout-login lại để refresh cookie.
- Nếu toàn bộ user → restart API + Redis, kiểm reverse proxy timeout
  (mặc định nginx 60s → bump lên ≥ 5 phút cho WS dài).

### 2.4. Cron chạy trùng / chạy 2 lần (P1)

**Triệu chứng**: territory weekly cycle có 2 settle cùng `periodKey`,
hoặc season snapshot 2 row cùng `seasonKey`. Thường thấy ở log
"`grant skipped — already exists`" hoặc "`P2002 swallowed`".

**Architecture invariant** (Phase 13.2.D + 14.0.F):
- Mọi cron handler **idempotent** ở DB layer qua UNIQUE constraint
  (settlement, decay log, reward grant, season snapshot).
- Optimistic Redis lease ngăn 2 node leader race (TTL 300s default).
- P2002 catch graceful → trả existing → không gửi mail/grant trùng.

**Verify**:
```sql
-- Territory: cùng periodKey 2 row?
SELECT period_key, count(*) FROM "TerritorySettlement"
GROUP BY period_key HAVING count(*) > 1;

-- Sect Season: cùng seasonKey 2 snapshot?
SELECT season_key, count(*) FROM "SectSeasonSnapshot"
GROUP BY season_key HAVING count(*) > 1;
```

**Mitigate**:
- Nếu UNIQUE đang hoạt động → không thực sự grant trùng, chỉ là log
  noisy. KHÔNG action gì.
- Nếu **thật sự** grant 2 lần (hiếm — bug regression) → freeze cron
  bằng env (`TERRITORY_CRON_ENABLED=false`) → restart API → mở P0/P1
  issue điều tra DB schema UNIQUE còn không.

**Rollback** (trường hợp xấu nhất grant trùng đã gửi mail):
1. Backup DB hiện tại.
2. Identify duplicate mail/ledger row qua admin audit.
3. Tạo migration hoặc admin script `--mode=rollback` để delete
   duplicate (kèm ledger correction row, không xóa row gốc gây mất
   evidence).
4. Báo player bị ảnh hưởng qua mail.

### 2.5. Reward mail gửi trùng (P1/P2)

**Triệu chứng**: Player báo "tôi nhận 2 mail giống hệt cùng territory
reward tuần này". Admin audit thấy 2 `Mail` row cùng `refType` +
`refId` cho 1 character.

**Verify**:
```sql
-- Territory reward mail: 2 mail cùng character + period?
SELECT character_id, ref_type, ref_id, count(*) FROM "Mail"
WHERE ref_type = 'TERRITORY_REWARD'
GROUP BY character_id, ref_type, ref_id HAVING count(*) > 1;
```

**Architecture invariant**: Reward grant idempotent qua UNIQUE
`(refType, refId, characterId)` ở `RewardGrantLedger` (Phase 14.0.E).
Mail send dùng grant ledger row làm key — không grant 2 lần →
không mail 2 lần.

**Mitigate**:
1. Nếu **chưa claim reward** trong cả 2 mail → admin force-delete 1
   mail dup (qua psql, log audit).
2. Nếu **đã claim cả 2** → ledger drift sẽ bị `audit:ledger` báo
   sau (xem §2.6). Tạo correction row negative để bù.
3. Báo player + log audit.

**Investigate**: tại sao UNIQUE bypass? Migration thiếu? Reward grant
không qua RewardGrantLedger? Mở P1 issue.

### 2.6. Player mất item / currency (P2)

**Triệu chứng**: Player báo "tôi có 1000 linh thạch, sau khi vào
shop NPC còn 0, không thấy purchase nào". Hoặc "inventory mất 1 item
sau khi merge sect không lý do".

**Verify** — tra ledger trước, không tin vào snapshot balance:
```bash
# 1) Audit ledger drift
pnpm --filter @xuantoi/api audit:ledger -- --json > /tmp/audit.json
cat /tmp/audit.json | jq --arg id "<char_id>" \
  '.currencyDiscrepancies[] | select(.characterId == $id)'

# 2) Tra trực tiếp ledger:
psql "$DATABASE_URL" -c "
SELECT created_at, reason, ref_type, ref_id, delta, balance_after
FROM \"CurrencyLedger\"
WHERE character_id = '<char_id>'
ORDER BY created_at DESC LIMIT 50;"

# 3) ItemLedger tương tự
psql "$DATABASE_URL" -c "
SELECT created_at, reason, item_key, qty_delta, qty_after
FROM \"ItemLedger\"
WHERE character_id = '<char_id>'
ORDER BY created_at DESC LIMIT 50;"
```

**Mitigate** (xem `docs/TROUBLESHOOTING.md` §15):
- KHÔNG sửa balance trực tiếp qua psql. Phải dùng admin grant với
  `reason="ledger-repair: <detail>"` để tạo audit row chính thức.
- `POST /api/admin/users/:id/grant` với amount + currency.
- Confirm ledger drift cleared bằng `audit:ledger` chạy lại.

**Investigate**: nếu drift xuất phát từ bug (service mutate balance
quên ghi ledger) → mở P1 issue + PR fix + test reproduce.

### 2.7. Topup / payment lỗi (P2)

**Triệu chứng**: Admin Stats panel báo > 50 stale pending topup
(`GET /api/admin/economy/alerts`), hoặc player báo "tôi đã chuyển
khoản 24h rồi mà chưa được cộng tiền ngọc".

**Verify**:
```bash
curl -H "Authorization: Bearer <admin-token>" \
  "https://<host>/api/admin/economy/alerts?staleHours=24" | jq .
```

**Mitigate** (xem `docs/TROUBLESHOOTING.md` §16):
- **Tạm thời**: bump threshold env `ECONOMY_ALERTS_DEFAULT_STALE_HOURS=48` +
  restart API → cho admin có thời gian duyệt.
- **Dài hạn**: phân quyền MOD `approveTopup` rotate ca, hoặc bật
  auto-approve (chưa có, cần dev).
- **Player cá biệt**: admin duyệt trực tiếp qua admin panel
  `/admin/economy/topup-orders/<id>/approve` (idempotent, ledger row
  được ghi).
- KHÔNG tắt alerts — đó là guard rail.

### 2.8. JWT secret leak / cookie leak (P0)

**Triệu chứng**: log có raw `authorization: Bearer ...` hoặc
`cookie: xt_access=...` không bị `[REDACTED]`. Hoặc Sentry event
chứa header. Hoặc 1 token bị paste vào public channel.

**Verify**:
```bash
# Pino redact path xem `apps/api/src/observability/logger.ts`.
grep -E "Bearer [A-Za-z0-9._-]+" /var/log/xuantoi-api.log | head
```

**Mitigate IMMEDIATELY** (xem `docs/TROUBLESHOOTING.md` §17 triệu chứng C):
1. **Rotate JWT_ACCESS_SECRET + JWT_REFRESH_SECRET** ngay (sinh secret
   ≥ 32 ký tự bằng `openssl rand -base64 48`).
2. Restart API → mọi token cũ invalid → tất cả user phải login lại.
3. Update redact path trong `apps/api/src/observability/logger.ts`,
   thêm test reproduce, mở PR fix.
4. Nếu Sentry đã ingest event chứa secret → xóa event qua Sentry UI
   (Settings → Issues → Delete) và ghi nhận vào incident log.

### 2.9. Deploy rollback (P0/P1)

**Khi nào rollback**:
- Release mới crash on start (config error, env thiếu).
- Release mới gây regression P0/P1 (data corruption, ledger drift,
  cron grant trùng).

**Steps**:
```bash
# 1) Backup hiện trạng DB TRƯỚC khi rollback (đề phòng cần forensic)
BACKUP_DIR=/var/backups/xuantoi pnpm backup:db
# → tạo file xuantoi-<TS>.sql.gz

# 2) Code rollback: revert tag / redeploy commit cũ
# git tag -l  → chọn version trước
# CI/CD: re-run deploy pipeline với commit SHA cũ

# 3) Migration rollback: KHÔNG `prisma migrate reset` ở production!
#    Migration nên ADD-only (Prisma không hỗ trợ down migration tự động).
#    Nếu phải rollback schema, tạo migration mới reverse thủ công.

# 4) Smoke sau rollback:
curl -i https://<host>/api/healthz   # 200, uptimeMs < 10s
curl -i https://<host>/api/readyz    # 200, db ok, redis ok
curl -i https://<host>/api/version   # commit SHA = bản cũ?
```

> **Ngoại lệ**: nếu release mới chỉ có **code change, KHÔNG có
> migration mới** → rollback code đơn giản, không cần migration.

### 2.10. Backup restore procedure (P0 — DB lost / corruption)

**Khi nào**:
- DB instance unrecoverable (volume corrupt, hardware fail).
- Data corruption do migration sai (phải rollback time T-1).
- Restore vào staging để repro bug.

**Pre-flight**:
- [ ] Xác nhận **backup file** tồn tại (xem `BACKUP_DIR` mặc định
  `./backups/`, format `xuantoi-YYYYMMDD-HHMMSS.sql.gz`).
- [ ] Xác nhận `DATABASE_URL` đang trỏ đúng môi trường (staging /
  production / local).
- [ ] Xác nhận `NODE_ENV` đúng. Nếu `NODE_ENV=production`, restore
  script **mặc định CHẶN** trừ khi `ALLOW_PRODUCTION_RESTORE=YES` —
  điều này **bắt buộc** sign-off của tech lead trước khi gõ.
- [ ] Backup hiện trạng DB (đề phòng restore sai):
  ```bash
  BACKUP_DIR=/var/backups/xuantoi pnpm backup:db
  ```
- [ ] Gửi notice maintenance window cho player nếu restore production.

**Restore steps** (xem `docs/BACKUP_RESTORE.md` chi tiết):
```bash
# 1) Stop API (hoặc đặt maintenance flag)

# 2) Restore — staging/local default, KHÔNG động production:
CONFIRM_RESTORE=YES \
  DATABASE_URL=postgresql://<user>:<pass>@<staging-host>:5432/mtt \
  pnpm restore:db ./backups/xuantoi-<TS>.sql.gz

# 3) Migrate (nếu schema repo mới hơn backup):
DATABASE_URL=... pnpm --filter @xuantoi/api exec prisma migrate deploy
# hoặc bật flag chạy ngay sau restore:
RUN_PRISMA_MIGRATE=1 CONFIRM_RESTORE=YES pnpm restore:db ./backups/<file>.sql.gz

# 4) Verify:
DATABASE_URL=... pnpm verify:restore
# Optional: + API healthcheck
API_HEALTHCHECK_URL=https://<host>/api/healthz \
  DATABASE_URL=... pnpm verify:restore

# 5) Bootstrap idempotent:
DATABASE_URL=... pnpm --filter @xuantoi/api bootstrap

# 6) Audit ledger consistency:
DATABASE_URL=... pnpm --filter @xuantoi/api audit:ledger

# 7) Smoke per `docs/QA_CHECKLIST.md` §15-min check.

# 8) Restart API.

# 9) Watch first 30 phút: Sentry event count, /api/readyz status,
#    audit:ledger drift (chạy lại sau 10 phút).
```

**Production restore** (chỉ khi tech lead đồng ý + maintenance window
đã announce):
```bash
ALLOW_PRODUCTION_RESTORE=YES \
  CONFIRM_RESTORE=YES \
  RUN_PRISMA_MIGRATE=1 \
  DATABASE_URL=postgresql://<prod-credentials>/mtt \
  pnpm restore:db /var/backups/xuantoi-<TS>.sql.gz
```

### 2.11. Economy anomaly CRITICAL (P1) — Phase 16.6

**Trigger**: `EconomyAnomaly.severity = CRITICAL` mới xuất hiện trong
`AdminEconomySafetyPanel` (admin → Economy Safety tab) hoặc cron daily
ledger check tạo issue `severity=CRITICAL`.

**KHÔNG được**:
- Tự ban user khi nhìn thấy anomaly. Anomaly chỉ là **signal**, không
  phải bằng chứng.
- Tự rollback inventory / currency. Cần manual review trước.
- Public notify (mail / chat) — admin team xử lý nội bộ.

**Quy trình**:

1. **Đọc anomaly detail** trong panel: `source` / `characterId` /
   `windowKey` / `detailsJson`. Note `actionableUserId` (qua
   `Character.userId` lookup).
2. **Ack** ngay (`POST /admin/economy/anomalies/:id/ack`) để team khác
   biết bạn đang xử lý — KHÔNG resolve trừ khi đã hoàn tất.
3. **Cross-check ledger**:
   - Currency: `SELECT delta, source, createdAt FROM "LedgerEntry" WHERE
     "characterId" = $1 AND "createdAt" >= $2 ORDER BY "createdAt"`.
     Tổng `delta` phải khớp `Character.linhThach` snapshot.
   - Item: `SELECT itemKey, qtyDelta FROM "ItemLedgerEntry" WHERE
     "characterId" = $1`. Tổng phải khớp với `InventoryItem.qty`.
4. **Xác minh nguồn delta**:
   - Nếu source = `ADMIN_GRANT_OVER_LIMIT` → check `AuditLog` user
     admin nào grant; verify reason hợp lệ (event, refund, support
     case).
   - Nếu source = `RARE_ITEM_GAIN_24H` → check `LedgerEntry` /
     `ItemLedgerEntry` source field (`MISSION_REWARD`,
     `DUNGEON_RUN_REWARD`, `MAIL_CLAIM`, …). Nếu source không hợp lệ
     (ví dụ `MAIL_CLAIM` từ mail không tồn tại) → escalate.
   - Nếu source = `MARKET_OUTLIER` → check `Listing.pricePerUnit` và
     buyer/seller phải khác user (không phải alt account self-trade).
5. **Quyết định**:
   - **Hợp lệ** (event grant, support refund) → resolve anomaly với
     reason note.
   - **Không hợp lệ** (cheat, exploit, RMT) → escalate theo §4 rồi:
     - Manual revoke inventory / refund qua endpoint admin có sẵn
       (`POST /admin/users/:id/inventory/revoke`).
     - Ban user nếu đã có evidence rõ — qua endpoint admin ban hiện có.
6. **Resolve** anomaly (`POST /admin/economy/anomalies/:id/resolve`)
   sau khi xử lý xong, đính kèm reason vào audit `meta.reason`.

### 2.12. Ledger mismatch (P1) — Phase 16.6

**Trigger**: `EconomyLedgerCheckIssue.type` = `CURRENCY_LEDGER_MISMATCH`
hoặc `ITEM_LEDGER_MISMATCH` (cron daily 01:00 UTC, hoặc manual `POST
/admin/economy/ledger-check/run`).

**Quy trình**:

1. Đọc `detailsJson` issue: `{ characterId, expected, actual, diff,
   ledgerSource? }`.
2. **Reproduce manual**:
   ```sql
   -- Currency
   SELECT "characterId", SUM("delta") AS expected
   FROM "LedgerEntry"
   WHERE "characterId" = $1
   GROUP BY "characterId";
   -- So sánh với Character.linhThach
   SELECT "linhThach" FROM "Character" WHERE id = $1;
   ```
3. Nếu mismatch xác nhận → escalate. Cần manual:
   - Xác định nguồn: race condition? bug feature mới? exploit?
   - **KHÔNG tự sửa `Character.linhThach`** — viết SQL/migration sau khi
     có root cause + senior reviewer ký.
4. Ack issue rồi resolve sau khi đã ghi root cause vào incident note.

### 2.13. Player mất item / currency (P2) — Phase 16.6 hỗ trợ

(Mở rộng §2.6) Nếu player report mất item/currency:

1. Hỏi player: itemKey, lần cuối nhìn thấy, action gì (claim mail, equip,
   refine, sell, buy)?
2. Check `EconomyLedgerCheckIssue` gần nhất theo `characterId`:
   ```sql
   SELECT id, severity, type, "detailsJson", "createdAt"
   FROM "EconomyLedgerCheckIssue"
   WHERE ("detailsJson"->>'characterId') = $1
   ORDER BY "createdAt" DESC LIMIT 20;
   ```
3. Check `LedgerEntry` (currency) + `ItemLedgerEntry` (item) trong window
   plausible. Nếu thấy delta âm bất thường (ví dụ refine consume nhưng
   chưa thấy `RefineAttempt` row) → escalate dev.
4. Manual refund qua admin endpoint hiện có (`POST /admin/users/:id/grant`)
   — luôn ghi `reason="support refund <ticket-id>"` để audit. Phase 16.6
   admin grant alert sẽ tạo anomaly `ADMIN_GRANT_OVER_LIMIT` nếu vượt
   threshold; ack với reason note.

### 2.14. Market price abuse (P2) — Phase 16.6

**Trigger**: User report listing giá troll, hoặc anomaly source =
`MARKET_OUTLIER` xuất hiện trong panel.

**Quy trình**:

1. Listing **mới** (post sau Phase 16.6 deploy) ngoài band sẽ bị reject
   tại API với code `PRICE_TOO_LOW` / `PRICE_TOO_HIGH`. Nếu vẫn vào DB →
   bug, escalate dev.
2. Listing **cũ** (post trước Phase 16.6) có giá ngoài band → KHÔNG bị
   mutate. Manual cancel:
   ```sql
   UPDATE "Listing" SET status = 'CANCELLED' WHERE id = $1;
   ```
   Item trả về inventory người post. Note ticket reason.
3. Nếu phát hiện self-trade pattern (alt account mua với giá cao) →
   escalate ban evaluation.

### 2.15. Admin grant nhầm (P2) — Phase 16.6

**Trigger**: Admin team note grant nhầm số lớn / nhầm character.

**Quy trình**:

1. Phase 16.6 hook đã tạo `EconomyAnomaly` source =
   `ADMIN_GRANT_OVER_LIMIT` nếu delta vượt threshold. Tìm anomaly đó:
   ```sql
   SELECT * FROM "EconomyAnomaly"
   WHERE source = 'ADMIN_GRANT_OVER_LIMIT'
   ORDER BY "createdAt" DESC LIMIT 50;
   ```
2. Note `detailsJson.adminId` + `targetCharacterId` + `delta` + `reason`.
3. Manual revoke ngược qua `POST /admin/users/:id/grant` với `delta` âm
   (nếu endpoint hỗ trợ) hoặc revoke inventory item nếu là item grant.
   Reason luôn `"reverse-grant <ticket-id>"`.
4. Ack + resolve anomaly.

### 2.16. Arena anti-wintrade alert WARN (P2) — Phase 14.1.D

**Trigger**: Alert mới với severity `WARN` xuất hiện trong tab Admin
"Arena Anti-Wintrade", thường do `quickCheckPair` post-match hoặc
admin-triggered scan.

**Phương châm**: alert trước, ban sau. **Không** auto-ban, **không**
auto-rollback reward, **không** chặn người chơi đánh tiếp khi mới WARN.
Dùng panel để review và xử lý thủ công.

**Quy trình**:

1. Mở tab "Arena Anti-Wintrade" → filter `severity=WARN`, `status=OPEN`.
   Đọc cột `type` (REPEATED_OPPONENT_PAIR / RECIPROCAL_WIN_LOSS /
   RATING_GAIN_SPIKE / REWARD_FARM_PATTERN / SEASON_SUSPICIOUS_ACTOR) +
   `attacker` + `defender` + `windowKey`.
2. Lấy `windowKey` (ví dụ `pair24h:2026-05-09T00`) làm period bucket.
   Query match history trong cửa sổ đó:
   ```sql
   SELECT id, "createdAt", result, "ratingDeltaJson"
   FROM "ArenaMatch"
   WHERE (("attackerCharacterId" = $1 AND "defenderCharacterId" = $2)
       OR ("attackerCharacterId" = $2 AND "defenderCharacterId" = $1))
     AND "createdAt" >= NOW() - INTERVAL '24 hours'
   ORDER BY "createdAt" DESC;
   ```
3. Đối chiếu với pattern: cùng IP / device fingerprint không có ở phase
   14.1.D nhưng có thể xem `User.lastLoginIp` (nếu schema có) +
   `RefreshToken.userAgent`.
4. Quyết định:
   - **False positive** (player legit cày Arena chăm) → bấm "Đóng"
     (Resolve) trong panel, ghi note nội bộ. Không cần action gì thêm.
   - **Cần theo dõi tiếp** → "Xác nhận" (Ack) → status `ACKNOWLEDGED`.
     Không hành động gameplay. Đợi alert CRITICAL hoặc bằng chứng khác.
   - **Có dấu hiệu rõ** → escalate sang playbook 2.17 (CRITICAL).

### 2.17. Arena anti-wintrade alert CRITICAL (P1) — Phase 14.1.D

**Trigger**: Alert severity `CRITICAL` (đối tượng đã đạt threshold cao
hơn nhiều — ví dụ ≥ 12 trận cùng cặp / 24h, hoặc farm 1 defender duy
nhất ≥ 8 trận). KHÔNG có auto-action — admin BẮT BUỘC review.

**Quy trình**:

1. Mở panel → filter `severity=CRITICAL`, `status=OPEN`. Lấy
   `attacker` + `defender` + `details` (chứa `matchCount`, `ratingDelta`
   tổng, `winRate`, `distinctOpponents`).
2. Verify match history bằng SQL ở mục 2.16 hoặc API
   `GET /arena/matches/history?side=all&limit=50` (proxy qua admin DB
   query nếu không có endpoint admin trực tiếp).
3. Kiểm tra link account:
   ```sql
   SELECT u.id, u.email, c.id, c.name, c."lastLoginAt"
   FROM "Character" c JOIN "User" u ON u.id = c."userId"
   WHERE c.id IN ($1, $2);
   ```
   Cùng email domain / cùng register IP / cùng cookie session →
   khả năng cao là alt account collusion.
4. **Reward review**: trước khi settle season, query
   `ArenaSeasonRewardGrant` cho character đó. Nếu chưa settle → flag
   manual review (TODO Phase 14.1.E: wire `rewardEligibility =
   REVIEW_REQUIRED`). Nếu đã settle và xác định abuse → revoke
   reward thủ công qua `POST /admin/users/:id/grant` với delta âm
   (mục 2.15).
5. **KHÔNG** xóa `ArenaMatch` (vi phạm immutable audit). **KHÔNG**
   xóa `ArenaWintradeAlert`. **KHÔNG** auto-ban.
6. Quyết định ban → manual qua `POST /admin/users/:id/ban` (audit
   `ADMIN_USER_BAN`) với reason cụ thể. Reference alert ID + match
   IDs.
7. Sau xử lý → "Đóng" (Resolve) alert. Audit
   `ADMIN_ARENA_WINTRADE_ALERT_RESOLVE` được tự ghi.

**Force scan thủ công** (khi nghi ngờ pattern mới):
- POST `/admin/arena/anti-wintrade/scan` (body `{}`).
- Idempotent — gọi nhiều lần trong cùng cửa sổ không tạo duplicate.
- Trả `AntiWintradeScanSummary` để xác nhận `alertsCreated > 0`.

**Tuning thresholds** (chỉ khi false-positive nhiều):
- Override env: `ARENA_ANTI_WINTRADE_REPEATED_WARN`,
  `ARENA_ANTI_WINTRADE_REPEATED_CRIT`, `ARENA_ANTI_WINTRADE_SPIKE_WARN`,
  `ARENA_ANTI_WINTRADE_SPIKE_CRIT`, etc. (xem
  `arena-anti-wintrade.service.ts → readAntiWintradeRulesFromEnv`).
- Restart API sau khi đổi env. Doc lại trong `docs/DEPLOY.md` nếu
  thay đổi permanent.

### 2.18. PWA service worker phục vụ asset cũ (P3)

Xem `docs/TROUBLESHOOTING.md` §14. Hard refresh hoặc DevTools →
Application → Service Workers → Unregister. Build production tự bump
precache hash → user mới sẽ tự update sau lần load thứ 2.

---

### 2.19. LiveOps Event Scheduler — kill switch / force recompute (P1) — Phase 15.1–15.2

**Symptom**: 1 event LiveOps đang ACTIVE chạy sai (vd multiplier bị bypass cao bất thường, event-end-time qua nhưng ledger vẫn ghi event bonus, reward economy spike) → cần dừng ngay.

**Triage** (≤ 5 phút):
1. Check status event qua admin panel `/admin#liveops` (LiveOps Events panel) hoặc API `GET /admin/liveops/events`.
2. Cross-check `meta.dungeon.liveOpsDropMultiplier` trong `CurrencyLedger` 1h gần nhất xem có lệch.
3. Check `AdminAuditLog WHERE action LIKE 'ADMIN_LIVEOPS_EVENT_%' ORDER BY createdAt DESC LIMIT 50` xem ai đã touch.

**Fix** (P1 — 1h SLA):
1. **Kill switch**: `POST /admin/liveops/events/:id/disable` — set `status=DISABLED`, runtime ngừng compose multiplier ngay (không cần reload). Audit `ADMIN_LIVEOPS_EVENT_DISABLE` ghi vào `AdminAuditLog`.
2. **Force recompute** (nếu cron chưa transition kịp ENDED): `POST /admin/liveops/events/recompute-status` — idempotent, gọi nhiều lần OK.
3. **Audit replay**: query ledger 1h gần nhất, xác minh tổng over-grant. Nếu cần revoke → manual `POST /admin/users/:id/grant` với delta âm (xem §2.15).

**Operational config**:
- Cron `*/5 * * * *` UTC default. Override `LIVEOPS_EVENT_SCHEDULER_CRON_TZ` (vd `Asia/Ho_Chi_Minh`).
- Disabled by default — bật qua env `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true` rồi restart api worker.
- Race-safe: 2 worker chạy cùng tick → đúng 1 winner per row. Nếu thấy log `recompute: activated=N ended=M` lặp lại với count > 0 ở 2 worker khác nhau → check Redis lease.

**KHÔNG** trong Phase 15.1–15.2:
- KHÔNG auto-rollback ledger khi disable event giữa chừng — linh thạch đã cấp = giữ. Nếu cần revoke thủ công xem §2.15.
- KHÔNG support shop discount / sect shop / daily login / boss / festival gift — runtime chưa wire (defer Phase 15.3+).
- KHÔNG cho admin manually set `status=ACTIVE` qua PATCH (chỉ DRAFT/SCHEDULED/DISABLED) — phải qua cron để window chính xác.

### 2.20. LiveOps Runtime Expansion — verify discount / boost / festival gift (P2/P3) — Phase 15.3.A

**Use case**: sau merge Phase 15.3.A, runtime đã wire 5/5 event type còn lại. Sự cố hay gặp:
event boost không áp / áp sai / festival gift claim error / double claim.

**A. Verify event đang active có wire đúng runtime**

```
GET /liveops/events/active   # Player API — list active events public-safe
```

Mỗi entry có `runtimeSupported: true` (nếu type ∈ {DOUBLE_DUNGEON_DROP,
CULTIVATION_EXP_BOOST, SHOP_DISCOUNT, SECT_SHOP_DISCOUNT, DAILY_LOGIN_BONUS,
BOSS_REWARD_BOOST, FESTIVAL_GIFT}). Nếu thấy `false` → bug, escalate.

Cross-check trong DB:

```sql
SELECT key, type, status, multiplier_from_config(configJson) as mul
FROM "LiveOpsScheduledEvent"
WHERE status = 'ACTIVE' AND startsAt <= NOW() AND endsAt > NOW();
```

**B. Verify SHOP_DISCOUNT / SECT_SHOP_DISCOUNT áp đúng**

Sau khi player buy → kiểm tra ledger:

```sql
SELECT id, characterId, delta, reason, meta
FROM "CurrencyLedger"
WHERE reason IN ('NPC_SHOP_BUY', 'SECT_SHOP_BUY')
  AND createdAt > NOW() - INTERVAL '1 hour'
ORDER BY createdAt DESC LIMIT 20;
```

Mỗi row phải có `meta.shop.liveOpsDiscount` (= `mul`) + `meta.shop.liveOpsEventKey`.
Số `delta` ledger phải bằng `-finalPrice` (KHÔNG `-originalPrice`).

**C. Verify DAILY_LOGIN_BONUS áp đúng**

```sql
SELECT id, characterId, delta, reason, meta
FROM "CurrencyLedger"
WHERE reason = 'DAILY_LOGIN_CLAIM'
  AND createdAt > NOW() - INTERVAL '1 day'
ORDER BY createdAt DESC LIMIT 20;
```

Bonus phải reflect ở `delta` (so sánh với base reward expected). Cap thắng — nếu
`delta < base × multiplier` → có thể đã chạm Daily Reward Cap (Phase 16.5,
§2.18). Verify `RewardCapAccrual` row cùng character/day để confirm.

**D. Verify BOSS_REWARD_BOOST áp đúng**

Boss reward gửi qua `MailService.sendToCharacter`. Check mail metadata:

```sql
SELECT id, characterId, mailType, metadataJson
FROM "Mail"
WHERE mailType = 'BOSS_REWARD'
  AND createdAt > NOW() - INTERVAL '1 hour'
ORDER BY createdAt DESC LIMIT 20;
```

Mỗi mail phải có `metadataJson.liveOpsBoostMultiplier` + `liveOpsEventKey`.
Khi player claim mail → CurrencyLedger ghi `reason='MAIL_CLAIM'` với delta đã
boost.

**E. Festival Gift claim — debug double claim**

```sql
SELECT eventId, characterId, COUNT(*) as cnt
FROM "LiveOpsEventRewardClaim"
GROUP BY eventId, characterId
HAVING COUNT(*) > 1;
```

Nếu thấy row với `cnt > 1` → bug (UNIQUE constraint thất bại). Escalate ngay.
Bình thường UNIQUE `(eventId, characterId)` → P2002 → 409 `EVENT_ALREADY_CLAIMED`.

**F. Festival Gift claim error troubleshooting**

| Error code | Khả năng nhân quả | Fix |
| --- | --- | --- |
| `EVENT_NOT_FOUND` | Event đã bị xóa hoặc key sai | Verify event tồn tại qua admin panel |
| `EVENT_NOT_ACTIVE` | Event chưa start / đã end / DISABLED | Force `recompute-status` nếu cron lệch; verify `startsAt`/`endsAt` |
| `EVENT_NOT_CLAIMABLE` | Type ≠ FESTIVAL_GIFT | Chỉ FESTIVAL_GIFT cho phép claim — kiểm tra event type |
| `EVENT_ALREADY_CLAIMED` | Player đã claim 1 lần | Idempotent OK — KHÔNG là bug |
| `EVENT_REWARD_EMPTY` / `OVER_CAP` / ... | Reward config invalid | Admin sửa rewardJson qua `PATCH /admin/liveops/events/:id` |

**G. Force-disable event với runtime wired**

Bỏ qua wired runtime — `POST /admin/liveops/events/:id/disable` set
`status=DISABLED`, runtime fail-soft trả `1.0` (BOOST) hoặc `0` (DISCOUNT)
tự động → no-op cho gameplay flow.

**KHÔNG** trong Phase 15.3.A:
- KHÔNG bypass Daily Reward Cap (Phase 16.5) — cap thắng cho mọi BOOST event.
- KHÔNG auto-revoke festival gift đã claim nếu admin disable event sau.
- KHÔNG broadcast realtime "event start/end" qua WS trong scope 15.3.A — đã wire trong Phase 15.3.B (xem §2.21).

### 2.21. LiveOps Announcement + WS broadcast / marquee (P1/P2/P3) — Phase 15.3.B

**Use case**: sau merge Phase 15.3.B, server tự broadcast `liveops:announcement`
(`ANNOUNCEMENT_ACTIVE`/`ANNOUNCEMENT_ENDED`) + `liveops:event`
(`LIVEOPS_EVENT_ACTIVE`/`LIVEOPS_EVENT_ENDED`) khi cron transition status. Sự cố
hay gặp: announcement lỗi cần kill switch / WS không tới client / marquee/toast
spam / payload nghi ngờ leak admin field.

**A. Disable announcement lỗi (P1/P2 — kill switch)**

Dùng khi nội dung sai, severity sai (`MAINTENANCE` nhưng không có maintenance),
hoặc admin vô tình tạo overlap. Endpoint:

```
POST /admin/liveops/announcements/:id/disable
```

Guard: `@RequireAdmin()` — PLAYER/MOD reject `403 ADMIN_ONLY`. Audit log
`AdminAuditLog` action `ADMIN_LIVEOPS_ANNOUNCEMENT_DISABLE`.

Hiệu ứng:
- Set `status='DISABLED'`, `disabledAt=NOW()` (idempotent — gọi nhiều lần OK).
- Nếu announcement đang `ACTIVE` → cron tick kế tiếp / `recompute-status` sẽ
  emit `ANNOUNCEMENT_ENDED` qua `liveops:announcement`. Frontend store remove
  khỏi marquee, toast `severity=info` báo "Announcement ended".
- `GET /liveops/announcements/active` ngưng trả announcement ngay lập tức
  (filter `status='ACTIVE'`).

Force immediate broadcast (không đợi cron 5 phút):

```
POST /admin/liveops/announcements/recompute-status
```

Audit `ADMIN_LIVEOPS_ANNOUNCEMENT_RECOMPUTE`. Idempotent — chỉ broadcast khi
status thật transition (CAS qua `updateMany`).

Verify trong DB:

```sql
SELECT id, key, status, severity, disabledAt
FROM "LiveOpsAnnouncement"
WHERE id = '<announcement-id>';
```

`status='DISABLED'` + `disabledAt IS NOT NULL` → kill switch đã apply.

**B. Kiểm tra WS broadcast không gửi (P1)**

Triệu chứng: admin tạo announcement, tới `startsAt` mà player không thấy banner
(F5 mới thấy / không bao giờ thấy realtime).

B.1. Verify status đã transition trong DB:

```sql
SELECT id, key, status, startsAt, endsAt, updatedAt
FROM "LiveOpsAnnouncement"
WHERE key = '<key>';
```

Nếu `status` vẫn là `SCHEDULED` sau `startsAt` → cron không chạy. Check
`LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true` trong env (cron piggy-back trên
LiveOps event scheduler — nếu env false thì announcement cũng không transition).
Force manual: `POST /admin/liveops/announcements/recompute-status`.

B.2. Verify `LiveOpsBroadcastService` log:

```
grep "announcement broadcast" <api-log>
grep "realtime service not wired" <api-log>
```

Nếu thấy `realtime service not wired — drop announcement broadcast key=<key>` →
`RealtimeService` không inject vào `LiveOpsBroadcastService`. Restart API
process; verify `app.module.ts` import `RealtimeModule`.

B.3. Verify gateway connect:

- Browser DevTools → Network tab → WS connection lên `/socket.io/?EIO=4`.
- Console: `socket.connected === true`.
- Test broadcast bằng admin bấm `recompute-status` lần 2 — KHÔNG broadcast lần 2
  (anti-spam guard) trừ khi có row mới transition. Đây là behavior đúng, không
  phải bug.

B.4. Verify channel name khớp:

```
LIVEOPS_WS_CHANNEL_ANNOUNCEMENT = 'liveops:announcement'
LIVEOPS_WS_CHANNEL_EVENT        = 'liveops:event'
```

FE listener trong `apps/web/src/ws/client.ts` phải subscribe đúng 2 channel này.

B.5. Fail-safe: nếu `broadcastAnnouncement`/`broadcastEvent` throw → log
`warn` và return (KHÔNG bao giờ throw). Status transition trong DB vẫn commit.
Grep log `announcement broadcast failed` / `event broadcast failed` để biết
WS service crash nhưng DB OK → cần restart realtime / kiểm tra socket.io
adapter (Redis pub/sub nếu multi-instance).

**C. Xử lý marquee/toast spam (P2/P3)**

Triệu chứng: player thấy banner/toast lặp liên tục — annoyed UX.

C.1. Verify anti-spam guard server-side:

```sql
SELECT id, key, status, updatedAt
FROM "LiveOpsAnnouncement"
WHERE updatedAt > NOW() - INTERVAL '10 minutes'
ORDER BY updatedAt DESC;
```

Nếu một announcement có `updatedAt` flash liên tục (cron 5 phút × N lần) →
bug `recomputeStatusesWithTransitions` không CAS đúng. Verify chỉ row mới
transition mới được trả về (`updateMany` với `where: { status: 'SCHEDULED', startsAt <= now }` set `status='ACTIVE'`).

C.2. Verify FE store dedupe:

- `apps/web/src/stores/liveopsAnnouncements.ts` upsert theo `key` —
  KHÔNG push duplicate.
- Toast severity-based: dùng `liveopsAnnouncements.toast` namespace, mỗi
  severity tạo 1 toast; multiple announcement cùng severity vẫn 1 toast / event.

C.3. Hot patch FE quá tải:

- Player có thể bấm dismiss button trên banner → ẩn local sessionStorage theo
  `key`. Reload session sẽ hiện lại (intentional — không persist xuyên session).
- Nếu cần kill switch toàn cục (e.g. severity `MAINTENANCE` spam vì admin set
  sai window quá ngắn) → disable announcement (xem A) → cron emit
  `ANNOUNCEMENT_ENDED` → store remove + banner ẩn cho mọi player.

C.4. Rate limit công khai:

- WS broadcast chỉ trigger khi cron transition (5 phút) hoặc admin recompute
  thủ công. KHÔNG có path emit theo request count.
- Nếu thấy broadcast spam mỗi cron tick (5 phút × N) → bug — escalate (phải có
  guard `nextLiveOpsAnnouncementStatus` skip nếu status đã match).

**D. Xác minh public-safe payload (P2 — security)**

Triệu chứng cần verify: lo ngại WS hoặc `GET /liveops/announcements/active` leak
`adminId` / `disabledAt` / `configJson` / internal field.

D.1. Verify HTTP public response:

```
curl -s https://<api-host>/liveops/announcements/active | jq '.data[0] | keys'
```

Whitelist phải đúng: `["endsAt","key","messageEn","messageVi","severity","startsAt","target","titleEn","titleVi"]`. KHÔNG có
`id` / `createdByAdminId` / `disabledAt` / `createdAt` / `updatedAt`.

D.2. Verify WS payload:

- DevTools → Network → WS frame `liveops:announcement` event.
- Payload field: `key` / `severity` / `target` / `titleVi` / `titleEn` /
  `messageVi` / `messageEn` / `startsAt` / `endsAt` / `eventType`.
- KHÔNG được có: `adminId` / `createdByAdminId` / `disabledAt` / `id`.

D.3. Verify `target=ADMIN_ONLY` không broadcast ra public room:

- Tạo announcement với `target='ADMIN_ONLY'` → admin recompute → `LiveOpsBroadcastService.broadcastAnnouncement` early-return (không gọi
  `realtime.broadcast`).
- Player connected KHÔNG nhận event này. Verify bằng admin DevTools:
  player browser tab → Network WS frame → KHÔNG có frame `liveops:announcement`
  với `key=<admin_only_key>`.

D.4. Verify LiveOps event broadcast public-safe:

- WS payload `liveops:event` chỉ có `eventKey` / `eventType` / `title` /
  `description` / `startsAt` / `endsAt` / `runtimeSupported`.
- KHÔNG có `configJson` raw / `adminId` / multiplier raw nếu private.
- Verify trong code `LiveOpsEventSchedulerService.buildBroadcastPayload`
  / `LiveOpsBroadcastService.broadcastEvent` strip đúng field.

D.5. Validator HTML/script injection:

```sql
SELECT id, key, titleVi, messageVi
FROM "LiveOpsAnnouncement"
WHERE titleVi ~ '<' OR titleVi ~ 'script' OR messageVi ~ 'javascript:'
   OR titleEn ~ '<' OR messageEn ~ 'javascript:';
```

Kết quả phải `0 rows` — `validateLiveOpsAnnouncementInput` reject `<`/`>`/`script`/`javascript:` trước khi insert (`ANNOUNCEMENT_TITLE_UNSAFE` /
`ANNOUNCEMENT_MESSAGE_UNSAFE`). Nếu thấy row → bug, escalate; tạm thời disable
row đó.

**KHÔNG** trong Phase 15.3.B:
- KHÔNG gửi raw `configJson` qua public WS.
- KHÔNG cho HTML/script trong title/message — validator chặn.
- KHÔNG spam broadcast mỗi cron tick — chỉ emit khi status thật transition.
- KHÔNG auto-rollback announcement đã ACTIVE nếu admin sửa nội dung — phải
  `disable` trước, tạo announcement mới với `key` khác.
- KHÔNG broadcast `target=ADMIN_ONLY` ra public room — admin polling pattern
  qua `GET /admin/liveops/announcements`.

### 2.22. Feature Flag — emergency kill switch (P1) — Phase 15.4

Phase 15.4 thêm hệ Feature Flag DB-backed cho phép admin **bật/tắt nhanh
các hệ thống lõi** (Arena, Reforge/Enchant, LiveOps Events, Festival
Gift, Market, Tribulation Mini-Battle, Territory War, Shop/Sect Shop
Discount runtime) **mà không cần deploy code**. Catalog 11 flag
hardcoded trong `packages/shared/src/feature-flags.ts`. DB row tự lazy
ensure khi service `isEnabled()` lần đầu — flag không có DB row → fallback
default từ catalog. Cache 2-tier (L1 in-memory TTL 30s + L2 Redis TTL 30s)
với Redis fail-soft (Redis lỗi → vẫn dùng L1 → vẫn dùng DB → vẫn dùng
default catalog).

**Khi nào dùng**: bug nghiêm trọng / exploit production cần ngắt một
feature ngay lập tức, KHÔNG có thời gian deploy hotfix; cần re-enable
khi đã có fix.

**Truy cập panel**: AdminView → tab "Feature Flags". Permission:
`RequireAdmin()`. Audit log: `ADMIN_FEATURE_FLAG_*`
(`UPDATE`/`REFRESH_DEFAULTS`/`CLEAR_CACHE`). API endpoint:

```bash
# List + xem trạng thái live (admin token)
curl -H "Cookie: xt_access=$ADMIN_TOKEN" https://<host>/api/admin/feature-flags

# Tắt flag (ví dụ Arena)
curl -X PATCH -H "Cookie: xt_access=$ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  https://<host>/api/admin/feature-flags/ARENA_ENABLED

# Bật lại
curl -X PATCH -H "Cookie: xt_access=$ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  https://<host>/api/admin/feature-flags/ARENA_ENABLED

# Force clear cache nếu nghi cache stale
curl -X POST -H "Cookie: xt_access=$ADMIN_TOKEN" \
  https://<host>/api/admin/feature-flags/clear-cache

# Seed default flags (idempotent — chỉ tạo row chưa tồn tại)
curl -X POST -H "Cookie: xt_access=$ADMIN_TOKEN" \
  https://<host>/api/admin/feature-flags/refresh-defaults
```

**Cách verify flag đang có hiệu lực**:
```bash
# 1. Check public endpoint (whitelist subset)
curl https://<host>/api/feature-flags/public
# → {"ok":true,"data":{"flags":[{"key":"ARENA_ENABLED","enabled":false}, ...]}}

# 2. Trigger 1 request thật → server phải trả 503 FEATURE_DISABLED
curl -X POST -H "Cookie: xt_access=$PLAYER_TOKEN" -H "Content-Type: application/json" \
  -d '{"defenderCharacterId":"abc"}' \
  https://<host>/api/arena/matches
# → 503 {"ok":false,"error":{"code":"FEATURE_DISABLED","flag":"ARENA_ENABLED",...}}
```

**Tắt Arena khẩn cấp** (vd phát hiện exploit MMR):
1. Admin panel → search "ARENA_ENABLED" → click "Tắt" → confirm modal.
2. Verify `POST /arena/matches` trả 503 `FEATURE_DISABLED`.
3. Verify FE: `ArenaView` hiện banner "Đấu Đài đang tạm tắt" + nút
   challenge disabled (server vẫn gate cuối cùng — FE chỉ hint UX).
4. Tag postmortem: nguyên nhân, blast radius, ETA fix.

**Tắt LiveOps Event Scheduler nếu lỗi config**: tắt `LIVEOPS_EVENTS_ENABLED`
→ runtime modifier (boost/discount) **không apply**, admin vẫn thấy event
trong panel để debug. Cron scheduler vẫn chạy recompute (chỉ disable
modifier áp dụng cho player, không disable status machine).

**Tắt Festival Gift claim nếu phát hiện double reward**: tắt
`LIVEOPS_FESTIVAL_GIFT_ENABLED` → `POST /liveops/events/:eventKey/claim`
trả 503; FE ẩn nút claim. Trong khi đó dùng playbook §2.5 reward mail
duplicate để xác minh `LiveOpsEventClaim` UNIQUE và rollback nếu cần.

**Tắt Reforge/Enchant nếu exploit substat / element**: tắt
`EQUIPMENT_REFORGE_ENABLED` hoặc `EQUIPMENT_ENCHANT_ENABLED` → `POST
/character/equipment/reforge|enchant` trả 503. Player vẫn xem được
substat/enchant hiện có (read-only). Audit `EquipmentReforgeHistory` /
`EquipmentEnchantHistory` để forensic.

**Tắt Market khẩn cấp** (price abuse, ledger mismatch nghi ngờ):
`MARKET_ENABLED=false` → cả create listing + buy listing đều bị 503; list
read-only vẫn hoạt động. Khi đã fix → bật lại + chạy §2.14 anomaly check
trên ledger.

**Cache TTL = 30s** → admin toggle flag → server clear L1+L2 ngay; FE
public flag store auto-refresh sau 30s. Nếu cần ép FE refetch ngay →
admin panel có nút "Xoá cache" + người chơi reload trang.

**KHÔNG**:
- KHÔNG tự thêm flag key ngoài catalog — service reject
  `FEATURE_FLAG_KEY_INVALID`. Catalog phải PR vào shared trước.
- KHÔNG dùng flag để che bug thay vì test/fix — xem `docs/AI_WORKFLOW_RULES.md`.
- KHÔNG tắt flag SAFETY (vd `ARENA_ANTI_WINTRADE_ENABLED` trong tương lai)
  mà không có incident report.
- KHÔNG dựa vào FE flag store để security gate — server-authoritative
  qua `FEATURE_DISABLED` 503 là source of truth.

### 2.23. Maintenance Window — bật / tắt / lập lịch (P1) — Phase 15.5

Phase 15.5 thêm hệ Maintenance Window cho phép admin **lập lịch hoặc bật
khẩn cấp cửa sổ bảo trì** để chặn traffic player trong khi vẫn cho admin /
health / metrics / `/maintenance/status` đi qua. State machine:
`DRAFT → SCHEDULED → ACTIVE → ENDED` (theo cron 5 phút) hoặc `→ DISABLED`
(admin tắt khẩn cấp). Severity (`INFO` / `WARNING` / `CRITICAL`) + target
(`ALL_PLAYERS` / `NON_ADMIN_USERS` / `API_WRITE_ONLY` / `FULL_LOCKDOWN`)
quyết định bypass. Middleware `MaintenanceWindowGuardMiddleware` chạy
trước Nest pipeline với 9 bypass rule (xem `docs/API.md` §Maintenance
Window). Cache L1 in-memory TTL 10s per pod; recompute idempotent piggy-
back trên `LiveOpsEventSchedulerCronProcessor` 5'-tick (reuse — không có
queue/lease riêng).

**Khi nào dùng**:
- **Khẩn cấp** (P1): bug nghiêm trọng, exploit production cần ngắt write
  ngay (target `API_WRITE_ONLY`) hoặc khoá toàn bộ player (target
  `ALL_PLAYERS`/`NON_ADMIN_USERS`) trong khi xử lý sự cố.
- **Lập lịch** (P3): bảo trì DB, migration lớn, deploy backend major. Tạo
  `SCHEDULED` window với `startsAt` tương lai → cron tự ACTIVE đúng giờ →
  tự ENDED sau `endsAt`.
- **Khoá hoàn toàn** (P1): exploit nghi ngờ admin token leak → target
  `FULL_LOCKDOWN` chặn cả admin route (chỉ giữ `/maintenance/status`,
  health, metrics; KHÔNG giữ `/_auth/*` — chỉ rất hạn hữu).

**Truy cập panel**: AdminView → tab "Maintenance". Permission:
`RequireAdmin()`. Audit log: `ADMIN_MAINTENANCE_*`
(`CREATE`/`UPDATE`/`DISABLE`/`RECOMPUTE`).

**API endpoint**:

```bash
# List
curl -H "Cookie: xt_access=$ADMIN_TOKEN" https://<host>/api/admin/maintenance-windows

# Bật khẩn cấp (status=SCHEDULED, startsAt = now → cron tick 5' sẽ chuyển ACTIVE;
# nếu cần ACTIVE ngay, đặt startsAt = now − 1s rồi gọi recompute-status)
curl -X POST -H "Cookie: xt_access=$ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "key": "emergency-2026-05-10",
    "severity": "CRITICAL",
    "target": "API_WRITE_ONLY",
    "titleVi": "Bảo trì khẩn cấp",
    "titleEn": "Emergency Maintenance",
    "messageVi": "Hệ thống đang bảo trì. Quay lại sau 30 phút.",
    "messageEn": "System under maintenance. Please retry in 30 minutes.",
    "startsAt": "2026-05-10T17:00:00.000Z",
    "endsAt": "2026-05-10T17:30:00.000Z",
    "allowAdminBypass": true,
    "allowHealthcheck": true,
    "allowMetrics": true,
    "initialStatus": "SCHEDULED"
  }' \
  https://<host>/api/admin/maintenance-windows

# Force chuyển trạng thái ngay (idempotent) — không cần đợi cron 5 phút
curl -X POST -H "Cookie: xt_access=$ADMIN_TOKEN" \
  https://<host>/api/admin/maintenance-windows/recompute-status

# Tắt khẩn cấp một window đang ACTIVE (status → DISABLED, idempotent)
curl -X POST -H "Cookie: xt_access=$ADMIN_TOKEN" \
  https://<host>/api/admin/maintenance-windows/{id}/disable

# Sửa cấu hình (chỉ khi status còn DRAFT/SCHEDULED — ACTIVE/ENDED/DISABLED bị
# reject `MAINTENANCE_INVALID_STATUS_TRANSITION` 400)
curl -X PATCH -H "Cookie: xt_access=$ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"endsAt": "2026-05-10T18:00:00.000Z"}' \
  https://<host>/api/admin/maintenance-windows/{id}
```

**Cách verify maintenance đang có hiệu lực**:

```bash
# 1. Public status — anonymous-safe, không leak admin field
curl https://<host>/api/maintenance/status
# → {"ok":true,"data":{"active":true,"severity":"CRITICAL","target":"API_WRITE_ONLY",
#    "titleVi":"...","messageVi":"...","endsAt":"...","serverTime":"..."}}

# 2. Trigger 1 request thật từ player → server phải trả 503 MAINTENANCE_ACTIVE
curl -X POST -H "Cookie: xt_access=$PLAYER_TOKEN" -H "Content-Type: application/json" \
  -d '{"qty":1}' \
  https://<host>/api/shop/items/some-id/buy
# → 503 + Retry-After header
# → {"ok":false,"error":{"code":"MAINTENANCE_ACTIVE","meta":{"severity":"CRITICAL",
#    "target":"API_WRITE_ONLY","titleVi":"...","messageVi":"...","endsAt":"..."}}}

# 3. Healthcheck phải vẫn pass (allowHealthcheck=true)
curl https://<host>/api/healthz
# → 200

# 4. Metrics phải vẫn pass (allowMetrics=true)
curl https://<host>/api/metrics
# → 200 prometheus text

# 5. Admin login phải vẫn được (trừ FULL_LOCKDOWN — `/_auth/*` luôn bypass khác mode)
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@host","password":"..."}' https://<host>/api/_auth/login
# → 200
```

**Cách tắt nếu cấu hình sai** (vd `target=FULL_LOCKDOWN` mà admin token
hết hạn → chính admin cũng bị khoá):

1. **Nếu admin còn login được** (target ≠ FULL_LOCKDOWN, hoặc admin đang
   có session valid): mở admin panel → row maintenance → button "Disable"
   → confirm. Cache L1 max-stale 10s; FE poll `/maintenance/status` 30s
   sẽ tự refresh; player axios interceptor 503 sẽ tự bỏ blocked sau request
   tiếp theo.
2. **Nếu admin BỊ KHOÁ** (FULL_LOCKDOWN sai cấu hình hoặc admin token
   hết hạn không thể renew): SSH vào DB và update trực tiếp:
   ```sql
   UPDATE "MaintenanceWindow"
   SET status = 'DISABLED', "disabledAt" = NOW(), "updatedAt" = NOW()
   WHERE status = 'ACTIVE';
   ```
   Sau đó force restart pod để clear L1 cache (10s TTL nhưng đã ACTIVE
   trong cache → cache vẫn block tới khi expire).
   ```bash
   kubectl rollout restart deployment/api  # hoặc tương đương
   ```
3. **Sau khi xử lý**: `POST /admin/maintenance-windows/recompute-status`
   để force ENDED transition trên các window đang quá `endsAt` (nếu có).

**Rollback PR Phase 15.5** (nếu cần unrevert toàn bộ feature):
- Revert PR #515 trên GitHub: prisma migration là **additive** (chỉ thêm
  bảng `MaintenanceWindow` + 3 index), không destructive — revert code
  KHÔNG mất data, chỉ cần `DROP TABLE "MaintenanceWindow"` thủ công sau
  khi deploy revert nếu muốn schema sạch (không bắt buộc — bảng dư không
  ảnh hưởng).
- Middleware `MaintenanceWindowGuardMiddleware` được mount trong
  `AppModule.configure()` qua `MaintenanceWindowModule`; revert sẽ tự xoá
  middleware → request không bị guard.
- Cron piggy-back trong `LiveOpsEventSchedulerCronProcessor` cũng bị xoá
  khi revert — KHÔNG cần thay đổi env var (cron interval không đổi).

**KHÔNG**:
- KHÔNG tạo window có `target=FULL_LOCKDOWN` mà KHÔNG có `allowAdminBypass=true`
  trừ khi đã chuẩn bị fallback DB access (xem step 2 ở trên). Confirm modal
  trong admin panel sẽ cảnh báo nhưng KHÔNG bắt buộc.
- KHÔNG trông cậy admin panel để "tự tắt" nếu cấu hình sai khoá chính
  admin — hãy chuẩn bị DB fallback ngay từ đầu.
- KHÔNG sửa window đã ACTIVE/ENDED/DISABLED qua `PATCH` — service throw
  `MAINTENANCE_INVALID_STATUS_TRANSITION` 400. Tạo window mới hoặc disable
  cái cũ + tạo lại.
- KHÔNG dựa vào FE store/`isBlocked` để security gate — server-authoritative
  qua `MAINTENANCE_ACTIVE` 503 envelope là source of truth.
- KHÔNG quên `allowHealthcheck=true` + `allowMetrics=true` cho window
  CRITICAL — nếu sai sẽ khiến k8s liveness probe fail → pod loop restart.

### 2.27. Phase 15.7 — Sect Season + Territory Auto-Cron (P1/P2)

**Use case**: cron auto-run weekly cycle nhưng có sự cố — không settle, settle 2 lần, double mail, hoặc Redis lease bị stuck.

**Architecture invariant** (Phase 15.7):

- 2 cron job: `territory-weekly-settle` (Mon 00:05 ICT) + `sect-season-snapshot` (daily 00:15 ICT). Default OFF nếu env `*_CRON_ENABLED` không set true. TZ unified: `SECT_TERRITORY_CRON_TZ=Asia/Ho_Chi_Minh`.
- 2 lớp idempotency: Redis lease (best-effort, TTL 5min) + DB UNIQUE (authoritative). Multi-instance safe.
- Manual trigger: `POST /admin/liveops/run-weekly-cycle` / `POST /admin/territory/cron/run-now` / `POST /admin/sect-season/cron/run-now` — same code path as cron.
- Status read-only: `GET /admin/territory/cron/status` + `GET /admin/sect-season/cron/status`.

#### 2.27.1. Bật/tắt cron

**Production cần BẬT** (env mặc định OFF cho safety dev):

```bash
# .env (production)
SECT_SEASON_CRON_ENABLED=true
TERRITORY_CRON_ENABLED=true
SECT_TERRITORY_CRON_TZ=Asia/Ho_Chi_Minh
LIVEOPS_CRON_LEASE_TTL_SEC=300
# Optional override cron expression (mặc định OK):
# TERRITORY_WEEKLY_SETTLE_CRON='5 0 * * 1'
# SECT_SEASON_SNAPSHOT_CRON='15 0 * * *'
```

**Tắt khẩn cấp** (vd reward catalog sai, balance bug):

```bash
# Set env và restart pod (graceful):
SECT_SEASON_CRON_ENABLED=false
TERRITORY_CRON_ENABLED=false
```

Verify cron tắt qua status endpoint:

```bash
curl -s -X GET https://api.xuantoi.com/admin/sect-season/cron/status \
  -H 'Cookie: <admin-session>' | jq '.data.enabled'
# → false
```

#### 2.27.2. Force settle Sect Season tay (admin manual fallback)

Use case: cron bị tắt / lỡ cron / cần settle ngay sau khi season vừa end.

```bash
# Snapshot mọi season đã end (idempotent — chạy lại không tạo duplicate):
curl -X POST https://api.xuantoi.com/admin/sect-season/cron/run-now \
  -H 'Cookie: <admin-session>' \
  -H 'Content-Type: application/json' \
  -d '{}'
# Response data:
#   { seasonSnapshotsCreated, seasonSnapshotsSkipped, seasonsProcessed,
#     championMailsCreated, championAlreadyGranted,
#     mvpMailsCreated, mvpAlreadyGranted, errors }

# Bypass Redis lease nếu cần (chỉ dùng khi cron đang lease bởi worker đang chạy):
curl -X POST https://api.xuantoi.com/admin/sect-season/cron/run-now \
  -H 'Cookie: <admin-session>' -H 'Content-Type: application/json' \
  -d '{"bypassLease": true}'
```

#### 2.27.3. Force settle Territory tay

```bash
# Settle previous week (auto-detect):
curl -X POST https://api.xuantoi.com/admin/territory/cron/run-now \
  -H 'Cookie: <admin-session>' -H 'Content-Type: application/json' \
  -d '{}'

# Override periodKey (vd settle tuần ABCD-Wxx):
curl -X POST https://api.xuantoi.com/admin/territory/cron/run-now \
  -H 'Cookie: <admin-session>' -H 'Content-Type: application/json' \
  -d '{"periodKey": "2026-W19"}'

# Combo (settle + decay + reward + sect-season snapshot trong 1 call):
curl -X POST https://api.xuantoi.com/admin/liveops/run-weekly-cycle \
  -H 'Cookie: <admin-session>' -H 'Content-Type: application/json' \
  -d '{}'
```

#### 2.27.4. Kiểm tra reward đã grant chưa (SQL probe)

```sql
-- Phase 15.7: số mail Champion + MVP đã grant theo seasonKey.
SELECT "rewardType",
       COUNT(*) AS mails,
       MIN("grantedAt") AS first_granted,
       MAX("grantedAt") AS last_granted
FROM "SectSeasonRewardGrant"
WHERE "seasonKey" = 'season_2026_s1'
GROUP BY "rewardType";

-- Territory owner reward count theo periodKey + region:
SELECT "regionKey",
       COUNT(*) AS mails,
       MIN("grantedAt") AS first_granted,
       MAX("grantedAt") AS last_granted
FROM "TerritoryOwnerRewardGrant"
WHERE "periodKey" = '2026-W19'
GROUP BY "regionKey"
ORDER BY "regionKey";

-- Decay log (1 row/period — UNIQUE):
SELECT "periodKey", "decayBps", "rowsAffected", "pointsBefore", "pointsAfter", "triggeredAt"
FROM "SectTerritoryDecayLog"
ORDER BY "triggeredAt" DESC
LIMIT 5;

-- Settlement snapshot (1 row/(region,period) — UNIQUE):
SELECT "regionKey", "periodKey", "winnerSectName", "winnerPoints", "settledAt"
FROM "SectTerritorySettlementSnapshot"
WHERE "periodKey" = '2026-W19'
ORDER BY "regionKey";
```

#### 2.27.5. Cron chạy trùng — multi-instance hoặc retry

DB UNIQUE đã đảm bảo 0 double mail / 0 double settle. Cron retry hoặc 2 pod đua:

- 1 thắng → tạo grant row + mail.
- 1 thua → P2002 unique violation → service swallow → trả `existed`/`skipped`.

Verify không có double mail (phải = 0):

```sql
-- Phase 15.7 — không bao giờ có 2 grant cho cùng tuple.
SELECT "seasonKey", "rewardType", "characterId", COUNT(*) AS dup
FROM "SectSeasonRewardGrant"
GROUP BY "seasonKey", "rewardType", "characterId"
HAVING COUNT(*) > 1;
-- Empty kết quả = healthy.

SELECT "periodKey", "regionKey", "characterId", COUNT(*) AS dup
FROM "TerritoryOwnerRewardGrant"
GROUP BY "periodKey", "regionKey", "characterId"
HAVING COUNT(*) > 1;
-- Empty kết quả = healthy.
```

#### 2.27.6. Redis down — fail-soft behavior

`LiveOpsCronLease` dùng Redis SET NX EX 300s. Redis down (connect refused / timeout):

- Lease acquire/release → log warn, throw NOT.
- Service vẫn tiếp tục chạy → DB UNIQUE chống double.
- API KHÔNG crash. Cron vẫn idempotent.

Recover Redis: cron next tick tự pickup lease lại.

#### 2.27.7. Rollback nếu reward mail grant nhầm

**Lỗi gặp thường**: catalog reward set sai (vd 50000 LT thay vì 5000). Phát hiện sau khi grant batch.

Plan rollback (chỉ ADMIN truy cập DB):

```sql
-- Bước 1: Soft-delete mail (KHÔNG xoá grant row — giữ audit).
UPDATE "Mail"
SET "deletedAt" = NOW(),
    "subject" = "subject" || ' [REVOKED — wrong reward]'
WHERE "id" IN (
  SELECT "mailId"
  FROM "SectSeasonRewardGrant"
  WHERE "seasonKey" = 'season_2026_s1'
    AND "rewardType" = 'CHAMPION'
    AND "mailId" IS NOT NULL
);

-- Bước 2: Reverse currency nếu mail đã claim (claim → ledger row).
-- Đếm trước:
SELECT COUNT(*), SUM("delta") AS total_lt_to_reverse
FROM "CurrencyLedger"
WHERE "reason" = 'MAIL_REWARD_CLAIM'
  AND "refType" = 'Mail'
  AND "refId" IN (...mail ids từ bước 1...);

-- Bước 3: Liên hệ user qua announcement; KHÔNG silent revert ledger.
```

**KHÔNG**:

- KHÔNG xoá row `SectSeasonRewardGrant` (mất idempotency — cron next tick re-grant).
- KHÔNG `DROP TABLE` table grant.

#### 2.27.8. Test boundary — ICT timezone Sunday 23:00 ↔ Monday 00:00

Sau PR #517 hotfix, period key được tính theo Asia/Ho_Chi_Minh. Verify:

```bash
# Mock thời gian Sunday 23:00 ICT — periodKey = tuần hiện tại (chưa rollover).
TZ=Asia/Ho_Chi_Minh node -e "
const { previousTerritoryPeriodKey } = require('@xuantoi/shared');
const now = new Date('2026-05-10T16:00:00Z'); // = Sun 23:00 ICT
console.log(previousTerritoryPeriodKey(now)); // expect 2026-W18
"

# Mock thời gian Monday 00:30 ICT — periodKey = tuần vừa kết thúc.
TZ=Asia/Ho_Chi_Minh node -e "
const { previousTerritoryPeriodKey } = require('@xuantoi/shared');
const now = new Date('2026-05-10T17:30:00Z'); // = Mon 00:30 ICT
console.log(previousTerritoryPeriodKey(now)); // expect 2026-W19
"
```

#### 2.27.9. KHÔNG làm

- KHÔNG bật cron production mà chưa verify Redis healthcheck (Redis down → lease fallback nhưng cảnh báo PRODs mất quan sát).
- KHÔNG hot-edit `SectSeasonRewardGrant` row (mất idempotency).
- KHÔNG bypass DB UNIQUE bằng cách `INSERT ... ON CONFLICT DO NOTHING` ngoài service — service đã handle P2002.
- KHÔNG settle bằng `dryRun=false` trên DB production khi chưa test trên staging.

### 2.28. Phase 15.8 — LiveOps / Maintenance polish (P1/P2)

**Scope** (Phase 15.8): Maintenance WS broadcast, Maintenance edit workflow, LiveOps reward form picker, Cron health/stale status, Champion membership snapshot. KHÔNG đổi cron auto-run của Phase 15.7.

#### 2.28.1. Kiểm tra Maintenance WebSocket broadcast (P2)

**Triệu chứng**: Admin bật/tắt maintenance qua panel nhưng client không thấy overlay đổi trạng thái cho đến tick poll 30s.

**Probe**:

```bash
# 1. Mở Chrome DevTools → Network → WS → filter /ws.
# 2. Tạo / kích hoạt 1 maintenance window từ admin panel.
# 3. Quan sát frame có:
#    { "type": "MAINTENANCE_STATUS", "channel": "maintenance:status",
#      "payload": { "status": "ACTIVE" | "ENDED" | "DISABLED", ... } }
# 4. KHÔNG được có field "createdByAdminId", "adminId", "auditTrailId" trong payload.
```

**Server-side debug**:

```bash
# Bật log debug cho realtime + maintenance.
LOG_LEVEL=debug pnpm --filter @xuantoi/api start

# Trigger recompute từ admin endpoint:
curl -X POST -b "$ADMIN_COOKIE" https://api/admin/maintenance/recompute
# Expect log:
#   [MaintenanceWindowService] effectiveStatus transition SCHEDULED → ACTIVE
#   [RealtimeService] broadcast channel=maintenance:status type=MAINTENANCE_STATUS recipients=N
```

**Nếu broadcast KHÔNG fire**:

- Verify `MaintenanceWindowService.recomputeStatus()` thấy transition thật (prev != next). Recompute no-op KHÔNG broadcast (design).
- Check `RealtimeService` connection lên Redis (pub/sub). Redis down → fallback poll 30s vẫn hoạt động → KHÔNG rollback DB.

#### 2.28.2. Maintenance overlay không biến mất ở client (P1)

**Triệu chứng**: Admin đã `DISABLE` maintenance nhưng client vẫn thấy overlay sau 1 phút.

**Probe**:

```bash
# 1. Hỏi player F12 → Application → Local Storage → xuantoi-maintenance-store
#    Expect: { effectiveStatus: 'DISABLED' | 'NONE', ... } sau khi server broadcast.
# 2. Verify WS connect: Network → WS → /ws → connected = true.
# 3. SQL probe server-side:
psql -c "SELECT id, \"effectiveStatus\", \"startsAt\", \"endsAt\" FROM \"MaintenanceWindow\" ORDER BY \"updatedAt\" DESC LIMIT 5;"
```

**Recovery**:

- Player F5 reload trang. FE init store đọc `GET /maintenance/status` (REST) làm warm cache.
- Nếu vẫn lì, kiểm tra `MaintenanceOverlay.vue` có store binding đúng + `axios` interceptor không lock overlay state.

#### 2.28.3. Cron stale warning — territory >8d / sect-season >2d (P1)

**Triệu chứng**: Admin LiveOps panel hiện badge `STALE` đỏ cho 1 cron.

**Probe**:

```bash
# Read cron health từ admin endpoint (cookie admin):
curl -b "$ADMIN_COOKIE" https://api/admin/territory/cron/status | jq '.health'
# Expected fields:
# {
#   "status": "STALE" | "OK" | "DEGRADED" | "DISABLED",
#   "lastRunAt": "2026-05-01T...",
#   "lastSuccessAt": "2026-05-01T...",
#   "lastErrorAt": null,
#   "staleReason": "TERRITORY_CRON_LAST_SUCCESS_MS_TOO_OLD",
#   "nextExpectedRunAt": "2026-05-04T17:00:00Z"
# }

# SQL probe trực tiếp:
psql -c "SELECT \"cronKey\", \"finishedAt\", \"success\", \"errorMessage\" \
         FROM \"LiveOpsCronRunLog\" \
         WHERE \"cronKey\" IN ('territory_weekly', 'sect_season_daily') \
         ORDER BY \"finishedAt\" DESC LIMIT 10;"
```

**Decision tree**:

- `status=DISABLED` + `staleReason=null` → env cron tắt; KHÔNG báo đỏ. Đây là intentional dev/test default. Bật `TERRITORY_CRON_ENABLED=true` / `SECT_SEASON_CRON_ENABLED=true` ở env production.
- `status=STALE` + cron `enabled=true` → cron không chạy đủ chu kỳ. Check:
  - Server process còn alive? (Node restart làm mất NestJS scheduler tick.)
  - Redis lease bị stuck (key `lock:liveops-cron:*` còn TTL > expected)? Manual `DEL` nếu cần.
- `status=DEGRADED` → last run lỗi. Đọc `errorMessage` từ `LiveOpsCronRunLog` row mới nhất.

#### 2.28.4. Force run cron an toàn (P1)

Phase 15.7 đã có endpoint `POST /admin/liveops/run-weekly-cycle`. Phase 15.8 KHÔNG đổi semantic — chỉ thêm audit log row.

```bash
# Force settle territory + decay + reward mail cho period vừa qua:
curl -X POST -b "$ADMIN_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"periodKey":"2026-W19","dryRun":true}' \
  https://api/admin/liveops/run-weekly-cycle

# Inspect dryRun output trước khi run thật.
# Force grant champion + MVP cho 1 season:
curl -X POST -b "$ADMIN_COOKIE" \
  -d '{"seasonKey":"season_2026_s1"}' \
  https://api/admin/sect-season/grant-rewards
```

**KHÔNG**: Bypass `dryRun` trên production khi chưa staging-verify. Idempotent ≠ "an toàn nhân đôi".

#### 2.28.5. Kiểm tra Champion membership snapshot (P2)

**Triệu chứng / câu hỏi**: "Champion reward đi tới ai? Snapshot dùng membership lúc nào?"

```bash
# Snapshot row per season + sect:
psql -c "SELECT \"seasonKey\", \"sectId\", \"rank\", \"memberCount\", \
         jsonb_array_length(\"memberCharacterIdsJson\") AS json_len, \"createdAt\" \
         FROM \"SectSeasonChampionSnapshot\" \
         ORDER BY \"createdAt\" DESC LIMIT 10;"

# Đọc danh sách characterId trong snapshot 1 season:
psql -c "SELECT \"seasonKey\", \"memberCharacterIdsJson\" \
         FROM \"SectSeasonChampionSnapshot\" \
         WHERE \"seasonKey\" = 'season_2026_s1';"

# Verify reward grant dùng snapshot path (championUsedSnapshot=true trong summary log):
journalctl -u xuantoi-api --since '1 day ago' | grep 'grantSeasonRewards'
```

**Invariant** (Phase 15.8):

- Snapshot tồn tại → reward dùng snapshot membership. Member rời sect sau snapshot vẫn nhận champion mail.
- Snapshot không tồn tại (legacy pre-15.8) → reward fallback current membership. Log warning rõ: `championMembershipSnapshot missing → fallback current membership`.
- Cap 100 member/season. Deterministic order `characterId ASC`.

#### 2.28.6. Reward grant sai membership snapshot — recovery (P1)

**Triệu chứng**: Player kêu "Sect của em vô địch season X nhưng em không nhận thưởng champion mặc dù còn member trong snapshot".

**Probe**:

```bash
# 1. Verify player có trong snapshot member list:
psql -c "SELECT \"memberCharacterIdsJson\" ? 'character-id-here' AS in_snapshot
         FROM \"SectSeasonChampionSnapshot\"
         WHERE \"seasonKey\" = 'season_2026_s1';"

# 2. Verify grant row đã tồn tại:
psql -c "SELECT * FROM \"SectSeasonRewardGrant\"
         WHERE \"seasonKey\" = 'season_2026_s1'
           AND \"rewardType\" = 'CHAMPION'
           AND \"characterId\" = 'character-id-here';"

# 3. Verify mail đã tạo:
psql -c "SELECT * FROM \"Mail\" WHERE id = (
           SELECT \"mailId\" FROM \"SectSeasonRewardGrant\"
           WHERE \"seasonKey\" = 'season_2026_s1'
             AND \"characterId\" = 'character-id-here'
             AND \"rewardType\" = 'CHAMPION'
         );"
```

**Recovery** (admin trigger lại):

```bash
# Re-trigger reward grant (idempotent — KHÔNG double mail):
curl -X POST -b "$ADMIN_COOKIE" \
  -d '{"seasonKey":"season_2026_s1"}' \
  https://api/admin/sect-season/grant-rewards
# Summary trả về: championMailsCreated cho người chưa grant, championAlreadyGranted cho người đã có.
```

#### 2.28.7. KHÔNG làm

- KHÔNG xoá row `SectSeasonChampionSnapshot` (mất audit + Phase 15.8 fallback path sẽ dùng current membership → lệch).
- KHÔNG manual edit `LiveOpsCronRunLog` (mất chuỗi audit + health reader sẽ misleading).
- KHÔNG rollback table `SectSeasonChampionSnapshot` mà chưa kiểm tra reward grant đã chạy chưa.
- KHÔNG broadcast maintenance event tay (server-authoritative — chỉ `recomputeStatus` mới broadcast).

### 2.29. Phase 16.1.B — Economy Range Report (P2)

**Scope** (Phase 16.1.B): Admin xem báo cáo economy theo khoảng ngày qua endpoint `GET /admin/economy/range-report` + FE panel dưới tab Economy. Detection + reporting only — KHÔNG auto-ban, KHÔNG tự rollback ledger.

#### 2.29.1. Bật / tắt cron ledger checker (P2)

**Cron đã có từ Phase 16.6**. Phase 16.1.B KHÔNG đổi cron config — chỉ thêm endpoint báo cáo + FE panel.

Env (đặt trong production secret manager hoặc `.env.production`):

```bash
# Bật cron daily 01:00 UTC. Mặc định OFF.
LEDGER_CHECKER_CRON_ENABLED=true
LEDGER_CHECKER_CRON_SCHEDULE="0 1 * * *"
ECONOMY_ANTICHEAT_CRON_TZ=UTC
```

**Bật/tắt runtime**: Thay env + restart API. KHÔNG có endpoint admin để toggle (an toàn — tránh ai-đó-tự-tắt khi cron đang detect anomaly).

#### 2.29.2. Chạy ledger check thủ công (P2)

Cách 1 — qua FE:

1. Vào tab **Economy** trong Admin panel.
2. Cuộn xuống section **"Báo cáo kinh tế theo khoảng ngày"**.
3. Bấm **"Chạy ledger check ngay"**. Confirm prompt → API call.
4. Job idempotent theo dayBucket — chạy lại trong ngày trả `alreadyDone: true`, KHÔNG tạo duplicate issue.

Cách 2 — qua API:

```bash
curl -X POST -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"forceRerun": false}' \
  https://<host>/admin/economy/ledger-check/run
```

`forceRerun: true` chỉ dùng khi muốn re-run sau khi fix data — sẽ duplicate run nhưng issue được tạo lại từ đầu (KHÔNG dup vì có check theo `dayBucket + type + characterId`).

#### 2.29.3. Xem economy report (P2)

Cách 1 — qua FE:

1. Vào tab **Economy** → section **"Báo cáo kinh tế theo khoảng ngày"**.
2. Chọn `Từ ngày` / `Đến ngày` (default = 7 ngày gần nhất, max 31 ngày).
3. Bấm **"Tải báo cáo"**. Server trả breakdown theo source + top 10 character delta + category totals + anomaly summary + latest ledger check run.
4. Audit log `ADMIN_ECONOMY_REPORT_VIEW` tự ghi vào `AdminAuditLog`.

Cách 2 — qua API (dùng cho script offline / scheduled report):

```bash
curl -H "Authorization: Bearer <admin-jwt>" \
  "https://<host>/admin/economy/range-report?from=2026-05-01&to=2026-05-07"
```

Response shape: xem `docs/API.md` mục `/admin/economy/range-report`.

#### 2.29.4. Đọc EconomyLedgerCheckRun (P2)

Truy vấn DB hoặc xem latest qua endpoint `GET /admin/economy/ledger-check/latest`:

```sql
SELECT id, "dayBucket", status, "startedAt", "finishedAt",
       "issuesCreated", "summaryJson"
FROM "EconomyLedgerCheckRun"
ORDER BY "dayBucket" DESC LIMIT 10;
```

Status:
- **`OK`**: Không có discrepancy, cron chạy thành công.
- **`ISSUES_FOUND`**: Có ≥1 `EconomyLedgerCheckIssue` được tạo. Mở tab Economy Safety (Phase 16.6 panel) để xem chi tiết.
- **`FAILED`**: Run bị exception (DB lỗi, OOM). Xem `errorJson` field. Re-run thủ công sau khi fix.

`dayBucket` UNIQUE — re-run cùng ngày KHÔNG tạo run mới (idempotent). `forceRerun=true` overrides.

#### 2.29.5. Đọc EconomyAnomaly (P2)

```sql
SELECT id, "dayBucket", "characterId", source, severity, status,
       amount, "detailJson", "createdAt"
FROM "EconomyAnomaly"
WHERE status = 'OPEN'
ORDER BY severity DESC, "createdAt" DESC LIMIT 20;
```

Source bucket (Phase 16.6): `CURRENCY_DELTA_24H`, `RARE_ITEM_GAIN_24H`, `REWARD_CAP_BYPASS`, `ADMIN_GRANT_OVER_LIMIT`, `MARKET_OUTLIER`. Mỗi source có threshold riêng — xem `docs/BALANCE_MODEL.md` §18.

Ack qua `POST /admin/economy/anomalies/:id/ack` (chỉ đánh dấu đã review, chưa fix). Resolve qua `POST /admin/economy/anomalies/:id/resolve` (xong xử lý).

#### 2.29.6. Xử lý mismatch / suspicious delta (P2)

Khi report cho thấy `MARKET_OUTLIER` / `ADMIN_GRANT_OVER_LIMIT` / character delta lớn bất thường:

1. **Mở tab Economy → bấm "Tải báo cáo"** với khoảng ngày gần nhất (3-7 ngày).
2. Xem **top 10 character delta** — character nào có net delta tăng vọt.
3. Cross-check với `CurrencyLedger`:
   ```sql
   SELECT "createdAt", reason, delta, "balanceAfter"
   FROM "CurrencyLedger"
   WHERE "characterId" = '<id>' AND currency = 'LINH_THACH'
     AND "createdAt" >= NOW() - INTERVAL '7 days'
   ORDER BY "createdAt" DESC LIMIT 50;
   ```
4. Xác minh source legit (admin grant ticket, dungeon farm, market sell). Nếu bất thường:
   - **KHÔNG auto-rollback**.
   - **KHÔNG tự ban**.
   - Mở support ticket, review log, decide thủ công.
   - Nếu cần grant ngược (revert nhầm): dùng `POST /admin/users/:userId/grant-currency` với `reason="reverse-grant <ticket-id>"`.
5. Sau khi resolve, ack/resolve anomaly trong `AdminEconomySafetyPanel`.

#### 2.29.7. Xử lý admin grant bất thường (P2)

`ADMIN_GRANT_OVER_LIMIT` anomaly = 1 admin grant linhThach/tienNgoc vượt `ADMIN_GRANT_LIMIT_LINH_THACH` hoặc `ADMIN_GRANT_LIMIT_TIEN_NGOC` (xem `docs/BALANCE_MODEL.md`).

1. Lookup admin (`actorUserId` trong `AdminAuditLog` `ADMIN_GRANT_CURRENCY` action).
2. Verify có ticket support / reason hợp lý (audit `reason` field).
3. Nếu admin nhầm hoặc trộm acc — escalate to security admin, xem `RUNBOOK §2.8 JWT secret leak`.
4. Hook anomaly KHÔNG block grant — nếu cần reverse, tạo grant ngược (negative delta) với reason rõ ràng.

#### 2.29.8. KHÔNG làm

- KHÔNG auto-ban dựa trên report. Anomaly chỉ là signal cảnh báo.
- KHÔNG tự sửa `CurrencyLedger` để "fix" mismatch. Ledger immutable.
- KHÔNG load report khoảng > 31 ngày (server reject với `RANGE_TOO_LARGE`).
- KHÔNG để cron tắt > 7 ngày liên tiếp (mất audit cumulative — nếu cần tắt lâu, bù lại bằng manual run hằng ngày).
- KHÔNG cache response ở CDN/edge — endpoint chứa data nhạy cảm + audit log.

### 2.30. Phase 18.1 — Security Rate Limit + Abuse Block (P1/P2/P3)

Tham chiếu: [`docs/SECURITY.md`](./SECURITY.md) §12, [`docs/API.md`](./API.md) §AdminSecurityController, source <ref_file file="apps/api/src/modules/security/rate-limit.service.ts" /> + <ref_file file="apps/api/src/modules/security/security-abuse.service.ts" /> + <ref_file file="packages/shared/src/security-rate-limit.ts" />.

#### 2.30.1. Symptom → severity

| Symptom | Severity | Note |
|---|---|---|
| Toàn bộ user legit bị 429 / `ABUSE_BLOCKED` đồng loạt | **P0** | Có thể do salt collision hoặc misconfig — xem 2.30.5. |
| Vài chục user legit bị 429 hoặc admin báo "không vào được" | **P1** | Kiểm Redis status + recent SecurityEvent. |
| 1 user legit bị block sai (false-positive) | **P2** | Lift block + ghi audit. |
| Healthcheck `/healthz` / `/readyz` trả 429 | **P0** | Bug: monitoring bị block. Phải có `@SkipRateLimit()`. |
| Admin nghi đang bị brute force / scrape | **P1** | Xem `SecurityEvent` filter `LOGIN_FAILED` / `RATE_LIMIT_VIOLATION`. |

#### 2.30.2. Kiểm tra 1 user có bị rate-limit / block không

```bash
# Subject = userId (cuid). Scope IP_USER cho login, USER cho economy.
curl -s -b cookies.txt \
  'https://<host>/api/admin/security/rate-limit/status?policy=AUTH_LOGIN&scope=IP_USER&subject=<userId>'
# Response: { count, remaining, resetAt }
```

Hoặc qua FE: AdminView → tab **Bảo mật / Lạm dụng** → block list (filter type `USER`) + event list (filter `userId` qua URL param tạm thời, hoặc xem `SecurityEvent` SQL direct):

```sql
SELECT id, type, severity, "ipHash", "userId", policy, "detailJson", "createdAt"
FROM "SecurityEvent"
WHERE "userId" = '<userId>'
   OR "ipHash" = encode(digest(concat(current_setting('app.salt'), ':', '<ip>'), 'sha256'), 'hex')
ORDER BY "createdAt" DESC LIMIT 50;
```

> SQL chỉ dùng khi panel/endpoint không đủ — bình thường dùng panel.

#### 2.30.3. Lift 1 block (admin override) — P2

1. Mở AdminView → tab **Bảo mật / Lạm dụng** → bảng **Active Blocks**.
2. Filter `type=USER` hoặc `type=IP`, copy `id` block.
3. Bấm nút **"Lift"** → xác nhận → server gọi `POST /admin/security/blocks/:id/lift` → audit `ADMIN_SECURITY_BLOCK_LIFT`.

Hoặc qua API:

```bash
curl -X POST -b cookies.txt \
  'https://<host>/api/admin/security/blocks/<blockId>/lift'
# Success 200: { ok: true, data: { block: {...} } }
# Idempotent: nếu đã lift / không tồn tại → 404 BLOCK_NOT_FOUND + audit FAIL.
```

**Sau khi lift**: user/IP có thể request lại ngay (counter rate-limit Redis vẫn còn, nhưng abuse-block đã bỏ). Nếu cần reset luôn counter rate-limit: chờ window reset (xem `expiresAt` từ `GET /admin/security/rate-limit/status`) hoặc flush Redis key `ratelimit:<policy>:<scope>:<subject>` (chỉ làm khi user khẳng định bị block nhầm vì test).

#### 2.30.4. Xử lý IP / user bị block nhầm (false-positive) — P2

1. **Confirm user thật**: hỏi email/userId + lý do bị block (login fail nhiều, click claim spam, đa account chung wifi…).
2. **Identify block**: GET `/admin/security/blocks?type=USER` (paginate). Match `subjectHash` = userId raw (USER scope không hash userId).
3. **Lift** (xem 2.30.3).
4. **Root cause**: xem `SecurityEvent` cùng `ipHash` / `userId` → policy nào vi phạm. Nếu là `AUTH_LOGIN` → kiểm có brute force thật không (event `LOGIN_FAILED` 10+ row cùng email từ nhiều IP = thật, từ 1 IP = nhiều khả năng user gõ sai password).
5. **Document**: ghi short note vào ticket support — `blockId` + `reason` + lý do lift. Audit log đã ghi tự động.

> KHÔNG lift hàng loạt mà không kiểm root cause — có thể đang bị tấn công thật.

#### 2.30.5. Toàn bộ user bị block / 429 đồng loạt — P0

Thường do 1 trong 3 nguyên nhân:

1. **Misconfig `RATE_LIMIT_ENABLED=false`** trên 1 instance → admin lift block đang reset → khi flip lại true, mọi window đếm từ 0 → spam UI legit bị 429. **Mitigate**: rollback env, restart từng instance để Redis sync.
2. **Hash salt bị thay đổi giữa deploy** → block cũ vẫn match ipHash mới do collision rất hiếm; nhưng nếu salt rotate cố ý → block tồn tại từ trước cũng vẫn match request mới (vì cả ipHash request mới + ipHash trong row đều sai theo cùng cách, chỉ orphan). Trường hợp false-positive đồng loạt thường do salt empty → `'xuantoi-default-ip-salt'` (mọi IP hash giống nhau ở deploy mới — KHÔNG, vì IP khác → hash khác). Nếu nghi salt issue: kiểm `SECURITY_IP_HASH_SALT` env trên các instance đồng bộ.
3. **Redis nhồi key abuse:block tự cũ** → check `redis-cli KEYS 'abuse:block:*' | wc -l`. Nếu > 10k → có thể do bot tấn công thật. Trong incident P0 hợp pháp (DDoS), KHÔNG flush vội — xem 2.30.7 trước.

**Emergency switch**:

```bash
# Tạm tắt enforcement 5-10 phút để recover:
RATE_LIMIT_ENABLED=false  # restart API instance, ghi post-mortem
# Sau khi traffic ổn lại, flip true ngay, KHÔNG để false > 1h.
```

#### 2.30.6. Verify fail-open behavior khi Redis down — P1

1. SSH vào API instance staging.
2. Block Redis port: `iptables -A OUTPUT -p tcp --dport 6379 -j REJECT` (KHÔNG làm production!).
3. Spam `POST /api/_auth/login` với password sai 15 lần.
4. Expected: request vẫn 200/401 (KHÔNG 500), `console.warn` 1 lần `[RateLimitService] redis failed (fail-open)`, in-memory counter active.
5. Reset: `iptables -D OUTPUT -p tcp --dport 6379 -j REJECT`.

Production smoke: `pnpm --filter @xuantoi/api test -- --run rate-limit.service` đã cover fail-open path trong vitest mock.

#### 2.30.7. Đọc SecurityEvent / điều tra brute force — P1/P2

```bash
# Filter login failed trong 1 giờ qua, theo ipHash:
curl -s -b cookies.txt \
  'https://<host>/api/admin/security/events?type=LOGIN_FAILED&from=2026-05-11T05:00:00Z&limit=200'
```

Hoặc SQL:

```sql
SELECT "ipHash", COUNT(*) AS attempts,
       MAX("createdAt") AS last_seen,
       array_agg(DISTINCT "detailJson"->>'email') AS emails_tried
FROM "SecurityEvent"
WHERE type = 'LOGIN_FAILED'
  AND "createdAt" >= NOW() - INTERVAL '1 hour'
GROUP BY "ipHash"
ORDER BY attempts DESC LIMIT 20;
```

Nếu 1 ipHash có > 50 attempts với > 5 email khác nhau → credential stuffing. Block đã được tạo tự động (threshold 10/15p). Nếu cần block lâu hơn → tạo block thủ công qua admin (chưa có endpoint trực tiếp Phase 18.1 — fallback: dùng SQL `INSERT INTO "SecurityBlock"` với `type='IP'`, `subjectHash=<hash>`, `expiresAt=NOW() + INTERVAL '24 hours'`, `reason='MANUAL_INVESTIGATION'`). Audit thủ công qua note.

#### 2.30.8. Tăng / giảm policy threshold — code change

Phase 18.1 KHÔNG cho phép tweak policy qua env / DB row. Lý do: tránh "lén bypass rate-limit ở production" mà không peer-review. Để đổi:

1. Mở <ref_file file="packages/shared/src/security-rate-limit.ts" /> → sửa `RATE_LIMIT_POLICIES[KEY]`.
2. Update `security-rate-limit.test.ts` (catalog lock-in test) → run `pnpm --filter @xuantoi/shared test -- --run security`.
3. PR riêng (KHÔNG hot-fix).

Validator `validateRateLimitPolicy` đã chặn `maxRequests > 10000` / `windowSec > 24h` / `blockSec > 24h` — không thể vô ý "tắt rate-limit" qua catalog.

#### 2.30.9. KHÔNG làm

- KHÔNG bao giờ tắt `RATE_LIMIT_ENABLED` mà không có ticket P0 + post-mortem.
- KHÔNG set `SECURITY_IP_HASH_SALT=''` ở production (`IpHashService` sẽ dùng default → mất tính bí mật salt). Phải set ≥ 32 ký tự ngẫu nhiên.
- KHÔNG flush toàn bộ `abuse:block:*` Redis (Phase 18.1 dùng Prisma cho block, không Redis — flush KHÔNG có tác dụng. Block ở DB; muốn lift hàng loạt → SQL update + audit thủ công, **chỉ làm khi P0**).
- KHÔNG gắn `@SkipRateLimit()` cho route gameplay / economy chỉ vì user phàn nàn — phải tweak policy đúng cách (xem 2.30.8).
- KHÔNG log raw IP / password / token vào `SecurityEvent.detailJson` khi thêm event type mới — `IpHashService.hashIp` luôn được gọi trước khi persist.
- KHÔNG dùng `RATE_LIMIT_FAIL_OPEN=false` trừ khi đã có WAF/CDN layer trên (closed beta hiện tại chưa có).

### 2.31. Phase 18.2 — Session Management Hardening (P1/P2)

Tham chiếu: [`docs/SECURITY.md`](./SECURITY.md) §13, [`docs/API.md`](./API.md) §AuthController + §AdminSecurityController. Source: <ref_file file="apps/api/src/modules/auth/session.service.ts" />.

#### 2.31.1. Symptom: report player nói "bị đăng xuất bất ngờ trên tất cả thiết bị"

1. Lookup user trong `UserSession`:
   ```sql
   SELECT id, "ipHash", "userAgent", "createdAt", "lastSeenAt", "revokedAt", "revokedReason", "revokedById"
     FROM "UserSession" WHERE "userId" = '<user>' ORDER BY "createdAt" DESC LIMIT 10;
   ```
2. Nếu **tất cả session** có `revokedReason = REFRESH_REUSED` cùng lúc → **reuse detection** đã trigger:
   - Check `SecurityEvent` `REFRESH_TOKEN_REUSED` cho user → `severity = CRITICAL`.
   - **Có khả năng cao token bị steal** (cookie leak / XSS / MITM). Liên hệ user xác nhận.
   - Bump `passwordVersion` qua force change-password nếu user xác nhận compromise.
3. Nếu `revokedReason = PASSWORD_CHANGED` → user vừa đổi pass (intended).
4. Nếu `revokedReason = ADMIN_REVOKE` + `revokedById != null` → admin đã revoke. Lookup `AdminAuditLog action = ADMIN_SECURITY_SESSION_REVOKE`.
5. Nếu `revokedReason = USER_LOGOUT` → user tự revoke từ `/_auth/sessions/:id`.

#### 2.31.2. Admin revoke session 1 user (incident response)

Khi nhận report user bị steal token / compromised:
```bash
# List active session của user
curl -X GET "https://api/admin/security/sessions?userId=<uid>&status=ACTIVE" \
  -H "Cookie: xt_access=<admin-token>"

# Revoke 1 session
curl -X POST "https://api/admin/security/sessions/<sessionId>/revoke" \
  -H "Cookie: xt_access=<admin-token>"
```
Audit ghi tự động `ADMIN_SECURITY_SESSION_REVOKE`. Nếu muốn kill mọi phiên: gọi admin reset-password (bump `passwordVersion` + revoke all session + email user reset).

#### 2.31.3. Mass reuse spike (P0)

Symptom: `REFRESH_TOKEN_REUSED` event nhiều user khác nhau cùng 1 IP range / cùng 1 phút.

1. **Có thể** đang bị attack botnet replay token leak (DB dump / log leak). Cấp độ P0.
2. Kiểm tra `SecurityEvent`:
   ```sql
   SELECT date_trunc('minute', "createdAt") AS m, count(*) AS n
   FROM "SecurityEvent" WHERE type = 'REFRESH_TOKEN_REUSED'
     AND "createdAt" > now() - interval '1 hour'
   GROUP BY m ORDER BY m DESC;
   ```
3. Nếu spike rõ → bump `JWT_REFRESH_SECRET` env → redeploy → toàn bộ JWT cũ invalid. Bao gồm cả attacker.
4. Post-mortem: tìm source leak (log? backup? DB dump?). Phối hợp 2.8 (JWT secret leak).

#### 2.31.4. KHÔNG được làm

- KHÔNG truncate `UserSession` table — sẽ leak audit trail và phá rotation lookup. Nếu cần dọn để giảm size: query expired rows + soft archive.
- KHÔNG xoá `RefreshToken` row đã revoked — `argon2.verify` check vẫn cần để detect reuse.
- KHÔNG copy/log `userAgent` raw vào audit nếu chưa qua `sanitizeUserAgent`.
- KHÔNG log raw IP — chỉ `ipHash` từ `IpHashService.hashIp`.

### 2.32. Phase 18.3 — Security Alert Workflow (P1/P2)

**Mục tiêu**: Cách admin xử lý `SecurityAlert` từ FE `AdminView` tab "Cảnh báo bảo mật" (`securityAlerts`). Alert layer là **monitoring + workflow only** — KHÔNG auto-ban, KHÔNG auto-rollback, KHÔNG auto-revoke session.

#### 2.32.1. Symptom → severity

| Symptom | Severity | Action |
| --- | --- | --- |
| Summary card "OPEN — CRITICAL" > 0 | **P1** | Mở tab securityAlerts, filter `severity=CRITICAL status=OPEN`, xem chi tiết. |
| Summary card "Reuse token 24h" > 0 | **P1** (mass) hoặc **P2** (1 user) | Xem alert `REFRESH_TOKEN_REUSED` — đối chiếu §2.31.3. |
| Summary card "Suspicious 24h" tăng đột biến | **P2** | Filter `type=SESSION_SUSPICIOUS`, đối chiếu ipHash / userAgent. |
| Summary card "Rate-limit 24h" rất lớn | **P2/P3** | Đối chiếu §2.30 — có thể là 1 bot batch không nguy hiểm. |
| Alert `ADMIN_FORBIDDEN` xuất hiện thường xuyên 1 userId | **P1** | Có thể admin bị compromise — đối chiếu §2.8 (cookie leak). |
| Alert `SUBJECT_BLOCKED` (USER) trên 1 admin | **P1** | Block đó là sai — vào tab Bảo Mật (Phase 18.1) lift block + resolve alert. |

#### 2.32.2. Xử lý 1 alert WARN/CRITICAL

1. Mở tab `securityAlerts` → summary cards cho biết khối lượng tổng thể.
2. Filter `status=OPEN` (default) → tìm alert cần xử lý.
3. Đối chiếu `eventId` với `SecurityEvent` (Phase 18.1 tab Bảo Mật) để xem detail gốc (`detailJson`, `ipHash`, `userId`).
4. Nếu cần action mạnh hơn (lift block / revoke session) → dùng đúng tab tương ứng (Phase 18.1 Bảo Mật / Phase 18.2 Sessions); **KHÔNG** dùng tab securityAlerts để mutate gameplay/economy.
5. Sau khi xử lý: bấm **Acknowledge** (alert chuyển `ACKNOWLEDGED`, gắn `acknowledgedByAdminId` + timestamp). Nếu chưa xác định nguyên nhân, dừng ở ACK để mark "đang theo dõi".
6. Khi đã xác minh xong + có ghi chú: bấm **Resolve** + nhập note (≤ 1000 ký tự) → alert chuyển `RESOLVED`. Note được sanitize (strip control char). Resolve KHÔNG xóa row — vẫn lưu lịch sử ack/resolve trong audit.

#### 2.32.3. Idempotent semantics

- Ack 1 alert đã `ACKNOWLEDGED` → no-op (server trả row hiện tại).
- Ack 1 alert đã `RESOLVED` → reject 409 `ALERT_ALREADY_RESOLVED` (admin không ack ngược 1 alert đã đóng — xem lại).
- Resolve 1 alert `OPEN` → skip-ack path, set cả `acknowledgedAt` + `resolvedAt` cùng lúc.
- Resolve 1 alert đã `RESOLVED` → reject 409 (cần `note` mới qua row mới hoặc edit gốc).

#### 2.32.4. Audit trail

Mọi mutation ghi `AdminAuditLog`:

- `ADMIN_SECURITY_ALERTS_VIEW` — list query.
- `ADMIN_SECURITY_SUMMARY_VIEW` — dashboard refresh.
- `ADMIN_SECURITY_ALERT_ACK` (success) / `ADMIN_SECURITY_ALERT_ACK_FAILED` (404/409).
- `ADMIN_SECURITY_ALERT_RESOLVE` (success) / `ADMIN_SECURITY_ALERT_RESOLVE_FAILED` (400/404/409).

Query audit để re-construct workflow:

```sql
SELECT "createdAt", "actorUserId", "action", "meta"
FROM "AdminAuditLog"
WHERE "action" LIKE 'ADMIN_SECURITY_ALERT_%'
ORDER BY "createdAt" DESC
LIMIT 100;
```

#### 2.32.5. KHÔNG được làm

- KHÔNG xóa row `SecurityAlert` — workflow chỉ dùng `status`. Xóa sẽ leak audit trail.
- KHÔNG auto-ban dựa trên số lượng alert OPEN — admin phải bấm action ở tab Bảo Mật / Sessions.
- KHÔNG copy/log `detailsJson` raw ra ngoài Postgres (đã sanitize ở BE; tuy nhiên trên FE không export CSV mục này).
- KHÔNG resolve hàng loạt không note — note bắt buộc để audit theo người xử lý sau này.

### 2.33. Phase 16.3 — Gameplay Anti-cheat Deep Detection (P1/P2)

**Mục tiêu**: Cách admin chạy scan / xử lý anomaly trong tab `AdminView` "Gameplay Anti-cheat" (`gameplayAntiCheat`). **Detection-only** — KHÔNG auto-ban, KHÔNG rollback, KHÔNG tự trừ EXP/item/đá, KHÔNG khoá tài khoản. Anomaly là **signal**, không phải bằng chứng.

#### 2.33.1. Symptom → severity

| Symptom | Severity | Action |
| --- | --- | --- |
| `openCriticalCount > 0` (summary card) | **P1** | Mở tab `gameplayAntiCheat`, filter `severity=CRITICAL status=OPEN`, xử lý theo §2.33.3. |
| `type=COMBAT_RESULT_MISMATCH` ≥1 trong 1h | **P1** | Không có baseline legitimate → suy ra exploit/bug. Đối chiếu battle log + escalate dev. |
| `type=CURRENCY_GAIN_SPIKE` CRITICAL (≥1M LT/1h) | **P1** | Có thể là RMT / exploit grant. Cross-check ledger + admin grant audit. |
| `type=EXP_GAIN_SPIKE` CRITICAL (≥500k EXP/1h) | **P1** | Cultivation bot / exploit reward. |
| `type=DUNGEON_REWARD_FARM` / `BOSS_REWARD_FARM` / `MISSION_REWARD_FARM` / `ARENA_REWARD_FARM` WARN | **P2** | Cày dày legit có thể chạm — đối chiếu trước khi action. |
| `type=ARENA_REWARD_FARM` CRITICAL (≥80 WIN/24h) | **P1** | Đối chiếu Phase 14.1.D Arena Anti-Wintrade (§2.16/§2.17) — có thể là wintrade pattern. |
| `type=TERRITORY_REWARD_SPIKE` WARN+ | **P2** | Multi-region pattern — đối chiếu `TerritoryOwnerRewardGrant` history. |
| `type=REWARD_CAP_BYPASS_ATTEMPT` CRITICAL (≥20 lần/1h) | **P1** | Bot farm chạm cap liên tục — cần manual investigate. |

#### 2.33.2. Chạy scan thủ công

**Khi nào**: (a) Player report nghi cheat; (b) Trước khi deploy patch reward/dungeon; (c) Sau incident để rà soát lại window cũ.

```bash
# Default — scan với windowMs từ rule catalog (1h / 24h / 7d tuỳ type)
curl -X POST https://api/api/admin/anticheat/gameplay/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{}'

# Force re-scan 1 windowKey cụ thể (idempotent — đã có row sẽ skip qua P2002)
curl -X POST https://api/api/admin/anticheat/gameplay/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{"windowKey":"hour:2026-05-11T10:00"}'

# Sweep batch dài hơn (≤ 30 ngày)
curl -X POST https://api/api/admin/anticheat/gameplay/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{"windowMs": 2592000000}'
```

Response `GameplayScanSummary`:

```json
{
  "ok": true,
  "data": {
    "totalCreated": 3,
    "totalSkipped": 12,
    "totalErrored": 0,
    "byType": { "DUNGEON_REWARD_FARM": 2, "EXP_GAIN_SPIKE": 1 },
    "windowKeysByType": { ... }
  }
}
```

`totalSkipped` cao là **bình thường** — idempotent re-run gặp row cũ. `totalErrored > 0` → check log để xem rule nào fail (1 rule fail KHÔNG phá rule khác).

Audit: `ADMIN_ANTICHEAT_GAMEPLAY_SCAN` (`actorUserId` + summary trong `meta`).

#### 2.33.3. Xử lý 1 anomaly WARN/CRITICAL

1. Mở tab `gameplayAntiCheat` → summary cards cho biết khối lượng OPEN tổng thể + critical/warn/info breakdown.
2. Filter `status=OPEN` + `severity=CRITICAL` trước → xử lý theo độ ưu tiên.
3. Đọc `detailsJson` của anomaly: thường chứa `characterId`, `windowKey`, `count`/`delta`, source-specific fields (vd `dungeonRunIds`, `bossKeys`, `arenaMatchIds`). KHÔNG có raw IP / token / cookie.
4. **Cross-check ledger / runtime row** tuỳ type:

   ```sql
   -- CURRENCY_GAIN_SPIKE / BOSS_REWARD_FARM (Σ delta dương + reason BOSS_REWARD)
   SELECT "createdAt", "delta", "reason", "currency"
   FROM "CurrencyLedger"
   WHERE "characterId" = $1
     AND "createdAt" >= NOW() - INTERVAL '1 hour'
   ORDER BY "createdAt" DESC;

   -- ITEM_GAIN_SPIKE (Σ qtyDelta dương)
   SELECT "createdAt", "itemKey", "qtyDelta", "source"
   FROM "ItemLedger"
   WHERE "characterId" = $1
     AND "qtyDelta" > 0
     AND "createdAt" >= NOW() - INTERVAL '1 hour'
   ORDER BY "createdAt" DESC;

   -- DUNGEON_REWARD_FARM
   SELECT id, "templateId", status, "claimedAt"
   FROM "DungeonRun"
   WHERE "characterId" = $1
     AND status = 'CLAIMED'
     AND "claimedAt" >= NOW() - INTERVAL '24 hours'
   ORDER BY "claimedAt" DESC;

   -- ARENA_REWARD_FARM (đối chiếu §2.16/§2.17 Phase 14.1.D nếu có pair pattern)
   SELECT id, "attackerCharacterId", "defenderCharacterId", "winnerCharacterId", "createdAt"
   FROM "ArenaMatch"
   WHERE "winnerCharacterId" = $1
     AND "createdAt" >= NOW() - INTERVAL '24 hours'
   ORDER BY "createdAt" DESC;

   -- TERRITORY_REWARD_SPIKE
   SELECT id, "regionKey", "rewardJson", "grantedAt"
   FROM "TerritoryOwnerRewardGrant"
   WHERE "characterId" = $1
     AND "grantedAt" >= NOW() - INTERVAL '7 days'
   ORDER BY "grantedAt" DESC;
   ```

5. Đối chiếu với Phase 16.6 `EconomyAnomaly` (cùng `characterId`) — nếu có `CURRENCY_DELTA_24H` / `ADMIN_GRANT_OVER_LIMIT` cùng window → escalate cao hơn (multi-signal).

6. **Quyết định**:
   - **False positive** (player cày legit, event mới, support refund hợp lệ) → `Resolve` với note nêu lý do.
   - **Cần theo dõi tiếp** → `Ack` (chuyển `OPEN → ACKNOWLEDGED`). Không action gameplay.
   - **Có dấu hiệu rõ** → escalate:
     - Manual revoke inventory/currency: dùng endpoint admin hiện có (`POST /admin/users/:id/inventory/revoke`, `POST /admin/users/:id/grant` với delta âm). Reason ghi `"phase 16.3 anomaly <id>"`.
     - Ban: dùng endpoint admin ban hiện có sau khi đã có evidence.
     - Sau khi xử lý xong → `Resolve` với note `"action: ban/revoke; root: <description>"`.

#### 2.33.4. Idempotent semantics

- Ack 1 anomaly đã `ACKNOWLEDGED` → 404 `ANOMALY_NOT_FOUND_OR_NOT_OPEN` (không ack ngược).
- Resolve 1 anomaly đã `RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_RESOLVED`.
- Resolve 1 anomaly `OPEN` → skip-ack path (chỉ set `resolvedAt` + `resolvedByAdminId`; `acknowledgedAt` vẫn null nếu chưa ack qua bước riêng).
- Scan trùng `windowKey` + `type` + `characterId` → `upsertAnomaly` bắt P2002 → đếm vào `totalSkipped` (multi-instance race-safe).

#### 2.33.5. Audit trail

Mọi mutation ghi `AdminAuditLog`:

- `ADMIN_ANTICHEAT_GAMEPLAY_SCAN` (meta = `{ totalCreated, totalSkipped, totalErrored, windowKeysByType }`).
- `ADMIN_ANTICHEAT_GAMEPLAY_ACK` (meta = `{ anomalyId }`).
- `ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE` (meta = `{ anomalyId, noteLength }`).

Query audit để re-construct workflow:

```sql
SELECT "createdAt", "actorUserId", "action", "meta"
FROM "AdminAuditLog"
WHERE "action" LIKE 'ADMIN_ANTICHEAT_GAMEPLAY_%'
ORDER BY "createdAt" DESC
LIMIT 100;
```

#### 2.33.6. Verify migration & cron

```bash
# Verify migration đã apply
psql "$DATABASE_URL" -c "\d \"GameplayAnomaly\""
# Phải thấy table + unique index (type, characterId, windowKey).

# Smoke scan với DB rỗng — phải trả totalCreated=0, totalErrored=0
curl -X POST https://api/api/admin/anticheat/gameplay/scan \
  -H 'Content-Type: application/json' -b 'access_token=...' -d '{}'
```

**Cron**: Phase 16.3 KHÔNG enable cron tự động — admin chạy thủ công qua FE/curl. Hook env reserved cho Phase follow-up.

#### 2.33.7. KHÔNG được làm

- **KHÔNG auto-ban / KHÔNG auto-rollback / KHÔNG auto-deduct** dựa trên anomaly OPEN. Mọi mutation player data phải qua endpoint admin có sẵn (ban / refund / grant) + manual review.
- **KHÔNG public notify** (mail / chat / WS) cho player có anomaly OPEN.
- **KHÔNG xoá row `GameplayAnomaly`** — workflow chỉ mutate `status`. Xoá leak audit trail.
- **KHÔNG resolve hàng loạt không note** — phải ghi rõ lý do để audit theo người xử lý sau này.
- **KHÔNG copy/log `detailsJson` raw ra ngoài Postgres** — vẫn coi như nhạy cảm dù đã sanitize.
- **KHÔNG mở rộng scope sang ban/lock** trong controller Phase 16.3 — Phase 16.3 chỉ detection. Mọi cử dùng `AdminController` / `AdminSecurityController` / `AdminUsersController` hiện có.

### 2.34. Phase 16.4 — Market Trade Abuse Hardening (P1/P2)

**Mục tiêu**: Cách admin chạy scan / xử lý anomaly trong tab `AdminView` "Chợ - Phát hiện trục lợi" (`marketAbuse`). **Detection-first, guard-light** — KHÔNG block giao dịch ngay cả khi WARN/CRITICAL, KHÔNG auto-ban, KHÔNG auto-rollback trade, KHÔNG tự refund. Anomaly là **signal**, không phải bằng chứng.

#### 2.34.1. Symptom → severity

| Symptom | Severity | Action |
| --- | --- | --- |
| `openCriticalCount > 0` (summary card) | **P1** | Mở tab `marketAbuse`, filter `severity=CRITICAL status=OPEN`, xử lý theo §2.34.3. |
| `type=MARKET_VOLUME_SPIKE` CRITICAL (≥5M LT/24h) | **P1** | Whale legit cấp này rất hiếm — đối chiếu `CurrencyLedger` + topup. Cross-check Phase 16.6 `CURRENCY_DELTA_24H` cùng character. |
| `type=PRICE_EXTREME_HIGH` CRITICAL (≥20× ref) | **P1** | Funnel pattern rõ — đối chiếu cùng `buyerCharacterId` với `REPEATED_BUYER_SELLER_PAIR` window cùng cặp. |
| `type=PRICE_EXTREME_LOW` CRITICAL (≤5% ref) | **P1** | RMT dump cheap-list — đối chiếu `sellerCharacterId` với gameplay anomaly (`CURRENCY_GAIN_SPIKE` / `ITEM_GAIN_SPIKE` Phase 16.3). |
| `type=REPEATED_BUYER_SELLER_PAIR` CRITICAL (≥10/24h hoặc ≥30/7d) | **P1** | Alt-account funnel rõ — đối chiếu IP cùng `ipHash` (Phase 18.1 SecurityEvent), device fingerprint nếu có. |
| `type=LISTING_SPAM` CRITICAL (≥80 listing/h) | **P1** | Bot automation — escalate ban seller account sau khi confirm via audit log. |
| Bất kỳ type WARN | **P2** | Cày dày / friendly trade frequent có thể chạm — đối chiếu trước khi action. Thường `Ack` rồi quan sát 24-48h. |
| `type=UNKNOWN_REFERENCE_PRICE` INFO | **P3** | Catalog drift — item không có `ItemDef` hợp lệ. Forward dev team check `packages/shared/src/items.ts`. |

#### 2.34.2. Chạy scan thủ công

**Khi nào**: (a) Player report market abuse; (b) Trước khi deploy patch market/economy; (c) Sau incident để rà soát lại window cũ; (d) Định kỳ daily admin sweep (cron chưa enable Phase 16.4).

```bash
# Default — scan với windowMs từ rule catalog (1h/24h/7d tuỳ type)
curl -X POST https://api/api/admin/market/abuse/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{}'

# Force re-scan 1 windowKey cụ thể (idempotent — đã có row sẽ skip qua P2002)
curl -X POST https://api/api/admin/market/abuse/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{"windowKey":"24h:2026-05-11"}'

# Sweep batch dài hơn (≤ 30 ngày)
curl -X POST https://api/api/admin/market/abuse/scan \
  -H 'Content-Type: application/json' \
  -b 'access_token=...' \
  -d '{"windowMs": 2592000000}'
```

Response `MarketScanSummary`:

```json
{
  "ok": true,
  "data": {
    "totalCreated": 4,
    "totalSkipped": 8,
    "totalErrored": 0,
    "rules": [
      { "type": "PRICE_EXTREME_LOW", "created": 1, "skipped": 0, "errored": false, "errorMessage": null },
      { "type": "REPEATED_BUYER_SELLER_PAIR", "created": 2, "skipped": 0, "errored": false, "errorMessage": null }
    ],
    "windowKeysByType": { "PRICE_EXTREME_LOW": "1h:2026-05-11T10", "REPEATED_BUYER_SELLER_PAIR": "24h:2026-05-11" },
    "scannedAt": "2026-05-11T10:30:00.000Z"
  }
}
```

`totalSkipped` cao là **bình thường** — idempotent re-run gặp row cũ. `totalErrored > 0` → check log để xem rule nào fail (`rules[].errorMessage`). 1 rule fail KHÔNG phá rule khác.

Audit: `ADMIN_MARKET_ABUSE_SCAN` (`actorUserId` + `{ totalCreated, totalSkipped, totalErrored, windowKeysByType }` trong `meta`).

#### 2.34.3. Xử lý 1 anomaly WARN/CRITICAL

1. Mở tab `marketAbuse` → summary cards (open total / critical / warn / info breakdown + latestCreatedAt / latestResolvedAt).
2. Filter `status=OPEN` + `severity=CRITICAL` trước → xử lý theo độ ưu tiên.
3. Đọc `detailsJson` của anomaly: thường chứa `listingId`, `tradeId?`, `sellerCharacterId?`, `buyerCharacterId?`, `itemKey?`, `quantity?`, `unitPrice?`, `referencePrice?`, `deviationRatio?`, `windowKey`, `count?`, `volumeSum?` (BigInt-as-string). KHÔNG có raw IP / token / cookie.
4. **Cross-check ledger / runtime row** tuỳ type:

   ```sql
   -- PRICE_EXTREME_LOW / HIGH (đối chiếu listing + buyer/seller)
   SELECT id, "sellerCharacterId", "itemKey", "pricePerUnit", "quantity", "status", "createdAt"
   FROM "Listing"
   WHERE id = $1;

   SELECT id, "sellerCharacterId", "buyerCharacterId", "itemKey", "pricePerUnit", "quantity", "createdAt"
   FROM "MarketTrade"
   WHERE "listingId" = $1
   ORDER BY "createdAt" DESC;

   -- REPEATED_BUYER_SELLER_PAIR (list trade cùng cặp)
   SELECT id, "itemKey", "pricePerUnit", "quantity", "createdAt"
   FROM "MarketTrade"
   WHERE "sellerCharacterId" = $1 AND "buyerCharacterId" = $2
     AND "createdAt" >= NOW() - INTERVAL '7 days'
   ORDER BY "createdAt" DESC;

   -- LISTING_SPAM (đếm listing per-seller window)
   SELECT id, "itemKey", "pricePerUnit", "quantity", status, "createdAt"
   FROM "Listing"
   WHERE "sellerCharacterId" = $1
     AND "createdAt" >= NOW() - INTERVAL '1 hour'
   ORDER BY "createdAt" DESC;

   -- MARKET_VOLUME_SPIKE (Σ value 24h)
   SELECT
     SUM("pricePerUnit" * "quantity") AS volume,
     COUNT(*) AS trades
   FROM "MarketTrade"
   WHERE ("sellerCharacterId" = $1 OR "buyerCharacterId" = $1)
     AND "createdAt" >= NOW() - INTERVAL '24 hours';
   ```

5. Đối chiếu cross-layer:
   - Phase 16.6 `EconomyAnomaly` (cùng `characterId`) — nếu có `CURRENCY_DELTA_24H` / `MARKET_OUTLIER` cùng window → multi-signal cao hơn.
   - Phase 16.3 `GameplayAnomaly` (cùng `characterId`) — nếu có `CURRENCY_GAIN_SPIKE` / `ITEM_GAIN_SPIKE` cùng giờ → chứng tỏ source farm + market dump cùng tay.
   - Phase 18.1 `SecurityEvent` (cùng `ipHash` nếu mapping được qua audit) — xem có `RATE_LIMIT_TRIGGERED` / `ABUSE_BLOCKED` không.

6. **Quyết định**:
   - **False positive** (whale legit, event mới mở meta, friends trade burst) → `Resolve` với note nêu lý do.
   - **Cần theo dõi tiếp** → `Ack` (chuyển `OPEN → ACKNOWLEDGED`). Không action market.
   - **Có dấu hiệu rõ** → escalate:
     - Manual cancel listing đang ACTIVE: dùng endpoint admin/seller có sẵn (`POST /market/listings/:id/cancel` với admin override hoặc kêu seller cancel — Phase 16.4 KHÔNG có admin cancel endpoint).
     - Manual revoke inventory/currency: dùng endpoint admin (`POST /admin/users/:id/inventory/revoke`, `POST /admin/users/:id/grant` với delta âm). Reason ghi `"phase 16.4 anomaly <id>"`.
     - Ban: dùng endpoint admin ban hiện có sau khi đã có evidence multi-signal.
     - Sau khi xử lý xong → `Resolve` với note `"action: ban/revoke/cancel; root: <description>"`.

#### 2.34.4. Idempotent semantics

- Ack 1 anomaly đã `ACKNOWLEDGED`/`RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_NOT_OPEN` (không ack ngược).
- Resolve 1 anomaly đã `RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_RESOLVED`.
- Resolve 1 anomaly `OPEN` → skip-ack path (chỉ set `resolvedAt` + `resolvedByAdminId`; `acknowledgedAt` vẫn null nếu chưa ack qua bước riêng).
- Scan trùng `windowKey` + `type` + `listingId` → `upsertAnomaly` bắt P2002 → đếm vào `totalSkipped` (multi-instance race-safe).
- Hook real-time (`recordListingCreate` / `recordListingBuy`) + scanAll cùng anomaly key → P2002 dedupe. Hook chạy POST-mutation, scan có thể chạy sau.

#### 2.34.5. Audit trail

Mọi mutation ghi `AdminAuditLog`:

- `ADMIN_MARKET_ABUSE_SCAN` (meta = `{ totalCreated, totalSkipped, totalErrored, windowKeysByType }`).
- `ADMIN_MARKET_ABUSE_ACK` (meta = `{ anomalyId }`).
- `ADMIN_MARKET_ABUSE_RESOLVE` (meta = `{ anomalyId, noteLength }`).

Query audit để re-construct workflow:

```sql
SELECT "createdAt", "actorUserId", "action", "meta"
FROM "AdminAuditLog"
WHERE "action" LIKE 'ADMIN_MARKET_ABUSE_%'
ORDER BY "createdAt" DESC
LIMIT 100;
```

#### 2.34.6. Verify migration & hook

```bash
# Verify migration đã apply
psql "$DATABASE_URL" -c "\d \"MarketTradeAnomaly\""
# Phải thấy table + unique index (type, listingId, windowKey).

# Smoke scan với DB rỗng — phải trả totalCreated=0, totalErrored=0
curl -X POST https://api/api/admin/market/abuse/scan \
  -H 'Content-Type: application/json' -b 'access_token=...' -d '{}'

# Test hook real-time: tạo listing extreme low → check anomaly xuất hiện
# 1. Post listing với unitPrice = 1 (rất thấp vs band)
# 2. Đợi 1-2s
# 3. GET /admin/market/abuse/anomalies?type=PRICE_EXTREME_LOW&status=OPEN
#    → phải thấy row với source='LISTING_CREATE'
```

**Cron**: Phase 16.4 KHÔNG enable cron tự động — admin chạy thủ công qua FE/curl. Hook real-time trên create/buy đảm bảo flag không cần cron. Định kỳ scan batch để bắt pattern multi-trade (REPEATED_PAIR / VOLUME_SPIKE) admin chạy thủ công.

#### 2.34.7. KHÔNG được làm

- **KHÔNG auto-ban / KHÔNG auto-rollback / KHÔNG auto-cancel listing / KHÔNG auto-refund** dựa trên anomaly OPEN. Mọi mutation phải qua endpoint admin có sẵn + manual review.
- **KHÔNG block giao dịch tiếp theo** của cùng seller / buyer / pair / item dựa trên anomaly. Phase 16.4 là **observation-only layer**, gate vào trade flow vẫn ở Phase 16.6 Price Band.
- **KHÔNG public notify** (mail / chat / WS) cho player có anomaly OPEN.
- **KHÔNG xoá row `MarketTradeAnomaly`** — workflow chỉ mutate `status`. Xoá leak audit trail.
- **KHÔNG resolve hàng loạt không note** — phải ghi rõ lý do để audit theo người xử lý sau này.
- **KHÔNG copy/log `detailsJson` raw ra ngoài Postgres** — vẫn coi như nhạy cảm dù đã sanitize.
- **KHÔNG mở rộng scope sang ban/cancel** trong controller Phase 16.4 — chỉ detection. Mọi cử dùng `AdminController` / `AdminUsersController` / `MarketService.cancel()` hiện có.

### 2.35. Phase 19.1 — Social System (friend / private chat / group chat) (P2/P3)

**Khi nào**: Player kêu bị spam friend request, bị nhận message offensive, có người chơi đang lợi dụng group để flood, hoặc cần xoá group "orphan" sau khi owner bỏ chơi.

**Triệu chứng**:
- "Tôi nhận hàng chục lời mời kết bạn từ user X trong 5 phút."
- "Có người gửi spam link 'top up' trong private chat / group chat."
- "Group này tôi không tham gia mà vẫn nhận tin nhắn." (KHÔNG xảy ra — non-member 404 mask; nếu báo cáo, là bug critical, escalate).
- "Owner group offline lâu rồi, không ai add/kick được — group bị đóng băng."

**Tại sao Phase 19.1 KHÔNG có admin UI**:
- Phase 19.1 là **foundation** — admin moderation UI sẽ ở Phase 19.2.
- Operator phải dùng query trực tiếp qua psql / Prisma Studio để xử lý.

**Cách xử lý spam friend request**:
1. Identify spammer userId qua report của player (hoặc query):
   ```sql
   SELECT "senderUserId", COUNT(*) AS n
   FROM "FriendRequest"
   WHERE status = 'PENDING' AND "createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY "senderUserId"
   HAVING COUNT(*) > 20
   ORDER BY n DESC;
   ```
2. Cancel toàn bộ pending request của spammer:
   ```sql
   UPDATE "FriendRequest"
      SET status = 'CANCELLED', "respondedAt" = NOW()
    WHERE "senderUserId" = '<spammer_user_id>' AND status = 'PENDING';
   ```
3. Add audit row qua `AdminAudit` (entry tay) với reason.
4. **Phase 19.1.B baseline**: `SOCIAL_FRIEND_REQUEST` (10 req / 60s / user, block 5p khi vượt threshold) đã gắn ở `POST /social/friend-requests`. Spam burst > 10/60s sẽ tự động nhận 429 `RATE_LIMITED`; vượt tiếp → abuse threshold (Phase 18.1 MEDIUM 10/15p) → `ABUSE_BLOCKED` 5p. Operator kiểm tra `SecurityEvent` (`type='RATE_LIMIT_TRIGGERED'` hoặc `'SUBJECT_BLOCKED'` filter theo `userId`) hoặc vào tab Bảo Mật (Phase 18.1) để lift block sớm nếu legit.
5. Đối với vụ spam **từ nhiều account** (alt-account funnel): kết hợp query SQL ở bước 1 với `SecurityEvent.ipHash` Phase 18.1 để tìm cụm IP. Rate-limit `SOCIAL_FRIEND_REQUEST` scope `USER` nên alt-account vẫn có thể bật lại — cluster thủ công + kiến nghị Phase 19.2 siết theo IP_USER khi traffic public real.

**Cách xử lý chat flood / message flood**:

- Phase 19.1.B đã gắn `CHAT_PRIVATE_SEND` (30 msg/60s/user) + `CHAT_GROUP_SEND` (30 msg/60s/user) + `CHAT_GROUP_CREATE` (10 group/60min/user) + `CHAT_GROUP_MEMBER_ADD` (30 invite/10p/user). Sender vượt → nhận 429 `RATE_LIMITED` tự động; vượt lâu → `ABUSE_BLOCKED` 5p (CHAT_*_SEND) / 10p (MEMBER_ADD) / 30p (CHAT_GROUP_CREATE).
- Player nhận flood KHÔNG bị mất message cũ (block chỉ chặn send tương lai). Nếu cần moderation, follow flow "private message offensive" bên dưới (mask body, KHÔNG xoá row).
- Nếu cần lift block sớm cho user oan (FE toast hiển thị `social.errors.ABUSE_BLOCKED`/`chatPrivate.errors.ABUSE_BLOCKED`/`chatGroup.errors.ABUSE_BLOCKED`): vào tab Bảo Mật (Phase 18.1) → Blocks → filter `subjectHash=hash(userId)` → lift. Audit sẽ ghi `ADMIN_SECURITY_BLOCK_LIFT`.

**Cách xử lý private message offensive**:
1. Query message:
   ```sql
   SELECT m.* FROM "PrivateChatMessage" m
   WHERE m."senderUserId" = '<offender_user_id>'
     AND m."createdAt" > NOW() - INTERVAL '24 hours'
   ORDER BY m."createdAt" DESC LIMIT 50;
   ```
2. **KHÔNG xoá row** — phải preserve audit. Nếu CRITICAL, dùng `UPDATE` để mask body và đánh dấu (Phase 19.2 sẽ có `moderationStatus` column):
   ```sql
   -- Tạm thời (Phase 19.1):
   UPDATE "PrivateChatMessage" SET body = '[REMOVED BY MODERATION]' WHERE id = '<msg_id>';
   ```
3. Tách phiên: gọi `AdminUsersController` revoke session của offender (Phase 18.2).
4. Player victim có thể `POST /social/block` để chặn sender 2 chiều.

**Cách xử lý group spam / flood**:
1. Identify group + owner:
   ```sql
   SELECT g.id, g.name, g."ownerUserId", COUNT(m.id) AS msg_count
   FROM "GroupChat" g
   LEFT JOIN "GroupChatMessage" m
     ON m."groupId" = g.id AND m."createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY g.id
   HAVING COUNT(m.id) > 200
   ORDER BY msg_count DESC;
   ```
2. Nếu offender là member non-owner: liên hệ owner để kick, hoặc operator force kick:
   ```sql
   DELETE FROM "GroupChatMember"
   WHERE "groupId" = '<group_id>' AND "userId" = '<offender_user_id>';
   ```
3. Nếu offender là owner: tạm thời rotate owner qua promote 1 member khác (Phase 19.2 sẽ có endpoint `transferOwnership`):
   ```sql
   UPDATE "GroupChat" SET "ownerUserId" = '<new_owner_user_id>' WHERE id = '<group_id>';
   ```

**Cách xoá group "orphan" (owner bỏ chơi)**:
1. Hiện Phase 19.1 KHÔNG có endpoint `deleteGroup`. Operator force:
   ```sql
   DELETE FROM "GroupChatMessage" WHERE "groupId" = '<group_id>';
   DELETE FROM "GroupChatMember"  WHERE "groupId" = '<group_id>';
   DELETE FROM "GroupChat"        WHERE id = '<group_id>';
   ```
2. Log audit qua `AdminAudit` (entry tay).

**Không bao giờ**:
- **KHÔNG xoá row `FriendRequest` / `PrivateChatMessage` / `GroupChatMessage`** trừ trường hợp purge group orphan — chỉ `UPDATE` `body` / `status`.
- **KHÔNG bypass block** bằng cách manual `INSERT FriendRequest` — nếu player bị block và muốn liên hệ lại, owner phải `unblock` qua API.
- **KHÔNG mở `DELETE /social/block/:userId`** thay player — chỉ player tự bỏ chặn của mình.

## 2.36. Phase 19.2 — Chat Moderation & Report (triage flow) (P2)

**Khi nào**:
- Player vào `Báo cáo tin nhắn` trên FE (Phase 19.2) → server tạo `ChatMessageReport` status `OPEN`.
- Admin nhận summary card `Open reports > 0` ở tab **Kiểm duyệt chat** (`AdminView → chatModeration`).
- Hoặc cron alert (Phase 21+): `openReports > 50 / day` → ping Slack ops.

**Người chịu trách nhiệm**: on-call moderator. Severity P2 (24h SLA), P1 nếu report là CRITICAL (lừa đảo nạp / phishing token).

**Flow xử lý qua FE admin panel** (`/admin` → tab `Kiểm duyệt chat`):

1. **Triage**:
   - Filter `status=OPEN` + `reason=SCAM|HARASSMENT` (priority cao). SPAM thường xử bulk cuối ca.
   - Xem `messagePreview` + `reporterDisplayName` / `targetDisplayName`. Reporter ẩn danh KHÔNG bị share với target.
2. **Ack** (acknowledge — báo "đang xử lý"): click `Ack` → state `OPEN → ACKNOWLEDGED`. Idempotent. Audit `ADMIN_CHAT_MODERATION_REPORT_ACK`.
3. **Action** trên message (nếu vi phạm):
   - **Hide message**: click `Hide` per report → `confirm()` + `prompt('Reason?')`. Soft-hide cols set, body giữ nguyên (audit/appeal). FE người dùng thấy placeholder `[đã bị ẩn bởi kiểm duyệt]` thay vì body. Audit `ADMIN_CHAT_MODERATION_MESSAGE_HIDE`.
   - **Mute user** (nếu offender lặp lại): vào **Mutes section** → form `Create mute` → nhập `userId` (target), chọn `scope` (`PRIVATE_CHAT` / `GROUP_CHAT` / `WORLD_SECT_CHAT` / `ALL_CHAT`), `reason`, optional `expiresAt` (để trống = mute vô thời hạn). Audit `ADMIN_CHAT_MODERATION_MUTE_CREATE`.
   - **Lock / Dissolve group** (nếu report ở GROUP type và toàn group spam): click `Lock` (tạm khoá, có thể `Unlock` lại) hoặc `Dissolve` (đánh dấu giải tán vĩnh viễn, KHÔNG xoá member/message). Audit `ADMIN_CHAT_MODERATION_GROUP_LOCK` / `_DISSOLVE`.
4. **Resolve / Reject**:
   - **Resolve** (kết luận vi phạm + đã action): click `Resolve` → `confirm()` + `prompt('Note?')` (note ghi vào `resolutionNote` cho audit). State → `RESOLVED`. Audit `ADMIN_CHAT_MODERATION_REPORT_RESOLVE`.
   - **Reject** (kết luận KHÔNG vi phạm): click `Reject` → `confirm()` + `prompt('Note?')`. State → `REJECTED`. Audit `ADMIN_CHAT_MODERATION_REPORT_REJECT`.
   - Resolve/reject là **terminal state** — KHÔNG quay lại OPEN. Nếu sai, phải tạo report mới (hoặc liên hệ super-admin restore via SQL).

**Mute scope ma trận** (`ChatModerationService.findActiveMuteForSend` server-enforced):

| Active mute scope | PRIVATE_CHAT | GROUP_CHAT | WORLD_SECT_CHAT |
|---|---|---|---|
| `PRIVATE_CHAT` | ✓ block | — | — |
| `GROUP_CHAT` | — | ✓ block | — |
| `WORLD_SECT_CHAT` | — | — | ✓ block |
| `ALL_CHAT` | ✓ block | ✓ block | ✓ block |

User bị block nhận lỗi `MUTED` ở client — FE toast i18n thân thiện.

**SQL fallback** (chỉ khi FE admin panel down):

```sql
-- List open report
SELECT id, "reporterUserId", "targetUserId", "messageType", reason, "createdAt"
FROM "ChatMessageReport"
WHERE status = 'OPEN'
ORDER BY "createdAt" DESC
LIMIT 50;

-- Mute user (PRIVATE_CHAT, 1 tuần)
INSERT INTO "ChatMute" ("id", "userId", "mutedByAdminId", reason, scope, "startsAt", "expiresAt", "createdAt")
VALUES (gen_random_uuid()::text, '<userId>', '<adminId>', 'flood spam', 'PRIVATE_CHAT', NOW(), NOW() + INTERVAL '7 days', NOW());

-- Soft-hide private message
UPDATE "PrivateChatMessage"
SET "hiddenAt" = NOW(), "hiddenByAdminId" = '<adminId>', "hideReason" = 'spam-link'
WHERE id = '<messageId>';
```

**KHÔNG bao giờ**:
- **KHÔNG hard-delete** `ChatMessageReport` / `ChatMute` / `PrivateChatMessage` / `GroupChatMessage` — luôn soft-hide / revoke.
- **KHÔNG bypass AdminAuditLog** — mọi mutation phải đi qua API endpoint admin (auto-audit). SQL chỉ dùng khi panel down + ghi audit tay vào `AdminAuditLog`.
- **KHÔNG mute scope `ALL_CHAT` mặc định** — chỉ dùng khi offender vi phạm cross-channel hoặc severe. Default scope = channel cụ thể vi phạm.

## 2.37. Phase 19.2 — Escalation matrix khi report spike (P1)

**Trigger**: `summary.openReports > 50` chưa xử trong 24h, hoặc cluster report cùng `targetUserId` > 10/giờ.

1. **Mức 1 (operator on-call)**: ack tất cả + soft-hide tin nhắn rõ ràng vi phạm + mute target scope `ALL_CHAT` 24h. Resolve với note.
2. **Mức 2 (admin chính)** nếu burst > 100/day: thêm rate-limit policy `CHAT_PRIVATE_SEND` / `CHAT_GROUP_SEND` tạm thời nghiêm hơn (chỉnh `packages/shared/src/security-rate-limit.ts` + redeploy). Lock group bị abuse mass.
3. **Mức 3 (security lead)** nếu liên quan phishing/scam token: bump JWT secret + audit toàn bộ `topup` quanh thời điểm report + viết postmortem. Phối hợp § 15 (Khi phát hiện sự cố) ở `SECURITY.md`.

**KPI sau xử lý**:
- TTAck (time-to-ack) median < 4h.
- TTResolve median < 24h.
- False-positive (REJECTED / total resolved) < 30% — nếu cao, review chính sách `chatReport.reason` để player hiểu rõ tiêu chí.

## 2.38. Phase 19.3 — Social Presence & Notification Center (debug & incident) (P2)

**Khi nào**: Player report (a) không thấy bell badge update khi có notification mới, (b) thấy friend "online" nhưng thực tế đã offline / ngược lại, (c) notification dropdown trống dù có event.

**Trước hết — phân loại**:

- **Notification miss** (DB row tồn tại nhưng FE không thấy) → §A.
- **Presence stale** (status không khớp WS connection thực tế) → §B.
- **Cross-shard inconsistency** (deploy multi-instance) → §C — KHÔNG fixable mà không bật Phase 19.3+ Redis presence.

### §A. Notification miss

1. **Check DB row** — vào `psql` chạy `SELECT id, type, "createdAt", "readAt" FROM "Notification" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 10`. Nếu row tồn tại → bug FE.
2. **Check WS connection** — `RealtimeGateway` log `attach`/`detach` per `userId`. Nếu user **offline** lúc notification tạo → KHÔNG có WS event (đúng spec) → FE nhận khi REST poll 60s hoặc reload.
3. **Check FE store state** — DevTools console `useNotificationsStore().items` + `unreadCount`. Force `store.refresh()` để re-fetch REST.
4. **Check `notification:new` dispatch** — Network → WS tab → tìm frame `notification:new`. Nếu KHÔNG có khi user online → kiểm tra `RealtimeService.userSockets.get(userId)` size > 0 không.
5. **Recover** — `POST /notifications/read-all` rồi reload (nếu user chấp nhận mất unread state cũ).

### §B. Presence stale

1. **Multi-tab safe check** — `RealtimeService.countConnectionsForUser(userId)` per user. Nếu = 0 nhưng FE thấy ONLINE → DB `UserPresence.lastSeenAt` stale (chưa fanout disconnect).
2. **Check `presence:update` fanout** — log `PresenceService.fanoutPresenceUpdate` warn line. State transition only emit khi `previousConnections===0 XOR currentConnections===0`. Nếu user multi-tab thì transition chỉ xảy ra ở first tab + last tab.
3. **Check PlayerBlock filter** — `SELECT * FROM "PlayerBlock" WHERE "blockerUserId"=$1 OR "blockedUserId"=$1`. Nếu friend có block 2-chiều → đúng spec, fanout skip.
4. **Force refresh** — `GET /social/presence?userIds=<csv>` REST batch lấy snapshot truth từ server.
5. **Recover từ ghost connection** — Nếu socket leaked (vd Node crash hờ giữa lifecycle): `RealtimeGateway.kickUser(userId)` (admin command qua admin tool) để cleanup `userSockets` + fanout offline.

### §C. Cross-shard inconsistency (multi-instance deploy)

Phase 19.3 scope = **single-instance**. Mỗi shard giữ in-memory `userSockets` Map riêng → presence inconsistent giữa shards. **KHÔNG fixable** mà không bật Phase 19.3+ Redis adapter:

- Nếu deploy >1 instance: **MUST** bật sticky-session ở load balancer (cookie `xt_access` hoặc IP affinity) để cùng user luôn về cùng shard.
- Hoặc bật `socket.io-redis-adapter` + `RealtimeService` migration sang Redis pub/sub (Phase 19.3+ deferred — chưa có code).
- Notification DB-side OK (Postgres single source of truth) — chỉ realtime emit bị split.

### Escalation matrix

| Severity | Trigger | Action |
|----------|---------|--------|
| P3 | 1 player report notification miss | Operator follow §A. Nếu reproducible 100% → escalate P2. |
| P2 | >5 player cùng report trong 1h | Backend on-call check log `NotificationService.fanoutRealtimeIfOnline` warn + `RealtimeService.bind` state. Có thể server WS bind chưa xong khi event fire. |
| P1 | Bell hoàn toàn không refresh badge sau reload + REST poll fail | Backend on-call + frontend on-call. Check `/notifications` 500 status. Có thể migration `20260920000000_phase_19_3_notification_presence` chưa apply ở env hiện tại — chạy `pnpm prisma migrate deploy`. |
| P1 | Presence broadcast leak (vd ai cũng thấy ai đó online dù đã block) | Security lead. **NGẮT immediate** Phase 19.3 WS fanout (revert `RealtimeGateway` hook PR). Postmortem + replay log. |

**KHÔNG làm**:

- KHÔNG xoá row `Notification` trực tiếp DB (mất audit). Thay vào dùng `markRead` REST.
- KHÔNG sửa `UserPresence.lastSeenAt` manual — server tự upsert qua lifecycle hook. Sửa tay → drift với `RealtimeService.userSockets` in-memory state.
- KHÔNG bật multi-instance trước khi có Redis presence (deferred Phase 19.3+).

## 2.39. Phase 19.4 — Group / Party System (debug & incident) (P2/P3)

**Khi nào**: Player report (a) không tạo được party / không invite được, (b) party "stuck" sau khi leader bỏ chơi mà không auto-disband, (c) duplicate member sau accept race, (d) inbox đầy invite từ 1 user (spam), (e) invite "biến mất" không accept được (đã expire nhưng FE chưa refresh).

**Trước hết — phân loại**:

- **Membership stuck** (party còn 1 member nhưng `status='ACTIVE'`, hoặc leader vắng mặt dài hạn) → §A.
- **Spam invite flood** (1 user gửi >20 invite trong vài phút) → §B.
- **Race accept duplicate** (player report "tôi join 2 lần", hoặc 2 row PartyMember cùng `(partyId, userId)`) → §C.
- **Invite expired silent fail** (FE thấy invite PENDING nhưng accept trả `INVITE_EXPIRED`) → §D.
- **Cross-shard inconsistency** (multi-instance deploy) → §E — same caveat như Phase 19.3.

### §A. Membership stuck / orphan leader

Phase 19.4 KHÔNG có admin endpoint disband (out of scope, deferred). Operator phải force qua SQL — **giữ row, KHÔNG DELETE**, chỉ flip status để giữ audit.

1. **Identify orphan party** — leader chưa hoạt động > N ngày, party còn member:
   ```sql
   SELECT p.id, p.name, p."leaderUserId", p."createdAt",
          (SELECT COUNT(*) FROM "PartyMember" m
             WHERE m."partyId"=p.id AND m."leftAt" IS NULL) AS active_members
   FROM "Party" p
   WHERE p.status='ACTIVE'
     AND p."createdAt" < NOW() - INTERVAL '7 days'
   ORDER BY p."createdAt" ASC;
   ```
2. **Cross-check leader presence** — `SELECT "lastSeenAt" FROM "UserPresence" WHERE "userId"=p."leaderUserId"` (Phase 19.3). Nếu null hoặc rất cũ → leader bỏ chơi.
3. **Edge case party còn 1 member nhưng `status='ACTIVE'`** — bug `leaveParty` auto-disband đã miss (rất hiếm, log warn ở `PartyService` nếu xảy ra). Fix manual:
   ```sql
   -- 1 transaction:
   BEGIN;
   UPDATE "Party"
      SET status='DISBANDED', "disbandedAt"=NOW(), "updatedAt"=NOW()
    WHERE id='<party_id>' AND status='ACTIVE';
   UPDATE "PartyMember"
      SET "leftAt"=NOW()
    WHERE "partyId"='<party_id>' AND "leftAt" IS NULL;
   UPDATE "PartyInvite"
      SET status='CANCELED', "respondedAt"=NOW()
    WHERE "partyId"='<party_id>' AND status='PENDING';
   COMMIT;
   ```
4. **Add `AdminAudit` row tay** với reason `PARTY_FORCE_DISBAND_ORPHAN` + party id + operator id.
5. **KHÔNG** broadcast `party:updated` từ SQL — member sẽ nhận state mới qua `GET /party/me` polling khi reload. Nếu cần thông báo gấp, gửi mail in-game qua admin tool.

### §B. Spam invite flood

Phase 19.4 đã enforce:
- `PARTY_INVITE_SEND` rate-limit 20 / 60s / user (sensitive, MEDIUM, block 5p khi vượt threshold).
- `PARTY_LIMITS.maxPendingInvitesPerUser = 20` — invite thứ 21 bị reject `TOO_MANY_PENDING_INVITES`.
- Duplicate PENDING invite cùng `(partyId, inviteeUserId)` bị reject `DUPLICATE_INVITE` ở app layer (`inviteToParty` check `findFirst({ partyId, inviteeUserId, status: PENDING })`). DB KHÔNG có unique constraint trên `PartyInvite` — chỉ có index — vì invite có vòng đời và có thể tạo lại sau khi DECLINED/CANCELED/EXPIRED.

Triage:

1. **Identify spammer** — gom theo `inviterUserId`:
   ```sql
   SELECT "inviterUserId", COUNT(*) AS n
   FROM "PartyInvite"
   WHERE status='PENDING' AND "createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY "inviterUserId"
   HAVING COUNT(*) > 20
   ORDER BY n DESC;
   ```
2. **Check `SecurityEvent`** — type `RATE_LIMIT_TRIGGERED` filter `policyKey='PARTY_INVITE_SEND'`, hoặc `SUBJECT_BLOCKED` cho user đã bị abuse block.
3. **Cluster theo IP** (alt-account funnel) — join `SecurityEvent.ipHash` Phase 18.1 với cùng `userId` set.
4. **Cancel toàn bộ pending invite của spammer** (giữ row, flip status):
   ```sql
   UPDATE "PartyInvite"
      SET status='CANCELED', "respondedAt"=NOW()
    WHERE "inviterUserId"='<spammer_user_id>' AND status='PENDING';
   ```
5. **Block hành chính** (nếu tái phạm) — Phase 18.2 revoke session, hoặc Phase 18.1 manual block dài hạn.

### §C. Race accept duplicate

Phase 19.4 enforce qua:
- `acceptInvite` trong `prisma.$transaction` re-check `inviteeUserId` chưa có active membership.
- `PartyMember` UNIQUE `(partyId, userId)` (DB constraint) — duplicate insert raise P2002 → service trả `ALREADY_IN_PARTY`.
- Test `accept invite is idempotent under concurrent calls` cover `Promise.all([acceptInvite, acceptInvite])`.

Nếu vẫn thấy **2 row active cùng `(partyId, userId)`** trong production (KHÔNG được xảy ra; unique constraint cấm):

1. **CRITICAL** — escalate P1 backend on-call. Có thể migration chưa apply (thiếu unique index).
2. **Verify constraint tồn tại**:
   ```sql
   SELECT indexname, indexdef FROM pg_indexes
   WHERE tablename='PartyMember' AND indexname LIKE '%partyId_userId%';
   ```
3. Nếu thiếu → re-run `pnpm prisma migrate deploy`. Nếu vẫn duplicate sau khi có constraint, kiểm tra một row có `leftAt IS NOT NULL` (đã rời) — đó là expected (member rời rồi join lại tạo row thứ 2 với `leftAt=NULL`, row cũ vẫn còn).
4. **Fix manual nếu thật sự duplicate active**:
   ```sql
   -- giữ row cũ nhất, mark row sau là LEFT:
   UPDATE "PartyMember" SET "leftAt"=NOW()
    WHERE id IN (
      SELECT id FROM "PartyMember"
       WHERE "partyId"='<pid>' AND "userId"='<uid>' AND "leftAt" IS NULL
       ORDER BY "joinedAt" DESC OFFSET 1
    );
   ```

### §D. Invite expired silent fail

Phase 19.4 lazy transition: `acceptInvite` check `now > expiresAt` → reject `INVITE_EXPIRED` + flip row status sang `EXPIRED`. List endpoint cũng lazy expire khi đọc. Nếu player kêu invite "biến mất":

1. **Check row trong DB** — `SELECT id, status, "createdAt", "expiresAt", "respondedAt" FROM "PartyInvite" WHERE id='<invite_id>'`.
2. Nếu `status='EXPIRED'` → đúng spec, FE cần refresh `/party/invites/incoming`. Hướng dẫn player reload tab Party.
3. Nếu `status='PENDING'` nhưng `expiresAt < NOW()` → FE chưa lazy transition (REST chưa được gọi). Player accept sẽ tự fail + flip row. Không cần fix manual.
4. **Adjust `PARTY_LIMITS.inviteExpireMinutes`** (default 10) chỉ qua code change + redeploy — KHÔNG override DB row.

### §E. Cross-shard inconsistency (multi-instance deploy)

Same constraint như Phase 19.3 — `RealtimeService.userSockets` in-memory per shard, party WS broadcast (`party:updated`, `party:invite`, `party:member-joined`, `party:member-left`, `party:leader-changed`) chỉ tới socket nằm cùng shard. Postgres rows là single source of truth, nên membership / invite state luôn nhất quán; chỉ realtime emit có thể bị split.

- Multi-instance deploy: **MUST** sticky-session ở LB (cookie `xt_access` hoặc IP affinity) — same recommendation như §2.38 §C.
- Nếu cần cross-shard fanout, đợi Phase 19.3+ Redis adapter (deferred).

### Escalation matrix

| Severity | Trigger | Action |
|----------|---------|--------|
| P3 | 1 player report orphan party / invite expired | Operator follow §A / §D. Reproducible 100% → escalate P2. |
| P2 | >5 player cùng report spam invite trong 1h | Backend on-call check `SecurityEvent` cluster theo `policyKey='PARTY_INVITE_SEND'`. Cancel pending invite của spammer (§B). |
| P2 | Migration `20261001000000_phase_19_4_group_party_system` chưa apply ở env (REST `/party/*` trả 500 hoặc Prisma `P2021` table not found) | Backend on-call chạy `pnpm prisma migrate deploy` ở env đó. |
| P1 | Duplicate active `PartyMember` cùng `(partyId, userId)` | Backend on-call ngay. Verify unique constraint (§C), fix manual, postmortem. |
| P1 | WS broadcast party:* leak ra non-member (vd member khác party nhận `party:member-joined`) | Security lead. **NGẮT immediate** `RealtimeService.emitToUser` cho party namespace (revert party WS fanout PR). Postmortem + replay log. |

**KHÔNG làm**:

- KHÔNG `DELETE FROM "Party"` / `"PartyMember"` / `"PartyInvite"` trực tiếp — mất audit. Force disband qua `UPDATE status='DISBANDED'` + `leftAt=NOW()` (§A).
- KHÔNG sửa `Party.leaderUserId` tay nếu không kèm flip `PartyMember.role` (sẽ drift — leader-on-party không match leader-on-member). Nếu cần transfer manual, làm cả 2 row trong cùng transaction.
- KHÔNG override `PartyInvite.expiresAt` qua SQL để "cứu" invite quá hạn (sẽ phá invariant + lazy transition logic). Bảo player tạo invite mới.
- KHÔNG bật multi-instance Phase 19.4 trước khi có Redis adapter (same caveat §2.38 §C).
- KHÔNG xoá `Party.disbandedAt` để "revive" party — tạo party mới.

## 2.40. Phase 20.1 — Party Dungeon Co-op PvE (debug & incident) (P2/P3)

**Khi nào**: Player report (a) không tạo được room dù là leader, (b) start trả `NOT_ENOUGH_MEMBERS`/`NOT_ALL_READY` mặc dù FE thấy đủ ready, (c) "claim 2 lần" hoặc "không thấy nút claim sau khi clear", (d) room "stuck" status `LOBBY`/`STARTED` không tiến hành, (e) reward grant thiếu (linh thạch / item / exp không cộng).

**Trước hết — phân loại**:

- **Cannot create room** → §A.
- **Start gate false-negative** (FE thinks ready, server says not) → §B.
- **Reward claim issue** (double-claim, missing, mismatch) → §C.
- **Stuck room** (LOBBY > 1h hoặc STARTED không lên COMPLETED — bug auto-resolve) → §D.

### §A. Cannot create room

Phase 20.1 enforce:
- 1 active room / party (`COOP_DUNGEON_LIMITS.maxActiveRoomPerParty=1`).
- Leader-only (`NOT_PARTY_LEADER`).
- Dungeon catalog whitelist (`INVALID_DUNGEON`).
- Rate-limit `PARTY_DUNGEON_CREATE` (20/60min/user, block 30p).

Triage:

1. **Verify party state** — `SELECT id, "leaderUserId" FROM "Party" WHERE status='ACTIVE' AND id IN (SELECT "partyId" FROM "PartyMember" WHERE "userId"='<user>' AND "leftAt" IS NULL)`. Trả 0 → user không thuộc party active (`NOT_IN_PARTY`); trả row có `leaderUserId !== user` → không phải leader (`NOT_PARTY_LEADER`).
2. **Verify không có active room cũ** — `SELECT id, status, "createdAt" FROM "PartyDungeonRoom" WHERE "partyId"='<party_id>' AND status IN ('LOBBY','READY_CHECK','STARTED')`. Trả >0 row → `ROOM_ALREADY_EXISTS`. Force-cancel nếu stale (xem §D).
3. **Verify dungeon catalog** — confirm `dungeonKey` có trong `packages/shared/src/combat.ts` `DUNGEONS`. Catalog miss thường do FE cache build cũ.
4. **Check rate-limit block** — `SELECT * FROM "SecurityEvent" WHERE "policyKey"='PARTY_DUNGEON_CREATE' AND "userId"='<user>' AND "createdAt" > NOW() - INTERVAL '1 hour'`. Type `SUBJECT_BLOCKED` → user bị block 30p, chờ hoặc lift manual qua Phase 18.1 admin.

### §B. Start gate false-negative (NOT_ENOUGH_MEMBERS / NOT_ALL_READY)

Server gate qua shared helper `canStartPartyDungeon`:
- `NOT_ENOUGH_MEMBERS`: count(`PartyDungeonParticipant` WHERE `roomId=<x>` AND `leftAt IS NULL`) < `minMembers=2`.
- `NOT_ALL_READY`: tồn tại participant với `readyAt IS NULL`.

Triage:

1. **List participant snapshot**:
   ```sql
   SELECT id, "userId", "readyAt", "joinedAt", "leftAt"
   FROM "PartyDungeonParticipant"
   WHERE "roomId"='<room_id>'
   ORDER BY "joinedAt" ASC;
   ```
2. Đếm `leftAt IS NULL` rows + verify mọi row có `readyAt != null`. Nếu count = FE display → false negative server-side bug (escalate); nếu count != FE display → FE cache stale (yêu cầu player F5).
3. **Check WS event delivery** — `RealtimeService` debug log: `emitReadyUpdated` có target userId không? Multi-instance + non-sticky LB có thể miss event → user thấy stale ready badge. Sticky-session là MUST (same caveat §2.38–2.39).
4. **Force unstuck (operator)** — nếu participant lưu trữ `readyAt=null` do bug FE không gọi `/ready`, hướng dẫn player click "Ready" lại. **KHÔNG** SQL set `readyAt=NOW()` tay (sẽ skip rate-limit + WS event audit).

### §C. Reward claim issue

Phase 20.1 enforce:
- CAS atomic `WHERE status='PENDING'` → 1 caller thắng, các caller khác `REWARD_ALREADY_CLAIMED`.
- Ledger entry với `reason='PARTY_DUNGEON_REWARD'` + meta `{runId, characterId}` cho audit.
- Unique constraint Prisma `(runId, userId)` chống duplicate row.

Triage:

1. **Verify claim row tồn tại** — `SELECT * FROM "PartyDungeonRewardClaim" WHERE "runId"='<run>' AND "userId"='<user>'`. 0 row → user không phải participant của run (`REWARD_NOT_FOUND`); 1 row `status='CLAIMED'` → đã claim; 1 row `status='PENDING'` → chưa claim.
2. **Verify ledger entry** — `SELECT * FROM "CurrencyLedger" WHERE "characterId"='<char>' AND reason='PARTY_DUNGEON_REWARD' AND meta::jsonb->>'runId'='<run>'` + tương tự `ItemLedger`. Đúng 1 row (currency, item) cho mỗi reward delta — duplicate → bug CAS, escalate P1.
3. **Player report "thiếu reward"** dù `status='CLAIMED'`:
   - Cross-check `rewardJson` ở claim row với `DungeonDef.runReward` của `dungeonKey`. Mismatch → bug clone, postmortem.
   - Verify ledger applied đúng (currency: `CurrencyLedger.delta`; item: `ItemLedger.delta`; exp: `Character.exp` increment). Nếu ledger có delta đúng nhưng `Character.linhThach` không thay đổi → bug `CurrencyService.applyTx`, escalate P1.
4. **Hoàn trả manual** (chỉ khi confirm bug):
   ```sql
   -- 1 transaction:
   BEGIN;
   INSERT INTO "CurrencyLedger" ("id","characterId","currency","delta","reason","meta","createdAt")
     VALUES (gen_random_uuid(), '<char>', 'LINH_THACH', <amount>, 'ADMIN_GRANT',
             '{"compensateFor":"PARTY_DUNGEON_REWARD","runId":"<run>"}'::jsonb, NOW());
   UPDATE "Character" SET "linhThach"="linhThach"+<amount> WHERE id='<char>';
   COMMIT;
   ```
   Ghi `AdminAudit` reason `PARTY_DUNGEON_REWARD_COMPENSATE` + run id + operator id.

### §D. Stuck room (LOBBY > 1h hoặc STARTED không lên COMPLETED)

Phase 20.1 `startRun` auto-resolve inline trong cùng transaction → COMPLETED ngay. Room STARTED kéo dài là **bất thường** (transaction crashed giữa chừng nhưng commit?).

Triage:

1. **List stale room**:
   ```sql
   SELECT id, "partyId", status, "createdAt", "startedAt"
   FROM "PartyDungeonRoom"
   WHERE status IN ('LOBBY','READY_CHECK','STARTED')
     AND "createdAt" < NOW() - INTERVAL '2 hours'
   ORDER BY "createdAt" ASC;
   ```
2. **LOBBY stuck (player quit không cancel)** — force cancel để giải phóng party invariant:
   ```sql
   BEGIN;
   UPDATE "PartyDungeonRoom"
      SET status='CANCELED', "canceledAt"=NOW(), "finishedAt"=NOW()
    WHERE id='<room>' AND status IN ('LOBBY','READY_CHECK');
   UPDATE "PartyDungeonParticipant"
      SET "leftAt"=NOW()
    WHERE "roomId"='<room>' AND "leftAt" IS NULL;
   COMMIT;
   ```
3. **STARTED stuck (auto-resolve crashed)** — verify `PartyDungeonRun` exist không:
   ```sql
   SELECT id, result, "startedAt", "finishedAt"
   FROM "PartyDungeonRun" WHERE "roomId"='<room>';
   ```
   Nếu có `result='CLEAR'` + `finishedAt IS NOT NULL` → run đã resolve nhưng room không update status (drift). Fix:
   ```sql
   UPDATE "PartyDungeonRoom"
      SET status='COMPLETED', "finishedAt"=run."finishedAt", "currentRunId"=run.id
   FROM "PartyDungeonRun" run
   WHERE "PartyDungeonRoom".id='<room>' AND run."roomId"='<room>';
   ```
   Postmortem ngay (P1) — transaction split là risk lớn.

### Escalation matrix

| Severity | Trigger | Action |
|----------|---------|--------|
| P3 | 1 player report cannot create / start | Operator follow §A/§B. Reproducible 100% → escalate P2. |
| P2 | Migration `20261020000000_phase_20_1_party_dungeon_coop` chưa apply ở env (REST `/party/dungeon/*` trả 500 hoặc Prisma `P2021` table not found) | Backend on-call chạy `pnpm prisma migrate deploy`. |
| P2 | >3 player cùng report reward "thiếu" dù `status='CLAIMED'` | Backend on-call check ledger consistency. Ledger có delta đúng nhưng character không update → escalate P1. |
| P1 | Duplicate `PartyDungeonRewardClaim` cùng `(runId, userId)` hoặc duplicate ledger entry cùng `reason='PARTY_DUNGEON_REWARD'` + meta runId | Backend on-call ngay. CAS bypass nghiêm trọng — disable `claimReward` endpoint qua feature flag, postmortem. |
| P1 | Room STARTED không lên COMPLETED + Run có `result='CLEAR'` + `finishedAt` set (transaction split) | Backend on-call. Fix room status SQL (§D) + postmortem. |

**KHÔNG làm**:

- KHÔNG `DELETE FROM "PartyDungeonRoom"`/`"PartyDungeonParticipant"`/`"PartyDungeonRun"`/`"PartyDungeonRewardClaim"` — mất audit. Force terminate qua `UPDATE status='CANCELED'`/`leftAt=NOW()` (§D).
- KHÔNG SQL set `readyAt=NOW()` tay (§B) để force start — sẽ skip rate-limit + WS audit + có thể violate invariant.
- KHÔNG SQL set `PartyDungeonRewardClaim.status='CLAIMED'` tay mà không insert ledger row — phá audit ledger.
- KHÔNG override `currentRunId` của room sang run khác — invariant 1-1.
- KHÔNG bật multi-instance Phase 20.1 trước khi có Redis adapter (same caveat §2.38–2.39).

## 2.99. Pre-cutover Deploy Verify Gate (Phase 17.1)

**Khi nào**: Mọi lần cutover production sang instance mới / image mới /
host mới. **TRƯỚC** khi mở traffic real user.

**Tại sao**: Phát hiện sớm env critical thiếu, secret placeholder, DB
migration conflict, healthz/readyz/version sai, admin bootstrap không
idempotent — trước khi ảnh hưởng player.

**Cách chạy** (single command):

```bash
cd /opt/xuantoi
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require \
REDIS_URL=rediss://host:6380 \
PORT=3100 \
pnpm verify:deploy
```

7 step orchestrator — migrate → spawn API NODE_ENV=production → poll
healthz/readyz/version → bootstrap idempotent (run twice). Chi tiết +
troubleshooting xem `docs/DEPLOY.md` §10.A.

**Exit code**:

- `0` → `Deploy Verify Gate OPEN.` → an toàn cutover.
- `!= 0` → script in step nào fail; **KHÔNG cutover** cho đến khi gate
  xanh. Mở incident theo §2.X tương ứng (migration fail = §2.X DB,
  health probe fail = §2.X API boot, etc.).

**Trên CI**: Job `verify-deploy` trong `.github/workflows/ci.yml` chạy
chính script này trên Postgres+Redis service container — fail PR nếu
gate đóng. Đảm bảo gate xanh trên CI **trước khi merge** branch deploy.

## 2.41. Phase 20.2 — Co-op Boss Party Contribution (debug & incident) (P2/P3)

**Khi nào**: Player report (a) không tạo được run dù là leader, (b) contribution không cộng dồn (FE thấy submit thành công nhưng score = 0), (c) "không nhận được reward dù tham gia clear", (d) "claim 2 lần" hoặc reward grant thiếu (linh thạch / item / exp), (e) run "stuck" `LOBBY`/`IN_PROGRESS` không lên CLEARED/FAILED, (f) anomaly damage log spam.

**Trước hết — phân loại**:

- **Cannot create run** → §A.
- **Contribution missing / clamp anomaly** → §B.
- **Reward claim issue** (eligibility, double-claim, missing) → §C.
- **Stuck run** (LOBBY/IN_PROGRESS > 1h) → §D.

### §A. Cannot create run

Phase 20.2 enforce:
- 1 active run / party (`COOP_BOSS_LIMITS.maxActiveRunPerParty=1`).
- Leader-only (`NOT_PARTY_LEADER`).
- Boss catalog whitelist (`INVALID_BOSS_KEY`).

Triage:

1. **Verify party state** — `SELECT id, "leaderUserId" FROM "Party" WHERE status='ACTIVE' AND id IN (SELECT "partyId" FROM "PartyMember" WHERE "userId"='<user>' AND "leftAt" IS NULL)`. Trả 0 → `NOT_IN_PARTY`; `leaderUserId !== user` → `NOT_PARTY_LEADER`.
2. **Verify không có active run cũ** — `SELECT id, status, "startedAt" FROM "CoopBossRun" WHERE "partyId"='<party_id>' AND status IN ('LOBBY','IN_PROGRESS')`. Trả >0 row → `RUN_ALREADY_EXISTS`. Force-cancel nếu stale (xem §D).
3. **Verify bossKey catalog** — Boss key phải tồn tại trong `BOSSES` (shared catalog `packages/shared/src/boss.ts`); typo → `INVALID_BOSS_KEY`.

### §B. Contribution missing / clamp anomaly

Phase 20.2 server clamp tất cả contribution input theo `COOP_BOSS_LIMITS`. Anomaly (vượt cap / negative / NaN) → ghi warning log, clamp về safe value, KHÔNG reject.

Triage:

1. **Verify participant row** — `SELECT id, "joinedAt", "leftAt" FROM "CoopBossParticipant" WHERE "runId"='<run_id>' AND "userId"='<user>'`. Trả 0 → `PARTICIPANT_NOT_FOUND` (user chưa join); `leftAt IS NOT NULL` → `PARTICIPANT_LEFT`.
2. **Verify contribution row** — `SELECT "damageDone"::text, "supportScore", "survivalSeconds", "actionCount", "contributionScore", "createdAt", "updatedAt" FROM "CoopBossContribution" WHERE "runId"='<run_id>' AND "participantId"='<part_id>'`. Trả 0 row → chưa từng submit; có row → so sánh `damageDone`/`supportScore`/`survivalSeconds` vs giá trị FE submit; nếu bằng cap (`maxDamagePerContribution=...`) → bị clamp anomaly.
3. **Verify contribution window** — `SELECT "startedAt" FROM "CoopBossRun" WHERE id='<run_id>'`. Nếu `NOW() - startedAt > COOP_BOSS_LIMITS.contributionWindowSeconds (1800s = 30 phút)` → `CONTRIBUTION_WINDOW_CLOSED`. Phải finish run trước khi window đóng.
4. **Anomaly log spam**: tail `journalctl -u xuantoi-api` (hoặc Loki query `app="api" msg=~"coop-boss.*anomaly"`). Nhiều anomaly từ 1 user → có thể bot/cheat → check `BanRisk` ledger, escalate `audit.COOP_BOSS_ABUSE_BLOCKED`.

### §C. Reward claim issue

Phase 20.2 enforce:
- Eligibility snapshot at `finishRun`: `leftAt=null` AND `survivalSeconds >= COOP_BOSS_LIMITS.minSurvivalSeconds (30s)` AND tier ≠ `NONE`.
- Atomic CAS `PENDING → CLAIMED` + ledger entry idempotent qua `refType='CoopBossRewardClaim'` + `refId=claim.id`.

Triage:

1. **Verify eligibility** — `SELECT "eligibleForReward", "finalContributionScore", "leftAt" FROM "CoopBossParticipant" WHERE "runId"='<run_id>' AND "userId"='<user>'`. `eligibleForReward=false` → đã ineligible tại finish (leave sớm / không đủ survival / tier NONE).
2. **Verify reward claim row** — `SELECT id, status, "rewardTier", "rewardJson", "claimedAt" FROM "CoopBossRewardClaim" WHERE "runId"='<run_id>' AND "userId"='<user>'`. Trả 0 row → `REWARD_NOT_FOUND` (run FAILED hoặc tier NONE); `status=CLAIMED` → đã claim trước đó.
3. **Verify ledger** — `SELECT "createdAt", currency, delta FROM "CurrencyLedger" WHERE reason='COOP_BOSS_REWARD' AND meta->>'runId'='<run_id>' AND "userId"='<user>'`. Phải có entry khi `status='CLAIMED'`; thiếu → race CAS bug, escalate P1.
4. **Double-claim**: CAS guard ngăn race. Nếu user khiếu nại nhận 2 lần → check ledger count `=2` → bug, P0. Nếu count `=1` nhưng FE thấy 2 toast → FE UI duplicate, P3.

### §D. Stuck run

Phase 20.2 run lifecycle: LOBBY → IN_PROGRESS (auto-promote khi contribution đầu tiên) → CLEARED/FAILED (leader `finishRun`) → reward claim window. Stuck:

1. **LOBBY > 24h, no contribution** — leader có thể đã rời game; force-cancel:
   ```sql
   UPDATE "CoopBossRun" SET status='CANCELED', "finishedAt"=NOW() WHERE id='<run_id>' AND status='LOBBY';
   ```
2. **IN_PROGRESS > 1h, no recent contribution** — group abandon; cho phép leader `cancelRun` qua admin, hoặc:
   ```sql
   UPDATE "CoopBossRun" SET status='FAILED', "finishedAt"=NOW() WHERE id='<run_id>' AND status='IN_PROGRESS';
   ```
   KHÔNG tự cộng reward; FAILED = no claim.
3. **Audit force-action**: ghi vào `audit.COOP_BOSS_ADMIN_FORCE_CANCEL` với meta `{runId, adminId, reason}`.

### Operator playbook (admin)

- List active runs: `GET /admin/coop/boss/runs?status=LOBBY,IN_PROGRESS` (cần `ADMIN`/`GM` role).
- Recompute contribution (drift detection): `POST /admin/coop/boss/runs/:id/recompute-contribution` — re-run `computeContributionScore` trên latest contribution rows.
- Audit channel: `audit.COOP_BOSS_*` (filter qua `/admin/audit?category=COOP_BOSS`).

---

## 3. Backup operations (closed beta cadence)

### 3.1. Cron daily backup

Suggested crontab (server có ít nhất 5GB free disk):
```cron
# 02:00 sáng local time — backup + auto-prune > 7 ngày
0 2 * * * cd /opt/xuantoi && BACKUP_DIR=/var/backups/xuantoi BACKUP_RETENTION_DAYS=7 pnpm backup:db >> /var/log/xuantoi-backup.log 2>&1
```

`BACKUP_RETENTION_DAYS=7` ép script tự xoá file
`xuantoi-*.sql.gz` cũ hơn 7 ngày — không còn cần `find -mtime +7
-delete` riêng.

**Offsite copy** (KHÔNG nằm trong script này — viết riêng):
```bash
# rclone mirror lên S3 / GCS
rclone copy /var/backups/xuantoi remote:xuantoi-backup --include 'xuantoi-*.sql.gz'
```

### 3.2. Manual backup khi nào

- Trước migration mới (`pnpm prisma:migrate`).
- Trước restore (đề phòng restore sai file).
- Trước admin script delete hàng loạt.
- Trước release rủi ro cao (Phase mới chạm ledger / inventory).

### 3.3. Verify backup tốt hằng tuần

Restore vào staging hoặc local:
```bash
DATABASE_URL=postgresql://mtt:mtt@localhost:5432/mtt_restore_test \
  CONFIRM_RESTORE=YES pnpm restore:db /var/backups/xuantoi/<latest>.sql.gz

DATABASE_URL=postgresql://mtt:mtt@localhost:5432/mtt_restore_test \
  pnpm verify:restore
```

Nếu verify fail → restore không tốt → **mở P0** (backup pipeline
broken nguy hiểm hơn cả service down).

### 3.4. Weekly Verification + Admin tracking (Phase 17.2)

Phase 17.2 thêm tracking layer trên 3 script `backup-db.sh`/`restore-db.sh`/`verify-restore.sh`: mỗi run được record vào `BackupRun` / `BackupVerifyRun` và admin xem trạng thái + cảnh báo stale/fail qua admin panel. **KHÔNG** thay đổi script shell. **KHÔNG** expose restore qua API — destructive ops vẫn theo §2.10.

**Cách check trạng thái nhanh:**
- Admin panel → tab "Backup" → 2 card với badge `OK` / `STALE` / `FAILED` / `DISABLED`.
- Hoặc API: `curl https://api/api/admin/backup/status` (auth admin cookie).

**Khi badge `STALE` (last success > 8 ngày):**
1. Kiểm tra `BACKUP_CRON_ENABLED` env trên API instance — nếu `false` → cron không fire, set `true` + restart.
2. Nếu enabled mà vẫn STALE → BullMQ worker có thể down. Check `ready` queue cho `backup-cron` repeat job.
3. Manual trigger qua admin UI "Chạy backup ngay" để khôi phục `lastSuccessAt` → badge sẽ chuyển `OK` sau khi success row được ghi.

**Khi badge `FAILED` (lastErrorAt fresher hơn lastSuccessAt):**
1. Mở admin panel → đọc `errorMessage` ở row latest.
2. Phổ biến nhất: disk full ở `BACKUP_DIR` → free disk + retry.
3. Hoặc `pg_dump` permission lỗi → kiểm tra DATABASE_URL có quyền `pg_read_all_data` không.
4. Sau khi fix root cause, manual trigger lại để verify.

**Khi cần manual verify (không qua admin UI):**
```bash
# Local: chạy verify rồi check record qua psql
pnpm verify:restore
# Tracking row chỉ được ghi khi chạy qua cron/admin API, KHÔNG khi chạy pnpm CLI raw.
# Phase sau có thể wire CLI -> POST /internal/backup/record.
```

**Admin endpoint** (tất cả ADMIN-only + audit log):
- `GET  /admin/backup/status` — đọc snapshot health.
- `POST /admin/backup/run` — manual trigger backup. Audit `ADMIN_BACKUP_RUN`.
- `POST /admin/backup/verify` — manual trigger verify. Audit `ADMIN_BACKUP_VERIFY`.

**KHÔNG có endpoint restore.** Khi cần restore production thật → theo §2.10 với maintenance window + sign-off.

---

## 4. Contact & escalation

> **KHÔNG đưa số điện thoại / email cá nhân vào file này.** Liên hệ
> tra qua secret manager hoặc internal wiki.

Escalation order (closed beta):

1. **On-call dev** (rotation theo tuần) — verify + mitigate.
2. **Tech lead** — quyết định rollback / production restore /
   maintenance window.
3. **Game design lead** — quyết định compensate player, mail
   announcement.
4. **Founder / product** — chỉ cho P0 ảnh hưởng > 50% player hoặc
   mất tiền > X (định nghĩa nội bộ).

**Channels**:
- Team channel (Slack / Discord) — log mọi action P1+ cho audit.
- GitHub issue — tag label `severity:p0/p1/p2/p3` + `area:ops`.
- Sentry — auto-page on-call khi P0 error rate > N/min (cấu hình ở
  Sentry alert rule, không phải code).

---

## 4.5. Load test (k6) — Phase 17.5

Closed beta capacity validation. **Không** chạy load test nặng trong CI / production. Default test local / staging.

### Cài k6

```bash
# Linux:
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6

# macOS:
brew install k6

# Verify:
k6 version
```

### Chạy 3 kịch bản

```bash
# 1. Smoke (1 VU x 10s) — verify API alive, không cần auth.
pnpm load:smoke
# Hoặc: k6 run scripts/load/k6-smoke.js
BASE_URL=https://staging.xuantoi.example pnpm load:smoke

# 2. API baseline (3 VUs x 30s) — full user flow.
BASE_URL=http://localhost:3000 \
TEST_EMAIL=loadtest@example.com \
TEST_PASSWORD=ChangeMe!123 \
pnpm load:api

# Custom VU/duration:
VUS=10 DURATION=2m pnpm load:api

# Hoặc dùng AUTH_TOKEN sẵn có (skip login flow):
AUTH_TOKEN=eyJhbGciOi... pnpm load:api

# 3. WebSocket baseline (5 VUs x 20s) — Socket.IO connect/auth/disconnect.
BASE_URL=http://localhost:3000 \
TEST_EMAIL=loadtest@example.com \
TEST_PASSWORD=ChangeMe!123 \
pnpm load:ws
```

### Đọc kết quả

k6 in tổng kết cuối run; field quan trọng:

| Field | Closed-beta target | Action khi fail |
|-------|--------------------|-----------------|
| `http_req_duration` p(95) | < 1500ms (api), < 800ms (smoke) | Check CPU/memory `/admin/metrics` qua poll cùng thời gian. Slow query → enable Postgres `log_min_duration_statement`. |
| `http_req_failed` rate | < 5% | 401/403 dồn dập → audit cookie expiry; 5xx → check Sentry / `apps/api` log. |
| `xt_login_failures` count | < 10 | Rate limit IP / account lock → kiểm tra `auth.service.ts` log. |
| `xt_flow_success_rate` | > 90% | 1 endpoint trong flow consistently fail — xem tag k6 (`endpoint=mission_me`). |
| `xt_ws_connect_success_rate` | > 95% | JWT expired / Redis down (`/api/admin/metrics` `ws.serverBound=false`). |
| `xt_ws_connect_failures` count | < 20 | Network / TLS handshake error — check API ingress log. |

### Threshold gợi ý closed beta (combine với `/admin/metrics`)

| Metric | Threshold | Source |
|--------|-----------|--------|
| API p95 latency | < 1500ms | k6 `http_req_duration` |
| API error rate | < 5% | k6 `http_req_failed` |
| WS connect success | > 95% | k6 `xt_ws_connect_success_rate` |
| Queue depth `waiting` | < 100 (nếu cron không kẹt) | `/admin/metrics` `queue.queues[].waiting` |
| Queue depth `failed` | < 10 (rolling 24h) | `/admin/metrics` `queue.queues[].failed` |
| RSS memory growth | < 1.5x baseline sau 1h soak | `/admin/metrics` `system.memory.rssBytes` |
| WS online users | tracking baseline (closed beta n=20-100) | `/admin/metrics` `ws.onlineUsers` |
| Cron last run age | < 25h cho daily, < 8 ngày cho weekly | `/admin/metrics` `cron.jobs[].lastRunAt` diff với `now()` |

### Common pitfalls

- **k6 raw WebSocket**: script `k6-ws-baseline.js` dùng raw WS vào engine.io endpoint (`/ws/?EIO=4&transport=websocket`). Đủ verify handshake + cookie auth, nhưng KHÔNG gửi event business. Full E2E protocol cần Artillery hoặc node-based runner.
- **Rate limit**: `POST /api/_auth/login` rate limit per-IP 5 / 15min (PR #60). Baseline 3 VU x 30s với 1 setup login chỉ login 1 lần (k6 setup() chạy trước iteration). Nếu chạy multi-stage → pass `AUTH_TOKEN` để skip login.
- **Cookie path**: cookie `xt_access` đặt `Path=/`, k6 phải gửi `Cookie: xt_access=<jwt>` cho mọi request authenticated. `setup()` parse từ `Set-Cookie` headers.
- **HTTPS staging**: nếu BASE_URL https, k6 mặc định verify TLS. Self-signed cert → `K6_INSECURE_SKIP_TLS_VERIFY=true k6 run ...`.
- **Test account**: tạo user riêng đã onboard character. KHÔNG dùng tài khoản admin / GM / staff. Note `loadtest` trong DB.

### SECURITY

- KHÔNG hardcode token vào script. Repo có gitleaks scan trong CI.
- KHÔNG chạy production khi chưa có phép — có thể trigger BAN_RISK audit, account lock người chơi thật, ngập rate-limit Redis key.
- Run staging trước, đối chiếu p95 / error rate / WS connect rate với baseline cũ (lưu kết quả trong `docs/closed-beta/load-test-runs/YYYY-MM-DD.md` nếu cần history).

## 5. Post-incident

Sau khi mitigate P0/P1:

1. Mở GitHub issue `incident-YYYYMMDD-<slug>`.
2. Cập nhật `docs/AI_HANDOFF_REPORT.md` Known Issues nếu có
   regression chưa fix.
3. Ghi action item: monitoring, alert mới, automation, test
   reproduce. Link sang issue/PR follow-up.
4. Re-test backup restore trên staging trong 7 ngày sau (đảm bảo
   pipeline còn tốt).

---

## 6. Liên kết

- `docs/DEPLOY.md` — deploy + env baseline.
- `docs/BACKUP_RESTORE.md` — script chi tiết.
- `docs/TROUBLESHOOTING.md` — symptom → fix.
- `docs/ADMIN_GUIDE.md` — admin endpoint.
- `docs/SECURITY.md` — secret + rotate.
- `docs/QA_CHECKLIST.md` — smoke check sau restore / deploy.
- `apps/api/src/observability/logger.ts` — Pino redact policy
  (Phase 17.3).
- `apps/api/src/observability/sentry.ts` — Sentry init (Phase 17.3).
