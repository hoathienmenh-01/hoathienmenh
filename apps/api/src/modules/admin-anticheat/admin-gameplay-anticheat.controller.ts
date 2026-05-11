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
  GAMEPLAY_ANOMALY_SEVERITIES,
  GAMEPLAY_ANOMALY_SOURCES,
  GAMEPLAY_ANOMALY_STATUSES,
  GAMEPLAY_ANOMALY_TYPES,
  isGameplayAnomalySeverity,
  isGameplayAnomalySource,
  isGameplayAnomalyStatus,
  isGameplayAnomalyType,
  type GameplayAnomalySeverity,
  type GameplayAnomalySource,
  type GameplayAnomalyStatus,
  type GameplayAnomalyType,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  GameplayAntiCheatService,
  type GameplayScanSummary,
} from './gameplay-anticheat.service';

/**
 * Phase 16.3 — Admin Gameplay Anti-cheat controller.
 *
 * Routes (mọi route gắn `@RequireAdmin()` — PLAYER/MOD đều 403):
 *   - `POST /admin/anticheat/gameplay/scan` — force-run scanner.
 *   - `GET  /admin/anticheat/gameplay/anomalies` — list filter.
 *   - `POST /admin/anticheat/gameplay/anomalies/:id/ack` — chuyển
 *     `OPEN → ACKNOWLEDGED`.
 *   - `POST /admin/anticheat/gameplay/anomalies/:id/resolve` — chuyển
 *     `OPEN | ACKNOWLEDGED → RESOLVED` (optional note).
 *
 * Audit: mỗi POST ghi `AdminAuditLog` (`ADMIN_ANTICHEAT_GAMEPLAY_*`).
 * KHÔNG lưu raw IP / token / cookie.
 *
 * Detection-only policy: KHÔNG endpoint ban / refund / rollback ở
 * controller này. Admin tự dùng endpoint admin khác.
 */

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const ScanBodyZ = z
  .object({
    windowKey: z.string().min(1).max(64).optional(),
    windowMs: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 3600 * 1000)
      .optional(),
  })
  .strict();

