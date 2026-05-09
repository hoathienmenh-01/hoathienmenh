import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  TERRITORY_CRON_QUEUE,
  TERRITORY_WEEKLY_CYCLE_JOB,
} from './liveops-cron.queue';
import { LiveOpsCronService } from './liveops-cron.service';

/**
 * Phase 14.0.F — BullMQ processor cho territory weekly cycle.
 *
 * Trigger từ {@link LiveOpsCronScheduler.scheduleRecurring} theo cron
 * pattern (mặc định Mon 00:05 UTC). Mỗi job chạy 1 chu kỳ
 * `LiveOpsCronService.runTerritoryCycle()` chốt period TUẦN TRƯỚC.
 *
 * Idempotency / race-safety:
 *   - Service tự lease + DB unique guard. Processor không cần thêm gì.
 *   - Job throw → BullMQ log + retry theo policy (default no retry để
 *     tránh nhân đôi khi service hot-throw).
 */
@Processor(TERRITORY_CRON_QUEUE)
export class TerritoryCronProcessor extends WorkerHost {
  private readonly logger = new Logger(TerritoryCronProcessor.name);

  constructor(private readonly cron: LiveOpsCronService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== TERRITORY_WEEKLY_CYCLE_JOB) return;
    try {
      const summary = await this.cron.runTerritoryCycle({
        triggeredBy: null,
      });
      this.logger.log(
        `cron territory cycle period=${summary.periodKey} settled=${summary.territorySettled} ` +
          `decaySkipped=${summary.territoryDecaySkipped} mails=${summary.rewardMailsCreated} ` +
          `errors=${summary.errors.length}`,
      );
    } catch (e) {
      this.logger.error(
        `cron territory cycle failed: ${(e as Error).message}`,
      );
      throw e;
    }
  }
}
