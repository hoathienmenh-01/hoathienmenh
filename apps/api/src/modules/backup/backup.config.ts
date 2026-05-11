/**
 * Phase 17.2 — Backup cron config (env reader).
 *
 * Pattern mirror `apps/api/src/modules/liveops-cron/liveops-cron.config.ts`
 * (Phase 15.8) — chia 2 cron riêng (backup + verify) để admin có thể
 * bật/tắt độc lập.
 *
 * Default `*_ENABLED=false` ở local/test/production — closed beta
 * scale nhỏ, ops chủ động bật khi sẵn sàng. Không nổ Redis worker khi
 * dev không cần.
 *
 * Convention env (mirror Phase 15.8):
 *   - `BACKUP_CRON_ENABLED`         — `'true'|'1'|'yes'|'on'` ⇒ enabled.
 *   - `BACKUP_CRON_SCHEDULE`        — cron expression (default `'0 3 * * 0'`
 *     = 03:00 mỗi Chủ Nhật theo `BACKUP_CRON_TZ`).
 *   - `BACKUP_VERIFY_CRON_ENABLED`  — toggle riêng cho verify.
 *   - `BACKUP_VERIFY_CRON_SCHEDULE` — cron expression (default `'0 4 * * 0'`
 *     = 04:00 mỗi Chủ Nhật, 1h sau backup).
 *   - `BACKUP_CRON_TZ`              — IANA timezone (default `Asia/Ho_Chi_Minh`).
 *   - `BACKUP_DIR`                  — backup output dir (default `./backups`).
 *     Forward xuống `scripts/backup-db.sh` qua child_process env.
 *   - `BACKUP_RETENTION_DAYS`       — auto-prune old backup (default `0` =
 *     disabled). Forward xuống script.
 */

export interface BackupConfig {
  /** Backup cron enabled toggle. */
  readonly backupEnabled: boolean;
  /** Cron expression (BullMQ pattern: `minute hour dom month dow`). */
  readonly backupSchedule: string;
  /** Verify cron enabled toggle. */
  readonly verifyEnabled: boolean;
  readonly verifySchedule: string;
  /** Timezone cho cả 2 cron job. */
  readonly timezone: string;
  /** Dir output backup (`scripts/backup-db.sh` $BACKUP_DIR). */
  readonly backupDir: string;
  /** Auto-prune ngày (`scripts/backup-db.sh` $BACKUP_RETENTION_DAYS). 0 = disabled. */
  readonly retentionDays: number;
}

/**
 * Default backup chạy 03:00 mỗi Chủ Nhật theo `BACKUP_CRON_TZ`.
 *
 * Sunday 03:00 — không trùng cao điểm chơi (cao điểm 20:00-23:00 ICT),
 * không trùng cron territory weekly (`5 0 * * 1` Monday 00:05 ICT), không
 * trùng cron sect-season daily (`15 0 * * *` 00:15 ICT). Đủ slack để
 * verify cron chạy 04:00 cùng ngày trước khi day-1 workload mới start.
 */
export const BACKUP_CRON_SCHEDULE_DEFAULT = '0 3 * * 0';

/**
 * Default verify chạy 04:00 mỗi Chủ Nhật — 1 giờ sau backup default
 * để verify bản backup vừa tạo. Verify-restore script đọc-only nên
 * không lock DB target verify.
 */
export const BACKUP_VERIFY_CRON_SCHEDULE_DEFAULT = '0 4 * * 0';

/**
 * Default timezone khớp `LIVEOPS_CRON_DEFAULT_TZ` (Phase 15.7) +
 * `MISSION_RESET_TZ` (closed beta ICT player base).
 */
export const BACKUP_CRON_DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** Default `BACKUP_DIR` (forward xuống shell script). */
export const BACKUP_DIR_DEFAULT = './backups';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

function readBool(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback = false,
): boolean {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  return TRUE_VALUES.has(v.toLowerCase());
}

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  return v;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const v = env[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Đọc {@link BackupConfig} từ `process.env` (hoặc env injection).
 *
 * Default `*_ENABLED=false` để cron KHÔNG register tự động — ops phải
 * set env tường minh trước khi enable backup automation.
 */
export function readBackupConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackupConfig {
  return {
    backupEnabled: readBool(env, 'BACKUP_CRON_ENABLED', false),
    backupSchedule: readString(
      env,
      'BACKUP_CRON_SCHEDULE',
      BACKUP_CRON_SCHEDULE_DEFAULT,
    ),
    verifyEnabled: readBool(env, 'BACKUP_VERIFY_CRON_ENABLED', false),
    verifySchedule: readString(
      env,
      'BACKUP_VERIFY_CRON_SCHEDULE',
      BACKUP_VERIFY_CRON_SCHEDULE_DEFAULT,
    ),
    timezone: readString(env, 'BACKUP_CRON_TZ', BACKUP_CRON_DEFAULT_TZ),
    backupDir: readString(env, 'BACKUP_DIR', BACKUP_DIR_DEFAULT),
    retentionDays: readInt(env, 'BACKUP_RETENTION_DAYS', 0),
  };
}
