import { Module } from '@nestjs/common';
import { BossService } from './boss.service';
import { BossController } from './boss.controller';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MissionModule } from '../mission/mission.module';
import { AdminModule } from '../admin/admin.module';
import { SectWarModule } from '../sect-war/sect-war.module';
import { TerritoryModule } from '../territory/territory.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';
import { EconomyModule } from '../economy/economy.module';
import { WebPushModule } from '../web-push/web-push.module';

// Phase 15.3.A — `LiveOpsEventSchedulerModule` wire để BossService đọc
// BOSS_REWARD_BOOST runtime modifier (Optional inject — test có thể bỏ).
// Phase 26.2 — `EconomyModule` wire để BossService đọc DropEconomyService
// cấp WORLD_BOSS material drop (weekly cap), fail-soft Optional inject.
@Module({
  imports: [
    RealtimeModule,
    AuthModule,
    CharacterModule,
    InventoryModule,
    MissionModule,
    AdminModule,
    SectWarModule,
    TerritoryModule,
    LiveOpsEventSchedulerModule,
    EconomyModule,
    WebPushModule,
  ],
  controllers: [BossController],
  providers: [BossService, PrismaService],
  exports: [BossService],
})
export class BossModule {}
