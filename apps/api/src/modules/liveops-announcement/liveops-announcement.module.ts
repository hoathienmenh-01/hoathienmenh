import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminLiveOpsAnnouncementsController } from './admin-liveops-announcements.controller';
import { LiveOpsAnnouncementsPublicController } from './liveops-announcements-public.controller';
import { LiveOpsAnnouncementService } from './liveops-announcement.service';
import { LiveOpsBroadcastService } from './liveops-broadcast.service';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { ConfigVersionModule } from '../config-version/config-version.module';

/**
 * Phase 15.3.B — LiveOps Announcement module.
 *
 * Provides:
 *   - `LiveOpsAnnouncementService` — CRUD + status machine + recompute idempotent.
 *   - `LiveOpsBroadcastService`    — WS adapter (announcement + event broadcast),
 *     reused bởi `liveops-event-scheduler` để broadcast event transitions.
 *   - `AdminLiveOpsAnnouncementsController` — `/admin/liveops/announcements*`.
 *   - `LiveOpsAnnouncementsPublicController` — `/liveops/announcements/active`.
 *
 * Imports:
 *   - `AdminModule` cho `AdminGuard` + `RequireAdmin` decorator.
 *   - `AuthModule`  cho `AuthService` (resolve viewer trên public endpoint).
 *   - `RealtimeModule` cho `RealtimeService` (broadcast adapter).
 *
 * Cron: dùng chung BullMQ recompute lease — cron processor wire ở
 * `LiveOpsEventSchedulerCronProcessor` (Phase 15.3.B mở rộng): mỗi tick
 * sau khi recompute event, processor cũng gọi
 * `LiveOpsAnnouncementService.recomputeStatuses()` rồi `broadcast`.
 */
@Module({
  imports: [
    AuthModule,
    AdminModule,
    RealtimeModule,
    FeatureFlagModule,
    // Phase 15.6 — Config Version persistence for announcement mutations.
    ConfigVersionModule,
  ],
  controllers: [
    AdminLiveOpsAnnouncementsController,
    LiveOpsAnnouncementsPublicController,
  ],
  providers: [PrismaService, LiveOpsAnnouncementService, LiveOpsBroadcastService],
  exports: [LiveOpsAnnouncementService, LiveOpsBroadcastService],
})
export class LiveOpsAnnouncementModule {}
