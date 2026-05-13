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
import { AuthService } from '../auth/auth.service';
import {
  ReturnerError,
  ReturnerService,
  type ReturnerStateView,
} from './returner.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('returner')
export class ReturnerController {
  constructor(
    private readonly svc: ReturnerService,
    private readonly auth: AuthService,
  ) {}

  /** GET /returner/state — returner panel data. */
  @Get('state')
  async state(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { state: ReturnerStateView | null } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const state = await this.svc.getState(userId);
    return { ok: true, data: { state } };
  }

  /**
   * POST /returner/check — manual trigger (FE call sau khi login).
   * Idempotent — gọi nhiều lần cùng cycleKey chỉ tạo 1 mail.
   */
  @Post('check')
  @HttpCode(200)
  async check(
    @Req() req: Request,
    @Body() _body: unknown,
  ): Promise<{
    ok: true;
    data: { tier: string | null; mailId: string | null };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.svc.onLogin(userId);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof ReturnerError) {
        if (e.code === 'NO_CHARACTER') fail(e.code, HttpStatus.NOT_FOUND);
        if (e.code === 'INVALID_INPUT') fail(e.code, HttpStatus.BAD_REQUEST);
      }
      throw e;
    }
  }
}
