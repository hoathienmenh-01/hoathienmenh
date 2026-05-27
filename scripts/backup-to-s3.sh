#!/usr/bin/env bash
# Phase 17.2 — Upload local backup files lên S3-compatible bucket.
#
# Đứng song song với `scripts/backup-db.sh` (Phase 17.4):
#   - Không backup mới — chỉ upload file `.sql.gz` đã có sẵn trong BACKUP_DIR.
#   - Workflow khuyến nghị cron daily:
#       pnpm backup:db && pnpm backup:s3:upload
#   - Nếu chạy độc lập (verify only), set `DRY_RUN=1` để in plan + exit 0.
#
# Usage:
#   pnpm backup:s3:upload                              # upload latest .sql.gz trong BACKUP_DIR
#   BACKUP_S3_FILE=./backups/xuantoi-X.sql.gz pnpm backup:s3:upload  # upload file cụ thể
#   DRY_RUN=1 pnpm backup:s3:upload                    # in plan, không upload
#
# Required env (xem `apps/api/.env.example` + `apps/api/src/ops/backup-s3-config.ts`):
#   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID,
#   BACKUP_S3_SECRET_ACCESS_KEY.
# Optional: BACKUP_S3_REGION, BACKUP_S3_PREFIX, BACKUP_S3_FORCE_PATH_STYLE,
#           BACKUP_S3_SSE.
#
# Exit codes:
#   0  — success / dry-run.
#   2  — env config invalid (missing required / invalid SSE / invalid DB name).
#   3  — `aws` CLI không có trong PATH.
#   4  — không có file backup trong BACKUP_DIR.
#   5  — upload fail (aws CLI exit ≠ 0).
#   6  — file chỉ định qua BACKUP_S3_FILE không tồn tại.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DRY_RUN="${DRY_RUN:-0}"
BACKUP_S3_FILE="${BACKUP_S3_FILE:-}"

# Validate env qua TS parser (chia sẻ logic với weekly-verify + apps/api unit
# test). Output là 1 dòng `OK|invalid:...|missing:...|`. Script dùng eval qua
# tách field `|`.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
  echo "FATAL: BACKUP_S3 env config invalid:" >&2
  printf '%s\n' "$CONFIG_OUTPUT" | sed 's/^/  /' >&2
  echo >&2
  echo "Required env vars (xem apps/api/.env.example):" >&2
  echo "  BACKUP_S3_ENDPOINT" >&2
  echo "  BACKUP_S3_BUCKET" >&2
  echo "  BACKUP_S3_ACCESS_KEY_ID" >&2
  echo "  BACKUP_S3_SECRET_ACCESS_KEY" >&2
  exit 2
fi

# Parse OK output. Format:
#   OK|endpoint=...|region=...|bucket=...|prefix=...|forcePathStyle=...|sse=...|retentionDays=...|accessKeyId=...|secretMasked=...
parse_field() {
  # `|| true` để grep no-match không kill script dưới `set -e`.
  printf '%s\n' "$CONFIG_OUTPUT" | tr '|' '\n' | { grep -E "^$1=" || true; } | head -1 | sed -E "s/^$1=//"
}

S3_ENDPOINT="$(parse_field endpoint)"
S3_REGION="$(parse_field region)"
S3_BUCKET="$(parse_field bucket)"
S3_PREFIX="$(parse_field prefix)"
S3_FORCE_PATH_STYLE="$(parse_field forcePathStyle)"
S3_SSE="$(parse_field sse)"
S3_ACCESS_KEY_ID_MASKED="$(parse_field accessKeyId)"
S3_SECRET_MASKED="$(parse_field secretMasked)"

# Identify file to upload.
if [[ -n "$BACKUP_S3_FILE" ]]; then
  if [[ ! -f "$BACKUP_S3_FILE" ]]; then
    echo "FATAL: BACKUP_S3_FILE='$BACKUP_S3_FILE' không tồn tại" >&2
    exit 6
  fi
  UPLOAD_FILE="$BACKUP_S3_FILE"
else
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "FATAL: BACKUP_DIR='$BACKUP_DIR' không tồn tại — chạy 'pnpm backup:db' trước." >&2
    exit 4
  fi
  UPLOAD_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'xuantoi-*.sql.gz' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | head -1 | cut -d' ' -f2- || true)"
  if [[ -z "$UPLOAD_FILE" ]] || [[ ! -f "$UPLOAD_FILE" ]]; then
    echo "FATAL: không tìm thấy file 'xuantoi-*.sql.gz' nào trong $BACKUP_DIR" >&2
    echo "Hint: chạy 'pnpm backup:db' trước khi 'pnpm backup:s3:upload'." >&2
    exit 4
  fi
