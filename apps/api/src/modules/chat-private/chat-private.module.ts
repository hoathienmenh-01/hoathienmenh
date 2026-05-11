import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ChatModerationModule } from '../chat-moderation/chat-moderation.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { ChatPrivateController } from './chat-private.controller';
import { ChatPrivateService } from './chat-private.service';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    SocialModule,
    ChatModerationModule,
    // Phase 19.3 — fail-soft notification helper for receiver.
    NotificationModule,
  ],
  controllers: [ChatPrivateController],
  providers: [ChatPrivateService, PrismaService],
  exports: [ChatPrivateService],
})
export class ChatPrivateModule {}
