import { Module } from '@nestjs/common';
import { CombatController } from './combat.controller';
import { CombatService } from './combat.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MissionModule } from '../mission/mission.module';
import { QuestModule } from '../quest/quest.module';
import { EconomyModule } from '../economy/economy.module';
import { Phase33StoryModule } from '../story-v2/story-v2.module';

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    CharacterModule,
    InventoryModule,
    MissionModule,
    QuestModule,
    EconomyModule,
    // Phase 33.3 — World Objective Deep Wire. Cung cấp Phase33StoryService
    // (@Optional inject) cho `kill`/`collect` step tracking.
    Phase33StoryModule,
  ],
  controllers: [CombatController],
  providers: [CombatService, PrismaService],
})
export class CombatModule {}
