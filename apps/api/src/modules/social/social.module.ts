import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

/**
 * Phase 19.1 — Social System Foundation module.
 *
 * `SocialService` được `exports` để `ChatPrivateModule` /
 * `ChatGroupModule` re-use `isBlockedBetween` + `areFriends`.
 */
@Module({
  imports: [AuthModule],
  controllers: [SocialController],
  providers: [SocialService, PrismaService],
  exports: [SocialService],
})
export class SocialModule {}
