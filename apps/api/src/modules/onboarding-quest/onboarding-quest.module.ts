import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestController } from './onboarding-quest.controller';
import { OnboardingQuestService } from './onboarding-quest.service';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';

/**
 * Phase 34.0 — 7-Day Onboarding Questline Module.
 *
 * Wire catalog `ONBOARDING_TASKS` + `ONBOARDING_DAYS` (shared) vào runtime.
 * Tách bạch với Phase 12 `QuestModule` (catalog `QUESTS`) và Phase 33
 * `Phase33StoryModule` (catalog `STORY_QUEST_EXPANSION`).
 *
 * Reuse Phase 12 services qua module import singleton:
 *   - `CurrencyService` từ `CharacterModule` cho
 *     `applyTx('ONBOARDING_TASK_CLAIM')`.
 *   - Phase 44.1 — `TitleService` từ `CharacterModule` cho Day 7 unlock title.
 *
 * Phase 44.2 — `CharacterModule` qua forwardRef để break cycle:
 * `InventoryModule → forwardRef(OnboardingQuestModule)` +
 * `CharacterModule → forwardRef(InventoryModule)` tạo cycle 3-cạnh khi
 * Nest scan từ EconomyModule → InventoryModule → CharacterModule → ...
 */
@Module({
  imports: [AuthModule, forwardRef(() => CharacterModule), FeatureFlagModule],
  controllers: [OnboardingQuestController],
  providers: [OnboardingQuestService, PrismaService],
  exports: [OnboardingQuestService],
})
export class OnboardingQuestModule {}
