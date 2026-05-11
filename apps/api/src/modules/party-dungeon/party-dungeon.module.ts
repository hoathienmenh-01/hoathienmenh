import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SecurityModule } from '../security/security.module';
import { PartyDungeonController } from './party-dungeon.controller';
import { PartyDungeonService } from './party-dungeon.service';

/**
 * Phase 20.1 — Party Dungeon Co-op PvE Foundation module.
 *
 * Wiring:
 *   - `AuthModule`      — cookie auth gate (`xt_access`).
 *   - `CharacterModule` — `CurrencyService.applyTx` cho linhThach/
 *                          tienNgoc reward grant (reason
 *                          `PARTY_DUNGEON_REWARD`).
 *   - `InventoryModule` — `InventoryService.grantTx` cho item
 *                          reward grant (cùng reason).
 *   - `RealtimeModule`  — emit WS event `party-dungeon:*` cho
 *                          participant của room.
 *   - `SecurityModule`  — `@RateLimitPolicy()` decorator hoạt động.
 *
 * Soft-ref pattern: KHÔNG FK với Party / DungeonRun. Service enforce
 * party-membership + leader-only invariants. Tách module riêng để
 * không cần import vào `PartyModule` (tránh circular dependency).
 */
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    RealtimeModule,
    SecurityModule,
  ],
  controllers: [PartyDungeonController],
  providers: [PrismaService, PartyDungeonService],
  exports: [PartyDungeonService],
})
export class PartyDungeonModule {}
