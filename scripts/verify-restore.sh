#!/usr/bin/env bash
# Phase 17.4 — Post-restore verification script.
#
# Usage:
#   scripts/verify-restore.sh                         # default: verify local dev DB + try API healthcheck
#   DATABASE_URL=postgres://... scripts/verify-restore.sh
#   API_HEALTHCHECK_URL=http://api:3000/api/healthz scripts/verify-restore.sh
#   USE_DOCKER=1 scripts/verify-restore.sh             # force psql qua docker exec xuantoi-pg
#   STRICT=1 scripts/verify-restore.sh                 # fail (exit 6) nếu count = 0 ở b\u1ea3ng game-state b\u1eaft bu\u1ed9c (User/Character)
#
# Verify checklist (an toàn cho staging/local — KHÔNG đụng row, chỉ đọc):
#   1) Kết nối DB được (`SELECT 1`).
#   2) Schema có ≥ 21 table (Phase 14.x baseline ~ 51 model).
#   3) Bảng quan trọng tồn tại + count: User, Character, Sect,
#      CurrencyLedger, ItemLedger, InventoryItem, Mail, TopupOrder,
#      AdminAuditLog, _prisma_migrations.
#   4) Latest prisma migration name (cross-ref schema version).
#   5) Optional: API healthcheck (chỉ khi API_HEALTHCHECK_URL set).
#
# Exit codes:
#   0 — verify pass.
#   2 — DB kết nối fail.
#   3 — thiếu table critical.
#   4 — schema có < 21 table.
#   5 — không có psql / docker.
#   6 — STRICT=1 và count = 0 ở User/Character (DB rỗng).
#   7 — API healthcheck fail.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://mtt:mtt@localhost:5432/mtt}"
USE_DOCKER="${USE_DOCKER:-auto}"
STRICT="${STRICT:-0}"
API_HEALTHCHECK_URL="${API_HEALTHCHECK_URL:-}"

# Mask password trong DATABASE_URL khi log/echo.
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"

if [[ -z "$DATABASE_URL" ]]; then
  echo "FATAL: DATABASE_URL is empty" >&2
  exit 2
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

# Extract DB name from URL.
DB_PATH="${DATABASE_URL##*/}"
DB_NAME="${DB_PATH%%\?*}"

# Helper: run psql -c "<sql>" -t -A và trả raw stdout.
run_sql() {
  local sql="$1"
  if [[ "$USE_DOCKER" == "1" ]]; then
    docker exec -e PGPASSWORD=mtt xuantoi-pg \
      psql -U mtt -d "$DB_NAME" -t -A -c "$sql"
  else
    psql "$DATABASE_URL" -t -A -c "$sql"
  fi
}

echo "[verify-restore] DATABASE_URL=$SAFE_URL"
echo "[verify-restore] DB name: $DB_NAME"
echo "[verify-restore] Strategy: $([[ "$USE_DOCKER" == "1" ]] && echo "docker exec xuantoi-pg" || echo "host psql")"
echo "[verify-restore] STRICT mode: $STRICT"
echo

# 1) Connection probe.
echo "[verify-restore] Step 1: connection probe (SELECT 1)"
if ! run_sql 'SELECT 1;' >/dev/null 2>&1; then
  echo "FATAL: cannot connect to DB ($SAFE_URL)" >&2
  exit 2
fi
echo "[verify-restore]   OK"

# 2) Schema table count.
TABLE_COUNT="$(run_sql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' \n\r')"
echo "[verify-restore] Step 2: public schema table count = $TABLE_COUNT"
if [[ -z "$TABLE_COUNT" ]] || [[ ! "$TABLE_COUNT" =~ ^[0-9]+$ ]]; then
  echo "FATAL: cannot read table count from information_schema" >&2
  exit 3
