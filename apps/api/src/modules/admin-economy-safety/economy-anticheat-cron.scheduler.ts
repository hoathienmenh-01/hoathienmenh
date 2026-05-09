import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ANOMALY_SCANNER_JOB,
  ANOMALY_SCANNER_QUEUE,
  LEDGER_CHECKER_JOB,
  LEDGER_CHECKER_QUEUE,
  readEconomyAnticheatCronConfig,
  type EconomyAnticheatCronConfig,
} from './economy-anticheat-cron.config';

/**
 * Phase 16.6 — Scheduler register cron repeat job vào BullMQ. Mirror
 * pattern `LiveOpsCronScheduler` (phase 13.2.D).
 *
 * Nếu env disabled (`*_ENABLED=false`), KHÔNG register repeat — admin
 * force-run qua `POST /admin/economy/{ledger-check,anomalies}/run|scan`.
 * Đây là default ở local/test.
 */
@Injectable()
export class EconomyAnticheatCronScheduler {
  private readonly logger = new Logger(EconomyAnticheatCronScheduler.name);

  constructor(
    @InjectQueue(LEDGER_CHECKER_QUEUE)
    private readonly ledgerQueue: Queue,
    @InjectQueue(ANOMALY_SCANNER_QUEUE)
    private readonly anomalyQueue: Queue,
  ) {}

  async scheduleRecurring(
    config: EconomyAnticheatCronConfig = readEconomyAnticheatCronConfig(),
  ): Promise<void> {
    if (config.ledgerCheckerEnabled) {
      await this.registerRepeat(
        this.ledgerQueue,
        LEDGER_CHECKER_JOB,
        config.ledgerCheckerCron,
        config.timezone,
      );
      this.logger.log(
        `ledger-checker cron registered pattern="${config.ledgerCheckerCron}" tz=${config.timezone}`,
      );
    } else {
      await this.removeRepeat(this.ledgerQueue, LEDGER_CHECKER_JOB);
      this.logger.log(
        'ledger-checker cron disabled (LEDGER_CHECKER_CRON_ENABLED=false)',
      );
    }

    if (config.anomalyScannerEnabled) {
      await this.registerRepeat(
        this.anomalyQueue,
        ANOMALY_SCANNER_JOB,
        config.anomalyScannerCron,
        config.timezone,
      );
      this.logger.log(
        `anomaly-scanner cron registered pattern="${config.anomalyScannerCron}" tz=${config.timezone}`,
      );
    } else {
      await this.removeRepeat(this.anomalyQueue, ANOMALY_SCANNER_JOB);
      this.logger.log(
        'anomaly-scanner cron disabled (ECONOMY_ANOMALY_CRON_ENABLED=false)',
      );
    }
  }

  private async registerRepeat(
    queue: Queue,
    name: string,
    pattern: string,
    tz: string,
  ): Promise<void> {
    const repeatable = await queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === name) await queue.removeRepeatableByKey(j.key);
    }
    await queue.add(
      name,
      {},
      {
        repeat: { pattern, tz },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  }

  private async removeRepeat(queue: Queue, name: string): Promise<void> {
    const repeatable = await queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === name) await queue.removeRepeatableByKey(j.key);
    }
  }
}
