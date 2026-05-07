import { Module } from '@nestjs/common';
import { StoryDungeonController } from './story-dungeon.controller';
import { StoryDungeonService } from './story-dungeon.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuestModule } from '../quest/quest.module';

/**
 * Phase 12.8.A + 12.8.B — Story Dungeon module.
 *
 * Imports:
 *  - AuthModule        — auth gate (cookie xt_access).
 *  - CharacterModule   — `CurrencyService.applyTx` cho linhThach/tienNgoc
 *                        reward grant (reason='STORY_DUNGEON_REWARD').
 *  - InventoryModule   — `InventoryService.grantTx` cho item reward grant
 *                        (cùng reason).
 *  - QuestModule       — `QuestService.track` cho quest kill auto-progress
 *                        khi advance (mirror DungeonRunService.nextEncounter).
 */
@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, QuestModule],
  controllers: [StoryDungeonController],
  providers: [StoryDungeonService, PrismaService],
  exports: [StoryDungeonService],
})
export class StoryDungeonModule {}
