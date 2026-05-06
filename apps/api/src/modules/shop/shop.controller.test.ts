/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/shop/shop.controller.ts`.
 *
 * 2 endpoint:
 *  - `GET /shop/npc`: auth → list (synchronous, no userId pass) → `{ ok, data: { entries } }`.
 *  - `POST /shop/buy`: auth → zod (itemKey 1..64, qty int 1..99) → buy(userId, itemKey, qty) → wrap.
 *
 * Error mapping:
 *  - `NO_CHARACTER` → 404
 *  - `ITEM_NOT_IN_SHOP` → 404
 *  - `INSUFFICIENT_FUNDS` → 409
 *  - default (`INVALID_QTY`, `NON_STACKABLE_QTY_GT_1`) → 400
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ShopController } from './shop.controller';
import {
  ShopError,
  type ShopService,
} from './shop.service';
import type { AuthService } from '../auth/auth.service';

const STUB_ENTRIES = [
  { itemKey: 'hp_potion_s', name: 'Hồi Khí Đan Tiểu', priceLinhThach: '50' },
];
const STUB_BUY = {
  itemKey: 'hp_potion_s',
  qty: 2,
  totalPrice: '100',
  currency: 'LINH_THACH' as const,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(opts: {
  authedUserId?: string | null;
  listImpl?: () => unknown;
  buyImpl?: (uid: string, key: string, qty: number) => Promise<typeof STUB_BUY>;
} = {}) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const shop = {
    list: opts.listImpl ?? (() => STUB_ENTRIES),
    buy: opts.buyImpl ?? (async () => STUB_BUY),
  } as unknown as ShopService;
  return new ShopController(shop, auth);
}

async function expectHttpError(p: Promise<unknown>, status: number, code: string) {
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

describe('ShopController', () => {
  describe('GET /shop/npc', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.list(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    it('happy path → { ok: true, data: { entries } }', async () => {
      const c = makeController();
      const r = await c.list(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { entries: STUB_ENTRIES } });
    });

    it('list không nhận userId (chỉ cần auth)', async () => {
      let calledWith: unknown[] = [];
      const c = makeController({
        listImpl: (...args) => {
          calledWith = args;
          return STUB_ENTRIES;
        },
      });
      await c.list(makeReq('valid'));
      expect(calledWith).toHaveLength(0);
    });
  });

  describe('POST /shop/buy', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.buy(makeReq(undefined), { itemKey: 'hp_potion_s', qty: 1 }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    describe('zod', () => {
      it('null body → 400', async () => {
        const c = makeController();
        await expectHttpError(
          c.buy(makeReq('valid'), null),
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
        );
      });

      it('itemKey rỗng → 400', async () => {
        const c = makeController();
        await expectHttpError(
          c.buy(makeReq('valid'), { itemKey: '', qty: 1 }),
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
        );
      });

      it('qty 0 → 400', async () => {
        const c = makeController();
        await expectHttpError(
          c.buy(makeReq('valid'), { itemKey: 'x', qty: 0 }),
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
        );
      });

      it('qty 100 → 400 (>max 99)', async () => {
        const c = makeController();
        await expectHttpError(
          c.buy(makeReq('valid'), { itemKey: 'x', qty: 100 }),
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
        );
      });

      it('qty boundary 99 → ok', async () => {
        const c = makeController();
        const r = await c.buy(makeReq('valid'), { itemKey: 'x', qty: 99 });
        expect(r.ok).toBe(true);
      });

      it('itemKey >64 → 400', async () => {
        const c = makeController();
        await expectHttpError(
          c.buy(makeReq('valid'), { itemKey: 'A'.repeat(65), qty: 1 }),
          HttpStatus.BAD_REQUEST,
          'INVALID_INPUT',
        );
      });
    });

    it('happy path → envelope + service nhận đúng args', async () => {
      let receivedArgs: [string, string, number] | null = null;
      const c = makeController({
        buyImpl: async (uid, key, qty) => {
          receivedArgs = [uid, key, qty];
          return STUB_BUY;
        },
      });
      const r = await c.buy(makeReq('valid'), { itemKey: 'hp_potion_s', qty: 2 });
      expect(r).toEqual({
        ok: true,
        data: {
          itemKey: 'hp_potion_s',
          qty: 2,
          totalPrice: '100',
          currency: 'LINH_THACH',
        },
      });
      expect(receivedArgs).toEqual(['u1', 'hp_potion_s', 2]);
    });

    describe('error mapping', () => {
      const cases: Array<[ConstructorParameters<typeof ShopError>[0], number]> = [
        ['NO_CHARACTER', HttpStatus.NOT_FOUND],
        ['ITEM_NOT_IN_SHOP', HttpStatus.NOT_FOUND],
        ['INSUFFICIENT_FUNDS', HttpStatus.CONFLICT],
        ['SHOP_DAILY_LIMIT', HttpStatus.CONFLICT],
        ['RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
        ['INVALID_QTY', HttpStatus.BAD_REQUEST],
        ['NON_STACKABLE_QTY_GT_1', HttpStatus.BAD_REQUEST],
      ];

      for (const [code, status] of cases) {
        it(`${code} → ${status}`, async () => {
          const c = makeController({
            buyImpl: async () => {
              throw new ShopError(code);
            },
          });
          await expectHttpError(
            c.buy(makeReq('valid'), { itemKey: 'x', qty: 1 }),
            status,
            code,
          );
        });
      }

      it('unknown error rethrow', async () => {
        const boom = new Error('prisma exploded');
        const c = makeController({
          buyImpl: async () => {
            throw boom;
          },
        });
        await expect(
          c.buy(makeReq('valid'), { itemKey: 'x', qty: 1 }),
        ).rejects.toBe(boom);
      });
    });
  });
});
