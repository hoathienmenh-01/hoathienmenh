import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
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
  type SessionErrorCode,
} from '@xuantoi/shared';
import { AuthService, AuthError, type AuthErrorCode } from './auth.service';
import { SessionService } from './session.service';
import { IpHashService } from '../security/ip-hash.service';
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

function userAgentHeader(req: Request): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua.length > 0) return ua;
  if (Array.isArray(ua) && typeof ua[0] === 'string') return ua[0];
  return null;
}

function sessionFail(
  code: SessionErrorCode,
  status: HttpStatus = HttpStatus.BAD_REQUEST,
): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

@Controller('_auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly ipHash: IpHashService,
  ) {}

  private buildCtx(req: Request) {
    const ip = clientIp(req);
    return {
      ip,
      ipHash: this.ipHash.hashIp(ip),
      userAgent: userAgentHeader(req),
    };
  }

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
      const out = await this.auth.register(parsed.data, this.buildCtx(req));
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
      const out = await this.auth.login(parsed.data, this.buildCtx(req));
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
      const out = await this.auth.forgotPassword(parsed.data, this.buildCtx(req));
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
      const out = await this.auth.refresh(
        req.cookies?.[REFRESH_COOKIE],
        this.buildCtx(req),
      );
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

  /**
   * Phase 18.2 — `GET /_auth/sessions`
   *
   * List session của chính user. Trả flag `current=true` cho session
   * gắn với refresh cookie hiện tại (FE highlight).
   *
   * Query `includeRevoked=true` để xem REVOKED/EXPIRED (mặc định chỉ
   * ACTIVE).
   */
  @Get('sessions')
  @RateLimitPolicy('AUTH_REFRESH')
  async listMySessions(
    @Req() req: Request,
    @Query('includeRevoked') includeRevokedRaw?: string,
  ) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const currentSessionId = await this.auth.sessionIdFromRefreshCookie(
      req.cookies?.[REFRESH_COOKIE],
    );
    const includeRevoked = includeRevokedRaw === 'true';
    const out = await this.sessions.listForUser({
      userId,
      currentSessionId,
      includeRevoked,
    });
    return {
      ok: true,
      data: {
        sessions: out.sessions,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Phase 18.2 — `DELETE /_auth/sessions/:id`
   *
   * Revoke 1 session của chính user. Self-ownership guard:
   *   - Nếu session không thuộc user → mask 404 `SESSION_NOT_FOUND`
   *     (chống enumeration). KHÔNG trả 403.
   *   - Nếu session đã revoke → idempotent return 200 với summary.
   *
   * Nếu user revoke session hiện tại (current=true) → clear cookies
   * để FE redirect login.
   */
  @Delete('sessions/:id')
  @HttpCode(200)
  @RateLimitPolicy('AUTH_REFRESH')
  async revokeMySession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') sessionId: string,
  ) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) {
      sessionFail('SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const existing = await this.sessions.findById(sessionId);
    if (!existing || existing.userId !== userId) {
      sessionFail('SESSION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const updated = await this.sessions.revokeSession({
      sessionId,
      reason: 'USER_LOGOUT',
      revokedById: userId,
    });
    const currentSessionId = await this.auth.sessionIdFromRefreshCookie(
      req.cookies?.[REFRESH_COOKIE],
    );
    if (currentSessionId === sessionId) {
      this.clearAuthCookies(res);
    }
    const now = new Date();
    return {
      ok: true,
      data: {
        session: this.sessions.toSummary(
          updated ?? existing,
          currentSessionId,
          now,
        ),
      },
    };
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
