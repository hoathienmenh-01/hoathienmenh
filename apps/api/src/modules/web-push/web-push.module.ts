import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { WebPushController } from './web-push.controller';
import { WebPushService } from './web-push.service';
import { WebPushTriggerService } from './web-push-trigger.service';
import { WebPushDailyReminderScheduler } from './web-push-daily-reminder.scheduler';

/**
 * Phase PWA-1 — Web Push module.
 * Phase 44.1 — expose `WebPushTriggerService` cho BossModule, MailModule,
 * StaminaWorker, DailyReminderScheduler gọi để trigger push.
 *
 * Trigger service tự gate `pushEnabled`, fail-soft khi gateway / prefs /
 * cooldown sai. Module gốc (Boss/Mail) inject Optional → tests không cần.
 */
@Module({
  imports: [AuthModule, FeatureFlagModule],
  controllers: [WebPushController],
  providers: [
    WebPushService,
    WebPushTriggerService,
    WebPushDailyReminderScheduler,
    PrismaService,
  ],
  exports: [WebPushService, WebPushTriggerService, WebPushDailyReminderScheduler],
})
export class WebPushModule {}
