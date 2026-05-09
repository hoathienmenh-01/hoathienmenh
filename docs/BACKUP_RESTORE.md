# Backup & Restore — Postgres

Mục đích: khôi phục DB nhanh sau sự cố trong closed beta. Đảm bảo dữ liệu người chơi (Character, ledger, mail, giftcode redemption, sect) không mất.

> Pair script: `scripts/backup-db.sh` + `scripts/restore-db.sh` + `scripts/verify-restore.sh` (Phase 17.4). Idempotent, an toàn để chạy nhiều lần. Runbook sự cố production: `docs/RUNBOOK.md`.

## TL;DR

```bash
# Backup (default: ./backups/xuantoi-<TS>.sql.gz)
pnpm backup:db

# Backup + auto-prune > 7 ngày
BACKUP_RETENTION_DAYS=7 pnpm backup:db

# Restore (yêu cầu interactive confirm)
pnpm restore:db ./backups/xuantoi-20260429-150000.sql.gz

# Restore bỏ confirm (cron / CI)
CONFIRM_RESTORE=YES pnpm restore:db ./backups/xuantoi-<TS>.sql.gz

# Restore + chạy prisma migrate deploy ngay sau (nếu schema mới hơn backup)
CONFIRM_RESTORE=YES RUN_PRISMA_MIGRATE=1 pnpm restore:db ./backups/<file>.sql.gz

# Verify sau khi restore xong
pnpm verify:restore
```

## Tổng quan

- **Format**: `pg_dump --format=plain` + gzip → `.sql.gz`. Plain SQL dễ inspect (`gunzip -c file.sql.gz | head`), restore chỉ cần `psql`.
- **Strategy auto-detect**:
  1. Nếu host có `pg_dump`/`psql` → dùng host binary trực tiếp với `DATABASE_URL`.
  2. Nếu không, fallback sang `docker exec xuantoi-pg pg_dump ...` (dùng container dev).
  3. Force chế độ docker bằng `USE_DOCKER=1`.
- **Naming** (Phase 17.4): `<BACKUP_DIR>/xuantoi-<YYYYMMDD-HHMMSS>.sql.gz`. Default `BACKUP_DIR=./backups`. Glob retention dùng pattern `xuantoi-*.sql.gz` để không đụng file lạ trong dir.
- **Verify**: `backup-db.sh` kiểm tra file > 0 byte + grep marker `-- PostgreSQL database dump`. Fail rõ nếu dump rỗng.
- **Auto-prune** (Phase 17.4): set `BACKUP_RETENTION_DAYS=N` → script tự xoá `xuantoi-*.sql.gz` cũ hơn N ngày sau backup thành công. Default `0` = disabled.
- **Risk khi restore**: **DROP DATABASE** rồi **CREATE** lại — phá toàn bộ data hiện có. Mặc định prompt `yes`; chỉ skip khi `CONFIRM_RESTORE=YES` (Phase 17.4) hoặc legacy `ASSUME_YES=1`.
- **Production guard** (Phase 17.4): khi `NODE_ENV=production`, restore script CHẶN (exit 9) trừ khi `ALLOW_PRODUCTION_RESTORE=YES` được set tường minh. Bắt buộc sign-off + maintenance window trước khi gõ.
- **Bootstrap sau restore**: nếu restore từ backup cũ thiếu admin/sect, chạy `pnpm --filter @xuantoi/api bootstrap` (idempotent).
- **Verify** (Phase 17.4): chạy `pnpm verify:restore` sau restore — connect probe + count critical tables (`User`/`Character`/`CurrencyLedger`/`ItemLedger`/`InventoryItem`/`Mail`/`Sect`/`TopupOrder`/`AdminAuditLog`/`_prisma_migrations`) + latest migration name + optional API healthcheck.

## Khi nào backup

- **Hàng ngày** (closed beta): chạy `pnpm backup:db` qua cron 02:00 sáng. Giữ 7 bản gần nhất.
- **Trước migration mới**: `pnpm backup:db` rồi mới `pnpm prisma:migrate`.
- **Trước restore production**: backup hiện trạng trước, đề phòng restore sai file.
- **Trước khi xoá hàng loạt** (admin script clean rác).

## Khi nào restore

- Sự cố data corruption (admin xoá nhầm, migration phá schema, container pg crash mất volume).
- Rollback sau release lỗi.
- Promote backup từ staging vào dev local để repro bug.

## Workflow chi tiết

### 1. Backup

