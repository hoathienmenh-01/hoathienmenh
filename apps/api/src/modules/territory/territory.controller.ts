import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TerritoryError, TerritoryService } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';
import { TerritoryWarService } from './territory-war.service';
import { AuthService } from '../auth/auth.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 14.0.A + 14.0.B — Territory REST endpoints.
 *
 * Endpoints:
 *   - `GET /territory/regions` — list 9 region + total influence + top sect
 *     + Phase 14.0.B owner snapshot. KHÔNG cần auth (public dashboard).
 *   - `GET /territory/regions/:regionKey/leaderboard` — top 10 sect trong
 *     region. KHÔNG cần auth.
 *   - `GET /territory/regions/:regionKey/history` — Phase 14.0.B settlement
 *     history (current owner + N snapshot gần nhất). KHÔNG cần auth.
 *   - `GET /territory/me` — personal view (per-region rank/points của sect
 *     user + personal contribution). YÊU CẦU auth.
 *
 * Mọi mutation logic server-authoritative qua hooks ở dungeon-run /
 * boss service — controller này chỉ read-only. Settlement trigger ở
 * `AdminTerritoryController` (`/admin/territory/...`).
 */
@Controller('territory')
export class TerritoryController {
  constructor(
    private readonly territory: TerritoryService,
    private readonly settlement: TerritorySettlementService,
    private readonly war: TerritoryWarService,
    private readonly auth: AuthService,
  ) {}

  private async getUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get('regions')
  async regions() {
    const data = await this.territory.getRegions();
    return { ok: true, data };
  }

  @Get('regions/:regionKey/leaderboard')
  async leaderboard(@Param('regionKey') regionKey: string) {
    try {
      const data = await this.territory.getRegionLeaderboard(regionKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('regions/:regionKey/history')
  async history(
    @Param('regionKey') regionKey: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    try {
      const data = await this.settlement.getRegionHistory(regionKey, limit);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = await this.getUserId(req);
    try {
      const data = await this.territory.getMyTerritory(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase 14.0.D — Weekly War Loop endpoints (public read-only)
  // ────────────────────────────────────────────────────────────────────

  @Get('war/current')
  async warCurrent() {
    const data = await this.war.getCurrentTerritoryWarState();
    return { ok: true, data };
  }

  @Get('war/regions/:regionKey')
  async warRegion(@Param('regionKey') regionKey: string) {
    try {
      const data = await this.war.getRegionWarStatus(regionKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('war/history')
  async warHistory(
    @Query('limit', new DefaultValuePipe(8), ParseIntPipe) limit: number,
  ) {
    const data = await this.war.getWarHistory(limit);
    return { ok: true, data };
  }

  private handleErr(e: unknown): never {
    if (e instanceof TerritoryError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'REGION_INVALID':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'PERIOD_INVALID':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
