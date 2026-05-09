#!/usr/bin/env bash
# Phase 17.4 — Postgres backup automation script.
#
# Usage:
#   scripts/backup-db.sh                               # default: dump local dev DB to ./backups/
#   DATABASE_URL=postgres://... scripts/backup-db.sh   # backup arbitrary DB
#   BACKUP_DIR=/var/backups/xuantoi scripts/backup-db.sh
#   BACKUP_RETENTION_DAYS=7 scripts/backup-db.sh       # auto-prune *.sql.gz older than 7 days
#   DRY_RUN=1 scripts/backup-db.sh                     # print plan, không dump
#   USE_DOCKER=1 scripts/backup-db.sh                  # force pg_dump qua docker exec xuantoi-pg
#
# Output: <BACKUP_DIR>/xuantoi-<YYYYMMDD-HHMMSS>.sql.gz
# Exit code: 0 success; 2 missing/invalid env; 3 missing toolchain; 4 empty dump; 5 marker mismatch.
#
# Closed-beta scale: chạy thủ công hoặc cron daily. Khi scale lên dùng pg_basebackup + WAL.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://mtt:mtt@localhost:5432/mtt}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
USE_DOCKER="${USE_DOCKER:-auto}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-0}"
DRY_RUN="${DRY_RUN:-0}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# Mask password trong DATABASE_URL khi log/echo (không leak credentials vào cron/CI log file).
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"

if [[ -z "$DATABASE_URL" ]]; then
  echo "FATAL: DATABASE_URL is empty" >&2
  exit 2
fi

# Parse DB name from URL (sau dấu / cuối, trước ?).
DB_PATH="${DATABASE_URL##*/}"
DB_NAME="${DB_PATH%%\?*}"
if [[ -z "$DB_NAME" ]]; then
  echo "FATAL: cannot parse DB name from DATABASE_URL=$SAFE_URL" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/xuantoi-$TIMESTAMP.sql.gz"

# Decide pg_dump strategy.
if [[ "$USE_DOCKER" == "auto" ]]; then
  if command -v pg_dump >/dev/null 2>&1; then
    USE_DOCKER=0
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^xuantoi-pg$'; then
    USE_DOCKER=1
  else
    echo "FATAL: neither pg_dump nor xuantoi-pg container available" >&2
    echo "Install postgres-client (apt-get install postgresql-client) or run pnpm infra:up" >&2
    exit 3
  fi
fi

echo "[backup-db] DATABASE_URL=$SAFE_URL"
echo "[backup-db] DB name: $DB_NAME"
echo "[backup-db] Writing to: $OUT"
echo "[backup-db] Strategy: $([[ "$USE_DOCKER" == "1" ]] && echo "docker exec xuantoi-pg" || echo "host pg_dump")"
echo "[backup-db] Retention: $([[ "$BACKUP_RETENTION_DAYS" == "0" ]] && echo "disabled (BACKUP_RETENTION_DAYS=0)" || echo "$BACKUP_RETENTION_DAYS days")"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[backup-db] DRY_RUN=1 — không thực thi pg_dump. Exit 0."
  exit 0
fi

if [[ "$USE_DOCKER" == "1" ]]; then
  # Container có sẵn psql user/pass, fix DB name. PGPASSWORD set qua env -e (không in ra log).
  docker exec -e PGPASSWORD=mtt xuantoi-pg \
    pg_dump --no-owner --no-acl -U mtt -d "$DB_NAME" --format=plain \
    | gzip -9 > "$OUT"
else
  pg_dump --no-owner --no-acl --format=plain "$DATABASE_URL" \
    | gzip -9 > "$OUT"
fi

# Sanity check: file phải có nội dung > 0 byte.
if [[ ! -s "$OUT" ]]; then
  echo "FATAL: backup file is empty ($OUT)" >&2
  rm -f "$OUT"
  exit 4
fi

SIZE_BYTES="$(wc -c < "$OUT" | tr -d ' ')"
SIZE_HUMAN="$(du -h "$OUT" | cut -f1)"
echo "[backup-db] Done: $OUT ($SIZE_HUMAN, $SIZE_BYTES bytes)"

# Quick verification: gunzip preview head 5 lines must contain PostgreSQL marker.
# Capture into variable trước khi grep — `gunzip -c | head -5` dưới `pipefail`
# sẽ fail với exit 141 (SIGPIPE) khi dump > pipe buffer (~64KB) vì head đóng stdin
# trước khi gunzip flush xong. `|| true` ngăn pipefail propagate vào dòng if.
HEADER="$(gunzip -c "$OUT" | head -5 || true)"
if ! printf '%s' "$HEADER" | grep -q -- "-- PostgreSQL database dump"; then
  echo "WARN: backup file does not contain expected PostgreSQL marker" >&2
  echo "WARN: verify manually with: gunzip -c $OUT | head -20" >&2
  exit 5
fi
echo "[backup-db] Verified PostgreSQL header marker."

# Optional retention prune. Only acts when BACKUP_RETENTION_DAYS > 0; chỉ xoá file
# theo glob `xuantoi-*.sql.gz` để không đụng file lạ trong BACKUP_DIR.
if [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$BACKUP_RETENTION_DAYS" -gt 0 ]]; then
  PRUNED=0
  while IFS= read -r -d '' OLD; do
    rm -f "$OLD"
    echo "[backup-db] Pruned: $OLD"
    PRUNED=$((PRUNED + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'xuantoi-*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -print0 2>/dev/null || true)
  echo "[backup-db] Retention prune done — removed $PRUNED file(s) > $BACKUP_RETENTION_DAYS days."
fi
