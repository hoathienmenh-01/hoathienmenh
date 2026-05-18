import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NpcAffinityModule } from '../npc-affinity/npc-affinity.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PrismaService } from '../../common/prisma.service';
import { Phase33StoryController } from './story-v2.controller';
import { Phase33StoryService } from './story-v2.service';

/**
 * Phase 33.1 — Story V2 Runtime Module.
 *
 * Wire Phase 33 catalog (`STORY_QUEST_EXPANSION` + `STORY_QUEST_DIALOGUES` đã
 * ship qua PR A #567) vào runtime. Hoàn toàn tách bạch với Phase 12 `QuestModule`
 * (Phase 12 dùng catalog `QUESTS` + `QuestProgress` table).
 *
 * Reuse Phase 12 services qua module import singleton:
 *   - `CurrencyService` từ `CharacterModule` cho `applyTx(STORY_V2_QUEST_CLAIM)`.
 *   - `InventoryService` từ `InventoryModule` cho `grantTx(STORY_V2_QUEST_CLAIM)`.
 *   - `NpcAffinityService` từ `NpcAffinityModule` cho `addAffinityTx(QUEST_REWARD)`.
 */
@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, NpcAffinityModule, OnboardingQuestModule, FeatureFlagModule],
  controllers: [Phase33StoryController],
  providers: [Phase33StoryService, PrismaService],
  exports: [Phase33StoryService],
})
export class Phase33StoryModule {}
