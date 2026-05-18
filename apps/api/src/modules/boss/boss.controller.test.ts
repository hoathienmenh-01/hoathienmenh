/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/boss/boss.controller.ts`.
 *
 * 3 endpoint:
 *  - `GET /boss/current`: viewer (no auth required) → boss.getCurrent(characterId|null).
 *    Khi không login → characterId=null vẫn gọi service (public-after-auth).
 *  - `POST /boss/attack`: auth + zod ({ skillKey?: string max 64 }) → boss.attack.
 *  - `POST /boss/admin/spawn` (AdminGuard): zod ({ bossKey?, level?, force? }) → boss.adminSpawn.
 *    Test bypass AdminGuard bằng cách instantiate controller trực tiếp + truyền
 *    `AdminReq = Request & { userId, role }` đã set.
 *
 * Error mapping (`BossError`, 11 code):
 *  - `NO_CHARACTER` / `NO_ACTIVE_BOSS` → 404
 *  - `COOLDOWN` → 429
 *  - `SKILL_NOT_USABLE` / `INVALID_BOSS_KEY` / `INVALID_LEVEL` → 400
 *  - `BOSS_DEFEATED` / `STAMINA_LOW` / `MP_LOW` / `HP_LOW` / `BOSS_ALREADY_ACTIVE` → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { BossController } from './boss.controller';
import {
  BossError,
  type BossService,
  type BossView,
  type AttackResult,
} from './boss.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_BOSS: BossView = {
  id: 'b1',
  bossKey: 'demon-king',
  name: 'Demon King',
  description: '',
  level: 1,
  maxHp: '1000',
  currentHp: '500',
  status: 'ACTIVE' as BossView['status'],
  spawnedAt: '2026-04-30T12:00:00.000Z',
  expiresAt: '2026-04-30T13:00:00.000Z',
  // Phase 12.6 — regionKey field cho multi-region support.
  regionKey: 'world',
  leaderboard: [],
  myDamage: null,
  myRank: null,
  participants: 0,
  cooldownUntil: null,
  topDropPool: [],
  midDropPool: [],
  elementProfile: {
    element: null,
    weaknessElement: null,
    resistElements: [],
    rewardElementHint: null,
  },
};

const STUB_ATTACK: AttackResult = {
  damageDealt: '100',
  bossHp: '400',
  bossMaxHp: '1000',
  defeated: false,
  myDamageTotal: '100',
  myRank: 1,
  charHp: 100,
  charMp: 50,
  charStamina: 80,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeAdminReq(): Request & { userId: string; role: 'ADMIN' } {
  return {
    cookies: { xt_access: 'admin-tok' },
    userId: 'admin-1',
    role: 'ADMIN',
  } as unknown as Request & { userId: string; role: 'ADMIN' };
}

function makeController(
  opts: {
    authedUserId?: string | null;
    characterId?: string | null;
    getCurrentImpl?: (cid: string | null) => Promise<BossView | null>;
    attackImpl?: (uid: string, skillKey?: string) => Promise<AttackResult>;
    spawnImpl?: (
      adminId: string,
      input: { bossKey?: string; level?: number; force?: boolean },
    ) => Promise<BossView>;
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
  const boss = {
    getCurrent: opts.getCurrentImpl ?? (async () => STUB_BOSS),
    attack: opts.attackImpl ?? (async () => STUB_ATTACK),
    adminSpawn: opts.spawnImpl ?? (async () => STUB_BOSS),
  } as unknown as BossService;
  const featureFlags = {
    requireEnabled: async () => {},
  } as unknown as import('../feature-flag/feature-flag.service').FeatureFlagService;
  return new BossController(boss, auth, prisma, featureFlags);
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

describe('BossController', () => {
  describe('GET /boss/current — public-after-auth', () => {
    it('200 với boss khi authed có character', async () => {
      const calls: Array<string | null> = [];
      const c = makeController({
        getCurrentImpl: async (cid) => {
          calls.push(cid);
          return STUB_BOSS;
        },
      });
      const r = await c.current(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { boss: STUB_BOSS } });
      expect(calls).toEqual(['c1']);
    });

    it('200 với boss=null khi không có boss active', async () => {
      const c = makeController({ getCurrentImpl: async () => null });
      const r = await c.current(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: { boss: null } });
    });

    it('200 + characterId=null khi không cookie (PUBLIC)', async () => {
      const calls: Array<string | null> = [];
      const c = makeController({
        getCurrentImpl: async (cid) => {
          calls.push(cid);
          return STUB_BOSS;
        },
      });
      const r = await c.current(makeReq(undefined));
      expect(r.ok).toBe(true);
      expect(calls).toEqual([null]);
    });

    it('200 + characterId=null khi auth ok nhưng chưa có character', async () => {
      const calls: Array<string | null> = [];
      const c = makeController({
        characterId: null,
        getCurrentImpl: async (cid) => {
          calls.push(cid);
          return STUB_BOSS;
        },
      });
      const r = await c.current(makeReq('valid'));
      expect(r.ok).toBe(true);
      expect(calls).toEqual([null]);
    });
  });

  describe('POST /boss/attack — auth + zod', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.attack(makeReq(undefined), {}),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    it('400 INVALID_INPUT khi skillKey > 64 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.attack(makeReq('valid'), { skillKey: 'x'.repeat(65) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 khi skillKey không phải string', async () => {
      const c = makeController();
      await expectHttpError(
        c.attack(makeReq('valid'), { skillKey: 42 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('200 envelope; skillKey optional (body rỗng OK)', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        attackImpl: async (uid, sk) => {
          calls.push([uid, sk]);
          return STUB_ATTACK;
        },
      });
      const r = await c.attack(makeReq('valid'), {});
      expect(r).toEqual({ ok: true, data: STUB_ATTACK });
      expect(calls).toEqual([['u1', undefined]]);
    });

    it('200 envelope; truyền skillKey ngắn ok', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        attackImpl: async (uid, sk) => {
          calls.push([uid, sk]);
          return STUB_ATTACK;
        },
      });
      const r = await c.attack(makeReq('valid'), { skillKey: 'fireball' });
      expect(r.ok).toBe(true);
      expect(calls).toEqual([['u1', 'fireball']]);
    });

    it('skillKey = 64 ký tự boundary accept', async () => {
      const c = makeController();
      const r = await c.attack(makeReq('valid'), { skillKey: 'x'.repeat(64) });
      expect(r?.ok).toBe(true);
    });
  });

  describe('POST /boss/admin/spawn — AdminGuard bypassed; zod', () => {
    it('400 khi level=0 (min 1)', async () => {
      const c = makeController();
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), { level: 0 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 khi level > 10', async () => {
      const c = makeController();
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), { level: 11 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 khi bossKey rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), { bossKey: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('400 khi bossKey > 64', async () => {
      const c = makeController();
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), { bossKey: 'x'.repeat(65) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });

    it('200 envelope; truyền adminUserId + parsed input', async () => {
      const calls: Array<[
        string,
        { bossKey?: string; level?: number; force?: boolean },
      ]> = [];
      const c = makeController({
        spawnImpl: async (id, inp) => {
          calls.push([id, inp]);
          return STUB_BOSS;
        },
      });
      const r = await c.adminSpawn(makeAdminReq(), {
        bossKey: 'demon-king',
        level: 5,
        force: true,
      });
      expect(r).toEqual({ ok: true, data: STUB_BOSS });
      expect(calls).toEqual([
        ['admin-1', { bossKey: 'demon-king', level: 5, force: true }],
      ]);
    });

    it('200 + body trống → service nhận empty input (all optional)', async () => {
      const calls: Array<unknown> = [];
      const c = makeController({
        spawnImpl: async (id, inp) => {
          calls.push([id, inp]);
          return STUB_BOSS;
        },
      });
      const r = await c.adminSpawn(makeAdminReq(), {});
      expect(r?.ok).toBe(true);
      expect(calls).toEqual([['admin-1', {}]]);
    });
  });

  describe('BossError 11-code mapping (qua attack endpoint)', () => {
    const cases: Array<[
      | 'NO_CHARACTER'
      | 'NO_ACTIVE_BOSS'
      | 'COOLDOWN'
      | 'SKILL_NOT_USABLE'
      | 'INVALID_BOSS_KEY'
      | 'INVALID_LEVEL'
      | 'BOSS_DEFEATED'
      | 'STAMINA_LOW'
      | 'MP_LOW'
      | 'HP_LOW'
      | 'BOSS_ALREADY_ACTIVE',
      number,
    ]> = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['NO_ACTIVE_BOSS', HttpStatus.NOT_FOUND],
      ['COOLDOWN', HttpStatus.TOO_MANY_REQUESTS],
      ['SKILL_NOT_USABLE', HttpStatus.BAD_REQUEST],
      ['INVALID_BOSS_KEY', HttpStatus.BAD_REQUEST],
      ['INVALID_LEVEL', HttpStatus.BAD_REQUEST],
      ['BOSS_DEFEATED', HttpStatus.CONFLICT],
      ['STAMINA_LOW', HttpStatus.CONFLICT],
      ['MP_LOW', HttpStatus.CONFLICT],
      ['HP_LOW', HttpStatus.CONFLICT],
      ['BOSS_ALREADY_ACTIVE', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of cases) {
      it(`BossError(${code}) → ${status}`, async () => {
        const c = makeController({
          attackImpl: async () => {
            throw new BossError(code);
          },
        });
        await expectHttpError(
          c.attack(makeReq('valid'), {}),
          status,
          code,
        );
      });
    }

    it('rethrow non-BossError nguyên (attack)', async () => {
      const boom = new Error('db down');
      const c = makeController({
        attackImpl: async () => {
          throw boom;
        },
      });
      await expect(c.attack(makeReq('valid'), {})).rejects.toBe(boom);
    });

    it('adminSpawn: BossError(INVALID_BOSS_KEY) → 400', async () => {
      const c = makeController({
        spawnImpl: async () => {
          throw new BossError('INVALID_BOSS_KEY');
        },
      });
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), { bossKey: 'unknown' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_BOSS_KEY',
      );
    });

    it('adminSpawn: BossError(BOSS_ALREADY_ACTIVE) → 409', async () => {
      const c = makeController({
        spawnImpl: async () => {
          throw new BossError('BOSS_ALREADY_ACTIVE');
        },
      });
      await expectHttpError(
        c.adminSpawn(makeAdminReq(), {}),
        HttpStatus.CONFLICT,
        'BOSS_ALREADY_ACTIVE',
      );
    });
  });
});
