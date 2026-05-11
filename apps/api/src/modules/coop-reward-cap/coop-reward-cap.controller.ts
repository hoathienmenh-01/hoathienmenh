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
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import {
  isCoopWeeklySeasonStatus,
  type CoopRewardStatusDto,
  type CoopWeeklyLeaderboardResponse,
  type CoopWeeklyRewardClaimDto,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { CoopCapError, CoopRewardCapService } from './coop-reward-cap.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const ClaimInput = z
  .object({
    seasonId: z.string().min(1).max(80),
  })
  .strict();

const WeekKeyQuery = z
  .string()
  .min(1)
  .max(16)
  .regex(/^\d{4}-W\d{2}$/, { message: 'weekKey must be YYYY-Www' });

/**
 * Phase 20.3 — Co-op Reward Cap / Weekly Season user-facing REST.
 *
 * Auth: cookie `xt_access` → `AuthService.requireUserId`. Mọi
 * endpoint yêu cầu authenticated PLAYER.
 *
 * Privacy invariants:
 *   - `GET /coop/rewards/status` chỉ trả counter + weekly entry của
 *     **caller**. Service `getMyCoopRewardStatus` filter theo userId
 *     bind từ cookie. User KHÔNG xem được counter của người khác.
 *   - `GET /coop/rewards/weekly-leaderboard` public-in-game — chỉ
 *     trả top N entries, KHÔNG ghi userId của caller; vẫn safe vì
 *     tất cả player cùng tuần đều xem được.
 *   - `POST /coop/rewards/weekly-claim` mutation bound by userId từ
 *     cookie. CAS guard ngăn 2 user claim cùng row.
 *
 * Rate-limit:
 *   - `POST /coop/rewards/weekly-claim` → policy `COOP_BOSS_CLAIM`
 *     (reuse Phase 20.2 policy — semantic gần nhau).
 *
 * GET endpoints không gắn policy (fall through `DEFAULT_API`).
 *
 * KHÔNG log token / cookie / secret.
 */
@Controller('coop/rewards')
export class CoopRewardCapController {
  constructor(
    private readonly service: CoopRewardCapService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[ACCESS_COOKIE];
    const id = await this.auth.userIdFromAccess(token);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private async resolveCharacterId(userId: string): Promise<string> {
    const ch = await this.prisma.character.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!ch) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return ch.id;
  }

  private statusFor(code: CoopCapError['code']): number {
    switch (code) {
      case 'SEASON_NOT_FOUND':
      case 'REWARD_NOT_FOUND':
      case 'CHARACTER_NOT_FOUND':
        return HttpStatus.NOT_FOUND;
      case 'REWARD_TIER_NONE':
      case 'REWARD_SKIPPED':
        return HttpStatus.FORBIDDEN;
      case 'INVALID_SOURCE':
        return HttpStatus.BAD_REQUEST;
      case 'SEASON_NOT_SETTLED':
      case 'SEASON_ALREADY_SETTLED':
      case 'SEASON_NOT_CLOSED':
      case 'REWARD_ALREADY_CLAIMED':
      case 'DAILY_CAP_REACHED':
      case 'WEEKLY_CAP_REACHED':
        return HttpStatus.CONFLICT;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }

  private rethrow(e: unknown): never {
    if (e instanceof CoopCapError) {
      throw new HttpException(
        { ok: false, error: { code: e.code, message: e.code } },
        this.statusFor(e.code),
      );
    }
    if (e instanceof HttpException) throw e;
    throw new HttpException(
      { ok: false, error: { code: 'INTERNAL' } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('status')
  async getStatus(
    @Req() req: Request,
  ): Promise<{ ok: true; data: CoopRewardStatusDto }> {
    const userId = await this.requireUserId(req);
    const characterId = await this.resolveCharacterId(userId);
    const data = await this.service.getMyCoopRewardStatus({
      userId,
      characterId,
    });
    return { ok: true, data };
  }

  @Get('weekly-leaderboard')
  async getLeaderboard(
    @Req() req: Request,
    @Query('weekKey') weekKey?: string,
    @Query('limit') limit?: string,
  ): Promise<{ ok: true; data: CoopWeeklyLeaderboardResponse }> {
    await this.requireUserId(req);
    let weekKeyValue: string | undefined;
    if (weekKey) {
      const parsed = WeekKeyQuery.safeParse(weekKey);
      if (!parsed.success) fail('INVALID_INPUT');
      weekKeyValue = parsed.data;
    }
    const lim = limit ? Math.max(1, Math.min(200, Number(limit))) : undefined;
    const data = await this.service.getWeeklyLeaderboard({
      weekKey: weekKeyValue,
      limit: lim,
    });
    return { ok: true, data };
  }

  @Post('weekly-claim')
  @RateLimitPolicy('COOP_BOSS_CLAIM')
  async claim(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: CoopWeeklyRewardClaimDto }> {
    const userId = await this.requireUserId(req);
    const parsed = ClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.service.claimWeeklyReward({
        userId,
        seasonId: parsed.data.seasonId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrow(e);
    }
  }
}

/**
 * Phase 20.3 — Admin Co-op Reward Cap controller. Mọi route gắn
 * `@RequireAdmin()`. Mutation ghi `AdminAuditLog`.
 */

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

const AdminListSeasonsQuery = z
  .object({
    status: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();

const AdminSettleParam = z.string().min(1).max(80);

@UseGuards(AdminGuard)
@Controller('admin/coop/rewards')
export class AdminCoopRewardCapController {
  constructor(
    private readonly service: CoopRewardCapService,
    private readonly prisma: PrismaService,
  ) {}

  private rethrow(e: unknown): never {
    if (e instanceof CoopCapError) {
      const status =
        e.code === 'SEASON_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : e.code === 'SEASON_ALREADY_SETTLED'
            ? HttpStatus.CONFLICT
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

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: { actorUserId, action, meta: meta as Prisma.InputJsonValue },
      });
    } catch {
      // fail-soft
    }
  }

  @Get('summary')
  @RequireAdmin()
  async summary(): Promise<{ ok: true; data: unknown }> {
    const data = await this.service.getAdminSummary();
    return { ok: true, data };
  }

  @Get('seasons')
  @RequireAdmin()
  async seasons(
    @Query() q: Record<string, string>,
  ): Promise<{ ok: true; data: unknown }> {
    const parsed = AdminListSeasonsQuery.safeParse(q);
    if (!parsed.success) fail('INVALID_INPUT');
    const statusValue =
      parsed.data.status && isCoopWeeklySeasonStatus(parsed.data.status)
        ? parsed.data.status
        : undefined;
    const limit = parsed.data.limit ? Number(parsed.data.limit) : undefined;
    const data = await this.service.listSeasons({ limit, status: statusValue });
    return { ok: true, data };
  }

  @Post('seasons/:id/settle')
  @RequireAdmin()
  async settleSeason(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { rankedEntries: number; claimRows: number } }> {
    const parsed = AdminSettleParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.service.settleWeeklySeason({
        seasonId: parsed.data,
        actorUserId: req.userId,
      });
      await this.audit(req.userId, 'ADMIN_COOP_REWARD_SETTLE_SEASON', {
        seasonId: parsed.data,
        rankedEntries: data.rankedEntries,
        claimRows: data.claimRows,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrow(e);
    }
  }

  @Get('cap-counters')
  @RequireAdmin()
  async listCapCounters(
    @Query('userId') userId?: string,
    @Query('source') source?: string,
    @Query('dayKey') dayKey?: string,
    @Query('weekKey') weekKey?: string,
    @Query('limit') limit?: string,
  ): Promise<{ ok: true; data: unknown }> {
    const lim = limit ? Number(limit) : undefined;
    const sourceValue =
      source === 'COOP_BOSS' || source === 'PARTY_DUNGEON' ? source : undefined;
    const data = await this.service.listCapCounters({
      userId,
      source: sourceValue,
      dayKey,
      weekKey,
      limit: lim,
    });
    return { ok: true, data };
  }
}
