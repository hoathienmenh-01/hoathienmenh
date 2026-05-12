import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { MonetizationError, MonetizationService } from './monetization.service';

const ACCESS_COOKIE = 'xt_access';

const BattlePassClaimInput = z.object({
  level: z.number().int().min(1).max(100),
  track: z.enum(['free', 'premium']),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('monetization')
export class MonetizationController {
  constructor(
    private readonly monetization: MonetizationService,
    private readonly auth: AuthService,
  ) {}

  @Get('battle-pass/current')
  async currentBattlePass(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.currentBattlePass(userId) };
  }

  @Get('battle-pass/progress')
  async battlePassProgress(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.battlePassProgress(userId) };
  }

  @Post('battle-pass/claim')
  @HttpCode(200)
  async claimBattlePass(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = BattlePassClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.monetization.claimBattlePassReward(userId, parsed.data),
      };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Post('battle-pass/claim-all')
  @HttpCode(200)
  async claimAllBattlePass(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      return { ok: true, data: await this.monetization.claimAllBattlePassRewards(userId) };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Get('monthly-card')
  async monthlyCard(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.monthlyCard(userId) };
  }

  @Post('monthly-card/claim')
  @HttpCode(200)
  async claimMonthlyCard(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      return { ok: true, data: await this.monetization.claimMonthlyCard(userId) };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Get('vip')
  async vip(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.vip(userId) };
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private failMonetization(e: unknown): never {
    if (e instanceof MonetizationError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'NO_ACTIVE_SEASON'
          ? HttpStatus.NOT_FOUND
          : e.code === 'ALREADY_CLAIMED' || e.code === 'MONTHLY_CARD_ALREADY_CLAIMED'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
