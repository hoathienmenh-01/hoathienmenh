# Backup & Restore — Offsite S3 Runbook

> **Phase 17.2** — extends Phase 17.4 `backup-db.sh`/`restore-db.sh`/`verify-restore.sh` with offsite S3 upload + weekly restore verification.

---

## Recovery Objectives

| Metric | Target (closed-beta) | Notes |
|--------|---------------------|-------|
| **RPO** (Recovery Point Objective) | ≤ 24 h | Daily pg_dump cron. Real-time RPO requires WAL archiving (deferred). |
| **RTO** (Recovery Time Objective) | ≤ 30 min | Manual restore from S3 + prisma migrate deploy. |
| **Verify cadence** | Weekly (cron Sunday 03:00 UTC+7) | Proves backup restorable. |

---

## Daily Backup + Upload — cron template

```bash
# /etc/cron.d/xuantoi-backup (or GitHub Actions schedule)
# Mỗi ngày 02:00 (ICT UTC+7 = 19:00 UTC)

0 19 * * * cd /app && DATABASE_URL=$DATABASE_URL BACKUP_DIR=/var/backups/xuantoi BACKUP_RETENTION_DAYS=7 pnpm backup:db && pnpm backup:s3:upload >> /var/log/xuantoi-backup.log 2>&1
```

### GitHub Actions schedule (alternative)

```yaml
name: Daily Backup + Offsite S3
on:
  schedule:
    - cron: '0 19 * * *' # 02:00 ICT
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL_PRODUCTION }}
      BACKUP_S3_ENDPOINT: ${{ secrets.BACKUP_S3_ENDPOINT }}
      BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
      BACKUP_S3_ACCESS_KEY_ID: ${{ secrets.BACKUP_S3_ACCESS_KEY_ID }}
      BACKUP_S3_SECRET_ACCESS_KEY: ${{ secrets.BACKUP_S3_SECRET_ACCESS_KEY }}
      BACKUP_S3_REGION: ${{ secrets.BACKUP_S3_REGION }}
      BACKUP_RETENTION_DAYS: '7'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm backup:db
      - run: pnpm backup:s3:upload
```

---

## Weekly Restore Verify — cron template

```bash
# Chủ nhật 03:00 ICT = 20:00 UTC Saturday
0 20 * * 6 cd /app && pnpm verify:restore:weekly >> /var/log/xuantoi-verify.log 2>&1
```

Or use BACKUP_VERIFY_LOCAL if running verify on same host with local backup files:

```bash
BACKUP_VERIFY_LOCAL=/var/backups/xuantoi/$(ls -1t /var/backups/xuantoi/xuantoi-*.sql.gz | head -1) pnpm verify:restore:weekly
```

---

## Manual Operations

### 1. Backup local dev

```bash
pnpm backup:db
# Output: ./backups/xuantoi-YYYYMMDD-HHMMSS.sql.gz
```

### 2. Upload to S3

```bash
# Upload latest file in ./backups/
pnpm backup:s3:upload

# Upload specific file
BACKUP_S3_FILE=./backups/xuantoi-20260513-150000.sql.gz pnpm backup:s3:upload

# Dry run (in plan, không gửi S3)
pnpm backup:s3:upload:dry-run
```

### 3. Download latest backup from S3

```bash
# aws CLI manual:
aws s3 ls s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX --endpoint-url $BACKUP_S3_ENDPOINT --region $BACKUP_S3_REGION

# Download latest
LATEST=$(aws s3 ls ... | sort -r | head -1 | awk '{print $4}')
aws s3 cp "s3://$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX}${LATEST}" ./ --endpoint-url $BACKUP_S3_ENDPOINT --region $BACKUP_S3_REGION
```

### 4. Restore local dev DB

```bash
pnpm restore:db ./backups/xuantoi-YYYYMMDD-HHMMSS.sql.gz
# ⚠️ DROP DATABASE + CREATE lại — phá toàn bộ data hiện có!
```

### 5. Verify after restore

```bash
pnpm verify:restore
# Check kết nối + schema 21+ table + critical table counts + latest migration.
```

---

## Production Restore — Emergency Procedure

