import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  LEDGER_CHECKER_JOB,
  LEDGER_CHECKER_QUEUE,
} from './economy-anticheat-cron.config';
import { LedgerCheckerService } from '../economy/ledger-checker.service';

/**
 * Phase 16.6 — BullMQ processor cho ledger checker daily check.
 *
 * Idempotency:
 *   - Service tự handle `dayBucket` UNIQUE (tạo run thất bại P2002 →
 *     short-circuit return existing run summary).
 *   - Processor không cần thêm gì.
 *
 * Throw → BullMQ log + retry theo policy queue-level (default no retry
 * để tránh nhân đôi nếu service mid-fail). Run idempotent nên retry
 * thực ra OK, nhưng đặt no-retry ở queue level để giảm noise log.
 */
@Processor(LEDGER_CHECKER_QUEUE)
export class LedgerCheckerCronProcessor extends WorkerHost {
  private readonly logger = new Logger(LedgerCheckerCronProcessor.name);

  constructor(private readonly checker: LedgerCheckerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== LEDGER_CHECKER_JOB) return;
    try {
      const summary = await this.checker.runCheck({ triggeredBy: null });
      this.logger.log(
        `cron ledger-check dayBucket=${summary.dayBucket} status=${summary.status} ` +
          `issues=${summary.issuesCreated} alreadyDone=${summary.alreadyDone}`,
      );
    } catch (e) {
      this.logger.error(`cron ledger-check failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
