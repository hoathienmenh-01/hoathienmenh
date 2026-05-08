import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SectSeasonError, SectSeasonService } from './sect-season.service';
import {
  SectSeasonHistoryError,
  SectSeasonHistoryService,
} from './sect-season-history.service';
import { AuthService } from '../auth/auth.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 13.2.A foundation + Phase 13.2.B claim — Sect Season (Mùa Tông Môn)
 * REST endpoints.
 *
 * Read endpoints (require auth ngoại trừ leaderboard):
 *   - `GET /sect-season/current` — full state (season, milestones,
 *     leaderboard top 10, me).
 *   - `GET /sect-season/leaderboard?seasonKey=...` — top 10 sects (current
 *     nếu không truyền seasonKey).
 *   - `GET /sect-season/me?seasonKey=...` — personal status (current nếu
 *     không truyền seasonKey) bao gồm claimed/claimable milestone keys.
 *   - `GET /sect-season/milestones` — snapshot common milestone catalog
 *     (Phase 13.2.B; FE tham chiếu nhanh, không cần cookie).
 *
 * Mutation endpoints (Phase 13.2.B):
 *   - `POST /sect-season/milestones/:milestoneKey/claim?seasonKey=...` —
 *     claim reward khi đạt mốc. Idempotent qua DB UNIQUE; race-safe.
 *
 * `current` + `me` + `claim` require auth (cookie `xt_access`); `leaderboard`
 * + `milestones` public vì là thông tin meta catalog/ranking.
 */
@Controller('sect-season')
export class SectSeasonController {
  constructor(
    private readonly sectSeason: SectSeasonService,
    private readonly sectSeasonHistory: SectSeasonHistoryService,
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

  @Get('milestones')
  milestones() {
    const data = { milestones: this.sectSeason.listMilestones() };
    return { ok: true, data };
  }

  /**
   * Phase 13.2.B — claim milestone reward.
   *
   * Body-less POST: tham số đến từ URL path (`milestoneKey`) + query
   * (`seasonKey`). Trả `granted` snapshot reward đã grant + `pointsAtClaim`
   * + `claimedAtIso`.
   *
   * Error mapping:
   *   - 401 UNAUTHENTICATED — cookie thiếu/sai.
   *   - 400 SEASON_KEY_REQUIRED — query `seasonKey` rỗng.
   *   - 404 NO_CHARACTER / SEASON_NOT_FOUND / SECT_SEASON_MILESTONE_NOT_FOUND.
   *   - 400 SECT_SEASON_NOT_ELIGIBLE — chưa đủ requiredPoints.
   *   - 409 SECT_SEASON_ALREADY_CLAIMED — claim trước đó (idempotency hit).
   */
  @Post('milestones/:milestoneKey/claim')
  async claim(
    @Req() req: Request,
    @Param('milestoneKey') milestoneKey: string,
    @Query('seasonKey') seasonKey?: string,
  ) {
    const userId = await this.getUserId(req);
    if (!seasonKey) fail('SEASON_KEY_REQUIRED', HttpStatus.BAD_REQUEST);
    try {
      const data = await this.sectSeason.claimMilestone(userId, seasonKey, milestoneKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 13.2.C — Liệt kê toàn bộ season đã chốt snapshot (newest first).
   * Public read — bảng vinh danh là thông tin meta đã hiển thị ở Sect War.
   */
  @Get('history')
  async history() {
    const data = await this.sectSeasonHistory.listHistory();
    return { ok: true, data };
  }

  /**
   * Phase 13.2.C — Detail 1 season đã chốt: full top-N sect + top-N cá
   * nhân. 404 nếu chưa snapshot (`SNAPSHOT_NOT_FOUND`).
   */
  @Get('history/:seasonKey')
  async historyDetail(@Param('seasonKey') seasonKey: string) {
    try {
      const data = await this.sectSeasonHistory.getHistory(seasonKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 13.2.C — Hall of Fame aggregate qua mọi season đã chốt. Trả
   * `sects` + `members` đã sort theo championships/mvps desc.
   */
  @Get('hall-of-fame')
  async hallOfFame() {
    const data = await this.sectSeasonHistory.getHallOfFame();
    return { ok: true, data };
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectSeasonError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'SEASON_NOT_FOUND':
        case 'SECT_SEASON_MILESTONE_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_SEASON_NOT_ELIGIBLE':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_SEASON_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    if (e instanceof SectSeasonHistoryError) {
      switch (e.code) {
        case 'SEASON_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SNAPSHOT_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SEASON_NOT_ENDED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
