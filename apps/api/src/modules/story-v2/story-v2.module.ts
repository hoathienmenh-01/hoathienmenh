import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NpcAffinityModule } from '../npc-affinity/npc-affinity.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PrismaService } from '../../common/prisma.service';
import { Phase33StoryController } from './story-v2.controller';
import { Phase33StoryService } from './story-v2.service';
import { StoryV2ResetScheduler } from './story-v2-reset.scheduler';
import { StoryV2ResetProcessor } from './story-v2-reset.processor';
import { STORY_V2_RESET_QUEUE } from './story-v2-reset.queue';

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
 *
 * Phase 33.4 — Daily/weekly reset via BullMQ (mirror MissionModule pattern).
 */
@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    NpcAffinityModule,
    OnboardingQuestModule,
    FeatureFlagModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: STORY_V2_RESET_QUEUE }),
  ],
  controllers: [Phase33StoryController],
  providers: [
    Phase33StoryService,
    StoryV2ResetScheduler,
    StoryV2ResetProcessor,
    PrismaService,
  ],
  exports: [Phase33StoryService],
})
export class Phase33StoryModule {}
