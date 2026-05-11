import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  isTerritoryPeriodKey,
  previousTerritoryPeriodKey,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import { readLiveOpsCronConfig } from './liveops-cron.config';
import {
  LiveOpsCronService,
  type SectSeasonCycleSummary,
  type TerritoryCycleSummary,
  type WeeklyCycleSummary,
} from './liveops-cron.service';

/**
 * Phase 13.2.D + 14.0.F — Admin endpoints để force-run cron tay.
 *
 * Endpoints (ADMIN only — `@RequireAdmin()` gate, MOD bị reject với
 * `ADMIN_ONLY` 403):
 *   - `POST /admin/liveops/run-weekly-cycle` — chạy 1 chu kỳ tuần đầy
 *     đủ (territory + sect season).
 *   - `POST /admin/territory/cron/run-now` — chỉ chạy territory cycle.
 *   - `POST /admin/sect-season/cron/run-now` — chỉ chạy sect season cycle.
 *
 * Body (JSON, optional):
 *   - `periodKey?: string` — territory period override (default
 *     `previousTerritoryPeriodKey()`).
 *   - `bypassLease?: boolean` — bỏ qua Redis lease (dev/test). DB unique
 *     guard vẫn idempotent — KHÔNG TIN cron chạy đúng 1 lần.
 *
 * Audit: ghi `AdminAuditLog` action `ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE` /
 * `ADMIN_TERRITORY_CRON_RUN` / `ADMIN_SECT_SEASON_CRON_RUN` với meta
 * snapshot summary (counts) — không log secret.
 */

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const RunBodyZ = z
  .object({
    periodKey: z.string().min(1).max(64).optional(),
    bypassLease: z.boolean().optional(),
  })
  .strict();

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

