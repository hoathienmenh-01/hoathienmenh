import { Module } from '@nestjs/common';
import { NpcController } from './npc.controller';
import { NpcService } from './npc.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

// Phase 12 PR-4 — NPC dialogue UI runtime. Read-only service: chỉ đọc
// `QuestProgress` để annotate dialogue branch + choice availability. Không cần
// CharacterModule / InventoryModule (mutation flow vẫn qua QuestModule).
@Module({
  imports: [AuthModule],
  controllers: [NpcController],
  providers: [NpcService, PrismaService],
  exports: [NpcService],
})
export class NpcModule {}
