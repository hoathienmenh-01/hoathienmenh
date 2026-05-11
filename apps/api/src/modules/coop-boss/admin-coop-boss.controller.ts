import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  isCoopBossStatus,
  type CoopBossRunDetailResponse,
  type CoopBossRunListResponse,
  type CoopBossStatus,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { CoopBossError, CoopBossService } from './coop-boss.service';

const RunIdParam = z.string().min(1).max(80);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 20.2 — Admin Co-op Boss controller. Mọi route gắn
 * `@RequireAdmin()` — PLAYER/MOD đều 403.
 *
 * Routes:
 *   - `GET  /admin/coop/boss/runs` — list filter status / bossKey / partyId.
 *   - `GET  /admin/coop/boss/runs/:id` — detail run + contribution + rewards.
 *   - `POST /admin/coop/boss/runs/:id/recompute-contribution` —
 *     deterministic recompute `contributionScore` cho 1 run (không
 *     mutate tier / reward claim đã tạo).
 */
@UseGuards(AdminGuard)
@Controller('admin/coop/boss')
export class AdminCoopBossController {
  constructor(private readonly coopBoss: CoopBossService) {}

  private rethrowAsHttp(e: unknown): never {
    if (e instanceof CoopBossError) {
      const status =
        e.code === 'RUN_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        { ok: false, error: { code: e.code, message: e.code } },
        status,
      );
    }
    if (e instanceof HttpException) throw e;
    throw new HttpException(
      { ok: false, error: { code: 'INTERNAL' } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('runs')
  @RequireAdmin()
  async listRuns(
    @Query('status') status?: string,
    @Query('bossKey') bossKey?: string,
    @Query('partyId') partyId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ ok: true; data: CoopBossRunListResponse }> {
    const statusValue: CoopBossStatus | null =
      status && isCoopBossStatus(status) ? status : null;
    const lim = limit ? Number(limit) : undefined;
    const data = await this.coopBoss.adminListRuns({
      status: statusValue,
      bossKey: bossKey ?? null,
      partyId: partyId ?? null,
      limit: lim,
    });
    return { ok: true, data };
  }

  @Get('runs/:id')
  @RequireAdmin()
  async getRun(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: CoopBossRunDetailResponse }> {
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.adminGetRunDetail(parsed.data);
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/recompute-contribution')
  @RequireAdmin()
  async recompute(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { updated: number } }> {
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.adminRecomputeContribution(parsed.data);
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }
}
