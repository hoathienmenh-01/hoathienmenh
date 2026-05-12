import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CULTIVATION_TICK_MS } from '@xuantoi/shared';
import { BODY_CULTIVATION_QUEUE } from './body-cultivation.queue';

@Injectable()
export class BodyCultivationSchedulerService {
  private readonly logger = new Logger(BodyCultivationSchedulerService.name);

  constructor(@InjectQueue(BODY_CULTIVATION_QUEUE) private readonly queue: Queue) {}

  async scheduleRecurring(): Promise<void> {
    const repeatable = await this.queue.getRepeatableJobs();
    for (const job of repeatable) {
      if (job.name === 'body-tick') await this.queue.removeRepeatableByKey(job.key);
    }
    await this.queue.add(
      'body-tick',
      {},
      {
        repeat: { every: CULTIVATION_TICK_MS },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`Body cultivation tick scheduled every ${CULTIVATION_TICK_MS}ms`);
  }
}
