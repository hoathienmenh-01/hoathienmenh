import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { WebPushController } from './web-push.controller';
import { WebPushService } from './web-push.service';

/**
 * Phase PWA-1 — Web Push module.
 *
 * Exports `WebPushService` cho các module trigger (MailModule,
 * BossModule, StaminaWorker, DailyReminderScheduler) gọi
 * `sendToUser` khi event xảy ra. Trigger wiring sẽ ở follow-up PR
 * nhỏ để PR này gọn (KHÔNG đụng combat / mail core).
 */
@Module({
  imports: [AuthModule],
  controllers: [WebPushController],
  providers: [WebPushService, PrismaService],
  exports: [WebPushService],
})
export class WebPushModule {}
