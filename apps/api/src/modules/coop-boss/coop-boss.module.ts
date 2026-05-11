import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SecurityModule } from '../security/security.module';
import { AdminCoopBossController } from './admin-coop-boss.controller';
import { CoopBossController } from './coop-boss.controller';
import { CoopBossService } from './coop-boss.service';

/**
 * Phase 20.2 — Co-op Boss Party Contribution module.
 *
 * Wiring:
 *   - `AuthModule`       — cookie auth gate (`xt_access`).
 *   - `CharacterModule`  — `CurrencyService.applyTx` cho linhThach /
 *                           tienNgoc reward grant (reason
 *                           `COOP_BOSS_REWARD`).
 *   - `InventoryModule`  — `InventoryService.grantTx` cho item reward
 *                           grant.
 *   - `RealtimeModule`   — emit WS event `coop-boss:*` cho participant.
 *   - `SecurityModule`   — `@RateLimitPolicy()` decorator hoạt động.
 *   - `AdminModule`      — `AdminGuard` + `RequireAdmin` cho admin
 *                           controller (`AdminCoopBossController`).
 *
 * Soft-ref pattern: KHÔNG FK với Party / WorldBoss / User. Service
 * enforce party-membership + leader-only + run lifecycle invariants.
 * Module độc lập (không import vào `BossModule` / `PartyModule` /
 * `PartyDungeonModule` để tránh circular).
 */
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    RealtimeModule,
    SecurityModule,
    AdminModule,
  ],
  controllers: [CoopBossController, AdminCoopBossController],
  providers: [PrismaService, CoopBossService],
  exports: [CoopBossService],
})
export class CoopBossModule {}
