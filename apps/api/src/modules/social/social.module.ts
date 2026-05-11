import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

/**
 * Phase 19.1 — Social System Foundation module.
 *
 * `SocialService` được `exports` để `ChatPrivateModule` /
 * `ChatGroupModule` re-use `isBlockedBetween` + `areFriends`.
 *
 * Phase 19.3 — import `NotificationModule` để inject
 * `NotificationHelpers` (optional, fail-soft). Khi user gửi /
 * accept friend request, service emit notification cho counterpart
 * qua helper. Không tạo circular vì NotificationModule chỉ depend
 * AuthModule + RealtimeModule.
 */
@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [SocialController],
  providers: [SocialService, PrismaService],
  exports: [SocialService],
})
export class SocialModule {}
