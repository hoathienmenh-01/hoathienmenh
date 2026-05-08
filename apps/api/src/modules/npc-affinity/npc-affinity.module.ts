import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { NpcAffinityController } from './npc-affinity.controller';
import { NpcAffinityService } from './npc-affinity.service';

/**
 * Phase 12.10.A — NPC Affinity & Relationship Foundation.
 *
 * Imports:
 *   - `AuthModule` cho `AuthService` (cookie userId).
 *
 * Exports:
 *   - `NpcAffinityService` — `StoryDialogueModule` (Phase 12.10.A integration)
 *     và `QuestModule` (quest reward affinity, opt-in) consume.
 */
@Module({
  imports: [AuthModule],
  controllers: [NpcAffinityController],
  providers: [NpcAffinityService, PrismaService],
  exports: [NpcAffinityService],
})
export class NpcAffinityModule {}
