import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminLiveOpsEventsController } from './admin-liveops-events.controller';
import { LiveOpsEventSchedulerService } from './liveops-event-scheduler.service';

/**
 * Phase 15.1–15.2 — LiveOps Event Scheduler module.
 *
 * Provides:
 *   - `LiveOpsEventSchedulerService` — CRUD + status machine + runtime modifier query.
 *   - `AdminLiveOpsEventsController` — admin endpoints `/admin/liveops/events*`.
 *
 * Imports `AdminModule` để dùng `AdminGuard` + `RequireAdmin` decorator
 * (cùng pattern với `AdminLiveOpsCronController`).
 *
 * Cron tick recompute là 1 BullMQ job riêng — wire ở `LiveOpsCronModule`
 * (Phase 13.2.D infra). Service này chỉ provide pure domain logic, không
 * tự schedule.
 */
@Module({
  imports: [AdminModule],
  controllers: [AdminLiveOpsEventsController],
  providers: [LiveOpsEventSchedulerService],
  exports: [LiveOpsEventSchedulerService],
})
export class LiveOpsEventSchedulerModule {}
