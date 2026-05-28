import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ChatModerationModule } from '../chat-moderation/chat-moderation.module';
import { NotificationModule } from '../notification/notification.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { ChatGroupController } from './chat-group.controller';
import { ChatGroupService } from './chat-group.service';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    SocialModule,
    ChatModerationModule,
    // Phase 19.3 — fail-soft notification helper for member added /
    // group message received.
    NotificationModule,
    OnboardingQuestModule,
  ],
  controllers: [ChatGroupController],
  providers: [ChatGroupService, PrismaService],
  exports: [ChatGroupService],
})
export class ChatGroupModule {}
