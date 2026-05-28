/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/mail/mail.controller.ts`.
 *
 * 4 endpoint:
 *  - `GET /mail/me`: auth → inbox(userId) → `{ ok, data: { mails } }`.
 *  - `GET /mail/unread-count`: auth → unreadCount(userId) → `{ ok, data: { count } }`.
 *  - `POST /mail/:id/read`: auth + IdParam (string min 1 max 80) → markRead.
 *  - `POST /mail/:id/claim`: auth + IdParam → claim.
 *
 * Error mapping (`MailError`):
 *  - `NO_CHARACTER` / `MAIL_NOT_FOUND` / `RECIPIENT_NOT_FOUND` → 404
 *  - `ALREADY_CLAIMED` / `MAIL_EXPIRED` / `NO_REWARD` → 409
 *  - `INVALID_INPUT` → 400
 *
 * Test này lock-in:
 *  1. Auth null → 401 cho cả 4 endpoint.
 *  2. IdParam zod fail → 400 INVALID_INPUT (id rỗng / quá 80 ký tự).
 *  3. Delegate đúng args.
 *  4. Envelope strict.
 *  5. MailError 7-code mapping {404,404,404,409,409,409,400}.
 *  6. unreadCount KHÔNG dùng try/catch → MailError sẽ leak 500
 *     (lock-in current behavior; nếu sau này sửa, test sẽ fail và buộc cập nhật).
 *  7. Unknown error rethrow nguyên cho 3 endpoint còn lại.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { MailController } from './mail.controller';
import {
  MailError,
  type MailService,
  type MailView,
} from './mail.service';
import type { AuthService } from '../auth/auth.service';

const STUB_MAIL: MailView = {
  id: 'm1',
  senderName: 'system',
  subject: 'hello',
  body: '',
  createdAt: '2026-04-30T12:00:00.000Z',
  expiresAt: null,
  readAt: null,
  claimedAt: null,
  rewardLinhThach: '0',
  rewardTienNgoc: 0,
  rewardExp: '0',
  rewardItems: [],
  claimable: false,
  // Phase 31.0
  mailType: 'SYSTEM',
  status: 'UNREAD',
  deleted: false,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    inboxImpl?: (uid: string) => Promise<MailView[]>;
    unreadImpl?: (uid: string) => Promise<number>;
    readImpl?: (uid: string, id: string) => Promise<MailView>;
    claimImpl?: (uid: string, id: string) => Promise<MailView>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const mail = {
    inbox: opts.inboxImpl ?? (async () => []),
    unreadCount: opts.unreadImpl ?? (async () => 0),
    markRead: opts.readImpl ?? (async () => STUB_MAIL),
    claim: opts.claimImpl ?? (async () => STUB_MAIL),
  } as unknown as MailService;
  const featureFlags = { requireEnabled: async () => {} } as any;
  return new MailController(mail, auth, featureFlags);
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

describe('MailController', () => {
  describe('auth — 401 cho cả 4 endpoint', () => {
    it('GET /mail/me 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.inbox(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('GET /mail/unread-count 401 khi auth null', async () => {
      const c = makeController({ authedUserId: null });
      await expectHttpError(
        c.unreadCount(makeReq('bad')),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('POST /mail/:id/read 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.read(makeReq(undefined), 'm1'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('POST /mail/:id/claim 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.claim(makeReq(undefined), 'm1', {}),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('GET /mail/me', () => {
    it('200 envelope với mails từ inbox', async () => {
      const list: MailView[] = [STUB_MAIL, { ...STUB_MAIL, id: 'm2' }];
      const c = makeController({ inboxImpl: async () => list });
      const r = await c.inbox(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { mails: list } });
    });
    it('rethrow non-MailError nguyên', async () => {
      const boom = new Error('db down');
      const c = makeController({
        inboxImpl: async () => {
          throw boom;
        },
      });
      await expect(c.inbox(makeReq('valid'))).rejects.toBe(boom);
    });
  });

  describe('GET /mail/unread-count', () => {
    it('200 envelope với count', async () => {
      const c = makeController({ unreadImpl: async () => 7 });
      const r = await c.unreadCount(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { count: 7 } });
    });
    it('count = 0 cho user mới', async () => {
      const c = makeController({ unreadImpl: async () => 0 });
      const r = await c.unreadCount(makeReq('valid'));
      expect(r.data.count).toBe(0);
    });
    it('rethrow error nguyên (no try/catch trong endpoint này)', async () => {
      const boom = new Error('redis down');
      const c = makeController({
        unreadImpl: async () => {
          throw boom;
        },
      });
      await expect(c.unreadCount(makeReq('valid'))).rejects.toBe(boom);
    });
  });

  describe('POST /mail/:id/read — IdParam zod', () => {
    it('400 INVALID_INPUT khi id rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.read(makeReq('valid'), ''),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi id dài hơn 80 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.read(makeReq('valid'), 'x'.repeat(81)),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope khi delegate ok; truyền (userId, id)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        readImpl: async (uid, id) => {
          calls.push([uid, id]);
          return STUB_MAIL;
        },
      });
      const r = await c.read(makeReq('valid'), 'm1');
      expect(r).toEqual({ ok: true, data: { mail: STUB_MAIL } });
      expect(calls).toEqual([['u1', 'm1']]);
    });
    it('id đúng max 80 ký tự được accept', async () => {
      const c = makeController();
      const r = await c.read(makeReq('valid'), 'x'.repeat(80));
      expect(r.ok).toBe(true);
    });
  });

  describe('POST /mail/:id/claim — IdParam zod', () => {
    it('400 khi id rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.claim(makeReq('valid'), '', {}),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope; delegate (userId, id) — body bị bỏ qua', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        claimImpl: async (uid, id) => {
          calls.push([uid, id]);
          return STUB_MAIL;
        },
      });
      const r = await c.claim(makeReq('valid'), 'm1', { junk: 'ignored' });
      expect(r).toEqual({ ok: true, data: { mail: STUB_MAIL } });
      expect(calls).toEqual([['u1', 'm1']]);
    });
  });

  describe('MailError 7-code mapping (qua claim endpoint)', () => {
    const cases: Array<[
      | 'NO_CHARACTER'
      | 'MAIL_NOT_FOUND'
      | 'RECIPIENT_NOT_FOUND'
      | 'ALREADY_CLAIMED'
      | 'MAIL_EXPIRED'
      | 'NO_REWARD'
      | 'INVALID_INPUT',
      number,
    ]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['MAIL_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['RECIPIENT_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ALREADY_CLAIMED', HttpStatus.CONFLICT],
      ['MAIL_EXPIRED', HttpStatus.CONFLICT],
      ['NO_REWARD', HttpStatus.CONFLICT],
      ['INVALID_INPUT', HttpStatus.BAD_REQUEST],
    ];
    for (const [code, status] of cases) {
      it(`MailError(${code}) → ${status}`, async () => {
        const c = makeController({
          claimImpl: async () => {
            throw new MailError(code);
          },
        });
        await expectHttpError(
          c.claim(makeReq('valid'), 'm1', {}),
          status,
          code,
        );
      });
    }

    it('markRead cũng đi qua handleErr — MailError(MAIL_NOT_FOUND) → 404', async () => {
      const c = makeController({
        readImpl: async () => {
          throw new MailError('MAIL_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.read(makeReq('valid'), 'm1'),
        HttpStatus.NOT_FOUND,
        'MAIL_NOT_FOUND',
      );
    });

    it('rethrow non-MailError nguyên (claim endpoint)', async () => {
      const boom = new Error('boom');
      const c = makeController({
        claimImpl: async () => {
          throw boom;
        },
      });
      await expect(c.claim(makeReq('valid'), 'm1', {})).rejects.toBe(boom);
    });
  });
});
