/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/combat/combat.controller.ts`.
 *
 * 5 endpoint:
 *  - `GET /combat/dungeons`: PUBLIC (no auth) → listDungeons() (synchronous getter).
 *  - `GET /combat/encounter/active`: auth + characterId → getActive(characterId).
 *  - `POST /combat/encounter/start`: auth + zod ({ dungeonKey: string min 1 }) → start.
 *  - `POST /combat/encounter/:id/action`: auth + zod ({ skillKey?: string }) → action.
 *  - `POST /combat/encounter/:id/abandon`: auth → abandon.
 *
 * Error mapping via duck-typing (`(e as { code?: string }).code` switch — KHÔNG
 * `instanceof CombatError` vì class CombatError không export):
 *  - `NO_CHARACTER` / `DUNGEON_NOT_FOUND` / `ENCOUNTER_NOT_FOUND` → 404
 *  - `STAMINA_LOW` / `MP_LOW` / `SKILL_NOT_USABLE` / `ALREADY_IN_FIGHT` /
 *    `ENCOUNTER_ENDED` / `DUNGEON_DAILY_LIMIT_REACHED` → 409
 *  - default → rethrow (không nuốt 500)
 *
 * Test này lock-in:
 *  1. dungeons() PUBLIC (cookie missing không 401) — quan trọng cho FE pre-auth landing.
 *  2. active() yêu cầu characterId → 404 NO_CHARACTER khi user chưa tạo nhân vật.
 *  3. start/action zod boundaries.
 *  4. action body null OK (controller dùng `body ?? {}` fallback).
 *  5. Duck-typing handleErr: error có `.code` match → fail status; không match → rethrow.
 *  6. Error không phải Error nhưng có shape `{ code }` cũng được map (current behavior).
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CombatController } from './combat.controller';
import {
  type CombatService,
  type EncounterView,
} from './combat.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_ENCOUNTER: EncounterView = {
  id: 'e1',
  dungeon: { key: 'd1', name: 'Cave', monsters: [] } as unknown as EncounterView['dungeon'],
  status: 'ACTIVE' as EncounterView['status'],
  monster: null,
  monsterHp: 100,
  monsterIndex: 0,
  log: [],
  reward: null,
};

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
    listImpl?: () => unknown[];
    activeImpl?: (cid: string) => Promise<EncounterView | null>;
    startImpl?: (uid: string, key: string) => Promise<EncounterView>;
    actionImpl?: (
      uid: string,
      id: string,
      input: { skillKey?: string },
    ) => Promise<EncounterView>;
    abandonImpl?: (uid: string, id: string) => Promise<EncounterView>;
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
  const combat = {
    listDungeons: opts.listImpl ?? (() => [{ key: 'd1' }, { key: 'd2' }]),
    getActive: opts.activeImpl ?? (async () => STUB_ENCOUNTER),
    start: opts.startImpl ?? (async () => STUB_ENCOUNTER),
    action: opts.actionImpl ?? (async () => STUB_ENCOUNTER),
    abandon: opts.abandonImpl ?? (async () => STUB_ENCOUNTER),
  } as unknown as CombatService;
  return new CombatController(combat, auth, prisma);
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

describe('CombatController', () => {
  describe('GET /combat/dungeons — PUBLIC', () => {
    it('200 envelope { dungeons } khi không cookie (no auth)', async () => {
      const c = makeController({
        listImpl: () => [{ key: 'd1' }, { key: 'd2' }],
      });
      const r = await c.dungeons();
      expect(r).toEqual({ ok: true, data: { dungeons: [{ key: 'd1' }, { key: 'd2' }] } });
    });
    it('listDungeons() synchronous (KHÔNG await trong controller)', async () => {
      let called = 0;
      const c = makeController({
        listImpl: () => {
          called += 1;
          return [];
        },
      });
      await c.dungeons();
      expect(called).toBe(1);
    });
  });

  describe('GET /combat/encounter/active — auth + characterId', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.active(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('404 NO_CHARACTER khi auth ok nhưng chưa tạo character', async () => {
      const c = makeController({ characterId: null });
      await expectHttpError(
        c.active(makeReq('valid')),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
    it('200 với encounter null khi không có encounter active', async () => {
      const c = makeController({ activeImpl: async () => null });
      const r = await c.active(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { encounter: null } });
    });
    it('200 với encounter; truyền characterId không phải userId', async () => {
      const calls: string[] = [];
      const c = makeController({
        activeImpl: async (cid) => {
          calls.push(cid);
          return STUB_ENCOUNTER;
        },
      });
      const r = await c.active(makeReq('valid'));
      expect(r.ok).toBe(true);
      expect(calls).toEqual(['c1']);
    });
  });

  describe('POST /combat/encounter/start — auth + zod', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.start(makeReq(undefined), { dungeonKey: 'd1' }),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.start(makeReq('valid'), null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi dungeonKey rỗng (min 1)', async () => {
      const c = makeController();
      await expectHttpError(
        c.start(makeReq('valid'), { dungeonKey: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi thiếu dungeonKey', async () => {
      const c = makeController();
      await expectHttpError(
        c.start(makeReq('valid'), {}),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope; truyền (userId, dungeonKey)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        startImpl: async (uid, k) => {
          calls.push([uid, k]);
          return STUB_ENCOUNTER;
        },
      });
      const r = await c.start(makeReq('valid'), { dungeonKey: 'demon-cave' });
      expect(r).toEqual({ ok: true, data: { encounter: STUB_ENCOUNTER } });
      expect(calls).toEqual([['u1', 'demon-cave']]);
    });
  });

  describe('POST /combat/encounter/:id/action — auth + zod (body nullable)', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.action(makeReq(undefined), 'e1', {}),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 OK khi body null (controller dùng `body ?? {}` fallback)', async () => {
      const calls: Array<[string, string, { skillKey?: string }]> = [];
      const c = makeController({
        actionImpl: async (uid, id, inp) => {
          calls.push([uid, id, inp]);
          return STUB_ENCOUNTER;
        },
      });
      const r = await c.action(makeReq('valid'), 'e1', null);
      expect(r).toEqual({ ok: true, data: { encounter: STUB_ENCOUNTER } });
      expect(calls).toEqual([['u1', 'e1', {}]]);
    });
    it('200 OK khi body undefined (cùng fallback)', async () => {
      const c = makeController();
      const r = await c.action(makeReq('valid'), 'e1', undefined);
      expect(r?.ok).toBe(true);
    });
    it('400 khi skillKey không phải string', async () => {
      const c = makeController();
      await expectHttpError(
        c.action(makeReq('valid'), 'e1', { skillKey: 99 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200 envelope; truyền (userId, id, parsed)', async () => {
      const calls: Array<[string, string, { skillKey?: string }]> = [];
      const c = makeController({
        actionImpl: async (uid, id, inp) => {
          calls.push([uid, id, inp]);
          return STUB_ENCOUNTER;
        },
      });
      const r = await c.action(makeReq('valid'), 'enc-42', {
        skillKey: 'fire',
      });
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['u1', 'enc-42', { skillKey: 'fire' }]]);
    });
  });

  describe('POST /combat/encounter/:id/abandon — auth', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.abandon(makeReq(undefined), 'e1'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });
    it('200 envelope; truyền (userId, encounterId)', async () => {
      const calls: Array<[string, string]> = [];
      const c = makeController({
        abandonImpl: async (uid, id) => {
          calls.push([uid, id]);
          return STUB_ENCOUNTER;
        },
      });
      const r = await c.abandon(makeReq('valid'), 'enc-42');
      expect(r).toEqual({ ok: true, data: { encounter: STUB_ENCOUNTER } });
      expect(calls).toEqual([['u1', 'enc-42']]);
    });
  });

  describe('handleErr — duck-typed code mapping qua start endpoint', () => {
    const cases: Array<[string, number]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['DUNGEON_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ENCOUNTER_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['STAMINA_LOW', HttpStatus.CONFLICT],
      ['MP_LOW', HttpStatus.CONFLICT],
      ['SKILL_NOT_USABLE', HttpStatus.CONFLICT],
      ['ALREADY_IN_FIGHT', HttpStatus.CONFLICT],
      ['ENCOUNTER_ENDED', HttpStatus.CONFLICT],
      // Phase 12.2.A — DungeonDef.dailyLimit enforcement → 409 CONFLICT
      ['DUNGEON_DAILY_LIMIT_REACHED', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of cases) {
      it(`error.code=${code} → ${status}`, async () => {
        const c = makeController({
          startImpl: async () => {
            throw new DuckErr(code);
          },
        });
        await expectHttpError(
          c.start(makeReq('valid'), { dungeonKey: 'd1' }),
          status,
          code,
        );
      });
    }

    it('rethrow nguyên khi code không match', async () => {
      const boom = new DuckErr('UNRELATED_CODE');
      const c = makeController({
        startImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.start(makeReq('valid'), { dungeonKey: 'd1' }),
      ).rejects.toBe(boom);
    });

    it('rethrow nguyên khi error không có code', async () => {
      const boom = new Error('no code field');
      const c = makeController({
        actionImpl: async () => {
          throw boom;
        },
      });
      await expect(
        c.action(makeReq('valid'), 'e1', {}),
      ).rejects.toBe(boom);
    });

    it('abandon path cũng đi qua handleErr — ENCOUNTER_NOT_FOUND → 404', async () => {
      const c = makeController({
        abandonImpl: async () => {
          throw new DuckErr('ENCOUNTER_NOT_FOUND');
        },
      });
      await expectHttpError(
        c.abandon(makeReq('valid'), 'e1'),
        HttpStatus.NOT_FOUND,
        'ENCOUNTER_NOT_FOUND',
      );
    });
  });
});
