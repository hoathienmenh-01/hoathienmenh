import { Module } from '@nestjs/common';
import { SectService } from './sect.service';
import { SectController } from './sect.controller';
import { SectMissionService } from './sect-mission.service';
import { SectMissionController } from './sect-mission.controller';
import { SectShopService } from './sect-shop.service';
import { SectShopController } from './sect-shop.controller';
import { SectBossService } from './sect-boss.service';
import { SectBossController } from './sect-boss.controller';
import { SectWarContributionService } from './sect-war-contribution.service';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { MissionModule } from '../mission/mission.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';

// Phase 13.1.B — wire SectMission + SectShop services + controllers vào SectModule.
// SectMissionService inject Optional `CurrencyService` + `InventoryService`
// để optional reward grant. SectShopService bắt buộc `InventoryService` cho
// item grant atomic-tx.
//
// Phase 15.3.A — `LiveOpsEventSchedulerModule` wire để SectShopService đọc
// SECT_SHOP_DISCOUNT runtime modifier (Optional inject — test có thể bỏ).
//
// Phase 13.8 — wire SectBoss service + controller + SectWarContribution service.
@Module({
  imports: [
    RealtimeModule,
    AuthModule,
    CharacterModule,
    MissionModule,
    InventoryModule,
    LiveOpsEventSchedulerModule,
    OnboardingQuestModule,
  ],
  controllers: [SectController, SectMissionController, SectShopController, SectBossController],
  providers: [
    SectService,
    SectMissionService,
    SectShopService,
    SectBossService,
    SectWarContributionService,
    PrismaService,
  ],
  exports: [SectService, SectMissionService, SectShopService, SectBossService, SectWarContributionService],
})
export class SectModule {}
