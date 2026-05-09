#!/usr/bin/env bash
# Phase 17.4 — Postgres restore automation script.
#
# Usage:
#   scripts/restore-db.sh ./backups/xuantoi-20260429-150000.sql.gz
#   DATABASE_URL=postgres://... scripts/restore-db.sh ./backup.sql.gz
#   CONFIRM_RESTORE=YES scripts/restore-db.sh ./backup.sql.gz   # skip prompt (cron/CI)
#   ASSUME_YES=1 scripts/restore-db.sh ./backup.sql.gz          # legacy alias of CONFIRM_RESTORE=YES
#   USE_DOCKER=1 scripts/restore-db.sh ./backup.sql.gz          # force docker exec
#   ALLOW_PRODUCTION_RESTORE=YES scripts/restore-db.sh ./backup.sql.gz  # bypass NODE_ENV=production guard
#   RUN_PRISMA_MIGRATE=1 scripts/restore-db.sh ./backup.sql.gz  # chạy prisma migrate deploy sau restore
#
# DROP + CREATE + restore. **Phá toàn bộ data hiện có**.
# Mặc định CHẶN khi NODE_ENV=production trừ khi `ALLOW_PRODUCTION_RESTORE=YES`.
# Mặc định prompt confirm trừ khi `CONFIRM_RESTORE=YES` (hoặc legacy `ASSUME_YES=1`).
#
# Pair với scripts/backup-db.sh + scripts/verify-restore.sh.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"
DATABASE_URL="${DATABASE_URL:-postgresql://mtt:mtt@localhost:5432/mtt}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-}"
ASSUME_YES="${ASSUME_YES:-0}"
USE_DOCKER="${USE_DOCKER:-auto}"
ALLOW_PRODUCTION_RESTORE="${ALLOW_PRODUCTION_RESTORE:-}"
RUN_PRISMA_MIGRATE="${RUN_PRISMA_MIGRATE:-0}"
NODE_ENV="${NODE_ENV:-development}"

# Mask password trong DATABASE_URL khi log/echo (không leak credentials vào cron/CI log file).
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"

if [[ -z "$DATABASE_URL" ]]; then
  echo "FATAL: DATABASE_URL is empty" >&2
  exit 8
fi

# Production safety guard chạy TRƯỚC mọi check khác — ưu tiên cao nhất.
# Block khi NODE_ENV=production trừ khi opt-in tường minh.
if [[ "$NODE_ENV" == "production" ]] && [[ "$ALLOW_PRODUCTION_RESTORE" != "YES" ]]; then
  echo "FATAL: NODE_ENV=production detected and ALLOW_PRODUCTION_RESTORE != YES." >&2
  echo "       Restore script mặc định CHẶN production." >&2
  echo "       Nếu thực sự muốn restore production, set ALLOW_PRODUCTION_RESTORE=YES tường minh," >&2
  echo "       sau khi đã backup hiện trạng + báo on-call (xem docs/RUNBOOK.md §Backup Restore)." >&2
  exit 9
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "FATAL: backup file not found: $BACKUP_FILE" >&2
  exit 2
fi

if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "FATAL: backup file is empty: $BACKUP_FILE" >&2
  exit 3
fi

# Extract DB name from URL.
DB_PATH="${DATABASE_URL##*/}"
DB_NAME="${DB_PATH%%\?*}"
if [[ -z "$DB_NAME" ]]; then
  echo "FATAL: cannot parse DB name from DATABASE_URL=$SAFE_URL" >&2
  exit 4
fi

# Decide strategy.
if [[ "$USE_DOCKER" == "auto" ]]; then
  if command -v psql >/dev/null 2>&1; then
    USE_DOCKER=0
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^xuantoi-pg$'; then
    USE_DOCKER=1
  else
    echo "FATAL: neither psql nor xuantoi-pg container available" >&2
    exit 5
  fi
fi

