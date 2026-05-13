#!/usr/bin/env bash
# Phase 17.2 — Weekly restore verification.
#
# Mục đích: chứng minh backup S3 thực sự có thể restore. Chạy cron weekly
# (vd Chủ nhật 03:00 sau full backup daily) — workflow:
#   1. Lấy file backup S3 mới nhất (theo prefix BACKUP_S3_PREFIX).
#   2. Tạo temp DB tên `BACKUP_VERIFY_TMP_DB` (default xuantoi_verify).
#   3. Restore backup vào temp DB (KHÔNG đụng DB chính).
#   4. Chạy `scripts/verify-restore.sh` (schema + critical tables + migration).
#   5. Drop temp DB (trừ khi BACKUP_VERIFY_TMP_RETAIN=1).
#   6. Exit 0 / non-zero theo kết quả verify.
#
# Usage:
#   pnpm verify:restore:weekly                     # full flow
#   DRY_RUN=1 pnpm verify:restore:weekly           # in plan, KHÔNG download/restore
#   BACKUP_VERIFY_LOCAL=./backups/xuantoi-X.sql.gz # skip S3, dùng file local
#   BACKUP_VERIFY_TMP_RETAIN=1                     # giữ temp DB để debug
#
# Required env (cho mode S3): xem `scripts/_backup-s3-config.mjs`.
# Postgres admin connection để CREATE/DROP DATABASE: lấy từ `DATABASE_URL`
# (đổi `database` segment → `postgres`).
#
# Exit codes:
#   0  — verify pass.
#   2  — env config invalid.
#   3  — thiếu aws / psql / pg_restore / gunzip.
#   4  — không tìm thấy backup file (S3 hoặc local).
#   5  — download S3 fail.
#   6  — create temp DB fail.
#   7  — restore vào temp DB fail.
#   8  — verify-restore.sh fail.
#   9  — drop temp DB fail (không gây fail toàn flow; log warn).

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
BACKUP_VERIFY_LOCAL="${BACKUP_VERIFY_LOCAL:-}"
DATABASE_URL="${DATABASE_URL:-postgresql://mtt:mtt@localhost:5432/mtt}"
USE_DOCKER="${USE_DOCKER:-auto}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Validate config qua TS-parity parser. Lấy verifyTmpDb + S3 endpoint/bucket.
CONFIG_OUTPUT="$(BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" \
  BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}" \
  BACKUP_S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}" \
  BACKUP_S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}" \
  BACKUP_S3_REGION="${BACKUP_S3_REGION:-}" \
  BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-}" \
  BACKUP_S3_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-}" \
  BACKUP_S3_SSE="${BACKUP_S3_SSE:-}" \
  BACKUP_VERIFY_TMP_DB="${BACKUP_VERIFY_TMP_DB:-}" \
  BACKUP_VERIFY_TMP_RETAIN="${BACKUP_VERIFY_TMP_RETAIN:-}" \
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-}" \
  node "$REPO_ROOT/scripts/_backup-s3-config.mjs" 2>&1)" || true

if printf '%s' "$CONFIG_OUTPUT" | grep -q "^INVALID|"; then
  # Local mode không cần S3 — chỉ cần verifyTmpDb hợp lệ.
  if [[ -n "$BACKUP_VERIFY_LOCAL" ]]; then
    # Bỏ qua missing S3 keys; chỉ fail nếu verifyTmpDb invalid.
    BAD_TMP_DB="$(printf '%s' "$CONFIG_OUTPUT" | grep -E "invalid=.*BACKUP_VERIFY_TMP_DB" || true)"
    if [[ -n "$BAD_TMP_DB" ]]; then
      echo "FATAL: BACKUP_VERIFY_TMP_DB invalid (ký tự không cho phép hoặc bắt đầu bằng digit)." >&2
      exit 2
    fi
  else
    echo "FATAL: BACKUP_S3 env config invalid:" >&2
    printf '%s\n' "$CONFIG_OUTPUT" | sed 's/^/  /' >&2
    echo >&2
    echo "Set BACKUP_VERIFY_LOCAL=<file> để chạy verify với backup local mà không cần S3." >&2
    exit 2
  fi
fi

parse_field() {
  # `|| true` để grep no-match không kill script dưới `set -e`.
  printf '%s\n' "$CONFIG_OUTPUT" | tr '|' '\n' | { grep -E "^$1=" || true; } | head -1 | sed -E "s/^$1=//"
}

S3_ENDPOINT="$(parse_field endpoint)"
S3_REGION="$(parse_field region)"
S3_BUCKET="$(parse_field bucket)"
S3_PREFIX="$(parse_field prefix)"
S3_FORCE_PATH_STYLE="$(parse_field forcePathStyle)"
TMP_DB="$(parse_field verifyTmpDb)"
TMP_RETAIN="$(parse_field verifyTmpRetain)"

# Fallback default cho local mode.
TMP_DB="${TMP_DB:-${BACKUP_VERIFY_TMP_DB:-xuantoi_verify}}"
TMP_RETAIN="${TMP_RETAIN:-false}"

echo "[verify-restore-weekly] Plan:"
echo "  mode             : $([[ -n "$BACKUP_VERIFY_LOCAL" ]] && echo "LOCAL FILE" || echo "S3 LATEST")"
echo "  source           : ${BACKUP_VERIFY_LOCAL:-$S3_ENDPOINT/$S3_BUCKET/$S3_PREFIX}"
echo "  tmp DB           : $TMP_DB"
echo "  retain tmp DB    : $TMP_RETAIN"
echo "  database url     : $(printf '%s' "$DATABASE_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[verify-restore-weekly] DRY_RUN=1 — skip actual download/restore/verify. Exit 0."
  exit 0
