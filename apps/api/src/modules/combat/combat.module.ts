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

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    CharacterModule,
    InventoryModule,
    MissionModule,
    QuestModule,
  ],
  controllers: [CombatController],
  providers: [CombatService, PrismaService],
})
export class CombatModule {}
