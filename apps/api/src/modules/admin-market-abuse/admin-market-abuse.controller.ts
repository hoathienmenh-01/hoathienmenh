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
  isMarketAbuseSeverity,
  isMarketAbuseSource,
  isMarketAbuseStatus,
  isMarketAbuseType,
  MARKET_ABUSE_SEVERITIES,
  MARKET_ABUSE_SOURCES,
  MARKET_ABUSE_STATUSES,
  MARKET_ABUSE_TYPES,
  type MarketAbuseSeverity,
  type MarketAbuseSource,
  type MarketAbuseStatus,
  type MarketAbuseType,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  MarketTradeAbuseService,
  type MarketScanSummary,
} from './market-trade-abuse.service';

/**
 * Phase 16.4 — Admin Market Trade Abuse controller.
 *
 * Routes (mọi route gắn `@RequireAdmin()` — PLAYER/MOD đều 403):
 *   - `GET  /admin/market/abuse/summary` — dashboard cards.
 *   - `POST /admin/market/abuse/scan` — force-run scanner.
 *   - `GET  /admin/market/abuse/anomalies` — list filter.
 *   - `POST /admin/market/abuse/anomalies/:id/ack` — `OPEN → ACKNOWLEDGED`.
 *   - `POST /admin/market/abuse/anomalies/:id/resolve` — `OPEN |
 *     ACKNOWLEDGED → RESOLVED` (optional note).
 *
 * Audit: mỗi POST ghi `AdminAuditLog` (`ADMIN_MARKET_ABUSE_*`).
 * KHÔNG lưu raw IP / token.
 *
 * Detection-only policy: KHÔNG endpoint ban / refund / rollback.
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
    sellerCharacterId: z.string().min(1).max(40).optional(),
    buyerCharacterId: z.string().min(1).max(40).optional(),
    itemKey: z.string().min(1).max(64).optional(),
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
  type: MarketAbuseType;
  severity: MarketAbuseSeverity;
  status: MarketAbuseStatus;
  source: MarketAbuseSource;
  listingId: string;
  sellerCharacterId: string | null;
  buyerCharacterId: string | null;
  itemKey: string | null;
  quantity: number | null;
  unitPrice: string | null;
  referencePrice: string | null;
  deviationRatio: number | null;
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
export class AdminMarketAbuseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: MarketTradeAbuseService,
  ) {}

  /**
   * `GET /admin/market/abuse/summary` — Dashboard summary cards.
   */
  @Get('admin/market/abuse/summary')
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
    const data = await this.scanner.summary();
    return { ok: true, data };
  }

  /**
   * `POST /admin/market/abuse/scan`
   *
   * Force-run scanner. Idempotent qua UNIQUE constraint.
   *
   * Audit: `ADMIN_MARKET_ABUSE_SCAN`.
   */
  @Post('admin/market/abuse/scan')
  @RequireAdmin()
  async runScan(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: MarketScanSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = ScanBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.scanner.scanAll({
      windowKey: parsed.data.windowKey,
      windowMs: parsed.data.windowMs,
    });
    await this.audit(req.userId, 'ADMIN_MARKET_ABUSE_SCAN', {
      totalCreated: data.totalCreated,
      totalSkipped: data.totalSkipped,
      totalErrored: data.totalErrored,
      windowKeysByType: data.windowKeysByType,
    });
    return { ok: true, data };
  }

  /**
   * `GET /admin/market/abuse/anomalies`
   */
  @Get('admin/market/abuse/anomalies')
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
    if (parsed.data.severity && isMarketAbuseSeverity(parsed.data.severity)) {
      where.severity = parsed.data.severity;
    }
    if (parsed.data.status && isMarketAbuseStatus(parsed.data.status)) {
      where.status = parsed.data.status;
    }
    if (parsed.data.type && isMarketAbuseType(parsed.data.type)) {
      where.type = parsed.data.type;
    }
    if (parsed.data.source && isMarketAbuseSource(parsed.data.source)) {
      where.source = parsed.data.source;
    }
    if (parsed.data.sellerCharacterId) {
      where.sellerCharacterId = parsed.data.sellerCharacterId;
    }
    if (parsed.data.buyerCharacterId) {
      where.buyerCharacterId = parsed.data.buyerCharacterId;
    }
    if (parsed.data.itemKey) {
      where.itemKey = parsed.data.itemKey;
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
      this.prisma.marketTradeAnomaly.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit,
      }),
      this.prisma.marketTradeAnomaly.count({ where }),
    ]);
    return {
      ok: true,
      data: {
        items: items.map((a) => toRowDto(a)),
        total,
        filters: {
          severities: MARKET_ABUSE_SEVERITIES,
          statuses: MARKET_ABUSE_STATUSES,
          types: MARKET_ABUSE_TYPES,
          sources: MARKET_ABUSE_SOURCES,
        },
      },
    };
  }

  /**
   * `POST /admin/market/abuse/anomalies/:id/ack`
   */
  @Post('admin/market/abuse/anomalies/:id/ack')
  @RequireAdmin()
  async ackAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'ACKNOWLEDGED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.marketTradeAnomaly.updateMany({
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
    await this.audit(req.userId, 'ADMIN_MARKET_ABUSE_ACK', { anomalyId: id });
    return { ok: true, data: { status: 'ACKNOWLEDGED' } };
  }

  /**
   * `POST /admin/market/abuse/anomalies/:id/resolve`
   */
  @Post('admin/market/abuse/anomalies/:id/resolve')
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
    const updated = await this.prisma.marketTradeAnomaly.updateMany({
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
    await this.audit(req.userId, 'ADMIN_MARKET_ABUSE_RESOLVE', {
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
      // Audit fail-soft.
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
  listingId: string;
  sellerCharacterId: string | null;
  buyerCharacterId: string | null;
  itemKey: string | null;
  quantity: number | null;
  unitPrice: bigint | null;
  referencePrice: bigint | null;
  deviationRatio: number | null;
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
    type: isMarketAbuseType(a.type)
      ? a.type
      : ('PRICE_EXTREME_LOW' as MarketAbuseType),
    severity: isMarketAbuseSeverity(a.severity)
      ? a.severity
      : ('INFO' as MarketAbuseSeverity),
    status: isMarketAbuseStatus(a.status)
      ? a.status
      : ('OPEN' as MarketAbuseStatus),
    source: isMarketAbuseSource(a.source)
      ? a.source
      : ('OTHER' as MarketAbuseSource),
    listingId: a.listingId,
    sellerCharacterId: a.sellerCharacterId,
    buyerCharacterId: a.buyerCharacterId,
    itemKey: a.itemKey,
    quantity: a.quantity,
    unitPrice: a.unitPrice !== null ? a.unitPrice.toString() : null,
    referencePrice: a.referencePrice !== null ? a.referencePrice.toString() : null,
    deviationRatio: a.deviationRatio,
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
