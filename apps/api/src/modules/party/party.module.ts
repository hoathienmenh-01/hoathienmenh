import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SecurityModule } from '../security/security.module';
import { SocialModule } from '../social/social.module';
import { PartyController } from './party.controller';
import { PartyService } from './party.service';

/**
 * Phase 19.4 — Party module.
 *
 * Wiring:
 *   - `AuthModule` để dùng `AuthService.requireUserId` cho cookie auth.
 *   - `RealtimeModule` để emit WS event party:*.
 *   - `SecurityModule` để `@RateLimitPolicy()` decorator hoạt động.
 *   - `SocialModule` để dùng `SocialService.isBlockedBetween` check
 *     block 2 chiều khi invite / accept.
 *
 * Soft-ref pattern: KHÔNG FK trong Prisma, service enforce ownership
 * + role + membership. Notification integration (Phase 19.3) là
 * follow-up scope ở phase này (best-effort qua hook tương lai).
 */
@Module({
  imports: [AuthModule, RealtimeModule, SecurityModule, SocialModule],
  controllers: [PartyController],
  providers: [PrismaService, PartyService],
  exports: [PartyService],
})
export class PartyModule {}