```bash
# Default: backup DB hiện tại trỏ bởi DATABASE_URL hoặc fallback localhost:5432/mtt
pnpm backup:db

# Custom DB URL (ví dụ staging)
DATABASE_URL=postgresql://user:pass@staging.host:5432/mtt pnpm backup:db

# Custom output dir
BACKUP_DIR=/var/backups/xuantoi pnpm backup:db

# Force docker mode (bỏ qua host pg_dump nếu có)
USE_DOCKER=1 pnpm backup:db
```

Output mẫu:
```
[backup-db] DATABASE_URL=postgresql://mtt:***@localhost:5432/mtt
[backup-db] DB name: mtt
[backup-db] Writing to: ./backups/xuantoi-20260429-150000.sql.gz
[backup-db] Strategy: docker exec xuantoi-pg
[backup-db] Retention: 7 days
[backup-db] Done: ./backups/xuantoi-20260429-150000.sql.gz (8.0K, 5966 bytes)
[backup-db] Verified PostgreSQL header marker.
[backup-db] Retention prune done — removed 0 file(s) > 7 days.
```

Exit codes:
- `0` — success.
- `2` — DATABASE_URL trống / không parse được DB name.
- `3` — không có cả `pg_dump` host lẫn `xuantoi-pg` container.
- `4` — file output rỗng (pg_dump fail).
- `5` — file thiếu PostgreSQL marker (file không phải dump hợp lệ).

### 2. Inspect backup

```bash
# Xem header
gunzip -c ./backups/xuantoi-20260429-150000.sql.gz | head -20

# Đếm số table
gunzip -c ./backups/xuantoi-20260429-150000.sql.gz | grep -c "CREATE TABLE"
# → expect ~51 (post Prisma schema Phase 14.x)

# Xem table cụ thể (e.g. Character)
gunzip -c ./backups/xuantoi-20260429-150000.sql.gz | grep -A 5 "TABLE.*Character"

# Đếm số record User (cần restore vào DB tạm)
gunzip -c ./backups/xuantoi-20260429-150000.sql.gz | grep -c "^INSERT INTO public.\"User\""
```

### 3. Restore

```bash
# Default: prompt confirm
pnpm restore:db ./backups/xuantoi-20260429-150000.sql.gz

# Bypass prompt (cron/CI)
CONFIRM_RESTORE=YES pnpm restore:db ./backups/xuantoi-20260429-150000.sql.gz

# Restore vào staging
DATABASE_URL=postgresql://user:pass@staging.host:5432/mtt \
  CONFIRM_RESTORE=YES pnpm restore:db ./backups/xuantoi-<TS>.sql.gz

# Restore + chạy prisma migrate deploy ngay sau
CONFIRM_RESTORE=YES RUN_PRISMA_MIGRATE=1 pnpm restore:db ./backups/<file>.sql.gz
```

Output mẫu:
```
[restore-db] DATABASE_URL=postgresql://mtt:***@localhost:5432/mtt
[restore-db] DB name: mtt
[restore-db] NODE_ENV: development
[restore-db] Backup file: ./backups/xuantoi-20260429-150000.sql.gz
[restore-db] Strategy: docker exec xuantoi-pg

WARNING: this will DROP database "mtt" and restore from ./backups/xuantoi-20260429-150000.sql.gz.
         All current data in "mtt" will be lost.

[restore-db] CONFIRM_RESTORE/ASSUME_YES set — bỏ qua interactive prompt.
[restore-db] Terminating active sessions on mtt via docker exec...
[restore-db] Dropping & recreating mtt via docker exec...
DROP DATABASE
CREATE DATABASE
[restore-db] Restoring...
[restore-db] Done. Database "mtt" restored from ./backups/xuantoi-20260429-150000.sql.gz.
```

Exit codes:
- `0` — success.
- `1` — thiếu argument backup file.
- `2` — backup file không tồn tại.
- `3` — backup file rỗng.
- `4` — DATABASE_URL không parse được DB name.
- `5` — không có psql/docker.
- `6` — user huỷ ở prompt confirm.
- `7` — backup file gzip corrupted (`gunzip -t` fail).
- `8` — DATABASE_URL trống.
- `9` — production guard chặn (NODE_ENV=production và không có `ALLOW_PRODUCTION_RESTORE=YES`).

### 4. Sau restore

1. **Bootstrap idempotent** (nếu backup thiếu admin/sect):
   ```bash
   pnpm --filter @xuantoi/api bootstrap
   ```
