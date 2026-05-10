/**
 * Phase 15.5 — Public endpoint cho Maintenance Window status.
 *
 * `GET /maintenance/status`:
 *   - Public-safe payload `MaintenanceWindowPublicView`:
 *     `{ active, severity, target, titleVi, titleEn, messageVi, messageEn,
 *        startsAt, endsAt, serverTime, allowAdminBypass }`.
 *   - KHÔNG expose `id`, `createdByAdminId`, `disabledAt`,
 *     `allowHealthcheck`, `allowMetrics` (internal middleware config).
 *   - Không yêu cầu auth — FE (kể cả viewer chưa login) cần biết để
 *     render overlay/banner.
 *   - Endpoint LUÔN pass middleware bảo trì (xem
 *     `MaintenanceWindowGuardMiddleware`).
 */
import { Controller, Get } from '@nestjs/common';
import type { MaintenanceWindowPublicView } from '@xuantoi/shared';
import { MaintenanceWindowService } from './maintenance-window.service';

@Controller()
export class MaintenanceWindowPublicController {
  constructor(private readonly service: MaintenanceWindowService) {}

  @Get('maintenance/status')
  async status(): Promise<{
    ok: true;
    data: MaintenanceWindowPublicView;
  }> {
    const view = await this.service.publicStatus();
    return { ok: true, data: view };
  }
}
