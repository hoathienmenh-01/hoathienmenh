import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaService } from '../../common/prisma.service';
import { NpcAffinityController } from './npc-affinity.controller';
import { NpcAffinityService } from './npc-affinity.service';
import { NpcAffinityShopService } from './npc-affinity-shop.service';
import { NpcRelationshipChainService } from './npc-relationship-chain.service';

/**
 * Phase 12.10.A — NPC Affinity & Relationship Foundation.
 *
 * Imports:
 *   - `AuthModule` cho `AuthService` (cookie userId).
 *   - `InventoryModule` (Phase 12.10.B) cho `InventoryService` —
 *     `giftNpcTx` consume 1 stack item qua `consumeOneByItemKeyTx`.
 *   - `CharacterModule` (Phase 12.10.C) cho `CurrencyService` — atomic spend
 *     khi NPC affinity shop buy. `forwardRef` để break cycle
 *     CharacterModule ↔ InventoryModule ↔ NpcAffinityModule.
 *
 * Exports:
 *   - `NpcAffinityService` — `StoryDialogueModule` (Phase 12.10.A integration)
 *     và `QuestModule` (quest reward affinity, opt-in Phase 12.10.B) consume.
 *   - `NpcAffinityShopService` (Phase 12.10.C) — handler cho shop endpoints.
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => InventoryModule),
    forwardRef(() => CharacterModule),
  ],
  controllers: [NpcAffinityController],
  providers: [
    NpcAffinityService,
    NpcAffinityShopService,
    NpcRelationshipChainService,
    PrismaService,
  ],
  exports: [
    NpcAffinityService,
    NpcAffinityShopService,
    NpcRelationshipChainService,
  ],
})
export class NpcAffinityModule {}