fi
if [[ "$TABLE_COUNT" -lt 21 ]]; then
  echo "FATAL: only $TABLE_COUNT tables in public schema (expected ≥ 21 — schema baseline)." >&2
  echo "       Có thể restore đã miss schema, hoặc thiếu prisma migrate deploy." >&2
  exit 4
fi
echo "[verify-restore]   OK (≥ 21 baseline)"

# 3) Critical tables existence + row counts.
declare -a CRITICAL=(
  '"User"'
  '"Character"'
  '"Sect"'
  '"CurrencyLedger"'
  '"ItemLedger"'
  '"InventoryItem"'
  '"Mail"'
  '"TopupOrder"'
  '"AdminAuditLog"'
  '_prisma_migrations'
)

declare -a MISSING=()
declare -a STATE_EMPTY=()
echo "[verify-restore] Step 3: critical table presence + count"
for tbl in "${CRITICAL[@]}"; do
  EXISTS_SQL="SELECT to_regclass('public.${tbl}') IS NOT NULL;"
  EXISTS="$(run_sql "$EXISTS_SQL" | tr -d ' \n\r')"
  if [[ "$EXISTS" != "t" ]]; then
    MISSING+=("$tbl")
    echo "[verify-restore]   $tbl → MISSING"
    continue
  fi
  COUNT="$(run_sql "SELECT count(*) FROM ${tbl};" | tr -d ' \n\r')"
  echo "[verify-restore]   $tbl count = $COUNT"
  # STRICT mode: User/Character empty là red flag (DB hoàn toàn trống sau restore).
  if [[ "$STRICT" == "1" ]] && [[ "$COUNT" == "0" ]]; then
    case "$tbl" in
      '"User"'|'"Character"')
        STATE_EMPTY+=("$tbl")
        ;;
    esac
  fi
done

if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo "FATAL: missing critical table(s): ${MISSING[*]}" >&2
  exit 3
fi

# 4) Latest prisma migration.
LATEST_MIGRATION="$(run_sql "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;" | tr -d ' \n\r' || true)"
if [[ -n "$LATEST_MIGRATION" ]]; then
  echo "[verify-restore] Step 4: latest applied prisma migration = $LATEST_MIGRATION"
else
  echo "[verify-restore] Step 4: WARN — no finished prisma migration found in _prisma_migrations." >&2
fi

# STRICT bail-out (post-step-3 nhưng trước healthcheck).
if [[ "${#STATE_EMPTY[@]}" -gt 0 ]]; then
  echo "FATAL: STRICT=1 và bảng game-state rỗng: ${STATE_EMPTY[*]}" >&2
  echo "       DB connect được nhưng KHÔNG có data — restore có thể đã fail mid-stream." >&2
  exit 6
fi

# 5) Optional API healthcheck.
if [[ -n "$API_HEALTHCHECK_URL" ]]; then
  echo "[verify-restore] Step 5: API healthcheck $API_HEALTHCHECK_URL"
  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$API_HEALTHCHECK_URL" || echo 000)"
    if [[ "$HTTP_CODE" == "200" ]]; then
      echo "[verify-restore]   API healthcheck OK (HTTP 200)"
    else
      echo "FATAL: API healthcheck $API_HEALTHCHECK_URL → HTTP $HTTP_CODE" >&2
      exit 7
    fi
  else
    echo "[verify-restore]   WARN: curl not available; skip API healthcheck" >&2
  fi
else
  echo "[verify-restore] Step 5: API healthcheck SKIPPED (set API_HEALTHCHECK_URL để bật)"
fi

echo
echo "[verify-restore] PASS — DB connectable, schema ≥ 21 tables, critical tables present."
echo "[verify-restore] Tiếp theo (manual smoke):"
echo "[verify-restore]   - pnpm --filter @xuantoi/api bootstrap        # idempotent admin + 3 sect"
echo "[verify-restore]   - pnpm --filter @xuantoi/api audit:ledger     # ledger consistency"
echo "[verify-restore]   - docs/QA_CHECKLIST.md §15-min smoke"
