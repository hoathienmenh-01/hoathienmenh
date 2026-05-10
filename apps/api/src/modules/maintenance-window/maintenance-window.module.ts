/**
 * Phase 15.5 — Maintenance Window runtime module.
 *
 * Provides:
 *   - `MaintenanceWindowService` — CRUD, cron recompute, request gate,
 *     active window cache.
 *   - `MaintenanceWindowPublicController` — `GET /maintenance/status`
 *     (public-safe; không yêu cầu auth).
 *
 * Exports `MaintenanceWindowService` để middleware
 * (`MaintenanceWindowGuardMiddleware`) và admin controller
 * (`MaintenanceWindowAdminModule`) reuse.
 *
 * Admin endpoints (`/admin/maintenance-windows*`) thuộc module riêng
 * `MaintenanceWindowAdminModule` để tránh circular import với
 * AdminModule (mirror Phase 15.4 split FeatureFlag/FeatureFlagAdmin).
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { MaintenanceWindowPublicController } from './maintenance-window-public.controller';
import { MaintenanceWindowService } from './maintenance-window.service';

@Module({
  controllers: [MaintenanceWindowPublicController],
  providers: [PrismaService, MaintenanceWindowService],
  exports: [MaintenanceWindowService],
})
export class MaintenanceWindowModule {}
