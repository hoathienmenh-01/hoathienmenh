/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/sect/sect.controller.ts`.
 *
 * 6 endpoint:
 *  - `GET /sect/list`: PUBLIC (no auth) → list().
 *  - `GET /sect/me`: auth + character → 401/404 + nullable sect.
 *  - `GET /sect/:id`: PUBLIC-after-auth (viewer characterId nullable) → detail().
 *  - `POST /sect/create`: auth + zod (name 2..16 + description max 200 default '') → create.
 *  - `POST /sect/:id/join`: auth (no zod) → join.
 *  - `POST /sect/leave`: auth (no body) → leave.
 *  - `POST /sect/contribute`: auth + zod (amount string-or-int → BigInt positive) → contribute.
 *
 * Auth: `getViewer` (NOT `requireCharacter`) — không fail-fast, chỉ resolve userId|null
 * và characterId|null. Endpoint tự gọi `fail('UNAUTHENTICATED'|'NO_CHARACTER')` nếu cần.
 *
 * Error mapping (`SectError` instanceof + switch, KHÁC market duck-typing):
 *  - `NO_CHARACTER` / `SECT_NOT_FOUND` → 404
 *  - `INVALID_AMOUNT` / `INVALID_NAME` → 400
 *  - `NOT_IN_SECT` / `ALREADY_IN_SECT` / `INSUFFICIENT_LINH_THACH` / `NAME_TAKEN` → 409
 *  - default → rethrow
 *
 * Lock-in invariants:
 *  1. /sect/list PUBLIC (cookie missing không 401) — trang xếp hạng pre-auth.
 *  2. /sect/me trả `{ sect: null }` (NOT throw) khi character không trong sect → khác /sect/:id.
 *  3. /sect/:id chỉ cần auth optional → characterId nullable truyền vào service detail().
 *  4. CreateInput.description default '' (zod transform) → service nhận '' không undefined.
 *  5. ContributeInput.amount transform → BigInt; service nhận BigInt.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { SectController } from './sect.controller';
import {
  SectError,
  type SectService,
  type SectListView,
  type SectDetailView,
} from './sect.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_SECT_LIST: SectListView[] = [];
const STUB_SECT_DETAIL: SectDetailView = {} as SectDetailView;

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

interface CharacterRow {
  id?: string;
  sectId?: string | null;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    /** First findUnique by userId returns this character row; null = no character. */
    characterByUserId?: { id: string; sectId?: string | null } | null;
    /** Second findUnique by characterId (only used in /sect/me to read sectId). */
    characterById?: { sectId: string | null } | null;
    listImpl?: () => Promise<SectListView[]>;
    detailImpl?: (
      sectId: string,
      viewerCharId: string | null,
    ) => Promise<SectDetailView>;
    createImpl?: (
      uid: string,
      name: string,
      desc: string,
    ) => Promise<SectDetailView>;
    joinImpl?: (uid: string, sectId: string) => Promise<SectDetailView>;
    leaveImpl?: (uid: string) => Promise<{ ok: true }>;
    contributeImpl?: (uid: string, amount: bigint) => Promise<SectDetailView>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const prisma = {
    character: {
      findUnique: async (args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId !== undefined) {
          // First lookup: by userId
          if (opts.characterByUserId === null) return null;
          return (opts.characterByUserId ?? { id: 'c1', sectId: null }) as CharacterRow;
        }
        // Second lookup: by characterId (only in /sect/me)
        if (opts.characterById === null) return null;
        return (opts.characterById ?? { sectId: null }) as CharacterRow;
      },
    },
  } as unknown as PrismaService;
  const sect = {
    list: opts.listImpl ?? (async () => STUB_SECT_LIST),
    detail: opts.detailImpl ?? (async () => STUB_SECT_DETAIL),
    create: opts.createImpl ?? (async () => STUB_SECT_DETAIL),
    join: opts.joinImpl ?? (async () => STUB_SECT_DETAIL),
    leave: opts.leaveImpl ?? (async () => ({ ok: true as const })),
    contribute: opts.contributeImpl ?? (async () => STUB_SECT_DETAIL),
  } as unknown as SectService;
  return new SectController(sect, auth, prisma);
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

describe('SectController', () => {
  describe('GET /sect/list — PUBLIC', () => {
    it('200 envelope { sects } khi không cookie (no auth)', async () => {
      const c = makeController();
      const r = await c.list(makeReq(undefined));
      expect(r).toEqual({ ok: true, data: { sects: STUB_SECT_LIST } });
    });
    it('list() async → controller await trước khi return', async () => {
      let resolved = false;
      const c = makeController({
        listImpl: async () => {
          resolved = true;
          return STUB_SECT_LIST;
        },
      });
      await c.list(makeReq(undefined));
      expect(resolved).toBe(true);
    });
  });

  describe('GET /sect/me — auth + character + nullable sect', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.me(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('404 NO_CHARACTER khi user chưa tạo character', async () => {
      const c = makeController({ characterByUserId: null });
      await expectHttpError(
        c.me(makeReq('valid')),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
    it('200 + sect=null khi character không thuộc sect nào (KHÔNG throw)', async () => {
      const c = makeController({
        characterByUserId: { id: 'c1', sectId: null },
        characterById: { sectId: null },
      });
      const r = await c.me(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { sect: null } });
    });
    it('200 + sect detail khi character có sectId; gọi detail(sectId, characterId)', async () => {
      const calls: Array<[string, string | null]> = [];
      const c = makeController({
        characterByUserId: { id: 'c1', sectId: 's1' },
        characterById: { sectId: 's1' },
        detailImpl: async (sid, vid) => {
          calls.push([sid, vid]);
          return STUB_SECT_DETAIL;
        },
      });
      const r = await c.me(makeReq('valid'));
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['s1', 'c1']]);
    });
  });

  describe('GET /sect/:id — PUBLIC-after-auth (characterId nullable)', () => {
    it('200 với characterId=null khi không cookie', async () => {
      const calls: Array<[string, string | null]> = [];
      const c = makeController({
        detailImpl: async (sid, vid) => {
          calls.push([sid, vid]);
          return STUB_SECT_DETAIL;
        },
      });
      const r = await c.get(makeReq(undefined), 's1');
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['s1', null]]);
    });
    it('200 với characterId khi authed', async () => {
      const calls: Array<[string, string | null]> = [];
      const c = makeController({
        detailImpl: async (sid, vid) => {
          calls.push([sid, vid]);
          return STUB_SECT_DETAIL;
        },
      });
      const r = await c.get(makeReq('valid'), 's42');
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['s42', 'c1']]);
    });
    it('404 SECT_NOT_FOUND qua handleErr', async () => {
      const c = makeController({
        detailImpl: async () => {
          throw new SectError('SECT_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.get(makeReq('valid'), 's-unknown'),
        HttpStatus.NOT_FOUND,
        'SECT_NOT_FOUND',
      );
    });
  });

  describe('POST /sect/create — zod', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.create(makeReq(undefined), { name: 'Tả Khâu', description: '' }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.create(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi name < 2 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.create(makeReq('valid'), { name: 'A' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi name > 16 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.create(makeReq('valid'), { name: 'x'.repeat(17) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi description > 200 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.create(makeReq('valid'), { name: 'Sect', description: 'x'.repeat(201) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 + description default "" khi không truyền', async () => {
      const calls: Array<[string, string, string]> = [];
      const c = makeController({
        createImpl: async (uid, name, desc) => {
          calls.push([uid, name, desc]);
          return STUB_SECT_DETAIL;
        },
      });
      const r = await c.create(makeReq('valid'), { name: 'NewSect' });
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([['u1', 'NewSect', '']]);
    });
    it('200; truyền (userId, name, description)', async () => {
      const calls: Array<[string, string, string]> = [];
      const c = makeController({
        createImpl: async (uid, n, d) => {
          calls.push([uid, n, d]);
          return STUB_SECT_DETAIL;
        },
      });
      await c.create(makeReq('valid'), { name: 'Test Sect', description: 'desc' });
      expect(calls).toEqual([['u1', 'Test Sect', 'desc']]);
    });
  });

  describe('POST /sect/:id/join', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.join(makeReq(undefined), 's1'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 envelope; truyền (userId, sectId)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        joinImpl: async (uid, sid) => {
          calls.push([uid, sid]);
          return STUB_SECT_DETAIL;
        },
      });
      const r = await c.join(makeReq('valid'), 's42');
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([['u1', 's42']]);
    });
  });

  describe('POST /sect/leave', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.leave(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 envelope { ok: true } truyền (userId)', async () => {
      const calls: string[] = [];
      const c = makeController({
        leaveImpl: async (uid) => {
          calls.push(uid);
          return { ok: true as const };
        },
      });
      const r = await c.leave(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual(['u1']);
    });
  });

  describe('POST /sect/contribute — zod amount → BigInt', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.contribute(makeReq(undefined), { amount: '100' }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.contribute(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi amount âm', async () => {
      const c = makeController();
      await expectHttpError(
        c.contribute(makeReq('valid'), { amount: -1 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi amount string negative', async () => {
      const c = makeController();
      await expectHttpError(
        c.contribute(makeReq('valid'), { amount: '-100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi amount=0', async () => {
      const c = makeController();
      await expectHttpError(
        c.contribute(makeReq('valid'), { amount: 0 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; amount string → BigInt', async () => {
      const calls: Array<[string, bigint]> = [];
      const c = makeController({
        contributeImpl: async (uid, amt) => {
          calls.push([uid, amt]);
          return STUB_SECT_DETAIL;
        },
      });
      await c.contribute(makeReq('valid'), { amount: '500' });
      expect(calls).toHaveLength(1);
      expect(typeof calls[0][1]).toBe('bigint');
      expect(calls[0]).toEqual(['u1', 500n]);
    });
    it('200; amount number → BigInt', async () => {
      const calls: Array<[string, bigint]> = [];
      const c = makeController({
        contributeImpl: async (uid, amt) => {
          calls.push([uid, amt]);
          return STUB_SECT_DETAIL;
        },
      });
      await c.contribute(makeReq('valid'), { amount: 999 });
      expect(calls[0]).toEqual(['u1', 999n]);
    });
  });

  describe('handleErr — SectError instanceof + switch', () => {
    const cases: Array<[
      | 'NO_CHARACTER'
      | 'SECT_NOT_FOUND'
      | 'INVALID_AMOUNT'
      | 'INVALID_NAME'
      | 'NOT_IN_SECT'
      | 'ALREADY_IN_SECT'
      | 'INSUFFICIENT_LINH_THACH'
      | 'NAME_TAKEN',
      number,
    ]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['SECT_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['INVALID_AMOUNT', HttpStatus.BAD_REQUEST],
      ['INVALID_NAME', HttpStatus.BAD_REQUEST],
      ['NOT_IN_SECT', HttpStatus.CONFLICT],
      ['ALREADY_IN_SECT', HttpStatus.CONFLICT],
      ['INSUFFICIENT_LINH_THACH', HttpStatus.CONFLICT],
      ['NAME_TAKEN', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of cases) {
      it(`create: SectError(${code}) → ${status}`, async () => {
        const c = makeController({
          createImpl: async () => {
            throw new SectError(code);
          },
        });
        await expectHttpError(
          c.create(makeReq('valid'), { name: 'Test' }),
          status,
          code,
        );
      });
    }

    it('join: SectError(ALREADY_IN_SECT) → 409 (cross-endpoint)', async () => {
      const c = makeController({
        joinImpl: async () => {
          throw new SectError('ALREADY_IN_SECT');
        },
      });
      await expectHttpError(
        c.join(makeReq('valid'), 's1'),
        HttpStatus.CONFLICT,
        'ALREADY_IN_SECT',
      );
    });
    it('contribute: SectError(INVALID_AMOUNT) → 400', async () => {
      const c = makeController({
        contributeImpl: async () => {
          throw new SectError('INVALID_AMOUNT');
        },
      });
      await expectHttpError(
        c.contribute(makeReq('valid'), { amount: '100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_AMOUNT',
      );
    });
    it('leave: SectError(NOT_IN_SECT) → 409', async () => {
      const c = makeController({
        leaveImpl: async () => {
          throw new SectError('NOT_IN_SECT');
        },
      });
      await expectHttpError(
        c.leave(makeReq('valid')),
        HttpStatus.CONFLICT,
        'NOT_IN_SECT',
      );
    });
    it('rethrow non-SectError nguyên', async () => {
      const boom = new Error('db down');
      const c = makeController({
        createImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.create(makeReq('valid'), { name: 'Test' }),
      ).rejects.toBe(boom);
    });
  });
});
