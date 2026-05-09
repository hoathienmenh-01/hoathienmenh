/**
 * Phase 13.2.D + 14.0.F — BullMQ queue + job constants cho live-ops cron.
 *
 * Tách const ra file riêng để tránh circular import giữa
 * `liveops-cron.service.ts`, `liveops-cron.module.ts`, và 2 processor file.
 * Pattern khớp với `cultivation.queue.ts` / `ops.queue.ts` đã có.
 */

/** Queue name cho territory weekly cycle (settle → decay → reward). */
export const TERRITORY_CRON_QUEUE = 'territory-cron';

/** Queue name cho sect season snapshot/history/HoF. */
export const SECT_SEASON_CRON_QUEUE = 'sect-season-cron';

/**
 * Job name = 'weekly-cycle'. 1 job duy nhất chạy theo cron pattern, chốt
 * period tuần trước (`previousTerritoryPeriodKey`).
 */
export const TERRITORY_WEEKLY_CYCLE_JOB = 'weekly-cycle';

/**
 * Job name = 'snapshot-due'. 1 job duy nhất chạy theo cron pattern,
 * snapshot mọi season đã `endsAt <= now` mà chưa snapshot. Idempotent
 * qua UNIQUE `seasonKey`.
 */
export const SECT_SEASON_SNAPSHOT_JOB = 'snapshot-due';
