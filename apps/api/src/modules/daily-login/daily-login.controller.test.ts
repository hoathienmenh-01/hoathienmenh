/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/daily-login/daily-login.controller.ts`.
 *
 * 2 endpoint: `GET /daily-login/me` + `POST /daily-login/claim`. Mỗi endpoint:
 *   1. Resolve userId qua `auth.userIdFromAccess(cookie)`.
 *   2. Nếu null → 401 `UNAUTHENTICATED`.
 *   3. Delegate `dailyLogin.status(userId)` / `dailyLogin.claim(userId)`.
 *   4. Map `DailyLoginError` → HTTP status (NO_CHARACTER → 404).
 *   5. Wrap `{ ok: true, data }`.
 *
 * Service-level tests đã có; controller layer chưa lock. PR này lock-in:
 *  - 2 auth guard.
 *  - 2 envelope shape.
 *  - 2 delegation arg passthrough (userId).
 *  - 2 error mapping (DailyLoginError NO_CHARACTER → 404).
 *  - 2 unknown error rethrow (không nuốt 500).
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { DailyLoginController } from './daily-login.controller';
import {
  DailyLoginError,
  type DailyLoginService,
  type DailyLoginStatus,
  type DailyLoginClaimResult,
} from './daily-login.service';
import type { AuthService } from '../auth/auth.service';

const STUB_STATUS: DailyLoginStatus = {
  todayDateLocal: '2026-04-30',
  canClaimToday: true,
  currentStreak: 3,
  nextRewardLinhThach: '100',
};

const STUB_CLAIM: DailyLoginClaimResult = {
  claimed: true,
  linhThachDelta: '100',
  baseLinhThach: '100',
  liveOpsBonus: null,
  newStreak: 4,
  claimDateLocal: '2026-04-30',
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(opts: {
  authedUserId?: string | null;
  statusImpl?: (uid: string) => Promise<DailyLoginStatus>;
  claimImpl?: (uid: string) => Promise<DailyLoginClaimResult>;
} = {}) {
  const auth = {
    userIdFromAccess: async (token: string | undefined) =>
      token ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const dailyLogin = {
    status: opts.statusImpl ?? (async () => STUB_STATUS),
    claim: opts.claimImpl ?? (async () => STUB_CLAIM),
  } as unknown as DailyLoginService;
  return new DailyLoginController(dailyLogin, auth);
}

describe('DailyLoginController', () => {
  describe('GET /daily-login/me', () => {
    it('401 UNAUTHENTICATED khi không cookie', async () => {
      const c = makeController();
      try {
        await c.me(makeReq(undefined));
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const err = e as HttpException;
        expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(err.getResponse()).toMatchObject({
          ok: false,
          error: { code: 'UNAUTHENTICATED' },
        });
      }
    });

    it('401 khi auth resolve null userId', async () => {
      const c = makeController({ authedUserId: null });
      await expect(c.me(makeReq('bad'))).rejects.toThrow(HttpException);
    });

    it('happy path → { ok: true, data: status } với userId truyền nguyên', async () => {
      let receivedUid: string | undefined;
      const c = makeController({
        statusImpl: async (uid) => {
          receivedUid = uid;
          return STUB_STATUS;
        },
      });
      const r = await c.me(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: STUB_STATUS });
      expect(receivedUid).toBe('u1');
    });

    it('DailyLoginError NO_CHARACTER → 404', async () => {
      const c = makeController({
        statusImpl: async () => {
          throw new DailyLoginError('NO_CHARACTER');
        },
      });
      try {
        await c.me(makeReq('valid'));
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const err = e as HttpException;
        expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(err.getResponse()).toMatchObject({
          ok: false,
          error: { code: 'NO_CHARACTER' },
        });
      }
    });

    it('unknown error rethrow nguyên (không nuốt 500)', async () => {
      const boom = new Error('db connection lost');
      const c = makeController({
        statusImpl: async () => {
          throw boom;
        },
      });
      await expect(c.me(makeReq('valid'))).rejects.toBe(boom);
    });
  });

  describe('POST /daily-login/claim', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expect(c.claim(makeReq(undefined))).rejects.toThrow(HttpException);
    });

    it('happy path → { ok: true, data: claimResult } với userId passthrough', async () => {
      let receivedUid: string | undefined;
      const c = makeController({
        claimImpl: async (uid) => {
          receivedUid = uid;
          return STUB_CLAIM;
        },
      });
      const r = await c.claim(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: STUB_CLAIM });
      expect(receivedUid).toBe('u1');
    });

    it('idempotent reclaim → claimed=false, linhThachDelta="0"', async () => {
      const idempotentResult: DailyLoginClaimResult = {
        claimed: false,
        linhThachDelta: '0',
        baseLinhThach: '100',
        liveOpsBonus: null,
        newStreak: 4,
        claimDateLocal: '2026-04-30',
      };
      const c = makeController({ claimImpl: async () => idempotentResult });
      const r = await c.claim(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: idempotentResult });
    });

    it('DailyLoginError NO_CHARACTER → 404 (claim không có char)', async () => {
      const c = makeController({
        claimImpl: async () => {
          throw new DailyLoginError('NO_CHARACTER');
        },
      });
      try {
        await c.claim(makeReq('valid'));
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });

    it('unknown error rethrow', async () => {
      const boom = new Error('redis down');
      const c = makeController({
        claimImpl: async () => {
          throw boom;
        },
      });
      await expect(c.claim(makeReq('valid'))).rejects.toBe(boom);
    });
  });

  describe('access cookie passthrough', () => {
    it('cookie value chuyển nguyên đến auth.userIdFromAccess', async () => {
      let received: string | undefined;
      const auth = {
        userIdFromAccess: async (t: string | undefined) => {
          received = t;
          return 'u1';
        },
      } as unknown as AuthService;
      const dailyLogin = {
        status: async () => STUB_STATUS,
        claim: async () => STUB_CLAIM,
      } as unknown as DailyLoginService;
      const c = new DailyLoginController(dailyLogin, auth);
      await c.me(makeReq('cookie-X'));
      expect(received).toBe('cookie-X');
    });
  });
});
