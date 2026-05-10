import { Module } from '@nestjs/common';
import { DungeonRunController } from './dungeon-run.controller';
import { DungeonRunService } from './dungeon-run.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuestModule } from '../quest/quest.module';
import { SectWarModule } from '../sect-war/sect-war.module';
import { TerritoryModule } from '../territory/territory.module';
import { EconomyModule } from '../economy/economy.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';

/**
 * Phase 12.2.B — DungeonRun runtime module.
 *
 * Imports:
 *  - AuthModule        — auth gate (cookie xt_access).
 *  - CharacterModule   — `CurrencyService.applyTx` cho linhThach/tienNgoc
 *                        reward grant (reason='DUNGEON_RUN_REWARD').
 *  - InventoryModule   — `InventoryService.grantTx` cho item reward grant
 *                        (cùng reason).
 *  - QuestModule       — `QuestService.track` cho quest kill auto-progress
 *                        khi resolve encounter (mirror `combat.service` PR-6).
 */
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    QuestModule,
    SectWarModule,
    TerritoryModule,
    EconomyModule,
    LiveOpsEventSchedulerModule,
  ],
  controllers: [DungeonRunController],
  providers: [DungeonRunService, PrismaService],
  exports: [DungeonRunService],
})
export class DungeonRunModule {}
