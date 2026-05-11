/**
 * Phase 17.2 — BackupProcessor — BullMQ worker xử lý cron job.
 *
 * Job name:
 *   - `backup-run`    — chạy backup weekly. Service spawn shell.
 *   - `backup-verify` — chạy verify-restore weekly. Service spawn shell.
 *
 * Cron-triggered → `triggeredBy='CRON'` + `actorUserId=null`.
 *
 * Idempotency: mỗi spawn tạo file riêng (timestamp suffix) nên 2 worker
 * race không corrupt nhau. DB row riêng cho từng spawn — không cần
 * lease lock.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  BACKUP_QUEUE,
  BACKUP_RUN_JOB,
  BACKUP_VERIFY_JOB,
} from './backup.queue';
import { BackupService } from './backup.service';

@Processor(BACKUP_QUEUE)
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly backupService: BackupService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`processor pick job=${job.name} id=${job.id}`);
    if (job.name === BACKUP_RUN_JOB) {
      await this.backupService.runBackup('CRON', null);
      return;
    }
    if (job.name === BACKUP_VERIFY_JOB) {
      await this.backupService.runVerify('CRON', null);
      return;
    }
    this.logger.warn(`processor ignore unknown job=${job.name}`);
  }
}
