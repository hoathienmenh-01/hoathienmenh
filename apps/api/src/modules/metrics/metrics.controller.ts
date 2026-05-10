/**
 * Phase 17.5 — Metrics controller. ADMIN-only endpoint trả snapshot
 * runtime metrics (system + api + ws + queue + cron) dạng JSON.
 *
 * Path: `GET /api/admin/metrics` (global prefix `api` ở `main.ts`).
 *
 * Auth:
 *   - `@UseGuards(AdminGuard)` — UNAUTH → 401, banned → 403.
 *   - `@RequireAdmin()` — MOD bị reject 403 (tiếp tục pattern Phase 16.6).
 *   - PLAYER không có cookie admin role → 403.
 *
 * Security:
 *   - Payload chỉ chứa số / string ngắn / boolean, KHÔNG có
 *     env / cookie / token / PII / requestId / userId — xem
 *     `metrics.types.ts`.
 *   - KHÔNG có audit log: endpoint read-only, polled cao tần (mỗi 30s
 *     bởi monitoring) — log audit sẽ ngập DB.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { MetricsService } from './metrics.service';
import type { MetricsSnapshot } from './metrics.types';

@UseGuards(AdminGuard)
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('admin/metrics')
  @RequireAdmin()
  async getMetrics(): Promise<{ ok: true; data: MetricsSnapshot }> {
    const data = await this.metrics.collectAll();
    return { ok: true, data };
  }
}
