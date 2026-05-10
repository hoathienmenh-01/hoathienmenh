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

### 2.16. PWA service worker phục vụ asset cũ (P3)

Xem `docs/TROUBLESHOOTING.md` §14. Hard refresh hoặc DevTools →
Application → Service Workers → Unregister. Build production tự bump
precache hash → user mới sẽ tự update sau lần load thứ 2.

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