> ⚠️ **THIS WILL DESTROY ALL CURRENT PRODUCTION DATA.**
> Chỉ dùng khi data corruption đã xác nhận, admin sign-off, maintenance window mở.

### Checklist trước restore

- [ ] Xác nhận data corruption (không phải bug app đơn giản).
- [ ] Admin team sign-off (≥ 2 người confirm).
- [ ] Thông báo player: maintenance window ≥ 30 phút.
- [ ] Backup hiện trạng trước (dù bị corrupt — giữ evidence):
  ```bash
  BACKUP_DIR=/var/backups/xuantoi/pre-restore DATABASE_URL=$PROD_URL pnpm backup:db
  ```
- [ ] Chọn file backup restore (kiểm ngày — RPO ≤ 24h):
  ```bash
  aws s3 ls s3://$BUCKET/$PREFIX --endpoint-url ... | sort | tail -5
  ```
- [ ] Download file backup từ S3 vào server.
- [ ] Xác nhận đúng file (gunzip | head → `-- PostgreSQL database dump`).

### Thực hiện

```bash
# 1. Set production unlock
export NODE_ENV=production
export ALLOW_PRODUCTION_RESTORE=YES
export CONFIRM_RESTORE=YES
export RUN_PRISMA_MIGRATE=1   # chạy migrate deploy ngay sau restore

# 2. Restore
DATABASE_URL=$PROD_URL pnpm restore:db /path/to/backup.sql.gz

# 3. Verify
DATABASE_URL=$PROD_URL STRICT=1 pnpm verify:restore

# 4. Restart API pods (để Prisma Client reconnect)
kubectl rollout restart deployment/xuantoi-api
# or: docker compose restart api
```

### Rollback plan (nếu restore sai file)

- Restore lại file `pre-restore` đã backup ở bước trên.
- Nếu pre-restore cũng hỏng: rollback qua WAL point (nếu có) hoặc accept data loss → thông báo player.

---

## Env Vars Quick Reference

| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `BACKUP_S3_ENDPOINT` | yes | — | S3-compatible endpoint |
| `BACKUP_S3_REGION` | no | `us-east-1` | AWS region |
| `BACKUP_S3_BUCKET` | yes | — | Tên bucket |
| `BACKUP_S3_PREFIX` | no | `xuantoi/backups/` | Path prefix |
| `BACKUP_S3_ACCESS_KEY_ID` | yes | — | IAM access key |
| `BACKUP_S3_SECRET_ACCESS_KEY` | yes | — | IAM secret |
| `BACKUP_S3_FORCE_PATH_STYLE` | no | `1` | path-style addressing (MinIO/R2) |
| `BACKUP_S3_SSE` | no | — | AES256 / aws:kms |
| `BACKUP_S3_PRUNE` | no | `0` | Auto-delete offsite backup > retention days |
| `BACKUP_RETENTION_DAYS` | no | `0` | Local + optional offsite retention |
| `BACKUP_VERIFY_TMP_DB` | no | `xuantoi_verify` | Temp DB name for weekly verify |
| `BACKUP_VERIFY_TMP_RETAIN` | no | `0` | Keep temp DB after verify |
| `BACKUP_VERIFY_LOCAL` | no | — | Override S3 with local file |
| `DRY_RUN` | no | `0` | Print plan, skip execution |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Upload exit 3 | `aws` CLI not installed | `apt install awscli` or `pip install awscli` |
| Upload exit 2 | Missing env | Set BACKUP_S3_* vars. Use `DRY_RUN=1` to verify config. |
| Upload exit 5 | Network / auth failure | Verify key + endpoint. `aws s3 ls` for basic connectivity. |
| Verify exit 4 | No backup found on S3 | Run backup+upload first. Check prefix. |
| Verify exit 7 | Restore fail | Inspect psql error. Possibly incompatible pg version. |
| Verify exit 8 | Schema verify fail | Backup may be corrupted / partial. Re-backup and retry. |

---

## Follow-ups (out of scope this PR)

- pg_basebackup + continuous WAL archiving (sub-minute RPO).
- S3 Object Lock (WORM — immutable backup against ransomware).
- Cross-region replication.
- Slack/PagerDuty alert on verify failure.
- Grafana dashboard for backup size trend + verify status.
