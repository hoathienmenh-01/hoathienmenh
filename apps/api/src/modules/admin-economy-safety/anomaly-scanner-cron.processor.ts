import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  ANOMALY_SCANNER_JOB,
  ANOMALY_SCANNER_QUEUE,
} from './economy-anticheat-cron.config';
import { EconomyAnomalyScannerService } from '../economy/economy-anomaly-scanner.service';

/**
 * Phase 16.6 — BullMQ processor cho anomaly scanner daily.
 *
 * Idempotency: service tạo anomaly với UNIQUE
 * `(source, characterId, windowKey)` → P2002 caught → counted as
 * `skipped` thay vì throw.
 */
@Processor(ANOMALY_SCANNER_QUEUE)
export class AnomalyScannerCronProcessor extends WorkerHost {
  private readonly logger = new Logger(AnomalyScannerCronProcessor.name);

  constructor(private readonly scanner: EconomyAnomalyScannerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== ANOMALY_SCANNER_JOB) return;
    try {
      const summary = await this.scanner.scanAll();
      this.logger.log(
        `cron anomaly-scan windowKey=${summary.windowKey} ` +
          `created=${summary.totalAnomaliesCreated} ` +
          `skipped=${summary.totalAnomaliesSkipped}`,
      );
    } catch (e) {
      this.logger.error(`cron anomaly-scan failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
