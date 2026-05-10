/**
 * Phase 15.1–15.2 — BullMQ queue + job constants cho LiveOps Event
 * Scheduler recompute cron.
 *
 * Queue tên `liveops-event-scheduler-cron`. 1 job duy nhất `recompute-status`
 * chạy theo cron pattern (default mỗi 5 phút — `*\/5 * * * *`). Mỗi tick
 * gọi `LiveOpsEventSchedulerService.recomputeStatuses(now)` để transition
 * SCHEDULED→ACTIVE và ACTIVE→ENDED dựa trên window.
 *
 * Idempotent / race-safe (xem doc trong service):
 *   - `updateMany` với guard status + window. Worker thắng count=N, worker
 *     thua count=0 (status đã transition). KHÔNG double tick.
 *   - Optional Redis lease (`LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY`) là
 *     barrier optimistic giảm log noise + DB load — KHÔNG phải nguồn sự
 *     thật idempotency.
 */

export const LIVEOPS_EVENT_SCHEDULER_QUEUE = 'liveops-event-scheduler-cron';

/** 1 job duy nhất chạy theo cron — recompute status cho mọi event row. */
export const LIVEOPS_EVENT_RECOMPUTE_JOB = 'recompute-status';

/** Default `*\/5 * * * *` — mỗi 5 phút. */
export const LIVEOPS_EVENT_RECOMPUTE_CRON_DEFAULT = '*/5 * * * *';

/** Redis lease key cho optimistic single-worker barrier. */
export const LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY =
  'xt:liveops-event-scheduler:recompute';
