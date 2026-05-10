/**
 * Phase 14.1.D — Admin Arena Anti-Wintrade controller.
 *
 * Endpoints:
 *   - POST /admin/arena/anti-wintrade/scan
 *   - GET  /admin/arena/anti-wintrade/alerts
 *   - POST /admin/arena/anti-wintrade/alerts/:id/ack
 *   - POST /admin/arena/anti-wintrade/alerts/:id/resolve
 *
 * Tách module riêng (`ArenaAntiWintradeAdminModule`) thay vì gộp vào
 * `ArenaModule`/`AdminModule` để tránh cycle: `AdminModule` đã import
 * `ArenaModule` cho season settle endpoint. Pattern mirror
 * `AdminEconomySafetyModule` (Phase 16.6).
 *
 * Tất cả route gắn `@RequireAdmin()` — PLAYER + MOD đều bị reject 403.
 * Anti-wintrade scan + ack + resolve đều có ảnh hưởng quyết định reward
 * của player (theo dõi/xử lý), nên hierarchy MOD không đủ.
 *
 * Audit `AdminAuditLog` cho mọi POST: trace `actorUserId, action, meta`.
 */
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
  isArenaWintradeSeverity,
  isArenaWintradeStatus,
  isArenaWintradeType,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  ArenaAntiWintradeService,
  type AntiWintradeScanSummary,
} from '../arena/arena-anti-wintrade.service';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const ScanBodyZ = z
  .object({
    periodKeyOverride: z.string().min(1).max(64).optional(),
  })
  .strict();

const AlertListQueryZ = z
  .object({
    severity: z.string().min(1).max(16).optional(),
    status: z.string().min(1).max(20).optional(),
    type: z.string().min(1).max(64).optional(),
    seasonId: z.string().min(1).max(40).optional(),
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
export class ArenaAntiWintradeAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: ArenaAntiWintradeService,
  ) {}

  @Post('admin/arena/anti-wintrade/scan')
  @RequireAdmin()
  async runScan(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: AntiWintradeScanSummary }> {
    const body = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const parsed = ScanBodyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const data = await this.scanner.scanAll({
      periodKeyOverride: parsed.data.periodKeyOverride,
    });
    await this.audit(req.userId, 'ADMIN_ARENA_WINTRADE_SCAN_RUN', {
      ...data,
    });
    return { ok: true, data };
  }

  @Get('admin/arena/anti-wintrade/alerts')
  @RequireAdmin()
  async listAlerts(@Query() rawQuery: unknown): Promise<{
    ok: true;
    data: {
      items: Array<{
        id: string;
        seasonId: string | null;
        attackerCharacterId: string | null;
        defenderCharacterId: string | null;
        relatedCharacterIds: string[];
        severity: string;
        type: string;
        status: string;
        windowKey: string;
        details: unknown;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    };
  }> {
    const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
    const parsed = AlertListQueryZ.safeParse(q);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const where: Record<string, unknown> = {};
    if (parsed.data.severity && isArenaWintradeSeverity(parsed.data.severity)) {
      where.severity = parsed.data.severity;
    }
    if (parsed.data.status && isArenaWintradeStatus(parsed.data.status)) {
      where.status = parsed.data.status;
    }
    if (parsed.data.type && isArenaWintradeType(parsed.data.type)) {
      where.type = parsed.data.type;
    }
    if (parsed.data.seasonId) where.seasonId = parsed.data.seasonId;
    const [items, total] = await Promise.all([
      this.prisma.arenaWintradeAlert.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: parsed.data.limit,
      }),
      this.prisma.arenaWintradeAlert.count({ where }),
    ]);
    return {
      ok: true,
      data: {
        items: items.map((a) => ({
          id: a.id,
          seasonId: a.seasonId,
          attackerCharacterId: a.attackerCharacterId,
          defenderCharacterId: a.defenderCharacterId,
          relatedCharacterIds: parseRelatedCharacterIds(
            a.relatedCharacterIdsJson,
          ),
          severity: a.severity,
          type: a.type,
          status: a.status,
          windowKey: a.windowKey,
          details: a.detailsJson,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        total,
      },
    };
  }

  @Post('admin/arena/anti-wintrade/alerts/:id/ack')
  @RequireAdmin()
  async ackAlert(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'ACKNOWLEDGED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.arenaWintradeAlert.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED' },
    });
    if (updated.count === 0) {
      fail('ALERT_NOT_FOUND_OR_NOT_OPEN', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ARENA_WINTRADE_ALERT_ACK', {
      alertId: id,
    });
    return { ok: true, data: { status: 'ACKNOWLEDGED' } };
  }

  @Post('admin/arena/anti-wintrade/alerts/:id/resolve')
  @RequireAdmin()
  async resolveAlert(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { status: 'RESOLVED' } }> {
    if (!id || id.length > 40) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST);
    const updated = await this.prisma.arenaWintradeAlert.updateMany({
      where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED' },
    });
    if (updated.count === 0) {
      fail('ALERT_NOT_FOUND_OR_RESOLVED', HttpStatus.NOT_FOUND);
    }
    await this.audit(req.userId, 'ADMIN_ARENA_WINTRADE_ALERT_RESOLVE', {
      alertId: id,
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

function parseRelatedCharacterIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string');
  }
  return [];
}
