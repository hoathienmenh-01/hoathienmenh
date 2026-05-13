# Phase 17.2 — Backup/Restore Weekly Verify + Offsite S3

> **Scope**: ops/infra additive PR. Đứng song song an toàn với Story Runtime PR B/C/D (KHÔNG đụng `packages/shared/src/story-*`, `/story/v2`, `StoryV2View.vue`, `QuestService`, `RewardService`, `CurrencyService`, `InventoryService`).

## Mục tiêu

1. **Offsite S3 upload**: backup hàng ngày (`scripts/backup-db.sh`) tự upload lên S3-compatible bucket (AWS S3 / MinIO / Backblaze B2 / DigitalOcean Spaces / Cloudflare R2). Không khoá vào AWS — `endpoint-url` + `force-path-style` cấu hình được.
2. **Weekly restore verify**: cron weekly tải file backup S3 mới nhất, restore vào temp DB (Postgres role/db hậu tố `_verify`), chạy `verify-restore.sh` (schema + critical table + migration probe + healthcheck) → drop temp DB → log kết quả + summary JSON tuỳ chọn.
3. **Retention**: local + offsite cùng giữ `BACKUP_RETENTION_DAYS`. Không xoá backup mới nhất nếu verify fail.
4. **Runbook**: `docs/ops/backup-restore-runbook.md` — manual backup, local restore, production restore (sign-off + maintenance window), rollback plan, recovery objectives.

## Non-goals (KHÔNG làm trong PR này)

- KHÔNG sửa Story Runtime hoặc bất kỳ module gameplay nào.
- KHÔNG rewrite `backup-db.sh` / `restore-db.sh` / `verify-restore.sh` core (chỉ thêm wrapper script, env vars, docs).
- KHÔNG commit credential thật (AWS keys, MinIO secret, …).
- KHÔNG cài cron tự động trên CI — runbook hướng dẫn manual cron + GitHub Actions schedule template.
- KHÔNG triển khai pg_basebackup / WAL streaming (closed-beta scale dùng pg_dump là đủ).

## Files thay đổi

### New

- `scripts/backup-to-s3.sh` — bash, upload latest local backup file lên S3 (xài `aws s3 cp`).
- `scripts/restore-verify-weekly.sh` — bash, full flow: download latest S3 backup → restore vào temp DB → verify → drop temp DB.
- `apps/api/src/ops/backup-s3-config.ts` — pure TS env parser + zod-style validator (no nest dep).
- `apps/api/src/ops/backup-s3-config.test.ts` — vitest unit tests (parsing, defaults, missing-required, force-path-style, retention).
- `docs/ops/phase-17-2-backup-restore-offsite-s3-plan.md` — file này.
- `docs/ops/backup-restore-runbook.md` — runbook chi tiết (manual + cron + production emergency).

### Modified

- `apps/api/.env.example` — thêm 9 env vars `BACKUP_S3_*` + `BACKUP_VERIFY_TMP_*`.
- `package.json` — thêm 3 pnpm scripts: `backup:s3:upload`, `verify:restore:weekly`, `verify:restore:weekly:dry-run`.
- `docs/AI_HANDOFF_REPORT.md` — Phase 17.2 entry.

## Env vars mới

| Env | Default | Required | Notes |
|---|---|---|---|
| `BACKUP_S3_ENDPOINT` | (empty) | yes (cho upload) | S3-compatible endpoint URL. Empty → script skip upload + log warn. AWS S3 dùng `https://s3.<region>.amazonaws.com`. |
| `BACKUP_S3_REGION` | `us-east-1` | no | AWS region. |
| `BACKUP_S3_BUCKET` | (empty) | yes (cho upload) | Tên bucket. |
| `BACKUP_S3_PREFIX` | `xuantoi/backups/` | no | Path prefix trong bucket. |
| `BACKUP_S3_ACCESS_KEY_ID` | (empty) | yes (cho upload) | Truyền qua `AWS_ACCESS_KEY_ID` env cho aws CLI. |
| `BACKUP_S3_SECRET_ACCESS_KEY` | (empty) | yes (cho upload) | Truyền qua `AWS_SECRET_ACCESS_KEY` env. |
| `BACKUP_S3_FORCE_PATH_STYLE` | `1` | no | `1` = `aws s3 --endpoint-url … --no-verify-ssl=false` + path style (MinIO/R2). `0` = virtual-hosted style. |
| `BACKUP_S3_SSE` | (empty) | no | server-side encryption: `AES256` / `aws:kms`. |
| `BACKUP_VERIFY_TMP_DB` | `xuantoi_verify` | no | Temp DB tên cho weekly verify. |
| `BACKUP_VERIFY_TMP_RETAIN` | `0` | no | `1` = giữ temp DB sau verify (debug). `0` = drop sau verify. |

## Acceptance criteria

- [x] `pnpm backup:s3:upload --help` (hoặc `DRY_RUN=1`) in plan + exit 0 mà không cần credential.
- [x] Script khi thiếu credential / bucket → exit 2 (config invalid), log rõ tên env thiếu.
- [x] Vitest test `backup-s3-config.test.ts` pass (≥ 10 test cases).
- [x] `pnpm verify:restore:weekly:dry-run` in flow plan (download → restore → verify → cleanup) mà KHÔNG đụng DB.
- [x] Runbook có: manual backup, restore local dev, restore production emergency, sign-off checklist, rollback plan, RPO/RTO mục tiêu.
- [x] `apps/api/.env.example` cập nhật.
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` xanh.

## Risk / Rollback

- Risk: cron daily upload S3 phụ thuộc network + credential — fail mode đã handle (exit 2/3, không xoá backup local).
- Rollback: revert PR. Hệ thống vẫn có backup local + `restore-db.sh` cũ — không phá runtime.
- KHÔNG có DB migration; không có API public mới.

## Follow-ups (out-of-scope)

- pg_basebackup + WAL archiving khi scale lên paid-beta.
- S3 object lock (immutable backup) cho ransomware defense.
- Cross-region S3 replication.
- Alerting (PagerDuty/Slack) khi verify fail 2 tuần liên tiếp.
