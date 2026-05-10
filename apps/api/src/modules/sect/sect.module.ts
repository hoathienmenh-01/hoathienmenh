import { Module } from '@nestjs/common';
import { SectService } from './sect.service';
import { SectController } from './sect.controller';
import { SectMissionService } from './sect-mission.service';
import { SectMissionController } from './sect-mission.controller';
import { SectShopService } from './sect-shop.service';
import { SectShopController } from './sect-shop.controller';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { MissionModule } from '../mission/mission.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';

// Phase 13.1.B — wire SectMission + SectShop services + controllers vào SectModule.
// SectMissionService inject Optional `CurrencyService` + `InventoryService`
// để optional reward grant. SectShopService bắt buộc `InventoryService` cho
// item grant atomic-tx.
//
// Phase 15.3.A — `LiveOpsEventSchedulerModule` wire để SectShopService đọc
// SECT_SHOP_DISCOUNT runtime modifier (Optional inject — test có thể bỏ).
@Module({
  imports: [
    RealtimeModule,
    AuthModule,
    CharacterModule,
    MissionModule,
    InventoryModule,
    LiveOpsEventSchedulerModule,
  ],
  controllers: [SectController, SectMissionController, SectShopController],
  providers: [
    SectService,
    SectMissionService,
    SectShopService,
    PrismaService,
  ],
  exports: [SectService, SectMissionService, SectShopService],
})
export class SectModule {}
