import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../../common/redis.module';
import { PrismaService } from '../../common/prisma.service';
import { LiveOpsCronLease } from '../liveops-cron/liveops-cron.lease';
import { AdminLiveOpsEventsController } from './admin-liveops-events.controller';
import { LiveOpsEventSchedulerService } from './liveops-event-scheduler.service';
import { LIVEOPS_EVENT_SCHEDULER_QUEUE } from './liveops-event-scheduler.queue';
import { LiveOpsEventSchedulerCronProcessor } from './liveops-event-scheduler.cron.processor';
import { LiveOpsEventSchedulerCronScheduler } from './liveops-event-scheduler.cron.scheduler';

/**
 * Phase 15.1–15.2 — LiveOps Event Scheduler module.
 *
 * Provides:
 *   - `LiveOpsEventSchedulerService` — CRUD + status machine + runtime modifier query.
 *   - `AdminLiveOpsEventsController` — admin endpoints `/admin/liveops/events*`.
 *   - `LiveOpsEventSchedulerCronProcessor` + `LiveOpsEventSchedulerCronScheduler`
 *     — BullMQ repeat job recompute SCHEDULED→ACTIVE / ACTIVE→ENDED mỗi 5 phút
 *     (default disabled, override `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true`).
 *
 * Imports:
 *   - `AdminModule` cho `AdminGuard` + `RequireAdmin` decorator.
 *   - `RedisModule` (transitive) cho `LiveOpsCronLease` Redis lease.
 *   - `BullModule.registerQueue` để BullMQ `@Processor` decorator hoạt động.
 *
 * Lifecycle:
 *   - `onModuleInit` → `scheduler.scheduleRecurring()`. Idempotent, gọi
 *     lại cũng OK (xoá repeat cũ + add lại).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: LIVEOPS_EVENT_SCHEDULER_QUEUE }),
    AuthModule,
    AdminModule,
    RedisModule,
  ],
  controllers: [AdminLiveOpsEventsController],
  providers: [
    PrismaService,
    LiveOpsEventSchedulerService,
    LiveOpsEventSchedulerCronProcessor,
    LiveOpsEventSchedulerCronScheduler,
    LiveOpsCronLease,
  ],
  exports: [LiveOpsEventSchedulerService],
})
export class LiveOpsEventSchedulerModule implements OnModuleInit {
  constructor(
    private readonly scheduler: LiveOpsEventSchedulerCronScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.scheduler.scheduleRecurring();
  }
}
