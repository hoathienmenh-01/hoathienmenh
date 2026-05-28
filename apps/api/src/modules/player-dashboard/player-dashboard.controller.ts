import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Optional,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DashboardResponse } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';
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
    private readonly prisma: PrismaService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  @Get()
  async get(@Req() req: Request): Promise<{ ok: true; data: DashboardResponse }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.svc.getDashboard(userId);
      // Phase 44.2 — Onboarding auto-track DASHBOARD_VIEW + NEXT_ACTION_VIEW.
      if (this.onboarding) {
        try {
          const c = await this.prisma.character.findUnique({
            where: { userId },
            select: { id: true },
          });
          if (c) {
            void this.onboarding.notifyAction(c.id, 'DASHBOARD_VIEW');
            void this.onboarding.notifyAction(c.id, 'NEXT_ACTION_VIEW');
          }
        } catch { /* fail-soft */ }
      }
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
