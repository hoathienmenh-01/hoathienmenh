import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  isEconomyAnomalySeverity,
  isEconomyAnomalySource,
  isEconomyIssueStatus,
  parseEconomyReportRange,
  type EconomyReportResponse,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  LedgerCheckerService,
  type LedgerCheckRunSummary,
} from '../economy/ledger-checker.service';
import {
  AnomalyScanSummary,
  EconomyAnomalyScannerService,
} from '../economy/economy-anomaly-scanner.service';
import { EconomyRangeReportService } from './economy-range-report.service';

/**
 * Phase 16.6 — Admin Economy Safety endpoints.
 *
 * Tất cả route gắn `@RequireAdmin()` — PLAYER + MOD đều bị reject 403
 * (action ảnh hưởng tài sản nhạy cảm; MOD KHÔNG view ledger panel).
 *
 * Audit `AdminAuditLog` cho mọi POST: trace `actorUserId, action, meta`
 * để admin team kiểm chéo.
 *
 * Policy: detection + reporting only. KHÔNG có endpoint auto-fix data
 * trong Phase 16.6 (refund/ban xảy ra qua endpoint khác đã có sẵn).
 */

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const RunBodyZ = z
  .object({
    forceRerun: z.boolean().optional(),
    dayBucket: z.string().min(1).max(20).optional(),
  })
  .strict();

const ScanBodyZ = z
  .object({
    windowKey: z.string().min(1).max(64).optional(),
    windowMs: z.number().int().positive().max(7 * 24 * 3600 * 1000).optional(),
  })
  .strict();

const IssueListQueryZ = z
  .object({
    severity: z.string().min(1).max(16).optional(),
    status: z.string().min(1).max(20).optional(),
    type: z.string().min(1).max(64).optional(),
    runId: z.string().min(1).max(40).optional(),
    limit: z
      .union([z.number(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined) return 50;
        const n = typeof v === 'string' ? Number(v) : v;
        if (!Number.isFinite(n) || n < 1) return 50;
        return Math.min(Math.floor(n), 200);
      }),
  })
  .strict();

