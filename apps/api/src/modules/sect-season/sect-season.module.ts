import { Module } from '@nestjs/common';
import { SectSeasonService } from './sect-season.service';
import { SectSeasonController } from './sect-season.controller';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';

// Phase 13.2.B — wire `CurrencyService` / `TitleService` / `BuffService` từ
// CharacterModule + `InventoryService` từ InventoryModule cho
// `SectSeasonService.claimMilestone` reward grant. Constructor inject
// `@Optional()` để Phase 13.2.A read-only test (chỉ Prisma) vẫn pass.
@Module({
  imports: [AuthModule, CharacterModule, InventoryModule],
  controllers: [SectSeasonController],
  providers: [SectSeasonService, PrismaService],
  exports: [SectSeasonService],
})
export class SectSeasonModule {}
