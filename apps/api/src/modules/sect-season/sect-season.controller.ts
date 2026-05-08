import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SectSeasonError, SectSeasonService } from './sect-season.service';
import { AuthService } from '../auth/auth.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 13.2.A — Sect Season (Mùa Tông Môn) REST endpoints.
 *
 * Endpoints (read-only):
 *   - `GET /sect-season/current` — full state (season, milestones,
 *     leaderboard top 10, me).
 *   - `GET /sect-season/leaderboard?seasonKey=...` — top 10 sects (current
 *     nếu không truyền seasonKey).
 *   - `GET /sect-season/me?seasonKey=...` — personal status (current nếu
 *     không truyền seasonKey).
 *
 * `current` + `me` require auth (cookie `xt_access`); `leaderboard` public
 * vì sect ranking là thông tin meta đã hiển thị ở Sect War weekly.
 *
 * KHÔNG có endpoint mutation — Phase 13.2.A chỉ read aggregation. Reward
 * claim sẽ ở Phase 13.2.B+ (cần audit table + idempotent claim row).
 */
@Controller('sect-season')
export class SectSeasonController {
  constructor(
    private readonly sectSeason: SectSeasonService,
    private readonly auth: AuthService,
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
      const data = await this.sectSeason.getCurrent(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('leaderboard')
  async leaderboard(@Query('seasonKey') seasonKey?: string) {
    const data = await this.sectSeason.getLeaderboard(seasonKey);
    return { ok: true, data };
  }

  @Get('me')
  async me(@Req() req: Request, @Query('seasonKey') seasonKey?: string) {
    const userId = await this.getUserId(req);
    try {
      const data = await this.sectSeason.getMyStatus(userId, seasonKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectSeasonError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SEASON_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
      }
    }
    throw e;
  }
}
