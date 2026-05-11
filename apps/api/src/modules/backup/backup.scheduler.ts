/**
 * Phase 17.2 — Backup cron scheduler.
 *
 * Register repeat job vào BullMQ theo env config. Pattern mirror
 * `LiveOpsCronScheduler` (Phase 15.8) + `OpsService.scheduleRecurring`
 * (Phase 9.5):
 *   - Xóa repeat cũ trùng tên (tránh ghost khi đổi pattern).
 *   - Add lại repeat job nếu enabled.
 *
 * Nếu env disabled (`*_ENABLED=false`), KHÔNG register repeat — admin
 * vẫn có thể manual trigger qua `POST /admin/backup/run` /
 * `POST /admin/backup/verify`. Đây là default.
 *
 * Multi-node race-safety: BullMQ lưu repeat schedule trong Redis. 2+
 * worker share Redis sẽ nhận cùng repeat key nhưng chỉ 1 worker chiếm
 * job ở mỗi tick → không double trigger ở queue level. DB tracking
 * row (mỗi spawn 1 file riêng) là barrier nhẹ thứ 2.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  BACKUP_QUEUE,
  BACKUP_RUN_JOB,
  BACKUP_VERIFY_JOB,
} from './backup.queue';
import { readBackupConfig, type BackupConfig } from './backup.config';

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    @InjectQueue(BACKUP_QUEUE)
    private readonly queue: Queue,
  ) {}

  async scheduleRecurring(
    config: BackupConfig = readBackupConfig(),
  ): Promise<void> {
    if (config.backupEnabled) {
      await this.registerRepeat(
        BACKUP_RUN_JOB,
        config.backupSchedule,
        config.timezone,
      );
      this.logger.log(
        `backup cron registered pattern="${config.backupSchedule}" tz=${config.timezone}`,
      );
    } else {
      await this.removeRepeat(BACKUP_RUN_JOB);
      this.logger.log('backup cron disabled (BACKUP_CRON_ENABLED=false)');
    }

    if (config.verifyEnabled) {
      await this.registerRepeat(
        BACKUP_VERIFY_JOB,
        config.verifySchedule,
        config.timezone,
      );
      this.logger.log(
        `verify cron registered pattern="${config.verifySchedule}" tz=${config.timezone}`,
      );
    } else {
      await this.removeRepeat(BACKUP_VERIFY_JOB);
      this.logger.log(
        'verify cron disabled (BACKUP_VERIFY_CRON_ENABLED=false)',
      );
    }
  }

  private async registerRepeat(
    name: string,
    pattern: string,
    tz: string,
  ): Promise<void> {
    const repeatable = await this.queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === name) await this.queue.removeRepeatableByKey(j.key);
    }
    await this.queue.add(
      name,
      {},
      {
        repeat: { pattern, tz },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  }

  private async removeRepeat(name: string): Promise<void> {
    const repeatable = await this.queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === name) await this.queue.removeRepeatableByKey(j.key);
    }
  }
}
