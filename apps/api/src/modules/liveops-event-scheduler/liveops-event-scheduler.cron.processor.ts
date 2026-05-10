import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { LiveOpsCronLease } from '../liveops-cron/liveops-cron.lease';
import {
  LIVEOPS_EVENT_RECOMPUTE_JOB,
  LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY,
  LIVEOPS_EVENT_SCHEDULER_QUEUE,
} from './liveops-event-scheduler.queue';
import { readLiveOpsEventSchedulerCronConfig } from './liveops-event-scheduler.cron.config';
import { LiveOpsEventSchedulerService } from './liveops-event-scheduler.service';

/**
 * Phase 15.1–15.2 — BullMQ processor cho LiveOps Event Scheduler recompute.
 *
 * Mỗi tick (default mỗi 5 phút):
 *   1. Lấy lease Redis (`LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY`). Nếu node khác
 *      đang giữ → skip (return early). Mục tiêu: giảm log noise + DB load.
 *   2. Gọi `service.recomputeStatuses(now)` — `updateMany` idempotent với
 *      guard status + window. SCHEDULED→ACTIVE / SCHEDULED→ENDED (skip
 *      past window) / ACTIVE→ENDED. Fail-safe nếu lease không cover tất
 *      cả node.
 *   3. Release lease ở finally — luôn release dù gặp exception.
 *
 * Race-safety: dù 2 worker cùng lease (Redis fail / TTL race), service
 * `updateMany` chỉ update đúng 1 lần per row do guard status + count
 * decrement (worker thua count=0). KHÔNG double transition.
 *
 * Logging: chỉ log khi có transition (toActivated > 0 || toEnded > 0)
 * để giảm noise.
 */
@Processor(LIVEOPS_EVENT_SCHEDULER_QUEUE)
export class LiveOpsEventSchedulerCronProcessor extends WorkerHost {
  private readonly logger = new Logger(
    LiveOpsEventSchedulerCronProcessor.name,
  );

  constructor(
    private readonly service: LiveOpsEventSchedulerService,
    private readonly lease: LiveOpsCronLease,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== LIVEOPS_EVENT_RECOMPUTE_JOB) return;

    const config = readLiveOpsEventSchedulerCronConfig();
    const ttl = config.leaseTtlSec;
    const acquired = await this.lease.acquire(
      LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY,
      ttl,
    );
    if (!acquired.acquired) {
      this.logger.debug?.(
        'liveops event scheduler recompute skipped (lease held by other worker)',
      );
      return;
    }

    try {
      const summary = await this.service.recomputeStatuses(new Date());
      if (summary.toActivated > 0 || summary.toEnded > 0) {
        this.logger.log(
          `cron recompute scannedAt=${summary.scannedAt} activated=${summary.toActivated} ended=${summary.toEnded}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `liveops event scheduler recompute failed: ${(e as Error).message}`,
      );
      // Throw để BullMQ log + retry policy. Service đã idempotent — retry
      // an toàn (rows đã transition không re-transition).
      throw e;
    } finally {
      await this.lease.release(
        LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY,
        acquired.owner,
      );
    }
  }
}