fi

# Required toolchain.
MISSING_TOOLS=()
for tool in psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING_TOOLS+=("$tool")
  fi
done
if [[ -z "$BACKUP_VERIFY_LOCAL" ]] && ! command -v aws >/dev/null 2>&1; then
  MISSING_TOOLS+=("aws (CLI)")
fi
if [[ "${#MISSING_TOOLS[@]}" -gt 0 ]]; then
  echo "FATAL: missing toolchain: ${MISSING_TOOLS[*]}" >&2
  exit 3
fi

# Determine backup file path. S3 → tải về tmp file; LOCAL → dùng trực tiếp.
TMP_DIR="$(mktemp -d -t xuantoi-verify-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ -n "$BACKUP_VERIFY_LOCAL" ]]; then
  if [[ ! -f "$BACKUP_VERIFY_LOCAL" ]]; then
    echo "FATAL: BACKUP_VERIFY_LOCAL='$BACKUP_VERIFY_LOCAL' không tồn tại" >&2
    exit 4
  fi
  BACKUP_FILE="$BACKUP_VERIFY_LOCAL"
  echo "[verify-restore-weekly] Using local file: $BACKUP_FILE"
else
  echo "[verify-restore-weekly] Listing offsite backups…"
  LATEST_KEY="$(AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
    AWS_S3_ADDRESSING_STYLE="$([[ "$S3_FORCE_PATH_STYLE" == "true" ]] && echo path || echo virtual)" \
    aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}" \
    --region "$S3_REGION" \
    --endpoint-url "$S3_ENDPOINT" \
    2>/dev/null \
    | awk '/xuantoi-.*\.sql\.gz/ {print $4}' \
    | sort -r | head -1 || true)"

  if [[ -z "$LATEST_KEY" ]]; then
    echo "FATAL: không tìm thấy backup nào ở s3://${S3_BUCKET}/${S3_PREFIX}" >&2
    exit 4
  fi

  BACKUP_FILE="$TMP_DIR/$LATEST_KEY"
  echo "[verify-restore-weekly] Downloading $LATEST_KEY → $BACKUP_FILE…"
  AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  AWS_S3_ADDRESSING_STYLE="$([[ "$S3_FORCE_PATH_STYLE" == "true" ]] && echo path || echo virtual)" \
    aws s3 cp "s3://${S3_BUCKET}/${S3_PREFIX}${LATEST_KEY}" "$BACKUP_FILE" \
    --region "$S3_REGION" \
    --endpoint-url "$S3_ENDPOINT" \
    || { echo "FATAL: s3 download fail" >&2; exit 5; }
  echo "[verify-restore-weekly]   Downloaded ($(du -h "$BACKUP_FILE" | cut -f1))"
fi

# Build admin DATABASE_URL trỏ vào `postgres` DB (cho CREATE/DROP DATABASE).
# Replace `/<dbname>` segment cuối bằng `/postgres`.
ADMIN_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#/([^/?]+)(\?.*)?$#/postgres\2#')"
echo "[verify-restore-weekly] Admin URL: $(printf '%s' "$ADMIN_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"

# CREATE temp DB. Drop trước nếu còn sót từ run trước (idempotent).
echo "[verify-restore-weekly] Step 1: CREATE DATABASE $TMP_DB…"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1 || true
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TMP_DB\";" >/dev/null \
  || { echo "FATAL: create tmp DB fail" >&2; exit 6; }
echo "[verify-restore-weekly]   OK"

# Build URL trỏ vào temp DB.
TMP_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/([^/?]+)(\?.*)?\$#/$TMP_DB\\2#")"

# Restore. Backup file là `.sql.gz` plain SQL.
echo "[verify-restore-weekly] Step 2: gunzip + psql restore vào $TMP_DB…"
if ! gunzip -c "$BACKUP_FILE" | psql "$TMP_URL" -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  echo "FATAL: restore vào tmp DB fail" >&2
  # Cleanup tmp DB nếu KHÔNG retain.
  if [[ "$TMP_RETAIN" != "true" ]]; then
    psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1 || true
  fi
  exit 7
fi
echo "[verify-restore-weekly]   OK"

# Run verify-restore.sh against tmp DB.
echo "[verify-restore-weekly] Step 3: scripts/verify-restore.sh against $TMP_DB…"
if DATABASE_URL="$TMP_URL" STRICT=0 bash "$SCRIPT_DIR/verify-restore.sh"; then
  echo "[verify-restore-weekly]   verify PASS"
  VERIFY_RC=0
else
  echo "[verify-restore-weekly]   verify FAIL" >&2
  VERIFY_RC=8
fi

# Cleanup tmp DB.
if [[ "$TMP_RETAIN" != "true" ]]; then
  echo "[verify-restore-weekly] Step 4: DROP DATABASE $TMP_DB…"
  if ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1; then
    echo "WARN: drop tmp DB fail (continuing)" >&2
    # Soft-warn — không override VERIFY_RC.
  else
    echo "[verify-restore-weekly]   OK"
  fi
else
  echo "[verify-restore-weekly] Step 4: retain $TMP_DB (BACKUP_VERIFY_TMP_RETAIN=1)"
fi

if [[ "$VERIFY_RC" -ne 0 ]]; then
  exit "$VERIFY_RC"
fi

echo "[verify-restore-weekly] DONE — backup verified restorable."
exit 0
