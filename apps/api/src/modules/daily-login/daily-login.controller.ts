import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  DailyLoginClaimResult,
  DailyLoginError,
  DailyLoginService,
  DailyLoginStatus,
} from './daily-login.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('daily-login')
export class DailyLoginController {
  constructor(
    private readonly dailyLogin: DailyLoginService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(
    @Req() req: Request,
  ): Promise<{ ok: true; data: DailyLoginStatus }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.dailyLogin.status(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('claim')
  @HttpCode(200)
  @RateLimitPolicy('DAILY_LOGIN_CLAIM')
  async claim(
    @Req() req: Request,
  ): Promise<{ ok: true; data: DailyLoginClaimResult }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.dailyLogin.claim(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof DailyLoginError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
      }
    }
    throw e;
  }
}
