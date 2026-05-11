import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@xuantoi/shared';
import { AuthService, AuthError, type AuthErrorCode } from './auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';

const ACCESS_COOKIE = 'xt_access';
const REFRESH_COOKIE = 'xt_refresh';

function fail(code: AuthErrorCode, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

function statusForCode(code: AuthErrorCode): HttpStatus {
  switch (code) {
    case 'EMAIL_TAKEN':
    case 'WEAK_PASSWORD':
    case 'INVALID_RESET_TOKEN':
      return HttpStatus.BAD_REQUEST;
    case 'RATE_LIMITED':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'ACCOUNT_BANNED':
      return HttpStatus.FORBIDDEN;
    case 'UNAUTHENTICATED':
    case 'SESSION_EXPIRED':
    case 'INVALID_CREDENTIALS':
    case 'OLD_PASSWORD_WRONG':
    default:
      return HttpStatus.UNAUTHORIZED;
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0];
  return req.ip ?? 'unknown';
}

@Controller('_auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @RateLimitPolicy('AUTH_REGISTER')
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = RegisterInput.safeParse(body);
    if (!parsed.success) fail('WEAK_PASSWORD');

    try {
      const out = await this.auth.register(parsed.data, { ip: clientIp(req) });
      this.setAuthCookies(res, out.accessToken, out.refreshToken);
      return { ok: true, data: { user: out.user } };
    } catch (e) {
      if (e instanceof AuthError) fail(e.code, statusForCode(e.code));
      throw e;
    }
  }

  @Post('login')
  @HttpCode(200)
  @RateLimitPolicy('AUTH_LOGIN')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) fail('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);

    try {
      const out = await this.auth.login(parsed.data, { ip: clientIp(req) });
      this.setAuthCookies(res, out.accessToken, out.refreshToken);
      return { ok: true, data: { user: out.user } };
    } catch (e) {
      if (e instanceof AuthError) fail(e.code, statusForCode(e.code));
      fail('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Forgot-password — silent: dù email tồn tại hay không vẫn trả `{ ok: true }`
   * (chống user enumeration). Trong dev (`NODE_ENV !== 'production'`) trả thêm
   * `devToken` để E2E test không cần Mailhog UI.
   */
  @Post('forgot-password')
  @HttpCode(200)
  @RateLimitPolicy('AUTH_PASSWORD_RESET')
  async forgotPassword(@Body() body: unknown, @Req() req: Request) {
    const parsed = ForgotPasswordInput.safeParse(body);
    if (!parsed.success) {
      // Vẫn trả silent ok để không leak shape error cho user enumeration script.
      return { ok: true, data: { ok: true } };
    }
    try {
      const out = await this.auth.forgotPassword(parsed.data, { ip: clientIp(req) });
      return { ok: true, data: { ok: true, devToken: out.devToken } };
    } catch (e) {
      if (e instanceof AuthError && e.code === 'RATE_LIMITED') {
        fail('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
      }
      // Fail-silent cho mọi lỗi khác (chống enumeration).
      return { ok: true, data: { ok: true } };
    }
  }

  /**
   * Reset password bằng token (đã gửi qua email). Token one-shot,
   * TTL 30 phút (xem `PASSWORD_RESET_TOKEN_TTL_MS`).
   */
  @Post('reset-password')
  @HttpCode(200)
  @RateLimitPolicy('AUTH_PASSWORD_RESET')
  async resetPassword(@Body() body: unknown) {
    const parsed = ResetPasswordInput.safeParse(body);
    if (!parsed.success) fail('INVALID_RESET_TOKEN');
    try {
      await this.auth.resetPassword(parsed.data);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      if (e instanceof AuthError) fail(e.code, statusForCode(e.code));
      throw e;
    }
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body() body: unknown, @Req() req: Request) {
    const parsed = ChangePasswordInput.safeParse(body);
    if (!parsed.success) fail('OLD_PASSWORD_WRONG', HttpStatus.UNAUTHORIZED);

    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);

    try {
      await this.auth.changePassword(userId, parsed.data);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      if (e instanceof AuthError) fail(e.code, statusForCode(e.code));
      throw e;
    }
  }

  @Get('session')
  async session(@Req() req: Request) {
    try {
      const user = await this.auth.session(req.cookies?.[ACCESS_COOKIE]);
      return { ok: true, data: { user } };
    } catch (e) {
      if (e instanceof AuthError) fail(e.code, statusForCode(e.code));
      throw e;
    }
  }

  @Post('refresh')
  @RateLimitPolicy('AUTH_REFRESH')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const out = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], {
        ip: clientIp(req),
      });
      this.setAuthCookies(res, out.accessToken, out.refreshToken);
      return { ok: true, data: { user: out.user } };
    } catch (e) {
      if (e instanceof AuthError) {
        this.clearAuthCookies(res);
        fail(e.code, statusForCode(e.code));
      }
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.clearAuthCookies(res);
    return { ok: true, data: { ok: true } };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const r = await this.auth.logoutAll(userId);
    this.clearAuthCookies(res);
    return { ok: true, data: r };
  }

  private setAuthCookies(res: Response, access: string, refresh: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    const accessTtl = Number(process.env.JWT_ACCESS_TTL ?? 15 * 60);
    const refreshTtl = Number(process.env.JWT_REFRESH_TTL ?? 30 * 24 * 60 * 60);
    res.cookie(ACCESS_COOKIE, access, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: accessTtl * 1000,
      path: '/',
    });
    res.cookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: refreshTtl * 1000,
      path: '/',
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }
}
