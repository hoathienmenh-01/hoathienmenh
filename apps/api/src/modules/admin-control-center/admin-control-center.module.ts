/**
 * Phase 27.6 — Admin Control Center V2 module.
 *
 * Tách ra khỏi `AdminModule` (Phase 18.x) để KHÔNG tạo cycle với
 * `CharacterModule`/`InventoryModule`/`MailModule`/`ArenaModule` — chỉ
 * cần `AuthModule` (cho `AuthService.userIdFromAccess`) + `PrismaService`.
 *
 * KHÔNG re-export `AdminGuard` cũ — module này dùng `AdminPermissionGuard`
 * riêng (granular permission, không phải role binary ADMIN/MOD).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminPermissionGuard } from './admin-permission.guard';
import { AdminAuditWriter } from './admin-audit-writer.service';
import { AdminOverviewService } from './admin-overview.service';
import { RewardProfileService } from './reward-profile.service';
import { DropProfileService } from './drop-profile.service';
import { ContentStatusService } from './content-status.service';
import { AdminControlCenterController } from './admin-control-center.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminControlCenterController],
  providers: [
    PrismaService,
    AdminPermissionGuard,
    AdminAuditWriter,
    AdminOverviewService,
    RewardProfileService,
    DropProfileService,
    ContentStatusService,
  ],
  exports: [
    AdminPermissionGuard,
    AdminAuditWriter,
    AdminOverviewService,
    RewardProfileService,
    DropProfileService,
    ContentStatusService,
  ],
})
export class AdminControlCenterModule {}
