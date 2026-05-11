/**
 * Phase 17.2 — Backup / Restore Weekly Verification shared types.
 *
 * Source-of-truth cho FE/BE share string union + constants liên quan
 * tracking backup runs. KHÔNG đụng enum Prisma — vẫn dùng string literal
 * ở DB để dễ mở rộng (vd thêm `S3` / `MINIO` sau không cần migration
 * enum).
 *
 * Bối cảnh:
 *   - Phase 17.4 đã có 3 script shell (`backup-db.sh`/`restore-db.sh`
 *     /`verify-restore.sh`) + `pnpm backup:db` / `pnpm restore:db` /
 *     `pnpm verify:restore`. Phase 17.2 thêm tracking layer trên hạ tầng
 *     đó: mỗi lần backup hoặc verify được record vào `BackupRun` /
 *     `BackupVerifyRun` row để admin xem trạng thái + cron weekly có
 *     audit trail + cảnh báo khi stale/fail.
 *   - Health helper reuse `computeLiveOpsCronHealth` (Phase 15.8) ở BE
 *     để không trùng logic — caller chỉ feed `lastRunAt`/`lastSuccessAt`
 *     /`lastErrorAt` + `maxSilenceMs` riêng cho cadence weekly.
 */

/**
 * Trạng thái 1 row `BackupRun` / `BackupVerifyRun`.
 *
 * Lifecycle:
 *   - `RUNNING` — row được tạo trước khi spawn shell; chưa có
 *     `finishedAt`. Race-safe: nếu API crash khi shell đang chạy, row
 *     `RUNNING` orphan này sẽ stale > maxSilenceMs → admin nhìn thấy
 *     "DEGRADED" và biết có vấn đề.
 *   - `SUCCESS` — shell exit 0, ghi đủ metadata (fileName,
 *     fileSizeBytes, ...).
 *   - `FAILED` — shell exit != 0 hoặc service throw; `errorMessage`
 *     chứa truncated stderr / Error.message.
 */
export const BACKUP_RUN_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;

export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];

export function isBackupRunStatus(v: unknown): v is BackupRunStatus {
  return (
    typeof v === 'string' && (BACKUP_RUN_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Storage layer backup được lưu. Phase 17.2 chỉ support `LOCAL`
 * (filesystem path cùng host API). S3/MinIO/GCS reserved cho phase
 * sau — định nghĩa trước để không phải migration string union khi
 * thêm.
 */
export const BACKUP_STORAGES = ['LOCAL', 'S3', 'MINIO', 'GCS'] as const;

export type BackupStorage = (typeof BACKUP_STORAGES)[number];

export function isBackupStorage(v: unknown): v is BackupStorage {
  return (
    typeof v === 'string' && (BACKUP_STORAGES as readonly string[]).includes(v)
  );
}

/**
 * Ai đã kích hoạt run (audit dimension):
 *   - `CRON` — BullMQ scheduler tự fire theo cron expression weekly.
 *   - `ADMIN` — admin gọi `POST /admin/backup/run` hoặc
 *     `POST /admin/backup/verify`. `actorUserId` non-null.
 *   - `MANUAL` — `pnpm backup:db` chạy tay từ shell (chưa wire vào
 *     tracking layer; reserve để future hook script ghi row).
 *   - `CI` — CI smoke job chạy backup/verify trong pipeline (reserve).
 */
export const BACKUP_TRIGGERED_BY = ['CRON', 'ADMIN', 'MANUAL', 'CI'] as const;

export type BackupTriggeredBy = (typeof BACKUP_TRIGGERED_BY)[number];

export function isBackupTriggeredBy(v: unknown): v is BackupTriggeredBy {
  return (
    typeof v === 'string' &&
    (BACKUP_TRIGGERED_BY as readonly string[]).includes(v)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backup cron cadence = weekly (mỗi 7 ngày). Cho 8 ngày silence trước
 * khi báo STALE — 1 tuần + 1 ngày buffer cho lệch cron / maintenance
 * window.
 *
 * Khớp ngữ nghĩa với `TERRITORY_CRON_MAX_SILENCE_MS` (Phase 15.8) nên
 * dùng cùng const giá trị (`8 * DAY_MS`).
 */
export const BACKUP_CRON_MAX_SILENCE_MS = 8 * DAY_MS;

/**
 * Verify cron cùng cadence weekly — sau backup chạy xong sẽ verify
 * restore một bản backup mới nhất vào DB tạm. Ngưỡng STALE giống
 * backup (8 ngày).
 */
export const BACKUP_VERIFY_CRON_MAX_SILENCE_MS = 8 * DAY_MS;

/**
 * Admin / FE payload shape cho `GET /admin/backup/status`.
 *
 * Reuse string union `LiveOpsCronHealthStatus` từ liveops-cron-health
 * (`'OK' | 'STALE' | 'DISABLED' | 'DEGRADED'`) — BE compute qua
 * `computeLiveOpsCronHealth` helper.
 */
export interface BackupStatusEntry {
  readonly enabled: boolean;
  readonly status: 'OK' | 'STALE' | 'DISABLED' | 'DEGRADED';
  readonly staleReason: string | null;
  /** ISO 8601 — null khi chưa có row nào. */
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  /** Cron expression hiện tại (vd `0 3 * * 0`). */
  readonly cronExpression: string;
  readonly timezone: string;
  /** Silence ngưỡng (ms) để compute STALE. */
  readonly maxSilenceMs: number;
}

export interface BackupRunSummary {
  readonly id: string;
  readonly status: BackupRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly fileName: string | null;
  readonly fileSizeBytes: number | null;
  readonly checksumSha256: string | null;
  readonly storage: BackupStorage;
  readonly errorMessage: string | null;
  readonly triggeredBy: BackupTriggeredBy;
}

export interface BackupVerifyRunSummary {
  readonly id: string;
  readonly backupRunId: string | null;
  readonly status: BackupRunStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly checkedTables: number | null;
  readonly latestMigration: string | null;
  readonly errorMessage: string | null;
  readonly triggeredBy: BackupTriggeredBy;
}

export interface BackupStatusResponse {
  readonly backup: BackupStatusEntry;
  readonly verify: BackupStatusEntry;
  readonly latestBackup: BackupRunSummary | null;
  readonly latestVerify: BackupVerifyRunSummary | null;
  /** ISO 8601 thời điểm server compute response (smoke debug). */
  readonly generatedAt: string;
}
