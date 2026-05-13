/**
 * Phase 43 — System Status admin controller.
 *
 * Endpoints (global prefix `api` → `/api/admin/system/*`):
 *
 *   - `GET /admin/system/status`                  — aggregate snapshot.
 *   - `GET /admin/system/errors`                  — recent error events.
 *   - `GET /admin/system/errors/:id`              — single event detail.
 *   - `GET /admin/system/integrity/last-run`      — kết quả integrity
 *                                                   check gần nhất (ghi
 *                                                   bởi `scripts/integrity-check.mjs`).
 *
 * Auth: `AdminGuard` — ADMIN hoặc MOD đều xem được (read-only ops). KHÔNG
 * dùng `@RequireAdmin()` (đó là chỉ ADMIN, dành cho action thay đổi
 * tài sản). Endpoints không thay đổi state → không cần audit log.
 *
 * `@SkipRateLimit()` ở class-level: admin polling status panel cao
 * tần, monitoring có thể scrape `/admin/system/status` — không được
 * 429.
 */
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../admin/admin.guard';
import { SkipRateLimit } from '../security/rate-limit-policy.decorator';
import {
  SystemErrorListResult,
  SystemErrorRow,
  SystemIntegrityLastRun,
  SystemStatusService,
  SystemStatusSnapshot,
} from './system-status.service';

const ListErrorsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  severity: z.enum(['INFO', 'WARN', 'ERROR', 'FATAL']).optional(),
  type: z.string().min(1).max(64).optional(),
  since: z.string().min(1).max(64).optional(),
});

@UseGuards(AdminGuard)
@SkipRateLimit()
@Controller('admin/system')
export class SystemStatusController {
  constructor(private readonly status: SystemStatusService) {}

  @Get('status')
  async getStatus(): Promise<{ ok: true; data: SystemStatusSnapshot }> {
    const data = await this.status.getStatus();
    return { ok: true, data };
  }

  @Get('errors')
  async listErrors(
    @Query() query: unknown,
  ): Promise<{ ok: true; data: SystemErrorListResult }> {
    const parsed = ListErrorsQuery.safeParse(query);
    if (!parsed.success) {
      throw new HttpException(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'INVALID_INPUT' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = await this.status.listErrors(parsed.data);
    return { ok: true, data };
  }

  @Get('errors/:id')
  async getError(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: SystemErrorRow }> {
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) {
      throw new HttpException(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'INVALID_INPUT' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const list = await this.status.listErrors({ limit: 100 });
    const row = list.rows.find((r) => r.id === id);
    if (!row) {
      throw new HttpException(
        { ok: false, error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true, data: row };
  }

  @Get('integrity/last-run')
  async lastIntegrityRun(): Promise<{
    ok: true;
    data: SystemIntegrityLastRun | null;
  }> {
    const data = await this.status.getIntegrityLastRun();
    return { ok: true, data };
  }
}
