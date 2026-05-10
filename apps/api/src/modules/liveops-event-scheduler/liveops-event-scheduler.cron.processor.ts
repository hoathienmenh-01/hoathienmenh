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
import {
  LiveOpsEventSchedulerService,
  toLiveOpsEventBroadcastPayload,
} from './liveops-event-scheduler.service';
import { LiveOpsAnnouncementService } from '../liveops-announcement/liveops-announcement.service';
import { LiveOpsBroadcastService } from '../liveops-announcement/liveops-broadcast.service';
import { MaintenanceWindowService } from '../maintenance-window/maintenance-window.service';

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
    private readonly announcementService: LiveOpsAnnouncementService,
    private readonly broadcast: LiveOpsBroadcastService,
    private readonly maintenanceService: MaintenanceWindowService,
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
      const now = new Date();
      // Phase 15.3.B — recompute LiveOps event SCHEDULED↔ACTIVE↔ENDED
      // và broadcast WS event public-safe payload cho rows transition.
      const summary = await this.service.recomputeStatusesWithTransitions(now);
      if (summary.toActivated > 0 || summary.toEnded > 0) {
        this.logger.log(
          `cron recompute scannedAt=${summary.scannedAt} activated=${summary.toActivated} ended=${summary.toEnded}`,
        );
      }
      for (const view of summary.activated) {
        this.broadcast.broadcastEvent(
          toLiveOpsEventBroadcastPayload(view, 'LIVEOPS_EVENT_ACTIVE'),
        );
      }
      for (const view of summary.ended) {
        this.broadcast.broadcastEvent(
          toLiveOpsEventBroadcastPayload(view, 'LIVEOPS_EVENT_ENDED'),
        );
      }

      // Phase 15.3.B — piggyback announcement recompute trên cùng cron tick
      // để tránh thêm queue/lease riêng. Idempotent — gọi nhiều lần OK.
      const announcementSummary =
        await this.announcementService.recomputeStatuses(now);
      for (const payload of announcementSummary.activated) {
        this.broadcast.broadcastAnnouncement(payload);
      }
      for (const payload of announcementSummary.ended) {
        this.broadcast.broadcastAnnouncement(payload);
      }
      if (
        announcementSummary.activated.length > 0 ||
        announcementSummary.ended.length > 0
      ) {
        this.logger.log(
          `cron announcement scannedAt=${announcementSummary.scannedAt} activated=${announcementSummary.activated.length} ended=${announcementSummary.ended.length}`,
        );
      }

      // Phase 15.5 — piggyback maintenance window recompute trên cùng
      // cron tick. Idempotent — gọi nhiều lần OK. KHÔNG broadcast WS
      // (player FE poll `/maintenance/status` mỗi 30s + middleware
      // gating qua cache 10s — đủ refresh sau transition).
      const maintenanceSummary =
        await this.maintenanceService.recomputeStatuses(now);
      if (
        maintenanceSummary.activatedKeys.length > 0 ||
        maintenanceSummary.endedKeys.length > 0
      ) {
        this.logger.log(
          `cron maintenance scannedAt=${maintenanceSummary.scannedAt} activated=${maintenanceSummary.activatedKeys.length} ended=${maintenanceSummary.endedKeys.length}`,
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
