/**
 * Phase 29.0 — PvP Foundation V1 module.
 *
 * Unified PvP layer cho non-arena modes. ARENA tiếp tục ở ArenaModule
 * riêng (Phase 14.1.B/C). SECT_WAR / TERRITORY_WAR / EVENT_PVP gọi service
 * layer này khi cần (KHÔNG expose endpoint trực tiếp).
 *
 * Module phụ thuộc:
 *   - AuthModule (cho `AuthService.userIdFromAccess`).
 *   - AdminControlCenterModule (re-use `AdminPermissionGuard` + audit writer).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { PrismaService } from '../../common/prisma.service';
import { PvpSnapshotService } from './snapshot.service';
import { PvpDefenseService } from './defense.service';
import { PvpBattleService } from './battle.service';
import { PvpAnomalyService } from './anomaly.service';
import { PvpPlayerController } from './pvp.player.controller';
import { PvpAdminController } from './pvp.admin.controller';

@Module({
  imports: [AuthModule, AdminControlCenterModule],
  controllers: [PvpPlayerController, PvpAdminController],
  providers: [
    PrismaService,
    PvpSnapshotService,
    PvpDefenseService,
    PvpBattleService,
    PvpAnomalyService,
  ],
  exports: [
    PvpSnapshotService,
    PvpDefenseService,
    PvpBattleService,
    PvpAnomalyService,
  ],
})
export class PvpModule {}
