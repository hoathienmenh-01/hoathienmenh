/**
 * Phase 15.5 — Maintenance Window admin module.
 *
 * Tách ra khỏi `MaintenanceWindowModule` để tránh cycle với
 * AdminModule (mirror Phase 15.4 split FeatureFlag/FeatureFlagAdmin).
 *
 *   - `MaintenanceWindowModule` chỉ giữ `MaintenanceWindowService` +
 *     public controller (no AdminModule import) — middleware
 *     (`MaintenanceWindowGuardMiddleware`) inject service mà không kéo
 *     theo cycle.
 *   - `MaintenanceWindowAdminModule` import `AdminModule` cho
 *     `AdminGuard` + `MaintenanceWindowModule` cho service.
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceWindowModule } from '../maintenance-window/maintenance-window.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminMaintenanceWindowController } from './admin-maintenance-window.controller';

@Module({
  imports: [AdminModule, AuthModule, MaintenanceWindowModule],
  controllers: [AdminMaintenanceWindowController],
  providers: [PrismaService],
})
export class MaintenanceWindowAdminModule {}
