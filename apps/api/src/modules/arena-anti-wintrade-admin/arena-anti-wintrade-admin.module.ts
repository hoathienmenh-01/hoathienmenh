/**
 * Phase 14.1.D — Arena Anti-Wintrade Admin module.
 *
 * Tách module riêng (KHÔNG gộp vào AdminModule / ArenaModule) vì:
 *   - AdminModule đã import ArenaModule cho season settle endpoint —
 *     gộp lại sẽ tạo cycle.
 *   - Pattern mirror `AdminEconomySafetyModule` (Phase 16.6).
 *
 * Wire `ArenaAntiWintradeAdminController` (admin endpoints scan + list +
 * ack + resolve). Inject `ArenaAntiWintradeService` từ `ArenaModule`
 * (đã export). Inject `AdminGuard` từ `AdminModule` (đã export).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ArenaModule } from '../arena/arena.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { ArenaAntiWintradeAdminController } from './arena-anti-wintrade.admin.controller';

@Module({
  imports: [AdminModule, ArenaModule, AuthModule],
  controllers: [ArenaAntiWintradeAdminController],
  providers: [PrismaService],
})
export class ArenaAntiWintradeAdminModule {}
