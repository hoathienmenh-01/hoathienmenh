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
