import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebPushModule } from '../web-push/web-push.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';

@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    RealtimeModule,
    WebPushModule,
    // Phase 44.2 — Optional onboarding wire để markRead trigger
    // `recordAction(MAIL_OPEN)`. Module export `OnboardingQuestService` đủ
    // cho `@Optional()` inject ở MailService.
    OnboardingQuestModule,
  ],
  controllers: [MailController],
  providers: [MailService, PrismaService],
  exports: [MailService],
})
export class MailModule {}
