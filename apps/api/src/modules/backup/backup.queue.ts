/**
 * Phase 17.2 — Backup queue + job name constants.
 *
 * 1 queue duy nhất (`backup`) cho cả 2 loại job — backup tạo file +
 * verify-restore. Đơn giản hơn 2 queue riêng vì 2 op không chạy đồng
 * thời quá nhiều (weekly cadence).
 *
 * Pattern mirror `liveops-cron.queue.ts` (Phase 15.8).
 */
export const BACKUP_QUEUE = 'backup';

export const BACKUP_RUN_JOB = 'backup-run';
export const BACKUP_VERIFY_JOB = 'backup-verify';