2. **Migrate** (nếu schema main mới hơn backup):
   ```bash
   cd apps/api && pnpm prisma:migrate
   ```
3. **Audit ledger** consistency:
   ```bash
   cd apps/api && pnpm audit:ledger
   ```
4. **Smoke test** theo `docs/QA_CHECKLIST.md` (login + character home view + mission claim).

### 4b. Verify (Phase 17.4)

```bash
# Default: probe local DB
pnpm verify:restore

# Verify staging + API healthcheck
DATABASE_URL=postgresql://user:pass@staging.host:5432/mtt \
  API_HEALTHCHECK_URL=https://api.staging.xuantoi/api/healthz \
  pnpm verify:restore

# STRICT: fail nếu User/Character bảng rỗng (DB rỗng sau restore)
STRICT=1 pnpm verify:restore
```

Verify checklist:
- Connect probe (`SELECT 1`).
- Schema có ≥ 21 table public.
- Critical tables tồn tại + count: `User`, `Character`, `Sect`, `CurrencyLedger`, `ItemLedger`, `InventoryItem`, `Mail`, `TopupOrder`, `AdminAuditLog`, `_prisma_migrations`.
- Latest applied prisma migration name (cross-ref schema version).
- Optional API healthcheck (chỉ khi `API_HEALTHCHECK_URL` set).

Exit codes:
- `0` — pass.
- `2` — DB không connect được.
- `3` — thiếu critical table.
- `4` — schema < 21 table.
- `5` — không có psql/docker.
- `6` — STRICT=1 và `User`/`Character` empty.
- `7` — API healthcheck fail.

## Cron daily backup (production)

Suggested crontab (Phase 17.4 — dùng `BACKUP_RETENTION_DAYS` thay cho `find -delete` riêng):
```cron
# Daily 02:00 — backup + auto-prune > 7 ngày
0 2 * * * cd /opt/xuantoi && BACKUP_DIR=/var/backups/xuantoi BACKUP_RETENTION_DAYS=7 pnpm backup:db >> /var/log/xuantoi-backup.log 2>&1
```

Hoặc dùng systemd timer thay vì cron (production VM).

## Disaster recovery checklist

Khi DB primary chết hoàn toàn — pair với `docs/RUNBOOK.md` §2.10:

1. Provision DB instance mới (same Postgres version — production target = `postgres:16`).
2. Khôi phục từ backup gần nhất:
   ```bash
   DATABASE_URL=postgresql://user:pass@new-host:5432/mtt \
     CONFIRM_RESTORE=YES RUN_PRISMA_MIGRATE=1 \
     pnpm restore:db /var/backups/xuantoi/<latest>.sql.gz
   ```
   Production: thêm `ALLOW_PRODUCTION_RESTORE=YES` (yêu cầu sign-off + maintenance window).
3. Verify sau restore:
   ```bash
   DATABASE_URL=... pnpm verify:restore
   ```
4. Bootstrap idempotent:
   ```bash
   cd apps/api && DATABASE_URL=... pnpm bootstrap
   ```
5. Audit ledger consistency:
   ```bash
   cd apps/api && DATABASE_URL=... pnpm audit:ledger
   ```
6. Smoke API: `curl https://api/api/healthz` + `curl https://api/api/readyz` đều trả `{ ok: true }`.
7. Smoke FE: login + character home + mission claim theo `docs/QA_CHECKLIST.md` 15-min check.

## Hạn chế hiện tại

- **Single dump file**: không có WAL streaming → RPO = thời gian giữa 2 lần backup. Trong closed beta acceptable; sau beta nên bổ sung pg_basebackup + WAL archiving (PITR).
- **Không encrypt**: file gzip plain text. Khi đẩy lên S3/GCS, dùng SSE hoặc encrypt thủ công (`gpg --symmetric file.sql.gz`).
- **Không offsite copy**: script chỉ ghi vào local `BACKUP_DIR`. Pair với rclone/aws-cli/scp riêng để upload offsite.

## Liên kết

- `docs/RUNBOOK.md` — incident severity P0–P3 + playbook (Phase 17.4).
- `docs/RUN_LOCAL.md` — setup dev (cần Docker chạy `xuantoi-pg`).
- `docs/SECURITY.md` — chính sách secret + log không rò token.
- `docs/QA_CHECKLIST.md` — smoke test sau restore.
- `apps/api/prisma/schema.prisma` — current schema (~51 model post Phase 14.x).
