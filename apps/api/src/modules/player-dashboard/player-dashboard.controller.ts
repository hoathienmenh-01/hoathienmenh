import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DashboardResponse } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import {
  DashboardError,
  PlayerDashboardService,
} from './player-dashboard.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('player/dashboard')
export class PlayerDashboardController {
  constructor(
    private readonly svc: PlayerDashboardService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async get(@Req() req: Request): Promise<{ ok: true; data: DashboardResponse }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.svc.getDashboard(userId);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof DashboardError) {
        if (e.code === 'NO_CHARACTER') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
        fail('DASHBOARD_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw e;
    }
  }
}
