/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/market/market.controller.ts`.
 *
 * 5 endpoint:
 *  - `GET /market/listings?kind=`: auth + character + kind soft-parse (KindEnum 7-value, fail
 *    silent → undefined). Trả `{ listings, feePct }`.
 *  - `GET /market/mine`: auth + character → listMine(characterId).
 *  - `POST /market/post`: auth + character + zod (inventoryItemId 1+, qty positive int,
 *    pricePerUnit string-or-int → BigInt) → market.post(userId, parsed).
 *  - `POST /market/:id/buy`: auth + character → market.buy(userId, id).
 *  - `POST /market/:id/cancel`: auth + character → market.cancel(userId, id).
 *
 * Auth: `requireCharacter` chia sẻ trên 5 endpoint (401 no-cookie, 404 NO_CHARACTER).
 *
 * Error mapping (duck-typed code switch):
 *  - `NO_CHARACTER` / `INVENTORY_ITEM_NOT_FOUND` / `LISTING_NOT_FOUND` / `ITEM_NOT_FOUND` → 404
 *  - `ITEM_EQUIPPED` / `INVALID_QTY` / `INVALID_PRICE` / `LISTING_INACTIVE` /
 *    `CANNOT_BUY_OWN` / `NOT_OWNER` / `INSUFFICIENT_LINH_THACH` → 409
 *  - default → rethrow
 *
 * Lock-in invariants:
 *  1. listings() kind soft-parse: invalid kind không 400 — silent undefined, listing trả full.
 *  2. PostInput.pricePerUnit transform → BigInt; service nhận BigInt (không phải string/number).
 *  3. PostInput.qty phải positive integer (qty=0 fail; qty=-1 fail; qty=1.5 fail).
 *  4. feePct trả từ MARKET_FEE_PCT constant — test cố định number.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { MarketController } from './market.controller';
import {
  MARKET_FEE_PCT,
  type MarketService,
  type ListingView,
} from './market.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_LISTINGS: ListingView[] = [];

class DuckErr extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    characterId?: string | null;
    listActiveImpl?: (
      cid: string,
      kind?: string,
    ) => Promise<ListingView[]>;
    listMineImpl?: (cid: string) => Promise<ListingView[]>;
    postImpl?: (
      uid: string,
      input: { inventoryItemId: string; qty: number; pricePerUnit: bigint },
    ) => Promise<ListingView>;
    buyImpl?: (uid: string, id: string) => Promise<ListingView>;
    cancelImpl?: (uid: string, id: string) => Promise<ListingView>;
    /** Phase 15.4 — gi\u1ea3 l\u1eadp MARKET_ENABLED=false \u0111\u1ec3 test runtime gate. */
    flagDisabled?: boolean;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const prisma = {
    character: {
      findUnique: async () =>
        opts.characterId === null
          ? null
          : { id: opts.characterId ?? 'c1' },
    },
  } as unknown as PrismaService;
  const market = {
    listActive: opts.listActiveImpl ?? (async () => STUB_LISTINGS),
    listMine: opts.listMineImpl ?? (async () => STUB_LISTINGS),
    post: opts.postImpl ?? (async () => ({} as ListingView)),
    buy: opts.buyImpl ?? (async () => ({} as ListingView)),
    cancel: opts.cancelImpl ?? (async () => ({} as ListingView)),
  } as unknown as MarketService;
  // Phase 15.4 — stub feature flags: default-on for tests; opts.flagDisabled
  // giả lập trường hợp MARKET_ENABLED=false.
  const featureFlags = {
    isEnabled: async () => !opts.flagDisabled,
    requireEnabled: async () => {
      if (opts.flagDisabled) {
        const { HttpException, HttpStatus } = await import('@nestjs/common');
        throw new HttpException(
          {
            ok: false,
            error: { code: 'FEATURE_DISABLED', message: 'disabled' },
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    },
  } as unknown as import('../feature-flag/feature-flag.service').FeatureFlagService;
  return new MarketController(market, auth, prisma, featureFlags);
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

const KINDS = [
  'WEAPON',
  'ARMOR',
  'PILL_HP',
  'PILL_MP',
  'PILL_EXP',
  'ORE',
  'MISC',
] as const;

describe('MarketController', () => {
  describe('requireCharacter — 5 endpoint share guard', () => {
    it('listings 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.listings(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('mine 404 NO_CHARACTER khi character chưa có', async () => {
      const c = makeController({ characterId: null });
      await expectHttpError(
        c.mine(makeReq('valid')),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
    it('post 401 khi auth resolve null', async () => {
      const c = makeController({ authedUserId: null });
      await expectHttpError(
        c.post(makeReq('bad'), { inventoryItemId: 'i1', qty: 1, pricePerUnit: '100' }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('buy 404 NO_CHARACTER', async () => {
      const c = makeController({ characterId: null });
      await expectHttpError(
        c.buy(makeReq('valid'), 'l1'),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
    it('cancel 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.cancel(makeReq(undefined), 'l1'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('GET /market/listings — kind soft-parse', () => {
    it('200 + feePct = MARKET_FEE_PCT constant', async () => {
      const c = makeController();
      const r = await c.listings(makeReq('valid'));
      expect(r).toEqual({
        ok: true,
        data: { listings: STUB_LISTINGS, feePct: MARKET_FEE_PCT },
      });
    });
    it('truyền (characterId, undefined) khi không có kind query', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        listActiveImpl: async (cid, k) => {
          calls.push([cid, k]);
          return STUB_LISTINGS;
        },
      });
      await c.listings(makeReq('valid'));
      expect(calls).toEqual([['c1', undefined]]);
    });
    for (const kind of KINDS) {
      it(`accept kind="${kind}" → truyền nguyên`, async () => {
        const calls: Array<[string, string | undefined]> = [];
        const c = makeController({
          listActiveImpl: async (cid, k) => {
            calls.push([cid, k]);
            return STUB_LISTINGS;
          },
        });
        await c.listings(makeReq('valid'), kind);
        expect(calls).toEqual([['c1', kind]]);
      });
    }
    it('kind invalid không 400 — silent undefined (soft-parse)', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        listActiveImpl: async (cid, k) => {
          calls.push([cid, k]);
          return STUB_LISTINGS;
        },
      });
      const r = await c.listings(makeReq('valid'), 'XYZ_INVALID');
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['c1', undefined]]);
    });
    it('kind lowercase "weapon" cũng silent undefined (case-sensitive)', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        listActiveImpl: async (cid, k) => {
          calls.push([cid, k]);
          return STUB_LISTINGS;
        },
      });
      await c.listings(makeReq('valid'), 'weapon');
      expect(calls).toEqual([['c1', undefined]]);
    });
  });

  describe('GET /market/mine', () => {
    it('200 envelope; truyền characterId không phải userId', async () => {
      const calls: string[] = [];
      const c = makeController({
        listMineImpl: async (cid) => {
          calls.push(cid);
          return STUB_LISTINGS;
        },
      });
      const r = await c.mine(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { listings: STUB_LISTINGS } });
      expect(calls).toEqual(['c1']);
    });
  });

  describe('POST /market/post — zod transform pricePerUnit → BigInt', () => {
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi inventoryItemId rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: '', qty: 1, pricePerUnit: '100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi qty=0 (positive)', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: 0, pricePerUnit: '100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi qty âm', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: -1, pricePerUnit: '100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi qty không nguyên', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: 1.5, pricePerUnit: '100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi pricePerUnit chứa ký tự lạ', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: 1, pricePerUnit: 'abc' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi pricePerUnit có dấu trừ', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: 1, pricePerUnit: '-100' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi pricePerUnit number âm/0', async () => {
      const c = makeController();
      await expectHttpError(
        c.post(makeReq('valid'), { inventoryItemId: 'i1', qty: 1, pricePerUnit: 0 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; pricePerUnit string → BigInt; truyền (userId, parsed)', async () => {
      const calls: Array<[
        string,
        { inventoryItemId: string; qty: number; pricePerUnit: bigint },
      ]> = [];
      const c = makeController({
        postImpl: async (uid, inp) => {
          calls.push([uid, inp]);
          return { id: 'L1' } as unknown as ListingView;
        },
      });
      const r = await c.post(makeReq('valid'), {
        inventoryItemId: 'i1',
        qty: 3,
        pricePerUnit: '999999999999999999',
      });
      expect(r?.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('u1');
      expect(calls[0][1].inventoryItemId).toBe('i1');
      expect(calls[0][1].qty).toBe(3);
      expect(typeof calls[0][1].pricePerUnit).toBe('bigint');
      expect(calls[0][1].pricePerUnit).toBe(999999999999999999n);
    });
    it('200; pricePerUnit number cũng → BigInt', async () => {
      const calls: Array<[string, { pricePerUnit: bigint }]> = [];
      const c = makeController({
        postImpl: async (uid, inp) => {
          calls.push([uid, inp]);
          return {} as ListingView;
        },
      });
      await c.post(makeReq('valid'), {
        inventoryItemId: 'i1',
        qty: 1,
        pricePerUnit: 500,
      });
      expect(calls[0][1].pricePerUnit).toBe(500n);
    });
  });

  describe('POST /market/:id/buy', () => {
    it('200 envelope; truyền (userId, id)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        buyImpl: async (uid, id) => {
          calls.push([uid, id]);
          return { id } as unknown as ListingView;
        },
      });
      const r = await c.buy(makeReq('valid'), 'L42');
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([['u1', 'L42']]);
    });
  });

  describe('POST /market/:id/cancel', () => {
    it('200 envelope; truyền (userId, id)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        cancelImpl: async (uid, id) => {
          calls.push([uid, id]);
          return { id } as unknown as ListingView;
        },
      });
      const r = await c.cancel(makeReq('valid'), 'L42');
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([['u1', 'L42']]);
    });
  });

  describe('handleErr — duck-typed code mapping', () => {
    const cases: Array<[string, number]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['INVENTORY_ITEM_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['LISTING_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ITEM_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ITEM_EQUIPPED', HttpStatus.CONFLICT],
      ['INVALID_QTY', HttpStatus.CONFLICT],
      ['INVALID_PRICE', HttpStatus.CONFLICT],
      ['LISTING_INACTIVE', HttpStatus.CONFLICT],
      ['CANNOT_BUY_OWN', HttpStatus.CONFLICT],
      ['NOT_OWNER', HttpStatus.CONFLICT],
      ['INSUFFICIENT_LINH_THACH', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of cases) {
      it(`buy: error.code=${code} → ${status}`, async () => {
        const c = makeController({
          buyImpl: async () => {
            throw new DuckErr(code);
          },
        });
        await expectHttpError(
          c.buy(makeReq('valid'), 'L1'),
          status,
          code,
        );
      });
    }

    it('post: INVALID_PRICE → 409 (cross-endpoint)', async () => {
      const c = makeController({
        postImpl: async () => {
          throw new DuckErr('INVALID_PRICE');
        },
      });
      await expectHttpError(
        c.post(makeReq('valid'), {
          inventoryItemId: 'i1',
          qty: 1,
          pricePerUnit: '100',
        }),
        HttpStatus.CONFLICT,
        'INVALID_PRICE',
      );
    });
    it('cancel: NOT_OWNER → 409', async () => {
      const c = makeController({
        cancelImpl: async () => {
          throw new DuckErr('NOT_OWNER');
        },
      });
      await expectHttpError(
        c.cancel(makeReq('valid'), 'L1'),
        HttpStatus.CONFLICT,
        'NOT_OWNER',
      );
    });
    it('post: rethrow nguyên khi code không match', async () => {
      const boom = new DuckErr('UNRELATED_CODE');
      const c = makeController({
        postImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.post(makeReq('valid'), {
          inventoryItemId: 'i1',
          qty: 1,
          pricePerUnit: '100',
        }),
      ).rejects.toBe(boom);
    });
    it('buy: rethrow nguyên khi error không có code', async () => {
      const boom = new Error('no code field');
      const c = makeController({
        buyImpl: async () => {
          throw boom;
        },
      });
      await expect(c.buy(makeReq('valid'), 'L1')).rejects.toBe(boom);
    });
  });

  // -------------------------------------------------------------------
  // Phase 15.4 — runtime gate (MARKET_ENABLED). post + buy bị chặn 503
  // FEATURE_DISABLED khi flag off; cancel + listings vẫn cho phép.
  // -------------------------------------------------------------------
  describe('Phase 15.4 — runtime gate MARKET_ENABLED=false', () => {
    it('post 503 FEATURE_DISABLED', async () => {
      const c = makeController({ flagDisabled: true });
      await expectHttpError(
        c.post(makeReq('valid'), {
          inventoryItemId: 'i1',
          qty: 1,
          pricePerUnit: '100',
        }),
        HttpStatus.SERVICE_UNAVAILABLE,
        'FEATURE_DISABLED',
      );
    });
    it('buy 503 FEATURE_DISABLED', async () => {
      const c = makeController({ flagDisabled: true });
      await expectHttpError(
        c.buy(makeReq('valid'), 'L1'),
        HttpStatus.SERVICE_UNAVAILABLE,
        'FEATURE_DISABLED',
      );
    });
    it('cancel vẫn cho phép (read-only escape hatch)', async () => {
      const c = makeController({
        flagDisabled: true,
        cancelImpl: async () => ({} as ListingView),
      });
      // không throw FEATURE_DISABLED — cancel không gate
      await expect(c.cancel(makeReq('valid'), 'L1')).resolves.toMatchObject({
        ok: true,
      });
    });
    it('listings vẫn read-only (không gate)', async () => {
      const c = makeController({ flagDisabled: true });
      await expect(c.listings(makeReq('valid'))).resolves.toMatchObject({
        ok: true,
      });
    });
  });
});
