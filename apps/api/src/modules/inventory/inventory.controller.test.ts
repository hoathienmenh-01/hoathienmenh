/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/inventory/inventory.controller.ts`.
 *
 * 4 endpoint:
 *  - `GET /inventory`: auth + character → list(characterId).
 *  - `POST /inventory/equip`: auth + character + zod ({ inventoryItemId: string min 1 }) → equip(userId, id).
 *  - `POST /inventory/unequip`: auth + character + zod ({ slot: enum 9 value }) → unequip(userId, slot).
 *  - `POST /inventory/use`: auth + character + zod ({ inventoryItemId: string min 1 }) → use(userId, id).
 *
 * Auth flow đặc biệt: `requireCharacter` fail-fast 401 nếu không cookie, 404
 * `NO_CHARACTER` nếu user chưa tạo nhân vật. Cả 4 endpoint share helper này.
 *
 * Error mapping via duck-typing (`(e as { code?: string }).code` switch):
 *  - `NO_CHARACTER` / `INVENTORY_ITEM_NOT_FOUND` / `ITEM_NOT_FOUND` → 404
 *  - `NOT_EQUIPPABLE` / `NOT_USABLE` / `WRONG_SLOT` / `ALREADY_USED` → 409
 *  - default → rethrow
 *
 * Lưu ý: `requireCharacter` trong controller thực chất quăng `NO_CHARACTER` 404
 * trực tiếp (không qua handleErr) khi character chưa có; nên test 4 endpoint đều
 * có path `requireCharacter` 404. Tách rõ NO_CHARACTER from prisma.character
 * lookup vs NO_CHARACTER from service throw.
 *
 * Slot enum cố định 9 value: WEAPON, ARMOR, BELT, BOOTS, HAT, TRAM, ARTIFACT_1,
 * ARTIFACT_2, ARTIFACT_3.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { InventoryController } from './inventory.controller';
import {
  type InventoryService,
  type InventoryView,
} from './inventory.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_INV: InventoryView[] = [];

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
    listImpl?: (cid: string) => Promise<InventoryView[]>;
    equipImpl?: (uid: string, id: string) => Promise<InventoryView[]>;
    unequipImpl?: (uid: string, slot: string) => Promise<InventoryView[]>;
    useImpl?: (uid: string, id: string) => Promise<InventoryView[]>;
    lockImpl?: (uid: string, id: string) => Promise<InventoryView>;
    unlockImpl?: (uid: string, id: string) => Promise<InventoryView>;
    lockBatchImpl?: (
      uid: string,
      ids: string[],
      lock: boolean,
    ) => Promise<{ changed: number; total: number }>;
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
  const STUB_ITEM = {} as unknown as InventoryView;
  const inv = {
    list: opts.listImpl ?? (async () => STUB_INV),
    equip: opts.equipImpl ?? (async () => STUB_INV),
    unequip: opts.unequipImpl ?? (async () => STUB_INV),
    use: opts.useImpl ?? (async () => STUB_INV),
    lock: opts.lockImpl ?? (async () => STUB_ITEM),
    unlock: opts.unlockImpl ?? (async () => STUB_ITEM),
    lockBatch:
      opts.lockBatchImpl ?? (async () => ({ changed: 0, total: 0 })),
  } as unknown as InventoryService;
  return new InventoryController(inv, auth, prisma);
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

const SLOTS = [
  'WEAPON',
  'ARMOR',
  'BELT',
  'BOOTS',
  'HAT',
  'TRAM',
  'ARTIFACT_1',
  'ARTIFACT_2',
  'ARTIFACT_3',
] as const;

describe('InventoryController', () => {
  describe('requireCharacter — auth shared trên 4 endpoint', () => {
    it('list 401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.list(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('equip 404 NO_CHARACTER khi user chưa tạo character', async () => {
      const c = makeController({ characterId: null });
      await expectHttpError(
        c.equip(makeReq('valid'), { inventoryItemId: 'i1' }),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
    it('unequip 401 khi auth resolve null', async () => {
      const c = makeController({ authedUserId: null });
      await expectHttpError(
        c.unequip(makeReq('bad'), { slot: 'WEAPON' }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('use 404 NO_CHARACTER khi chưa tạo character', async () => {
      const c = makeController({ characterId: null });
      await expectHttpError(
        c.use(makeReq('valid'), { inventoryItemId: 'i1' }),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
  });

  describe('GET /inventory', () => {
    it('200 envelope { items } truyền characterId không phải userId', async () => {
      const calls: string[] = [];
      const c = makeController({
        listImpl: async (cid) => {
          calls.push(cid);
          return STUB_INV;
        },
      });
      const r = await c.list(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { items: STUB_INV } });
      expect(calls).toEqual(['c1']);
    });
    it('rethrow non-coded error nguyên (list không có handleErr)', async () => {
      const boom = new Error('db down');
      const c = makeController({
        listImpl: async () => {
          throw boom;
        },
      });
      await expect(c.list(makeReq('valid'))).rejects.toBe(boom);
    });
  });

  describe('POST /inventory/equip — zod', () => {
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.equip(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi inventoryItemId rỗng (min 1)', async () => {
      const c = makeController();
      await expectHttpError(
        c.equip(makeReq('valid'), { inventoryItemId: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi thiếu inventoryItemId', async () => {
      const c = makeController();
      await expectHttpError(
        c.equip(makeReq('valid'), {}),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope; truyền (userId, inventoryItemId)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        equipImpl: async (uid, id) => {
          calls.push([uid, id]);
          return STUB_INV;
        },
      });
      const r = await c.equip(makeReq('valid'), { inventoryItemId: 'i42' });
      expect(r).toEqual({ ok: true, data: { items: STUB_INV } });
      expect(calls).toEqual([['u1', 'i42']]);
    });
  });

  describe('POST /inventory/unequip — slot enum 9 value', () => {
    it('400 khi slot không match enum', async () => {
      const c = makeController();
      await expectHttpError(
        c.unequip(makeReq('valid'), { slot: 'NECKLACE' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi thiếu slot', async () => {
      const c = makeController();
      await expectHttpError(
        c.unequip(makeReq('valid'), {}),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi slot rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.unequip(makeReq('valid'), { slot: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi slot lowercase (case-sensitive)', async () => {
      const c = makeController();
      await expectHttpError(
        c.unequip(makeReq('valid'), { slot: 'weapon' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    for (const slot of SLOTS) {
      it(`200 với slot="${slot}" — accept full enum`, async () => {
        const calls: Array<[string, string]> = [];
        const c = makeController({
          unequipImpl: async (uid, s) => {
            calls.push([uid, s]);
            return STUB_INV;
          },
        });
        const r = await c.unequip(makeReq('valid'), { slot });
        expect(r?.ok).toBe(true);
        expect(calls).toEqual([['u1', slot]]);
      });
    }
  });

  describe('POST /inventory/use — zod', () => {
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.use(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi inventoryItemId rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.use(makeReq('valid'), { inventoryItemId: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope; truyền (userId, id)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        useImpl: async (uid, id) => {
          calls.push([uid, id]);
          return STUB_INV;
        },
      });
      const r = await c.use(makeReq('valid'), { inventoryItemId: 'pot1' });
      expect(r).toEqual({ ok: true, data: { items: STUB_INV } });
      expect(calls).toEqual([['u1', 'pot1']]);
    });
  });

  describe('handleErr — duck-typed code mapping', () => {
    const cases: Array<[string, number]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['INVENTORY_ITEM_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ITEM_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['NOT_EQUIPPABLE', HttpStatus.CONFLICT],
      ['NOT_USABLE', HttpStatus.CONFLICT],
      ['WRONG_SLOT', HttpStatus.CONFLICT],
      ['ALREADY_USED', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of cases) {
      it(`equip: error.code=${code} → ${status}`, async () => {
        const c = makeController({
          equipImpl: async () => {
            throw new DuckErr(code);
          },
        });
        await expectHttpError(
          c.equip(makeReq('valid'), { inventoryItemId: 'i1' }),
          status,
          code,
        );
      });
    }

    it('use: WRONG_SLOT → 409 (cross-endpoint)', async () => {
      const c = makeController({
        useImpl: async () => {
          throw new DuckErr('WRONG_SLOT');
        },
      });
      await expectHttpError(
        c.use(makeReq('valid'), { inventoryItemId: 'i1' }),
        HttpStatus.CONFLICT,
        'WRONG_SLOT',
      );
    });

    it('unequip: error.code không match → rethrow nguyên', async () => {
      const boom = new DuckErr('UNRELATED_CODE');
      const c = makeController({
        unequipImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.unequip(makeReq('valid'), { slot: 'WEAPON' }),
      ).rejects.toBe(boom);
    });

    it('use: error không có code → rethrow nguyên', async () => {
      const boom = new Error('no code field');
      const c = makeController({
        useImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.use(makeReq('valid'), { inventoryItemId: 'i1' }),
      ).rejects.toBe(boom);
    });
  });

  describe('POST /inventory/:id/lock — QOL-1', () => {
    it('200 envelope { item }', async () => {
      const calls: string[] = [];
      const c = makeController({
        lockImpl: async (uid, id) => {
          calls.push(`${uid}:${id}`);
          return { id, locked: true } as unknown as InventoryView;
        },
      });
      const res = await c.lockItem(makeReq('valid'), 'inv-1');
      expect(res).toMatchObject({
        ok: true,
        data: { item: { id: 'inv-1', locked: true } },
      });
      expect(calls).toEqual(['u1:inv-1']);
    });

    it('404 INVENTORY_ITEM_NOT_FOUND → mapping', async () => {
      const c = makeController({
        lockImpl: async () => {
          throw new DuckErr('INVENTORY_ITEM_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.lockItem(makeReq('valid'), 'inv-x'),
        HttpStatus.NOT_FOUND,
        'INVENTORY_ITEM_NOT_FOUND',
      );
    });

    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.lockItem(makeReq(undefined), 'inv-1'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('POST /inventory/:id/unlock — QOL-1', () => {
    it('200 envelope { item }', async () => {
      const c = makeController({
        unlockImpl: async (_uid, id) =>
          ({ id, locked: false }) as unknown as InventoryView,
      });
      const res = await c.unlockItem(makeReq('valid'), 'inv-2');
      expect(res).toMatchObject({
        ok: true,
        data: { item: { id: 'inv-2', locked: false } },
      });
    });

    it('404 INVENTORY_ITEM_NOT_FOUND → mapping', async () => {
      const c = makeController({
        unlockImpl: async () => {
          throw new DuckErr('INVENTORY_ITEM_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.unlockItem(makeReq('valid'), 'inv-x'),
        HttpStatus.NOT_FOUND,
        'INVENTORY_ITEM_NOT_FOUND',
      );
    });
  });

  describe('POST /inventory/lock/batch — QOL-1', () => {
    it('200 envelope { changed, total }', async () => {
      const calls: { ids: string[]; lock: boolean }[] = [];
      const c = makeController({
        lockBatchImpl: async (_uid, ids, lock) => {
          calls.push({ ids, lock });
          return { changed: ids.length, total: ids.length };
        },
      });
      const res = await c.lockBatch(makeReq('valid'), {
        inventoryItemIds: ['a', 'b', 'c'],
        lock: true,
      });
      expect(res).toMatchObject({
        ok: true,
        data: { changed: 3, total: 3 },
      });
      expect(calls).toEqual([{ ids: ['a', 'b', 'c'], lock: true }]);
    });

    it('400 INVALID_INPUT khi không có inventoryItemIds', async () => {
      const c = makeController();
      await expectHttpError(
        c.lockBatch(makeReq('valid'), { lock: true }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 INVALID_INPUT khi quá 100 ids', async () => {
      const c = makeController();
      const ids = Array.from({ length: 101 }, (_, i) => `i${i}`);
      await expectHttpError(
        c.lockBatch(makeReq('valid'), { inventoryItemIds: ids, lock: true }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 INVALID_INPUT khi empty array', async () => {
      const c = makeController();
      await expectHttpError(
        c.lockBatch(makeReq('valid'), { inventoryItemIds: [], lock: true }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 INVALID_INPUT khi thiếu lock flag', async () => {
      const c = makeController();
      await expectHttpError(
        c.lockBatch(makeReq('valid'), { inventoryItemIds: ['a'] }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('404 mapping khi service throw INVENTORY_ITEM_NOT_FOUND', async () => {
      const c = makeController({
        lockBatchImpl: async () => {
          throw new DuckErr('INVENTORY_ITEM_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.lockBatch(makeReq('valid'), {
          inventoryItemIds: ['a'],
          lock: true,
        }),
        HttpStatus.NOT_FOUND,
        'INVENTORY_ITEM_NOT_FOUND',
      );
    });
  });

  describe('error mapping — INVENTORY_ITEM_LOCKED', () => {
    it('use: 409 INVENTORY_ITEM_LOCKED khi service reject locked row', async () => {
      const c = makeController({
        useImpl: async () => {
          throw new DuckErr('INVENTORY_ITEM_LOCKED');
        },
      });
      await expectHttpError(
        c.use(makeReq('valid'), { inventoryItemId: 'i1' }),
        HttpStatus.CONFLICT,
        'INVENTORY_ITEM_LOCKED',
      );
    });
  });
});
