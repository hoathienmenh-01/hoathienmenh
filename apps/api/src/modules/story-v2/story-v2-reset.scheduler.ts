import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { STORY_V2_RESET_QUEUE, STORY_V2_RESET_INTERVAL_MS } from './story-v2-reset.queue';

/**
 * Phase 33.4 — Story V2 daily/weekly quest reset scheduler.
 *
 * Mirror `MissionScheduler`: clean ghost repeatable jobs, add recurring
 * `'reset'` job every 10 minutes.
 */
@Injectable()
export class StoryV2ResetScheduler implements OnModuleInit {
  private readonly logger = new Logger(StoryV2ResetScheduler.name);

  constructor(@InjectQueue(STORY_V2_RESET_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const repeatable = await this.queue.getRepeatableJobs();
    for (const j of repeatable) {
      if (j.name === 'reset') await this.queue.removeRepeatableByKey(j.key);
    }
    await this.queue.add(
      'reset',
      {},
      {
        repeat: { every: STORY_V2_RESET_INTERVAL_MS },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
    this.logger.log(
      `Story V2 daily/weekly reset scheduled every ${STORY_V2_RESET_INTERVAL_MS}ms`,
    );
  }
}
