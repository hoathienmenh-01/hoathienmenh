import { forwardRef, Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CharacterModule } from '../character/character.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';

// Phase 11.10.D — forwardRef CharacterModule để break circular dep:
// CharacterModule imports forwardRef(InventoryModule) cho AchievementService.
// Phase 44.2 — forwardRef OnboardingQuestModule để break circular dep:
// OnboardingQuestModule imports CharacterModule → CharacterModule forwardRef
// InventoryModule. forwardRef giữ wiring an toàn cho Optional inject.
@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    forwardRef(() => CharacterModule),
    forwardRef(() => OnboardingQuestModule),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, PrismaService],
  exports: [InventoryService],
})
export class InventoryModule {}
