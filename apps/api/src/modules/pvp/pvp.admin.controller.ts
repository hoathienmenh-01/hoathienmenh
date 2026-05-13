/**
 * Phase 29.0 — PvP admin controller.
 *
 * Endpoint:
 *   - GET    /admin/pvp/policy             → current balance policy + default.
 *   - GET    /admin/pvp/battle-logs        → list logs (filter mode/character).
 *   - POST   /admin/pvp/battle-logs/:id/invalidate → invalidate battle + audit.
 *   - GET    /admin/pvp/anomalies          → list anomaly queue.
 *   - POST   /admin/pvp/anomalies/:id/resolve → resolve anomaly + audit.
 *   - GET    /admin/pvp/defense/:characterId → admin view defense profile.
 *
 * Tất cả endpoint require `ADMIN_MANAGE_PVP` permission. Audit qua
 * `AdminAuditWriter` với action type `PVP_BATTLE_INVALIDATE` /
 * `PVP_ANTICHEAT_RESOLVE` / `PVP_FEATURE_FLAG_UPDATE`.
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
  PVP_ANOMALY_TYPES,
  PVP_DEFAULT_BALANCE_POLICY,
  isPvpMode,
  type AdminRoleKey,
} from '@xuantoi/shared';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { PrismaService } from '../../common/prisma.service';
import { PvpBattleService, PvpBattleError } from './battle.service';
import { PvpAnomalyService } from './anomaly.service';
import { PvpDefenseService } from './defense.service';

interface AdminReq extends Request {
  userId: string;
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const InvalidateZ = z
  .object({
    reason: z.string().min(3).max(500),
  })
  .strict();

const ResolveAnomalyZ = z
  .object({
    resolution: z.enum(['DISMISSED', 'CONFIRMED', 'ESCALATED']),
    reason: z.string().min(3).max(500),
  })
  .strict();

@Controller('admin/pvp')
@UseGuards(AdminPermissionGuard)
export class PvpAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly battle: PvpBattleService,
    private readonly anomalies: PvpAnomalyService,
    private readonly defense: PvpDefenseService,
    private readonly audit: AdminAuditWriter,
  ) {}

  @Get('policy')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  policy() {
    return {
      ok: true,
      data: {
        current: this.battle.policy,
        default: PVP_DEFAULT_BALANCE_POLICY,
      },
    };
  }

  @Get('battle-logs')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  async listBattles(
    @Query('mode') mode?: string,
    @Query('characterId') characterId?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10)));
    const parsedMode = mode && isPvpMode(mode) ? mode : undefined;
    const where: {
      mode?: string;
      OR?: { attackerCharacterId?: string; defenderCharacterId?: string }[];
    } = {};
    if (parsedMode) where.mode = parsedMode;
    if (characterId) {
      where.OR = [
        { attackerCharacterId: characterId },
        { defenderCharacterId: characterId },
      ];
    }
    const rows = await this.prisma.pvpBattle.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: lim,
    });
    return { ok: true, data: rows };
  }

  @Post('battle-logs/:id/invalidate')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  async invalidate(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = InvalidateZ.safeParse(body);
    if (!parsed.success) fail('PVP_INVALIDATE_PAYLOAD_INVALID');
    try {
      const before = await this.battle.getById(id);
      const after = await this.battle.invalidate(id, parsed.data.reason);
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType: 'PVP_BATTLE_INVALIDATE',
        permissionKey: 'ADMIN_MANAGE_PVP',
        reason: parsed.data.reason,
        targetType: 'PvpBattle',
        targetId: id,
        beforeJson: before,
        afterJson: after,
      });
      return { ok: true, data: after };
    } catch (err) {
      if (err instanceof PvpBattleError) {
        fail(err.code, HttpStatus.NOT_FOUND);
      }
      throw err;
    }
  }

  @Get('anomalies')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  async listAnomalies(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const validStatus =
      status === 'PENDING' || status === 'RESOLVED' || status === 'ALL'
        ? status
        : 'PENDING';
    const validType =
      type && PVP_ANOMALY_TYPES.includes(type as never) ? type : undefined;
    const rows = await this.anomalies.list({
      status: validStatus,
      type: validType as never,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { ok: true, data: rows };
  }

  @Post('anomalies/:id/resolve')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  async resolveAnomaly(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = ResolveAnomalyZ.safeParse(body);
    if (!parsed.success) fail('PVP_ANOMALY_RESOLVE_PAYLOAD_INVALID');
    const before = await this.prisma.pvpAnomalyLog.findUnique({
      where: { id },
    });
    if (!before) fail('PVP_ANOMALY_NOT_FOUND', HttpStatus.NOT_FOUND);
    const after = await this.anomalies.resolve(
      id,
      req.userId,
      parsed.data.resolution,
      parsed.data.reason,
    );
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PVP_ANTICHEAT_RESOLVE',
      permissionKey: 'ADMIN_MANAGE_PVP',
      reason: parsed.data.reason,
      targetType: 'PvpAnomalyLog',
      targetId: id,
      beforeJson: before,
      afterJson: after,
    });
    return { ok: true, data: after };
  }

  @Get('defense/:characterId')
  @RequireAdminPermission('ADMIN_MANAGE_PVP')
  async getDefense(@Param('characterId') characterId: string) {
    const profile = await this.defense.get(characterId);
    return { ok: true, data: profile };
  }
}
