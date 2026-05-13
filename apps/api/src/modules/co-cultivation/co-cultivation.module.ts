import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { CoCultivationController } from './co-cultivation.controller';
import { CoCultivationService } from './co-cultivation.service';

/**
 * Phase 35.1 — Co-Cultivation / Hợp Luyện module.
 *
 * Reuse:
 *   - `SocialModule` (Phase 19.1) → `SocialService.areFriends` /
 *     `isBlockedBetween`.
 *   - `RealtimeModule` (Phase 19.0) → `RealtimeService.isOnline` presence
 *     check (best-effort).
 *   - `EconomyModule` (Phase 16.5) → `RewardCapService.applyCapTx` cho
 *     bonus EXP grant (source `CULTIVATION`).
 *   - `AuthModule` → `AuthService.userIdFromAccess`.
 */
@Module({
  imports: [AuthModule, EconomyModule, SocialModule, RealtimeModule],
  controllers: [CoCultivationController],
  providers: [CoCultivationService, PrismaService],
  exports: [CoCultivationService],
})
export class CoCultivationModule {}
