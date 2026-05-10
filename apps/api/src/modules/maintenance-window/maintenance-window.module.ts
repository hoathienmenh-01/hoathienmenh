/**
 * Phase 15.5 — Maintenance Window runtime module.
 *
 * Provides:
 *   - `MaintenanceWindowService` — CRUD, cron recompute, request gate,
 *     active window cache.
 *   - `MaintenanceWindowPublicController` — `GET /maintenance/status`
 *     (public-safe; không yêu cầu auth).
 *   - `MaintenanceWindowGuardMiddleware` — global middleware chặn
 *     player khi window ACTIVE (admin bypass, health/metrics/status
 *     vẫn pass).
 *
 * Exports `MaintenanceWindowService` để admin module
 * (`MaintenanceWindowAdminModule`) reuse.
 *
 * Admin endpoints (`/admin/maintenance-windows*`) thuộc module riêng
 * `MaintenanceWindowAdminModule` để tránh circular import với
 * AdminModule (mirror Phase 15.4 split FeatureFlag/FeatureFlagAdmin).
 *
 * Middleware import `AuthModule` để inject `AuthService` (parse access
 * cookie). AuthModule KHÔNG import MaintenanceWindowModule → an toàn cycle.
 */
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { MaintenanceWindowGuardMiddleware } from './maintenance-window.middleware';
import { MaintenanceWindowPublicController } from './maintenance-window-public.controller';
import { MaintenanceWindowService } from './maintenance-window.service';
import { ConfigVersionModule } from '../config-version/config-version.module';

@Module({
  // Phase 15.6 — ConfigVersion persistence for create/update/disable/recompute.
  imports: [AuthModule, ConfigVersionModule],
  controllers: [MaintenanceWindowPublicController],
  providers: [
    PrismaService,
    MaintenanceWindowService,
    MaintenanceWindowGuardMiddleware,
  ],
  exports: [MaintenanceWindowService],
})
export class MaintenanceWindowModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `forRoutes('*')` — middleware chạy cho mọi route đi qua Nest router.
    // Bypass logic (healthcheck, metrics, status, auth) đã được gói gọn
    // trong `MaintenanceWindowService.isMaintenanceActiveForRequest`.
    consumer.apply(MaintenanceWindowGuardMiddleware).forRoutes('*');
  }
}
