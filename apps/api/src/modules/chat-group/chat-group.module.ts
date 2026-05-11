import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ChatModerationModule } from '../chat-moderation/chat-moderation.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { ChatGroupController } from './chat-group.controller';
import { ChatGroupService } from './chat-group.service';

@Module({
  imports: [AuthModule, RealtimeModule, SocialModule, ChatModerationModule],
  controllers: [ChatGroupController],
  providers: [ChatGroupService, PrismaService],
  exports: [ChatGroupService],
})
export class ChatGroupModule {}