const AnomalyListQueryZ = z
  .object({
    severity: z.string().min(1).max(16).optional(),
    status: z.string().min(1).max(20).optional(),
    type: z.string().min(1).max(64).optional(),
    source: z.string().min(1).max(40).optional(),
    characterId: z.string().min(1).max(40).optional(),
    from: z.string().min(1).max(32).optional(),
    to: z.string().min(1).max(32).optional(),
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

const ResolveBodyZ = z
  .object({
    note: z.string().max(1000).optional(),
  })
  .strict();

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

interface AnomalyRowDto {
  id: string;
  type: GameplayAnomalyType;
  severity: GameplayAnomalySeverity;
  status: GameplayAnomalyStatus;
  source: GameplayAnomalySource;
  characterId: string | null;
  userId: string | null;
  windowKey: string;
  detailsJson: unknown;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: string | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminGameplayAntiCheatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: GameplayAntiCheatService,
  ) {}

  /**
   * `GET /admin/anticheat/gameplay/summary` — Summary cards cho FE.
   *
   * Returns:
   *   - openCount / criticalOpenCount / warnOpenCount / infoOpenCount.
   *   - latestCreatedAt.
   *   - latestResolvedAt.
   *   - totalCount.
   */
  @Get('admin/anticheat/gameplay/summary')
  @RequireAdmin()
  async getSummary(): Promise<{
    ok: true;
    data: {
      openCount: number;
      openCriticalCount: number;
      openWarnCount: number;
      openInfoCount: number;
      totalCount: number;
      latestCreatedAt: string | null;
      latestResolvedAt: string | null;
    };
  }> {
    const [
      openCount,
      openCriticalCount,
      openWarnCount,
      openInfoCount,
      totalCount,
      latestCreated,
      latestResolved,
    ] = await Promise.all([
      this.prisma.gameplayAnomaly.count({ where: { status: 'OPEN' } }),
      this.prisma.gameplayAnomaly.count({
        where: { status: 'OPEN', severity: 'CRITICAL' },
      }),
      this.prisma.gameplayAnomaly.count({
        where: { status: 'OPEN', severity: 'WARN' },
      }),
      this.prisma.gameplayAnomaly.count({
        where: { status: 'OPEN', severity: 'INFO' },
      }),
      this.prisma.gameplayAnomaly.count(),
      this.prisma.gameplayAnomaly.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.gameplayAnomaly.findFirst({
        where: { status: 'RESOLVED' },
        orderBy: { resolvedAt: 'desc' },
        select: { resolvedAt: true },
      }),
    ]);

    return {
      ok: true,
      data: {
        openCount,
        openCriticalCount,
        openWarnCount,
        openInfoCount,
        totalCount,
        latestCreatedAt: latestCreated?.createdAt.toISOString() ?? null,
        latestResolvedAt: latestResolved?.resolvedAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * `POST /admin/anticheat/gameplay/scan`
   *
   * Force-run scanner. Idempotent: cùng windowKey tự derive theo rule
   * + character → unique violation → skip.
   *
   * Audit: `ADMIN_ANTICHEAT_GAMEPLAY_SCAN`.
   */
  @Post('admin/anticheat/gameplay/scan')
  @RequireAdmin()
  async runScan(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: GameplayScanSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = ScanBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.scanner.scanAll({
      windowKey: parsed.data.windowKey,
      windowMs: parsed.data.windowMs,
    });
    await this.audit(req.userId, 'ADMIN_ANTICHEAT_GAMEPLAY_SCAN', {
      totalCreated: data.totalCreated,
      totalSkipped: data.totalSkipped,
      totalErrored: data.totalErrored,
      windowKeysByType: data.windowKeysByType,
    });
    return { ok: true, data };
  }

  /**
   * `GET /admin/anticheat/gameplay/anomalies`
   *
   * Filter: `severity`, `status`, `type`, `source`, `characterId`,
   * `from`, `to`, `limit`. Sort severity DESC + createdAt DESC.
   */
  @Get('admin/anticheat/gameplay/anomalies')
  @RequireAdmin()
  async listAnomalies(@Query() rawQuery: unknown): Promise<{
    ok: true;
    data: {
      items: AnomalyRowDto[];
      total: number;
      filters: {
        severities: readonly string[];
        statuses: readonly string[];
        types: readonly string[];
        sources: readonly string[];
      };
    };
  }> {
    const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
    const parsed = AnomalyListQueryZ.safeParse(q);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const where: Record<string, unknown> = {};
    if (parsed.data.severity && isGameplayAnomalySeverity(parsed.data.severity)) {
      where.severity = parsed.data.severity;
    }
    if (parsed.data.status && isGameplayAnomalyStatus(parsed.data.status)) {
      where.status = parsed.data.status;
    }
    if (parsed.data.type && isGameplayAnomalyType(parsed.data.type)) {
      where.type = parsed.data.type;
    }
    if (parsed.data.source && isGameplayAnomalySource(parsed.data.source)) {
      where.source = parsed.data.source;
    }
    if (parsed.data.characterId) {
      where.characterId = parsed.data.characterId;
    }
    const createdAtFilter: Record<string, Date> = {};
    if (parsed.data.from) {
      const d = parseDateOrNull(parsed.data.from);
      if (d) createdAtFilter.gte = d;
    }
    if (parsed.data.to) {
      const d = parseDateOrNull(parsed.data.to);
      if (d) createdAtFilter.lte = d;
    }
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }
    const [items, total] = await Promise.all([
      this.prisma.gameplayAnomaly.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit,
      }),
      this.prisma.gameplayAnomaly.count({ where }),
    ]);
    return {
      ok: true,
      data: {
        items: items.map((a) => toRowDto(a)),
        total,
        filters: {
          severities: GAMEPLAY_ANOMALY_SEVERITIES,
          statuses: GAMEPLAY_ANOMALY_STATUSES,
          types: GAMEPLAY_ANOMALY_TYPES,
          sources: GAMEPLAY_ANOMALY_SOURCES,
        },
      },
    };
  }

  /**
   * `POST /admin/anticheat/gameplay/anomalies/:id/ack`
   *
   * Chuyển `OPEN → ACKNOWLEDGED`. Idempotent: nếu đã ack → 404
   * `ANOMALY_NOT_FOUND_OR_NOT_OPEN`.
   *
   * Audit: `ADMIN_ANTICHEAT_GAMEPLAY_ACK`.
   */
  @Post('admin/anticheat/gameplay/anomalies/:id/ack')
  @RequireAdmin()
  async ackAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'ACKNOWLEDGED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.gameplayAnomaly.updateMany({
      where: { id, status: 'OPEN' },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedByAdminId: req.userId,
      },
    });
    if (updated.count === 0) {
      fail('ANOMALY_NOT_FOUND_OR_NOT_OPEN', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ANTICHEAT_GAMEPLAY_ACK', {
      anomalyId: id,
    });
    return { ok: true, data: { status: 'ACKNOWLEDGED' } };
  }

  /**
   * `POST /admin/anticheat/gameplay/anomalies/:id/resolve`
   *
   * Chuyển `OPEN | ACKNOWLEDGED → RESOLVED` (optional `note` ≤1000
   * char). Idempotent: đã `RESOLVED` → 404 `ANOMALY_NOT_FOUND_OR_RESOLVED`.
   *
   * Audit: `ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE`.
   */
  @Post('admin/anticheat/gameplay/anomalies/:id/resolve')
  @RequireAdmin()
  async resolveAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: { status: 'RESOLVED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = ResolveBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.gameplayAnomaly.updateMany({
      where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedByAdminId: req.userId,
        resolutionNote: parsed.data.note ?? null,
      },
    });
    if (updated.count === 0) {
      fail('ANOMALY_NOT_FOUND_OR_RESOLVED', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE', {
      anomalyId: id,
      noteLength: parsed.data.note?.length ?? 0,
    });
    return { ok: true, data: { status: 'RESOLVED' } };
  }

  // ----- helpers -----

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

function parseDateOrNull(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toRowDto(a: {
  id: string;
  type: string;
  severity: string;
  status: string;
  source: string;
  characterId: string | null;
  userId: string | null;
  windowKey: string;
  detailsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}): AnomalyRowDto {
  return {
    id: a.id,
    type: isGameplayAnomalyType(a.type) ? a.type : ('EXP_GAIN_SPIKE' as GameplayAnomalyType),
    severity: isGameplayAnomalySeverity(a.severity)
      ? a.severity
      : ('INFO' as GameplayAnomalySeverity),
    status: isGameplayAnomalyStatus(a.status)
      ? a.status
      : ('OPEN' as GameplayAnomalyStatus),
    source: isGameplayAnomalySource(a.source)
      ? a.source
      : ('OTHER' as GameplayAnomalySource),
    characterId: a.characterId,
    userId: a.userId,
    windowKey: a.windowKey,
    detailsJson: a.detailsJson,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByAdminId: a.acknowledgedByAdminId,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedByAdminId: a.resolvedByAdminId,
    resolutionNote: a.resolutionNote,
  };
}
