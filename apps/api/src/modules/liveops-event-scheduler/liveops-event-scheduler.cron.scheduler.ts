import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  LIVEOPS_EVENT_RECOMPUTE_JOB,
  LIVEOPS_EVENT_SCHEDULER_QUEUE,
} from './liveops-event-scheduler.queue';
import {
  readLiveOpsEventSchedulerCronConfig,
  type LiveOpsEventSchedulerCronConfig,
} from './liveops-event-scheduler.cron.config';

/**
 * Phase 15.1–15.2 — BullMQ scheduler cho LiveOps Event Scheduler recompute.
 *
 * Pattern khớp với `LiveOpsCronScheduler` (territory + sect-season):
 *   - Đọc env config + register repeat job nếu enabled.
 *   - Idempotent: gọi lại `scheduleRecurring()` xoá repeat cũ rồi add lại.
 *   - Khi `enabled=false`, xoá repeat job (không register) — admin vẫn
 *     force-run qua endpoint `/admin/liveops/events/recompute-status`.
 *
 * Multi-node race-safety:
 *   - BullMQ repeat schedule lưu trong Redis. Mỗi tick chỉ 1 worker chiếm
 *     job → không double trigger ở queue level.
 *   - Processor + service đã idempotent qua `updateMany` guard status —
 *     fail-safe ngay cả khi 2 worker race.
 */
@Injectable()
export class LiveOpsEventSchedulerCronScheduler {
  private readonly logger = new Logger(LiveOpsEventSchedulerCronScheduler.name);

  constructor(
    @InjectQueue(LIVEOPS_EVENT_SCHEDULER_QUEUE)
    private readonly queue: Queue,
  ) {}

  async scheduleRecurring(
    config: LiveOpsEventSchedulerCronConfig = readLiveOpsEventSchedulerCronConfig(),
  ): Promise<void> {
    const repeatable = await this.queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === LIVEOPS_EVENT_RECOMPUTE_JOB) {
        await this.queue.removeRepeatableByKey(j.key);
      }
    }
    if (!config.enabled) {
      this.logger.log(
        'liveops event scheduler cron disabled (LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=false)',
      );
      return;
    }
    await this.queue.add(
      LIVEOPS_EVENT_RECOMPUTE_JOB,
      {},
      {
        repeat: { pattern: config.cron, tz: config.timezone },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(
      `liveops event scheduler cron registered pattern="${config.cron}" tz=${config.timezone}`,
    );
  }
}
