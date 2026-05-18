import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AdminLiveOpsService } from './admin-liveops.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { TopupModule } from '../topup/topup.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GiftCodeModule } from '../giftcode/giftcode.module';
import { MailModule } from '../mail/mail.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuestModule } from '../quest/quest.module';
import { MissionModule } from '../mission/mission.module';
import { ArenaModule } from '../arena/arena.module';
import { PrismaService } from '../../common/prisma.service';

// Phase 13.1.B — register `AdminLiveOpsService` for liveops controls +
// sect-war read-only status / recalculate placeholder.
// Phase 14.1.C — wire `ArenaSeasonService` qua `ArenaModule` cho admin
// endpoints `POST /admin/arena/season/settle` + `POST /admin/arena/season/create-next`.
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    TopupModule,
    RealtimeModule,
    GiftCodeModule,
    MailModule,
    InventoryModule,
    QuestModule,
    MissionModule,
    ArenaModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, AdminLiveOpsService, PrismaService],
  exports: [AdminGuard, AdminLiveOpsService],
})
export class AdminModule {}
