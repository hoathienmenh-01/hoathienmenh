import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  SECT_SEASON_CRON_QUEUE,
  SECT_SEASON_SNAPSHOT_JOB,
  TERRITORY_CRON_QUEUE,
  TERRITORY_WEEKLY_CYCLE_JOB,
} from './liveops-cron.queue';
import { readLiveOpsCronConfig, type LiveOpsCronConfig } from './liveops-cron.config';

/**
 * Phase 13.2.D + 14.0.F — Scheduler register repeat job vào BullMQ.
 *
 * Pattern khớp với `OpsService.scheduleRecurring()` /
 * `CultivationService.scheduleRecurring()`:
 *   - Xóa repeat cũ trùng tên (tránh ghost khi đổi pattern).
 *   - Add lại repeat job với cron pattern + timezone từ env.
 *
 * Nếu env disabled (`*_ENABLED=false`), KHÔNG register repeat — admin
 * vẫn có thể force-run qua `POST /admin/liveops/run-weekly-cycle`. Đây
 * là default ở local/test (theo task spec).
 *
 * Race-safety multi-node: BullMQ lưu repeat schedule trong Redis. 2+
 * worker share Redis sẽ nhận cùng repeat key nhưng chỉ 1 worker chiếm
 * job ở mỗi tick → không double trigger ở queue level. DB unique guard
 * + Redis lease (xem `LiveOpsCronLease`) là barrier thứ 2.
 */
@Injectable()
export class LiveOpsCronScheduler {
  private readonly logger = new Logger(LiveOpsCronScheduler.name);

  constructor(
    @InjectQueue(TERRITORY_CRON_QUEUE)
    private readonly territoryQueue: Queue,
    @InjectQueue(SECT_SEASON_CRON_QUEUE)
    private readonly sectSeasonQueue: Queue,
  ) {}

  /**
   * Đọc env config + register repeat. Idempotent: gọi lại sẽ xoá repeat
   * cũ rồi add lại với pattern mới.
   */
  async scheduleRecurring(
    config: LiveOpsCronConfig = readLiveOpsCronConfig(),
  ): Promise<void> {
    if (config.territoryEnabled) {
      await this.registerRepeat(
        this.territoryQueue,
        TERRITORY_WEEKLY_CYCLE_JOB,
        config.territoryCron,
        config.timezone,
      );
      this.logger.log(
        `territory cron registered pattern="${config.territoryCron}" tz=${config.timezone}`,
      );
    } else {
      // Disabled trong env — xoá repeat job cũ nếu còn.
      await this.removeRepeat(this.territoryQueue, TERRITORY_WEEKLY_CYCLE_JOB);
      this.logger.log('territory cron disabled (TERRITORY_CRON_ENABLED=false)');
    }

    if (config.sectSeasonEnabled) {
      await this.registerRepeat(
        this.sectSeasonQueue,
        SECT_SEASON_SNAPSHOT_JOB,
        config.sectSeasonCron,
        config.timezone,
      );
      this.logger.log(
        `sect-season cron registered pattern="${config.sectSeasonCron}" tz=${config.timezone}`,
      );
    } else {
      await this.removeRepeat(this.sectSeasonQueue, SECT_SEASON_SNAPSHOT_JOB);
      this.logger.log(
        'sect-season cron disabled (SECT_SEASON_CRON_ENABLED=false)',
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
