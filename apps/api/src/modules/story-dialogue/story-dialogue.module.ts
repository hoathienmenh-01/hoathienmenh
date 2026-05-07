import { Module } from '@nestjs/common';
import { StoryDialogueController } from './story-dialogue.controller';
import { StoryDialogueService } from './story-dialogue.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';

/**
 * Phase 12 Story Dialogue Foundation — branching dialogue runtime.
 *
 * Imports:
 *   - `AuthModule` cho `AuthService` (cookie userId).
 *   - `CharacterModule` cho `CurrencyService` (give_reward grants linhThach/tienNgoc qua ledger).
 *
 * Quest step advance đi qua `prisma.questProgress.update` inline (cùng tx) —
 * KHÔNG re-enter QuestService để giữ atomicity. Validation (step kind, skip
 * guard) replicate trong `StoryDialogueService` (mirror QuestService.progress).
 */
@Module({
  imports: [AuthModule, CharacterModule],
  controllers: [StoryDialogueController],
  providers: [StoryDialogueService, PrismaService],
  exports: [StoryDialogueService],
})
export class StoryDialogueModule {}