const AnomalyListQueryZ = z
  .object({
    severity: z.string().min(1).max(16).optional(),
    status: z.string().min(1).max(20).optional(),
    source: z.string().min(1).max(40).optional(),
    limit: z
      .union([z.number(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined) return 50;
        const n = typeof v === 'string' ? Number(v) : v;
        if (!Number.isFinite(n) || n < 1) return 50;
        return Math.min(Math.floor(n), 200);
      }),
  })
  .strict();

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminEconomySafetyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerCheckerService,
    private readonly scanner: EconomyAnomalyScannerService,
    private readonly rangeReport: EconomyRangeReportService,
  ) {}

  // ---------- Ledger Check ----------

  @Post('admin/economy/ledger-check/run')
  @RequireAdmin()
  async runLedgerCheck(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: LedgerCheckRunSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = RunBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.ledger.runCheck({
      triggeredBy: req.userId,
      forceRerun: parsed.data.forceRerun === true,
    });
    await this.audit(req.userId, 'ADMIN_ECONOMY_LEDGER_CHECK_RUN', {
      runId: data.runId,
      dayBucket: data.dayBucket,
      status: data.status,
      issuesCreated: data.issuesCreated,
      forceRerun: parsed.data.forceRerun === true,
      alreadyDone: data.alreadyDone,
    });
    return { ok: true, data };
  }

  @Get('admin/economy/ledger-check/latest')
  @RequireAdmin()
  async getLatestRun(): Promise<{
    ok: true;
    data: {
      run: {
        id: string;
        dayBucket: string;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        summaryJson: unknown;
        triggeredBy: string | null;
      } | null;
      openIssues: number;
    };
  }> {
    const run = await this.prisma.economyLedgerCheckRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });
    if (!run) {
      return { ok: true, data: { run: null, openIssues: 0 } };
    }
    const openIssues = await this.prisma.economyLedgerCheckIssue.count({
      where: { runId: run.id, status: 'OPEN' },
    });
    return {
      ok: true,
      data: {
        run: {
          id: run.id,
          dayBucket: run.dayBucket,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          summaryJson: run.summaryJson,
          triggeredBy: run.triggeredBy,
        },
        openIssues,
      },
    };
  }

  @Get('admin/economy/ledger-check/issues')
  @RequireAdmin()
  async listIssues(@Query() rawQuery: unknown): Promise<{
    ok: true;
    data: {
      items: Array<{
        id: string;
        runId: string;
        severity: string;
        type: string;
        characterId: string | null;
        detailsJson: unknown;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    };
  }> {
    const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
    const parsed = IssueListQueryZ.safeParse(q);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const where: Record<string, unknown> = {};
    if (
      parsed.data.severity &&
      isEconomyAnomalySeverity(parsed.data.severity)
    ) {
      where.severity = parsed.data.severity;
    }
    if (parsed.data.status && isEconomyIssueStatus(parsed.data.status)) {
      where.status = parsed.data.status;
    }
    if (parsed.data.type) where.type = parsed.data.type;
    if (parsed.data.runId) where.runId = parsed.data.runId;
    const [items, total] = await Promise.all([
      this.prisma.economyLedgerCheckIssue.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit,
      }),
      this.prisma.economyLedgerCheckIssue.count({ where }),
    ]);
    return {
      ok: true,
      data: {
        items: items.map((i) => ({
          id: i.id,
          runId: i.runId,
          severity: i.severity,
          type: i.type,
          characterId: i.characterId,
          detailsJson: i.detailsJson,
          status: i.status,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        })),
        total,
      },
    };
  }

  @Post('admin/economy/ledger-check/issues/:id/ack')
  @RequireAdmin()
  async ackIssue(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'ACKNOWLEDGED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.economyLedgerCheckIssue.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED' },
    });
    if (updated.count === 0) {
      fail('ISSUE_NOT_FOUND_OR_NOT_OPEN', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ECONOMY_ISSUE_ACK', { issueId: id });
    return { ok: true, data: { status: 'ACKNOWLEDGED' } };
  }

  @Post('admin/economy/ledger-check/issues/:id/resolve')
  @RequireAdmin()
  async resolveIssue(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'RESOLVED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.economyLedgerCheckIssue.updateMany({
      where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED' },
    });
    if (updated.count === 0) {
      fail('ISSUE_NOT_FOUND_OR_RESOLVED', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ECONOMY_ISSUE_RESOLVE', {
      issueId: id,
    });
    return { ok: true, data: { status: 'RESOLVED' } };
  }

  // ---------- Range Report (Phase 16.1.B) ----------

  /**
   * `GET /admin/economy/range-report?from=YYYY-MM-DD&to=YYYY-MM-DD`
   *
   * Date-range Economy Report (Phase 16.1.B). ADMIN-only.
   *
   * - Validate range via shared `parseEconomyReportRange` (max 31d, UTC).
   * - Default = last 7 days inclusive `today` UTC.
   * - Returns currency in/out by source bucket, totals, top 10 character
   *   net delta (linhThach), pre-defined category totals (market volume,
   *   shop spend, sect shop spend, reforge-enchant, admin grant, topup,
   *   liveops, daily login, dungeon, boss, territory, sect season),
   *   anomaly summary, latest ledger check run, `generatedAt`.
   * - Emits audit `ADMIN_ECONOMY_REPORT_VIEW`.
   */
  @Get('admin/economy/range-report')
  @RequireAdmin()
  async rangeReportEndpoint(
    @Req() req: AdminReq,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<{ ok: true; data: EconomyReportResponse }> {
    const parsed = parseEconomyReportRange(from, to);
    if (!parsed.ok || !parsed.range) {
      fail(
        parsed.error ?? 'INVALID_RANGE',
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = await this.rangeReport.generate(parsed.range);
    await this.audit(req.userId, 'ADMIN_ECONOMY_REPORT_VIEW', {
      from: data.range.from,
      to: data.range.to,
      days: data.range.days,
      totalInLinhThach: data.totalInLinhThach,
      totalOutLinhThach: data.totalOutLinhThach,
      openAnomalies: data.anomalySummary.openCount,
    });
    return { ok: true, data };
  }

  // ---------- Anomalies ----------

  @Post('admin/economy/anomalies/scan')
  @RequireAdmin()
  async runAnomalyScan(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: AnomalyScanSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = ScanBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.scanner.scanAll({
      windowKey: parsed.data.windowKey,
      windowMs: parsed.data.windowMs,
    });
    await this.audit(req.userId, 'ADMIN_ECONOMY_ANOMALY_SCAN_RUN', {
      windowKey: data.windowKey,
      totalAnomaliesCreated: data.totalAnomaliesCreated,
      totalAnomaliesSkipped: data.totalAnomaliesSkipped,
    });
    return { ok: true, data };
  }

  @Get('admin/economy/anomalies')
  @RequireAdmin()
  async listAnomalies(@Query() rawQuery: unknown): Promise<{
    ok: true;
    data: {
      items: Array<{
        id: string;
        severity: string;
        source: string;
        characterId: string | null;
        userId: string | null;
        detailsJson: unknown;
        status: string;
        windowKey: string;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    };
  }> {
    const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
    const parsed = AnomalyListQueryZ.safeParse(q);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const where: Record<string, unknown> = {};
    if (
      parsed.data.severity &&
      isEconomyAnomalySeverity(parsed.data.severity)
    ) {
      where.severity = parsed.data.severity;
    }
    if (parsed.data.status && isEconomyIssueStatus(parsed.data.status)) {
      where.status = parsed.data.status;
    }
    if (parsed.data.source && isEconomyAnomalySource(parsed.data.source)) {
      where.source = parsed.data.source;
    }
    const [items, total] = await Promise.all([
      this.prisma.economyAnomaly.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit,
      }),
      this.prisma.economyAnomaly.count({ where }),
    ]);
    return {
      ok: true,
      data: {
        items: items.map((a) => ({
          id: a.id,
          severity: a.severity,
          source: a.source,
          characterId: a.characterId,
          userId: a.userId,
          detailsJson: a.detailsJson,
          status: a.status,
          windowKey: a.windowKey,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        total,
      },
    };
  }

  @Post('admin/economy/anomalies/:id/ack')
  @RequireAdmin()
  async ackAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'ACKNOWLEDGED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.economyAnomaly.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED' },
    });
    if (updated.count === 0) {
      fail('ANOMALY_NOT_FOUND_OR_NOT_OPEN', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ECONOMY_ANOMALY_ACK', {
      anomalyId: id,
    });
    return { ok: true, data: { status: 'ACKNOWLEDGED' } };
  }

  @Post('admin/economy/anomalies/:id/resolve')
  @RequireAdmin()
  async resolveAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'RESOLVED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.economyAnomaly.updateMany({
      where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED' },
    });
    if (updated.count === 0) {
      fail('ANOMALY_NOT_FOUND_OR_RESOLVED', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ECONOMY_ANOMALY_RESOLVE', {
      anomalyId: id,
    });
    return { ok: true, data: { status: 'RESOLVED' } };
  }

  // ---------- helpers ----------

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
          meta: meta as never,
        },
      });
    } catch {
      // Audit fail-soft — không lật ngược kết quả endpoint.
    }
  }
}
