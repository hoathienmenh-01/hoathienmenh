import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationHelpers } from './notification-helpers';

/**
 * Phase 19.3 — Notification module.
 *
 * Exports:
 *   - `NotificationService` cho integration hook caller (vd
 *     SocialModule, ChatPrivateModule, ChatGroupModule,
 *     ChatModerationModule) gọi `createNotification` khi event xảy ra.
 *   - `NotificationHelpers` (factory wrapper an toàn — không throw)
 *     cho các caller không muốn xử lý lỗi notification trong main flow.
 *
 * Re-use `RealtimeService` cho fanout `notification:new` +
 * `notification:unread-count` qua `RealtimeModule`.
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    PrismaService,
    {
      provide: NotificationHelpers,
      useFactory: (service: NotificationService) =>
        new NotificationHelpers(service),
      inject: [NotificationService],
    },
  ],
  exports: [NotificationService, NotificationHelpers],
})
export class NotificationModule {}