echo "[restore-db] DATABASE_URL=$SAFE_URL"
echo "[restore-db] DB name: $DB_NAME"
echo "[restore-db] NODE_ENV: $NODE_ENV"
echo "[restore-db] Backup file: $BACKUP_FILE"
echo "[restore-db] Strategy: $([[ "$USE_DOCKER" == "1" ]] && echo "docker exec xuantoi-pg" || echo "host psql")"
echo
echo "WARNING: this will DROP database \"$DB_NAME\" and restore from $BACKUP_FILE."
echo "         All current data in \"$DB_NAME\" will be lost."
echo

# CONFIRM gate. Hợp lệ: CONFIRM_RESTORE=YES (mới, ưu tiên) HOẶC ASSUME_YES=1 (legacy alias).
if [[ "$CONFIRM_RESTORE" == "YES" ]] || [[ "$ASSUME_YES" == "1" ]]; then
  echo "[restore-db] CONFIRM_RESTORE/ASSUME_YES set — bỏ qua interactive prompt."
else
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "[restore-db] Aborted." >&2
    exit 6
  fi
fi

# Validate gzip integrity first.
if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "FATAL: backup file is corrupted gzip: $BACKUP_FILE" >&2
  exit 7
fi

# Terminate active sessions trước khi DROP — Postgres từ chối DROP DATABASE nếu
# còn connection (Prisma client / pgAdmin / API server). Câu lệnh này idempotent
# và an toàn (`pid <> pg_backend_pid()` skip session psql đang chạy).
TERMINATE_SQL="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"

if [[ "$USE_DOCKER" == "1" ]]; then
  # Drop + recreate db inside docker.
  echo "[restore-db] Terminating active sessions on $DB_NAME via docker exec..."
  docker exec -e PGPASSWORD=mtt xuantoi-pg \
    psql -U mtt -d postgres -c "$TERMINATE_SQL" >/dev/null
  echo "[restore-db] Dropping & recreating $DB_NAME via docker exec..."
  docker exec -e PGPASSWORD=mtt xuantoi-pg \
    psql -U mtt -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
  docker exec -e PGPASSWORD=mtt xuantoi-pg \
    psql -U mtt -d postgres -c "CREATE DATABASE \"$DB_NAME\";"
  echo "[restore-db] Restoring..."
  gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD=mtt xuantoi-pg \
    psql -U mtt -d "$DB_NAME" --quiet
else
  # Build maintenance URL trỏ vào DB `postgres` để DROP/CREATE.
  ADMIN_URL="${DATABASE_URL%/$DB_NAME*}/postgres"
  echo "[restore-db] Terminating active sessions on $DB_NAME via host psql..."
  psql "$ADMIN_URL" -c "$TERMINATE_SQL" >/dev/null
  echo "[restore-db] Dropping & recreating $DB_NAME via host psql..."
  psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
  psql "$ADMIN_URL" -c "CREATE DATABASE \"$DB_NAME\";"
  echo "[restore-db] Restoring..."
  gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" --quiet
fi

echo "[restore-db] Done. Database \"$DB_NAME\" restored from $BACKUP_FILE."

# Optional: chạy prisma migrate deploy nếu schema repo mới hơn backup.
if [[ "$RUN_PRISMA_MIGRATE" == "1" ]]; then
  echo "[restore-db] RUN_PRISMA_MIGRATE=1 — chạy prisma migrate deploy..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --filter @xuantoi/api exec prisma migrate deploy
    echo "[restore-db] prisma migrate deploy done."
  else
    echo "WARN: pnpm not found, skipping prisma migrate deploy. Chạy thủ công: pnpm --filter @xuantoi/api exec prisma migrate deploy" >&2
  fi
fi

echo "[restore-db] Sau restore, nhớ chạy:"
echo "[restore-db]   1) pnpm verify:restore                          # verify schema/count tables"
echo "[restore-db]   2) pnpm --filter @xuantoi/api bootstrap         # idempotent admin + 3 sect"
if [[ "$RUN_PRISMA_MIGRATE" != "1" ]]; then
  echo "[restore-db]   3) pnpm --filter @xuantoi/api exec prisma migrate deploy   # nếu schema main mới hơn backup"
fi
