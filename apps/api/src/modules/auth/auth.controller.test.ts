/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/auth/auth.controller.ts`.
 *
 * 8 endpoint:
 *  - `POST /_auth/register`: zod RegisterInput → register + setAuthCookies.
 *  - `POST /_auth/login`: zod LoginInput → login + setAuthCookies. Catch-all → 401 INVALID_CREDENTIALS.
 *  - `POST /_auth/forgot-password`: zod silent-ok pattern (anti-enumeration). Chỉ throw RATE_LIMITED.
 *  - `POST /_auth/reset-password`: zod ResetPasswordInput → resetPassword.
 *  - `POST /_auth/change-password`: zod ChangePasswordInput → changePassword (require auth).
 *  - `GET /_auth/session`: cookie-based → session (truyền access cookie, có thể undefined).
 *  - `POST /_auth/refresh`: cookie-based → refresh + setAuthCookies; AuthError → clearAuthCookies trước fail.
 *  - `POST /_auth/logout`: cookie-based logout + clearAuthCookies (luôn 200).
 *  - `POST /_auth/logout-all`: auth-required → logoutAll + clearAuthCookies.
 *
 * AuthError → status mapping (`statusForCode`):
 *  - `EMAIL_TAKEN` / `WEAK_PASSWORD` / `INVALID_RESET_TOKEN` → 400
 *  - `RATE_LIMITED` → 429
 *  - `ACCOUNT_BANNED` → 403
 *  - `UNAUTHENTICATED` / `SESSION_EXPIRED` / `INVALID_CREDENTIALS` / `OLD_PASSWORD_WRONG` / default → 401
 *
 * Lock-in invariants critical to security:
 *  1. forgot-password: silent ok cho mọi error trừ RATE_LIMITED → chống user enumeration.
 *  2. login: AuthError-known → fail với code đó; unknown error → fail INVALID_CREDENTIALS 401 (không leak).
 *  3. refresh: khi AuthError → clearAuthCookies TRƯỚC khi fail (session invalidated).
 *  4. logout: KHÔNG cần auth — luôn 200, clearCookies (idempotent).
 *  5. logout-all: cần auth — 401 nếu không cookie.
 *  6. setAuthCookies: trong dev `secure: false`; trong prod `secure: true`.
 *  7. clientIp prefer x-forwarded-for[0] → fallback req.ip → 'unknown'.
 *  8. RegisterInput zod: WEAK_PASSWORD nếu < 8 ký tự / không chữ / không số.
 *  9. session: token undefined OK — service tự xử lý → có thể trả AuthError hoặc user.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthError, type AuthService } from './auth.service';

const STUB_USER = {
  id: 'u1',
  email: 'a@b.com',
  role: 'PLAYER',
  createdAt: new Date().toISOString(),
} as unknown as Awaited<ReturnType<AuthService['session']>>;

const STUB_AUTH_OUT = {
  user: STUB_USER,
  accessToken: 'access-jwt',
  refreshToken: 'refresh-jwt',
};

interface CookieRecord {
  name: string;
  value: string;
  opts: {
    httpOnly?: boolean;
    sameSite?: string;
    secure?: boolean;
    maxAge?: number;
    path?: string;
  };
}

function makeReq(opts: {
  access?: string;
  refresh?: string;
  ip?: string;
  xff?: string | string[];
}): Request {
  const cookies: Record<string, string> = {};
  if (opts.access) cookies.xt_access = opts.access;
  if (opts.refresh) cookies.xt_refresh = opts.refresh;
  return {
    cookies,
    ip: opts.ip,
    headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {},
  } as unknown as Request;
}

function makeRes() {
  const cookies: CookieRecord[] = [];
  const cleared: Array<{ name: string; opts: { path?: string } }> = [];
  const res = {
    cookie: (name: string, value: string, opts: CookieRecord['opts']) => {
      cookies.push({ name, value, opts });
    },
    clearCookie: (name: string, opts: { path?: string }) => {
      cleared.push({ name, opts });
    },
  } as unknown as Response;
  return { res, cookies, cleared };
}

function makeController(
  opts: Partial<AuthService> = {},
  sessionStubs: Partial<{
    listForUser: (...args: unknown[]) => Promise<{ sessions: unknown[] }>;
    findById: (...args: unknown[]) => Promise<unknown>;
    revokeSession: (...args: unknown[]) => Promise<unknown>;
    toSummary: (...args: unknown[]) => unknown;
  }> = {},
) {
  const auth = {
    register: opts.register ?? (async () => STUB_AUTH_OUT),
    login: opts.login ?? (async () => STUB_AUTH_OUT),
    forgotPassword: opts.forgotPassword ?? (async () => ({ devToken: 'dev-tok' })),
    resetPassword: opts.resetPassword ?? (async () => undefined),
    changePassword: opts.changePassword ?? (async () => undefined),
    session: opts.session ?? (async () => STUB_USER),
    refresh: opts.refresh ?? (async () => STUB_AUTH_OUT),
    logout: opts.logout ?? (async () => ({ sessionId: null })),
    logoutAll: opts.logoutAll ?? (async () => ({ revoked: 3 })),
    userIdFromAccess: opts.userIdFromAccess ?? (async () => 'u1'),
    sessionIdFromRefreshCookie:
      (opts as { sessionIdFromRefreshCookie?: unknown })
        .sessionIdFromRefreshCookie ?? (async () => null),
  } as unknown as AuthService;
  const sessions = {
    listForUser: sessionStubs.listForUser ?? (async () => ({ sessions: [] })),
    findById: sessionStubs.findById ?? (async () => null),
    revokeSession: sessionStubs.revokeSession ?? (async () => null),
    toSummary:
      sessionStubs.toSummary ??
      ((row: unknown) => row as Record<string, unknown>),
  } as unknown as import('./session.service').SessionService;
  const ipHash = {
    hashIp: (ip: string | null) => (ip ? `hash:${ip}` : null),
  } as unknown as import('../security/ip-hash.service').IpHashService;
  return new AuthController(auth, sessions, ipHash);
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
    throw new Error('expected throw');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ ok: false, error: { code } });
  }
}

const VALID_REGISTER = { email: 'a@b.com', password: 'pass1234' };
const VALID_LOGIN = { email: 'a@b.com', password: 'pass1234' };
const VALID_RESET = { token: 'x'.repeat(20), newPassword: 'pass1234' };
const VALID_CHANGE = { oldPassword: 'old1234A', newPassword: 'newpass1234' };

describe('AuthController', () => {
  describe('POST /_auth/register', () => {
    it('400 WEAK_PASSWORD khi password < 8 ký tự', async () => {
      const { res } = makeRes();
      const c = makeController();
      await expectHttpError(
        c.register({ email: 'a@b.com', password: 'p1' }, makeReq({}), res),
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
      );
    });
    it('400 WEAK_PASSWORD khi password không có chữ', async () => {
      const { res } = makeRes();
      const c = makeController();
      await expectHttpError(
        c.register(
          { email: 'a@b.com', password: '12345678' },
          makeReq({}),
          res,
        ),
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
      );
    });
    it('400 WEAK_PASSWORD khi password không có số', async () => {
      const { res } = makeRes();
      const c = makeController();
      await expectHttpError(
        c.register(
          { email: 'a@b.com', password: 'abcdefgh' },
          makeReq({}),
          res,
        ),
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
      );
    });
    it('400 khi email không hợp lệ', async () => {
      const { res } = makeRes();
      const c = makeController();
      await expectHttpError(
        c.register({ email: 'not-email', password: 'pass1234' }, makeReq({}), res),
        HttpStatus.BAD_REQUEST,
        'WEAK_PASSWORD',
      );
    });
    it('200 + setAuthCookies; truyền clientIp', async () => {
      const { res, cookies } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (input: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      const r = await c.register(VALID_REGISTER, makeReq({ ip: '1.2.3.4' }), res);
      expect(r).toEqual({ ok: true, data: { user: STUB_USER } });
      expect(calls).toEqual([{ ip: '1.2.3.4' }]);
      expect(cookies.length).toBe(2);
      expect(cookies[0]?.name).toBe('xt_access');
      expect(cookies[0]?.value).toBe('access-jwt');
      expect(cookies[1]?.name).toBe('xt_refresh');
      expect(cookies[1]?.value).toBe('refresh-jwt');
      expect(cookies[0]?.opts.httpOnly).toBe(true);
      expect(cookies[0]?.opts.sameSite).toBe('lax');
    });
    it('AuthError(EMAIL_TAKEN) → 400', async () => {
      const { res } = makeRes();
      const c = makeController({
        register: (async () => {
          throw new AuthError('EMAIL_TAKEN');
        }) as unknown as AuthService['register'],
      });
      await expectHttpError(
        c.register(VALID_REGISTER, makeReq({}), res),
        HttpStatus.BAD_REQUEST,
        'EMAIL_TAKEN',
      );
    });
    it('AuthError(RATE_LIMITED) → 429', async () => {
      const { res } = makeRes();
      const c = makeController({
        register: (async () => {
          throw new AuthError('RATE_LIMITED');
        }) as unknown as AuthService['register'],
      });
      await expectHttpError(
        c.register(VALID_REGISTER, makeReq({}), res),
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
      );
    });
    it('rethrow non-AuthError', async () => {
      const { res } = makeRes();
      const boom = new Error('db down');
      const c = makeController({
        register: (async () => {
          throw boom;
        }) as unknown as AuthService['register'],
      });
      await expect(
        c.register(VALID_REGISTER, makeReq({}), res),
      ).rejects.toBe(boom);
    });
  });

  describe('POST /_auth/login', () => {
    it('401 INVALID_CREDENTIALS khi zod fail (không leak shape)', async () => {
      const { res } = makeRes();
      const c = makeController();
      await expectHttpError(
        c.login({ email: 'not-email', password: '' }, makeReq({}), res),
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
      );
    });
    it('200 + setAuthCookies; truyền clientIp', async () => {
      const { res, cookies } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        login: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['login'],
      });
      const r = await c.login(VALID_LOGIN, makeReq({ ip: '5.6.7.8' }), res);
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([{ ip: '5.6.7.8' }]);
      expect(cookies.length).toBe(2);
    });
    it('AuthError(INVALID_CREDENTIALS) → 401', async () => {
      const { res } = makeRes();
      const c = makeController({
        login: (async () => {
          throw new AuthError('INVALID_CREDENTIALS');
        }) as unknown as AuthService['login'],
      });
      await expectHttpError(
        c.login(VALID_LOGIN, makeReq({}), res),
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
      );
    });
    it('AuthError(ACCOUNT_BANNED) → 403', async () => {
      const { res } = makeRes();
      const c = makeController({
        login: (async () => {
          throw new AuthError('ACCOUNT_BANNED');
        }) as unknown as AuthService['login'],
      });
      await expectHttpError(
        c.login(VALID_LOGIN, makeReq({}), res),
        HttpStatus.FORBIDDEN,
        'ACCOUNT_BANNED',
      );
    });
    it('non-AuthError → fail INVALID_CREDENTIALS 401 (catch-all anti-leak)', async () => {
      const { res } = makeRes();
      const c = makeController({
        login: (async () => {
          throw new Error('db down');
        }) as unknown as AuthService['login'],
      });
      await expectHttpError(
        c.login(VALID_LOGIN, makeReq({}), res),
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
      );
    });
  });

  describe('POST /_auth/forgot-password — silent-ok anti-enumeration', () => {
    it('200 silent-ok khi zod fail (KHÔNG 400)', async () => {
      const c = makeController();
      const r = await c.forgotPassword({ email: 'not-an-email' }, makeReq({}));
      expect(r).toEqual({ ok: true, data: { ok: true } });
    });
    it('200 với devToken khi service ok (dev mode helper)', async () => {
      const c = makeController({
        forgotPassword: (async () => ({ devToken: 'tok-abc' })) as unknown as AuthService['forgotPassword'],
      });
      const r = await c.forgotPassword({ email: 'a@b.com' }, makeReq({}));
      expect(r).toEqual({
        ok: true,
        data: { ok: true, devToken: 'tok-abc' },
      });
    });
    it('200 silent-ok khi service throw non-RATE_LIMITED AuthError', async () => {
      const c = makeController({
        forgotPassword: (async () => {
          throw new AuthError('UNAUTHENTICATED');
        }) as unknown as AuthService['forgotPassword'],
      });
      const r = await c.forgotPassword({ email: 'a@b.com' }, makeReq({}));
      expect(r).toEqual({ ok: true, data: { ok: true } });
    });
    it('200 silent-ok khi service throw plain Error', async () => {
      const c = makeController({
        forgotPassword: (async () => {
          throw new Error('db down');
        }) as unknown as AuthService['forgotPassword'],
      });
      const r = await c.forgotPassword({ email: 'a@b.com' }, makeReq({}));
      expect(r).toEqual({ ok: true, data: { ok: true } });
    });
    it('429 RATE_LIMITED — chỉ AuthError(RATE_LIMITED) mới throw', async () => {
      const c = makeController({
        forgotPassword: (async () => {
          throw new AuthError('RATE_LIMITED');
        }) as unknown as AuthService['forgotPassword'],
      });
      await expectHttpError(
        c.forgotPassword({ email: 'a@b.com' }, makeReq({})),
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
      );
    });
  });

  describe('POST /_auth/reset-password', () => {
    it('400 INVALID_RESET_TOKEN khi token < 16 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.resetPassword({ token: 'short', newPassword: 'pass1234' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_RESET_TOKEN',
      );
    });
    it('400 INVALID_RESET_TOKEN khi password yếu', async () => {
      const c = makeController();
      await expectHttpError(
        c.resetPassword({ token: 'x'.repeat(20), newPassword: 'short' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_RESET_TOKEN',
      );
    });
    it('200 ok khi service ok', async () => {
      const c = makeController();
      const r = await c.resetPassword(VALID_RESET);
      expect(r).toEqual({ ok: true, data: { ok: true } });
    });
    it('AuthError(INVALID_RESET_TOKEN) → 400', async () => {
      const c = makeController({
        resetPassword: (async () => {
          throw new AuthError('INVALID_RESET_TOKEN');
        }) as unknown as AuthService['resetPassword'],
      });
      await expectHttpError(
        c.resetPassword(VALID_RESET),
        HttpStatus.BAD_REQUEST,
        'INVALID_RESET_TOKEN',
      );
    });
  });

  describe('POST /_auth/change-password', () => {
    it('401 OLD_PASSWORD_WRONG khi zod fail (không leak shape)', async () => {
      const c = makeController();
      await expectHttpError(
        c.changePassword({ oldPassword: '', newPassword: 'pass1234' }, makeReq({})),
        HttpStatus.UNAUTHORIZED,
        'OLD_PASSWORD_WRONG',
      );
    });
    it('401 UNAUTHENTICATED khi không có cookie', async () => {
      const c = makeController({
        userIdFromAccess: (async () => null) as unknown as AuthService['userIdFromAccess'],
      });
      await expectHttpError(
        c.changePassword(VALID_CHANGE, makeReq({})),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 ok; truyền (userId, parsed)', async () => {
      const calls: Array<[string, unknown]> = [];
      const c = makeController({
        changePassword: (async (uid: string, inp: unknown) => {
          calls.push([uid, inp]);
          return undefined;
        }) as unknown as AuthService['changePassword'],
      });
      const r = await c.changePassword(VALID_CHANGE, makeReq({ access: 'tok' }));
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual([['u1', VALID_CHANGE]]);
    });
    it('AuthError(OLD_PASSWORD_WRONG) → 401', async () => {
      const c = makeController({
        changePassword: (async () => {
          throw new AuthError('OLD_PASSWORD_WRONG');
        }) as unknown as AuthService['changePassword'],
      });
      await expectHttpError(
        c.changePassword(VALID_CHANGE, makeReq({ access: 'tok' })),
        HttpStatus.UNAUTHORIZED,
        'OLD_PASSWORD_WRONG',
      );
    });
  });

  describe('GET /_auth/session', () => {
    it('200 với user khi service ok', async () => {
      const c = makeController();
      const r = await c.session(makeReq({ access: 'tok' }));
      expect(r).toEqual({ ok: true, data: { user: STUB_USER } });
    });
    it('200 ok dù không có cookie (service tự xử lý)', async () => {
      const c = makeController();
      const r = await c.session(makeReq({}));
      expect(r?.ok).toBe(true);
    });
    it('AuthError(SESSION_EXPIRED) → 401', async () => {
      const c = makeController({
        session: (async () => {
          throw new AuthError('SESSION_EXPIRED');
        }) as unknown as AuthService['session'],
      });
      await expectHttpError(
        c.session(makeReq({ access: 'tok' })),
        HttpStatus.UNAUTHORIZED,
        'SESSION_EXPIRED',
      );
    });
  });

  describe('POST /_auth/refresh — cookies invalidation on AuthError', () => {
    it('200 + setAuthCookies với token mới', async () => {
      const { res, cookies } = makeRes();
      const c = makeController();
      const r = await c.refresh(makeReq({ refresh: 'old-rt' }), res);
      expect(r?.ok).toBe(true);
      expect(cookies.length).toBe(2);
    });
    it('AuthError(SESSION_EXPIRED) → 401 + clearAuthCookies trước khi fail', async () => {
      const { res, cleared } = makeRes();
      const c = makeController({
        refresh: (async () => {
          throw new AuthError('SESSION_EXPIRED');
        }) as unknown as AuthService['refresh'],
      });
      await expectHttpError(
        c.refresh(makeReq({ refresh: 'old-rt' }), res),
        HttpStatus.UNAUTHORIZED,
        'SESSION_EXPIRED',
      );
      expect(cleared.length).toBe(2);
      expect(cleared.map((c) => c.name).sort()).toEqual([
        'xt_access',
        'xt_refresh',
      ]);
    });
    it('rethrow non-AuthError nguyên (không clearCookies)', async () => {
      const { res, cleared } = makeRes();
      const boom = new Error('db down');
      const c = makeController({
        refresh: (async () => {
          throw boom;
        }) as unknown as AuthService['refresh'],
      });
      await expect(c.refresh(makeReq({ refresh: 'rt' }), res)).rejects.toBe(boom);
      expect(cleared.length).toBe(0);
    });
  });

  describe('POST /_auth/logout — idempotent', () => {
    it('200 + clearCookies dù không cookie (idempotent)', async () => {
      const { res, cleared } = makeRes();
      const c = makeController();
      const r = await c.logout(makeReq({}), res);
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(cleared.length).toBe(2);
    });
    it('200 + truyền refreshToken vào service.logout', async () => {
      const { res } = makeRes();
      const calls: Array<string | undefined> = [];
      const c = makeController({
        logout: (async (rt: string | undefined) => {
          calls.push(rt);
        }) as unknown as AuthService['logout'],
      });
      await c.logout(makeReq({ refresh: 'rt-xxx' }), res);
      expect(calls).toEqual(['rt-xxx']);
    });
  });

  describe('POST /_auth/logout-all — auth required', () => {
    it('401 UNAUTHENTICATED khi không cookie', async () => {
      const { res } = makeRes();
      const c = makeController({
        userIdFromAccess: (async () => null) as unknown as AuthService['userIdFromAccess'],
      });
      await expectHttpError(
        c.logoutAll(makeReq({}), res),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 + truyền userId; clearAuthCookies; trả revoked count', async () => {
      const { res, cleared } = makeRes();
      const calls: string[] = [];
      const c = makeController({
        logoutAll: (async (uid: string) => {
          calls.push(uid);
          return { revoked: 7 };
        }) as unknown as AuthService['logoutAll'],
      });
      const r = await c.logoutAll(makeReq({ access: 'tok' }), res);
      expect(r).toEqual({ ok: true, data: { revoked: 7 } });
      expect(calls).toEqual(['u1']);
      expect(cleared.length).toBe(2);
    });
  });

  describe('clientIp + setAuthCookies cookie shape', () => {
    it('xff string → split[0] trim', async () => {
      const { res } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      await c.register(
        VALID_REGISTER,
        makeReq({ xff: '10.0.0.1, 192.168.1.1', ip: '127.0.0.1' }),
        res,
      );
      expect(calls).toEqual([{ ip: '10.0.0.1' }]);
    });
    it('xff array → first element', async () => {
      const { res } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      await c.register(
        VALID_REGISTER,
        makeReq({ xff: ['10.0.0.5'], ip: '127.0.0.1' }),
        res,
      );
      expect(calls).toEqual([{ ip: '10.0.0.5' }]);
    });
    it('không xff + req.ip → req.ip', async () => {
      const { res } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      await c.register(VALID_REGISTER, makeReq({ ip: '127.0.0.1' }), res);
      expect(calls).toEqual([{ ip: '127.0.0.1' }]);
    });
    it('không xff + không req.ip → "unknown"', async () => {
      const { res } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      await c.register(VALID_REGISTER, makeReq({}), res);
      expect(calls).toEqual([{ ip: 'unknown' }]);
    });
    it('xff string rỗng → fallback req.ip', async () => {
      const { res } = makeRes();
      const calls: Array<{ ip: string }> = [];
      const c = makeController({
        register: (async (_i: unknown, ctx: { ip: string }) => {
          calls.push(ctx);
          return STUB_AUTH_OUT;
        }) as unknown as AuthService['register'],
      });
      await c.register(
        VALID_REGISTER,
        makeReq({ xff: '', ip: '127.0.0.1' }),
        res,
      );
      expect(calls).toEqual([{ ip: '127.0.0.1' }]);
    });
    it('cookies httpOnly + sameSite="lax" + path="/"', async () => {
      const { res, cookies } = makeRes();
      const c = makeController();
      await c.login(VALID_LOGIN, makeReq({ ip: '1.1.1.1' }), res);
      for (const cookie of cookies) {
        expect(cookie.opts.httpOnly).toBe(true);
        expect(cookie.opts.sameSite).toBe('lax');
        expect(cookie.opts.path).toBe('/');
      }
    });
    it('cookies maxAge tính theo seconds * 1000 (dev default)', async () => {
      // Default: access 15*60s, refresh 30*24*60*60s → maxAge = ms.
      const prevA = process.env.JWT_ACCESS_TTL;
      const prevR = process.env.JWT_REFRESH_TTL;
      delete process.env.JWT_ACCESS_TTL;
      delete process.env.JWT_REFRESH_TTL;
      try {
        const { res, cookies } = makeRes();
        const c = makeController();
        await c.login(VALID_LOGIN, makeReq({ ip: '1.1.1.1' }), res);
        expect(cookies[0].opts.maxAge).toBe(15 * 60 * 1000);
        expect(cookies[1].opts.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
      } finally {
        if (prevA !== undefined) process.env.JWT_ACCESS_TTL = prevA;
        if (prevR !== undefined) process.env.JWT_REFRESH_TTL = prevR;
      }
    });
  });
});
