import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { SecurityModule } from '../security/security.module';
import {
  AdminCoopRewardCapController,
  CoopRewardCapController,
} from './coop-reward-cap.controller';
import { CoopRewardCapService } from './coop-reward-cap.service';

/**
 * Phase 20.3 — Co-op Reward Cap / Weekly Contribution Season module.
 *
 * Wiring:
 *   - `AuthModule`       — cookie auth (`xt_access`) cho REST.
 *   - `CharacterModule`  — `CurrencyService.applyTx` cho weekly reward
 *                           grant (reason `COOP_WEEKLY_REWARD`).
 *   - `SecurityModule`   — `@RateLimitPolicy()` decorator.
 *   - `AdminModule`      — `AdminGuard` + `RequireAdmin` cho admin
 *                           controller.
 *
 * Export `CoopRewardCapService` để Phase 20.1 (`PartyDungeonModule`)
 * + Phase 20.2 (`CoopBossModule`) import + cap gate vào claim flow.
 *
 * Soft-ref pattern: KHÔNG FK với User / Character. Service enforce
 * idempotency + race-safe qua UNIQUE composite + CAS guard.
 */
@Module({
  imports: [AuthModule, CharacterModule, SecurityModule, AdminModule],
  controllers: [CoopRewardCapController, AdminCoopRewardCapController],
  providers: [PrismaService, CoopRewardCapService],
  exports: [CoopRewardCapService],
})
export class CoopRewardCapModule {}
