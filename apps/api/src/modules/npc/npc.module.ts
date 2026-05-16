import { Module } from '@nestjs/common';
import { NpcController } from './npc.controller';
import { NpcService } from './npc.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';

// Phase 12 PR-4 — NPC dialogue UI runtime. Read-only service: chỉ đọc
// `QuestProgress` để annotate dialogue branch + choice availability. Không cần
// CharacterModule / InventoryModule (mutation flow vẫn qua QuestModule).
// Phase 44.2 — Optional OnboardingQuestModule wire để `getDialogueForNpc`
// trigger `recordAction(NPC_TALK)` fire-and-forget.
@Module({
  imports: [AuthModule, OnboardingQuestModule],
  controllers: [NpcController],
  providers: [NpcService, PrismaService],
  exports: [NpcService],
})
export class NpcModule {}
