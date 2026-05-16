import { Module } from '@nestjs/common';
import { SectSeasonService } from './sect-season.service';
import { SectSeasonHistoryService } from './sect-season-history.service';
import { SectSeasonRewardService } from './sect-season-reward.service';
import { SectSeasonController } from './sect-season.controller';
import { AdminSectSeasonController } from './admin-sect-season.controller';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';

// Phase 13.2.B — wire `CurrencyService` / `TitleService` / `BuffService` từ
// CharacterModule + `InventoryService` từ InventoryModule cho
// `SectSeasonService.claimMilestone` reward grant. Constructor inject
// `@Optional()` để Phase 13.2.A read-only test (chỉ Prisma) vẫn pass.
//
// Phase 15.7 — SectSeasonRewardService runs Champion / MVP grant cho
// snapshot đã chốt. Reward delivery 100% qua Mail (không touch
// CurrencyService trực tiếp — player tự MAIL_CLAIM).
@Module({
  imports: [AdminModule, AuthModule, CharacterModule, InventoryModule],
  controllers: [SectSeasonController, AdminSectSeasonController],
  providers: [
    SectSeasonService,
    SectSeasonHistoryService,
    SectSeasonRewardService,
    PrismaService,
  ],
  exports: [
    SectSeasonService,
    SectSeasonHistoryService,
    SectSeasonRewardService,
  ],
})
export class SectSeasonModule {}