fi

FILENAME="$(basename "$UPLOAD_FILE")"
S3_URI="s3://${S3_BUCKET}/${S3_PREFIX}${FILENAME}"
FILE_SIZE="$(du -h "$UPLOAD_FILE" | cut -f1)"

echo "[backup-to-s3] Plan:"
echo "  source      : $UPLOAD_FILE ($FILE_SIZE)"
echo "  destination : $S3_URI"
echo "  endpoint    : $S3_ENDPOINT"
echo "  region      : $S3_REGION"
echo "  path-style  : $S3_FORCE_PATH_STYLE"
echo "  sse         : ${S3_SSE:-none}"
echo "  access key  : $S3_ACCESS_KEY_ID_MASKED"
echo "  secret      : $S3_SECRET_MASKED"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[backup-to-s3] DRY_RUN=1 — skip upload. Exit 0."
  exit 0
fi

# `aws` CLI required for actual upload.
if ! command -v aws >/dev/null 2>&1; then
  echo "FATAL: aws CLI không có trong PATH." >&2
  echo "Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
  exit 3
fi

# Build aws CLI args. Path style → aws CLI v2 supports `--no-verify-ssl` and
# implicit path style via endpoint-url. For S3-compatible (MinIO/R2), set
# `AWS_S3_ADDRESSING_STYLE=path` env.
EXTRA_ARGS=()
if [[ "$S3_FORCE_PATH_STYLE" == "true" ]]; then
  export AWS_S3_ADDRESSING_STYLE=path
fi

if [[ -n "$S3_SSE" ]] && [[ "$S3_SSE" != "null" ]]; then
  EXTRA_ARGS+=(--sse "$S3_SSE")
fi

echo "[backup-to-s3] Uploading…"
AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  aws s3 cp "$UPLOAD_FILE" "$S3_URI" \
  --region "$S3_REGION" \
  --endpoint-url "$S3_ENDPOINT" \
  "${EXTRA_ARGS[@]}" \
  || {
    rc=$?
    echo "FATAL: aws s3 cp failed (exit $rc)" >&2
    exit 5
  }

echo "[backup-to-s3] Done. Uploaded to $S3_URI"

# Optional retention prune trên S3: chỉ thực hiện khi BACKUP_RETENTION_DAYS > 0
# AND env BACKUP_S3_PRUNE=1 (opt-in, default tắt vì sợ xoá nhầm cross-region).
BACKUP_S3_PRUNE="${BACKUP_S3_PRUNE:-0}"
RETENTION_DAYS="$(parse_field retentionDays)"
if [[ "$BACKUP_S3_PRUNE" == "1" ]] && [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$RETENTION_DAYS" -gt 0 ]]; then
  echo "[backup-to-s3] Pruning offsite backups > $RETENTION_DAYS days…"
  # `aws s3 ls` xuất 1 dòng/file: <date> <time> <size> <key>
  CUTOFF_EPOCH="$(( $(date +%s) - RETENTION_DAYS * 86400 ))"
  PRUNED=0
  AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
    aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}" \
    --region "$S3_REGION" \
    --endpoint-url "$S3_ENDPOINT" \
    2>/dev/null \
    | while read -r DATE TIME SIZE KEY; do
        [[ -z "$KEY" ]] && continue
        # Chỉ xét file xuantoi-*.sql.gz
        case "$KEY" in
          xuantoi-*.sql.gz) ;;
          *) continue ;;
        esac
        FILE_EPOCH="$(date -d "$DATE $TIME" +%s 2>/dev/null || echo 0)"
        if [[ "$FILE_EPOCH" -gt 0 ]] && [[ "$FILE_EPOCH" -lt "$CUTOFF_EPOCH" ]]; then
          AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
          AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
            aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}${KEY}" \
            --region "$S3_REGION" \
            --endpoint-url "$S3_ENDPOINT" \
            >/dev/null 2>&1 \
            && echo "[backup-to-s3] Pruned offsite: $KEY"
          PRUNED=$((PRUNED + 1))
        fi
      done
  echo "[backup-to-s3] Offsite retention prune done."
else
  echo "[backup-to-s3] Offsite retention prune: disabled (BACKUP_S3_PRUNE=$BACKUP_S3_PRUNE, retentionDays=$RETENTION_DAYS)."
fi
