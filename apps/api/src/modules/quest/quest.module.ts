import { Module } from '@nestjs/common';
import { QuestController } from './quest.controller';
import { QuestService } from './quest.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';

// Phase 12 PR-3 — claim path injects `CurrencyService` (CharacterModule) +
// `InventoryService` (InventoryModule). Đã có `forwardRef` giữa
// CharacterModule ↔ InventoryModule cho AchievementService item rewards;
// QuestModule import trực tiếp 2 module này để chia sẻ provider singleton.
@Module({
  imports: [AuthModule, CharacterModule, InventoryModule],
  controllers: [QuestController],
  providers: [QuestService, PrismaService],
  exports: [QuestService],
})
export class QuestModule {}
