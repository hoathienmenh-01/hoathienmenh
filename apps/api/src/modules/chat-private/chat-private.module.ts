import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { ChatPrivateController } from './chat-private.controller';
import { ChatPrivateService } from './chat-private.service';

@Module({
  imports: [AuthModule, RealtimeModule, SocialModule],
  controllers: [ChatPrivateController],
  providers: [ChatPrivateService, PrismaService],
  exports: [ChatPrivateService],
})
export class ChatPrivateModule {}
