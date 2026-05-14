import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SeasonLeaderboardKind, SeasonStatus } from '@prisma/client';
import { z } from 'zod';
import type { AdminRoleKey } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { SeasonError, SeasonsService } from './seasons.service';

const ACCESS_COOKIE = 'xt_access';

interface AdminReq extends Request {
  userId: string;
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const DateString = z
  .string()
  .min(1)
  .transform((s, ctx) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid date' });
    }
    return d;
  });

const CreateSeasonZ = z
  .object({
    seasonKey: z.string().min(3).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    startAt: DateString,
    endAt: DateString,
    status: z.nativeEnum(SeasonStatus).optional(),
    pointConfig: z.unknown().optional(),
    rewardConfig: z.unknown().optional(),
    milestoneConfig: z.unknown().optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();

const UpdateSeasonZ = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    startAt: DateString.optional(),
    endAt: DateString.optional(),
    pointConfig: z.unknown().optional(),
    rewardConfig: z.unknown().optional(),
    milestoneConfig: z.unknown().optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();

const StatusZ = z
  .object({
    status: z.nativeEnum(SeasonStatus),
    reason: z.string().min(3).max(500),
  })
  .strict();

@Controller()
export class SeasonsController {
  constructor(
    private readonly seasons: SeasonsService,
    private readonly auth: AuthService,
    private readonly audit: AdminAuditWriter,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get('seasons/current')
  async current() {
    const season = await this.seasons.current();
    return { ok: true, data: { season } };
  }

  @Get('seasons/me/progress')
  async myProgress(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.seasons.progress(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('seasons/leaderboard')
  async leaderboard(@Query('kind') kind?: string, @Query('limit') limit?: string) {
    const parsed = z
      .object({
        kind: z.nativeEnum(SeasonLeaderboardKind).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse({ kind, limit });
    if (!parsed.success) fail('INVALID_INPUT');
    const data = await this.seasons.leaderboard(
      parsed.data.kind ?? SeasonLeaderboardKind.POINTS,
      parsed.data.limit ?? 50,
    );
    return { ok: true, data };
  }

  @Get('seasons/server-milestones')
  async milestones() {
    const data = await this.seasons.serverMilestones();
    return { ok: true, data };
  }

  @Post('seasons/rewards/:rewardKey/claim')
  async claim(@Req() req: Request, @Param('rewardKey') rewardKey: string) {
    const userId = await this.requireUserId(req);
    if (!rewardKey) fail('INVALID_INPUT');
    try {
      const data = await this.seasons.claimReward(userId, rewardKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('seasons/:seasonKey')
  async byKey(@Param('seasonKey') seasonKey: string) {
    if (!seasonKey) fail('INVALID_INPUT');
    try {
      const season = await this.seasons.byKey(seasonKey);
      return { ok: true, data: { season } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('admin/seasons')
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async createAdmin(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = CreateSeasonZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const season = await this.seasons.createSeason({
        ...parsed.data,
        adminId: req.userId,
      });
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType:
          parsed.data.status === SeasonStatus.ACTIVE ? 'SEASON_ACTIVATE' : 'SEASON_CREATE',
        permissionKey: 'ADMIN_MANAGE_EVENTS',
        reason: parsed.data.reason,
        targetType: 'ServerSeason',
        targetId: season.seasonKey,
        afterJson: season,
      });
      return { ok: true, data: { season } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Patch('admin/seasons/:seasonKey')
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async updateAdmin(
    @Req() req: AdminReq,
    @Param('seasonKey') seasonKey: string,
    @Body() body: unknown,
  ) {
    const parsed = UpdateSeasonZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const before = await this.seasons.byKey(seasonKey);
      const season = await this.seasons.updateSeason(seasonKey, {
        ...parsed.data,
        adminId: req.userId,
      });
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType:
          parsed.data.rewardConfig !== undefined
            ? 'SEASON_REWARD_CONFIG_UPDATE'
            : 'SEASON_UPDATE',
        permissionKey: 'ADMIN_MANAGE_EVENTS',
        reason: parsed.data.reason,
        targetType: 'ServerSeason',
        targetId: seasonKey,
        beforeJson: before,
        afterJson: season,
      });
      return { ok: true, data: { season } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Patch('admin/seasons/:seasonKey/status')
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission('ADMIN_MANAGE_EVENTS')
  async statusAdmin(
    @Req() req: AdminReq,
    @Param('seasonKey') seasonKey: string,
    @Body() body: unknown,
  ) {
    const parsed = StatusZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const before = await this.seasons.byKey(seasonKey);
      const season = await this.seasons.setStatus(
        seasonKey,
        parsed.data.status,
        req.userId,
      );
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType: actionForStatus(parsed.data.status),
        permissionKey: 'ADMIN_MANAGE_EVENTS',
        reason: parsed.data.reason,
        targetType: 'ServerSeason',
        targetId: seasonKey,
        beforeJson: before,
        afterJson: season,
      });
      return { ok: true, data: { season } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SeasonError) {
      if (e.code === 'NO_CHARACTER' || e.code === 'SEASON_NOT_FOUND') {
        fail(e.code, HttpStatus.NOT_FOUND);
      }
      if (
        e.code === 'SEASON_ALREADY_ACTIVE' ||
        e.code === 'POINT_CAP_REACHED' ||
        e.code === 'REWARD_ALREADY_CLAIMED'
      ) {
        fail(e.code, HttpStatus.CONFLICT);
      }
      fail(e.code);
    }
    throw e;
  }
}

function actionForStatus(status: SeasonStatus) {
  if (status === SeasonStatus.ACTIVE) return 'SEASON_ACTIVATE';
  if (status === SeasonStatus.ENDED) return 'SEASON_END';
  if (status === SeasonStatus.ARCHIVED) return 'SEASON_ARCHIVE';
  return 'SEASON_UPDATE';
}
