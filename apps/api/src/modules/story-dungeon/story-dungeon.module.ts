import { Module } from '@nestjs/common';
import { StoryDungeonController } from './story-dungeon.controller';
import { StoryDungeonService } from './story-dungeon.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Phase 12.8.A Story Dungeon Catalog + API Foundation.
 *
 * Read-only module — KHÔNG có quest/inventory/currency dependency vì:
 *   - `listForUser` / `getByKey` chỉ đọc `Character` + `QuestProgress` qua
 *     `PrismaService` trực tiếp (mirror DungeonRunService.listForUser
 *     read-only path).
 *   - Reward grant + runtime advance sẽ wire ở Phase 12.8.B (lúc đó cần
 *     import `CharacterModule` + `InventoryModule` + `QuestModule`).
 */
@Module({
  imports: [AuthModule],
  controllers: [StoryDungeonController],
  providers: [StoryDungeonService, PrismaService],
  exports: [StoryDungeonService],
})
export class StoryDungeonModule {}
