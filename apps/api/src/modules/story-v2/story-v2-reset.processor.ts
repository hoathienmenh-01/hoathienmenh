import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Phase33StoryService } from './story-v2.service';
import { STORY_V2_RESET_QUEUE } from './story-v2-reset.queue';

/**
 * Phase 33.4 — Story V2 daily/weekly quest reset processor.
 *
 * Chạy mỗi 10 phút: quét CLAIMED daily/weekly quests có `windowEnd <= now`,
 * reset về AVAILABLE cho phép player re-accept + re-claim.
 */
@Processor(STORY_V2_RESET_QUEUE)
export class StoryV2ResetProcessor extends WorkerHost {
  private readonly logger = new Logger(StoryV2ResetProcessor.name);

  constructor(private readonly storyV2: Phase33StoryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'reset') return;
    try {
      const count = await this.storyV2.resetExpiredQuests();
      if (count > 0) {
        this.logger.log(`Story V2 daily/weekly reset — ${count} quests reset`);
      }
    } catch (e) {
      this.logger.error(`Story V2 reset failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
