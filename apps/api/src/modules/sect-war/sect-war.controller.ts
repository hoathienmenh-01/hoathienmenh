import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SectWarError, SectWarService } from './sect-war.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 13.1.A — Sect War REST endpoints.
 *
 * Endpoints:
 *   - `GET  /sect-war/current` — full state (week, season, leaderboard, me).
 *   - `GET  /sect-war/leaderboard?weekKey=...` — top 10 sects.
 *   - `GET  /sect-war/me` — personal status (week current).
 *   - `POST /sect-war/claim` — claim weekly reward.
 *
 * All endpoints require authenticated user (cookie `xt_access`). Mọi mutation
 * logic server-authoritative — body không chứa points/rank.
 */
@Controller('sect-war')
export class SectWarController {
  constructor(
    private readonly sectWar: SectWarService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async getUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get('current')
  async current(@Req() req: Request) {
    const userId = await this.getUserId(req);
    try {
      const data = await this.sectWar.getCurrent(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('leaderboard')
  async leaderboard(@Query('weekKey') weekKey?: string) {
    const data = await this.sectWar.getLeaderboard(weekKey);
    return { ok: true, data };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = await this.getUserId(req);
    try {
      const data = await this.sectWar.getMyStatus(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('claim')
  @HttpCode(200)
  async claim(@Req() req: Request) {
    const userId = await this.getUserId(req);
    try {
      const data = await this.sectWar.claimWeeklyReward(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectWarError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_REQUIRED':
        case 'SECT_WAR_NOT_CLAIMABLE':
        case 'SECT_WAR_NO_REWARD':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_WAR_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