@UseGuards(AdminGuard)
@Controller()
export class AdminLiveOpsCronController {
  constructor(
    private readonly cron: LiveOpsCronService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('admin/liveops/run-weekly-cycle')
  @RequireAdmin()
  async runWeeklyCycle(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: WeeklyCycleSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = RunBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    if (
      parsed.data.periodKey !== undefined &&
      !isTerritoryPeriodKey(parsed.data.periodKey)
    ) {
      fail('PERIOD_INVALID', HttpStatus.BAD_REQUEST);
    }

    const data = await this.cron.runWeeklyCycle({
      periodKey: parsed.data.periodKey,
      triggeredBy: req.userId,
      bypassLease: parsed.data.bypassLease === true,
    });
    await this.audit(req.userId, 'ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE', {
      periodKey: data.territory.periodKey,
      bypassLease: parsed.data.bypassLease === true,
      skippedAlreadyDone: data.skippedAlreadyDone,
      territorySettled: data.territory.territorySettled,
      territoryDecaySkipped: data.territory.territoryDecaySkipped,
      rewardMailsCreated: data.territory.rewardMailsCreated,
      seasonSnapshotsCreated: data.sectSeason.seasonSnapshotsCreated,
      errors:
        data.territory.errors.length + data.sectSeason.errors.length,
    });
    return { ok: true, data };
  }

  @Post('admin/territory/cron/run-now')
  @RequireAdmin()
  async runTerritoryNow(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: TerritoryCycleSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = RunBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    if (
      parsed.data.periodKey !== undefined &&
      !isTerritoryPeriodKey(parsed.data.periodKey)
    ) {
      fail('PERIOD_INVALID', HttpStatus.BAD_REQUEST);
    }
    const data = await this.cron.runTerritoryCycle({
      periodKey: parsed.data.periodKey,
      triggeredBy: req.userId,
      bypassLease: parsed.data.bypassLease === true,
    });
    await this.audit(req.userId, 'ADMIN_TERRITORY_CRON_RUN', {
      periodKey: data.periodKey,
      bypassLease: parsed.data.bypassLease === true,
      territorySettled: data.territorySettled,
      territoryDecaySkipped: data.territoryDecaySkipped,
      rewardMailsCreated: data.rewardMailsCreated,
      errors: data.errors.length,
    });
    return { ok: true, data };
  }

  @Post('admin/sect-season/cron/run-now')
  @RequireAdmin()
  async runSectSeasonNow(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: SectSeasonCycleSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = RunBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.cron.runSectSeasonCycle({
      triggeredBy: req.userId,
      bypassLease: parsed.data.bypassLease === true,
    });
    await this.audit(req.userId, 'ADMIN_SECT_SEASON_CRON_RUN', {
      bypassLease: parsed.data.bypassLease === true,
      seasonSnapshotsCreated: data.seasonSnapshotsCreated,
      seasonSnapshotsSkipped: data.seasonSnapshotsSkipped,
      seasonsProcessed: data.seasonsProcessed.length,
      errors: data.errors.length,
    });
    return { ok: true, data };
  }

  /**
   * Phase 15.7 — GET /admin/territory/cron/status. Read-only snapshot
   * để admin observe automation health.
   */
  @Get('admin/territory/cron/status')
  @RequireAdmin()
  async territoryCronStatus(): Promise<{
    ok: true;
    data: {
      enabled: boolean;
      cron: string;
      timezone: string;
      previousPeriodKey: string;
      lastSettlement: { periodKey: string; settledAt: string } | null;
      lastDecay: { periodKey: string; appliedAt: string } | null;
      lastReward: { periodKey: string; grantedAt: string } | null;
    };
  }> {
    const cfg = readLiveOpsCronConfig();
    const previousPeriodKey = previousTerritoryPeriodKey();
    const [lastSettlementRow, lastDecayRow, lastRewardRow] = await Promise.all([
      this.prisma.sectTerritorySettlementSnapshot.findFirst({
        orderBy: { periodKey: 'desc' },
        select: { periodKey: true, settledAt: true },
      }),
      this.prisma.sectTerritoryDecayLog.findFirst({
        orderBy: { periodKey: 'desc' },
        select: { periodKey: true, triggeredAt: true },
      }),
      this.prisma.territoryOwnerRewardGrant.findFirst({
        orderBy: { grantedAt: 'desc' },
        select: { periodKey: true, grantedAt: true },
      }),
    ]);
    return {
      ok: true,
      data: {
        enabled: cfg.territoryEnabled,
        cron: cfg.territoryCron,
        timezone: cfg.timezone,
        previousPeriodKey,
        lastSettlement: lastSettlementRow
          ? {
              periodKey: lastSettlementRow.periodKey,
              settledAt: lastSettlementRow.settledAt.toISOString(),
            }
          : null,
        lastDecay: lastDecayRow
          ? {
              periodKey: lastDecayRow.periodKey,
              appliedAt: lastDecayRow.triggeredAt.toISOString(),
            }
          : null,
        lastReward: lastRewardRow
          ? {
              periodKey: lastRewardRow.periodKey,
              grantedAt: lastRewardRow.grantedAt.toISOString(),
            }
          : null,
      },
    };
  }

  /**
   * Phase 15.7 — GET /admin/sect-season/cron/status. Read-only snapshot.
   */
  @Get('admin/sect-season/cron/status')
  @RequireAdmin()
  async sectSeasonCronStatus(): Promise<{
    ok: true;
    data: {
      enabled: boolean;
      cron: string;
      timezone: string;
      lastSnapshot: { seasonKey: string; finalizedAt: string } | null;
      lastChampionGrant: {
        seasonKey: string;
        grantedAt: string;
      } | null;
      lastMvpGrant: { seasonKey: string; grantedAt: string } | null;
    };
  }> {
    const cfg = readLiveOpsCronConfig();
    const [lastSnapshotRow, lastChampRow, lastMvpRow] = await Promise.all([
      this.prisma.sectSeasonSnapshot.findFirst({
        orderBy: { finalizedAt: 'desc' },
        select: { seasonKey: true, finalizedAt: true },
      }),
      this.prisma.sectSeasonRewardGrant.findFirst({
        where: { rewardType: 'CHAMPION' },
        orderBy: { grantedAt: 'desc' },
        select: { seasonKey: true, grantedAt: true },
      }),
      this.prisma.sectSeasonRewardGrant.findFirst({
        where: { rewardType: 'MVP' },
        orderBy: { grantedAt: 'desc' },
        select: { seasonKey: true, grantedAt: true },
      }),
    ]);
    return {
      ok: true,
      data: {
        enabled: cfg.sectSeasonEnabled,
        cron: cfg.sectSeasonCron,
        timezone: cfg.timezone,
        lastSnapshot: lastSnapshotRow
          ? {
              seasonKey: lastSnapshotRow.seasonKey,
              finalizedAt: lastSnapshotRow.finalizedAt.toISOString(),
            }
          : null,
        lastChampionGrant: lastChampRow
          ? {
              seasonKey: lastChampRow.seasonKey,
              grantedAt: lastChampRow.grantedAt.toISOString(),
            }
          : null,
        lastMvpGrant: lastMvpRow
          ? {
              seasonKey: lastMvpRow.seasonKey,
              grantedAt: lastMvpRow.grantedAt.toISOString(),
            }
          : null,
      },
    };
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          actorUserId,
          action,
          // Json compatible — không có secret/PII.
          meta: meta as never,
        },
      });
    } catch {
      // Audit fail-soft: cron run summary đã trả về cho client; audit
      // log chỉ là paper trail. Nuốt lỗi để không lật ngược kết quả.
    }
  }
}
