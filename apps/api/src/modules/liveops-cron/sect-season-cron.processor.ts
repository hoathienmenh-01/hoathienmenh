import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  SECT_SEASON_CRON_QUEUE,
  SECT_SEASON_SNAPSHOT_JOB,
} from './liveops-cron.queue';
import { LiveOpsCronService } from './liveops-cron.service';

/**
 * Phase 13.2.D — BullMQ processor cho sect season snapshot.
 *
 * Trigger từ {@link LiveOpsCronScheduler.scheduleRecurring} theo cron
 * pattern (mặc định 00:15 UTC mỗi ngày). Mỗi job snapshot mọi season đã
 * `endsAt <= now` mà chưa snapshot. Idempotent qua UNIQUE `seasonKey`.
 *
 * Phase 13.2.D KHÔNG distribute reward — chỉ snapshot history/HoF.
 */
@Processor(SECT_SEASON_CRON_QUEUE)
export class SectSeasonCronProcessor extends WorkerHost {
  private readonly logger = new Logger(SectSeasonCronProcessor.name);

  constructor(private readonly cron: LiveOpsCronService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== SECT_SEASON_SNAPSHOT_JOB) return;
    try {
      const summary = await this.cron.runSectSeasonCycle({
        triggeredBy: null,
      });
      this.logger.log(
        `cron sect-season snapshot created=${summary.seasonSnapshotsCreated} ` +
          `skipped=${summary.seasonSnapshotsSkipped} processed=${summary.seasonsProcessed.length} ` +
          `errors=${summary.errors.length}`,
      );
    } catch (e) {
      this.logger.error(
        `cron sect-season snapshot failed: ${(e as Error).message}`,
      );
      throw e;
    }
  }
}
