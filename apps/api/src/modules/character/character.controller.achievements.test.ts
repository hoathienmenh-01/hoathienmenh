import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import { AchievementError, type AchievementService } from './achievement.service';
import type { AchievementDef } from '@xuantoi/shared';

/**
 * Phase 11.10.E — controller-level test cho `GET /character/achievements`.
 * Service được mock; verify wiring + error mapping + ISO date serialization.
 */

const STUB_DEF: AchievementDef = {
  key: 'first_monster_kill',
  nameVi: 'Sơ Sát',
  nameEn: 'First Blood',
  description: 'Lần đầu chính thức ra tay sát địch.',
  category: 'combat',
  tier: 'bronze',
  goalKind: 'KILL_MONSTER',
  goalAmount: 1,
  element: null,
  rewardTitleKey: 'achievement_first_kill',
  reward: { linhThach: 100, exp: 50 },
  hidden: false,
};

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  character?: { id: string } | null;
  achievement?: Partial<AchievementService> | null;
}

function makeController(opts: ControllerOpts = {}) {
  const auth = {
    userIdFromAccess: async (token: string | undefined) =>
      token ? 'u1' : null,
  } as unknown as AuthService;
  const character =
    opts.character === undefined ? { id: 'c1' } : opts.character;
  const chars = {
    findByUser: async (_userId: string) => character,
  } as unknown as CharacterService;
  const achievement =
    opts.achievement === null
      ? undefined
      : (opts.achievement as AchievementService | undefined);
  const controller = new CharacterController(
    chars,
    auth,
    undefined, // spiritualRoot
    undefined, // cultivationMethod
    undefined, // characterSkill
    undefined, // gem
    undefined, // refine
    undefined, // equipment (Phase 15.0.A)
    undefined, // tribulation
    achievement,
    undefined, // talent
    undefined, // alchemy
    undefined, // title
    undefined, // buff
    undefined, // profileLimiter
  );
  return { controller };
}

describe('CharacterController.achievementsState — Phase 11.10.E', () => {
  it('GET /character/achievements ok → return achievements list với progress + ISO date', async () => {
    const completedAt = new Date('2026-01-02T03:04:05.000Z');
    const claimedAt = new Date('2026-01-02T03:05:00.000Z');
    const achievement = {
      listAllWithProgress: async (_id: string) => [
        {
          achievementKey: 'first_monster_kill',
          progress: 1,
          completedAt,
          claimedAt,
          def: STUB_DEF,
        },
        {
          achievementKey: 'kill_100_monsters',
          progress: 30,
          completedAt: null,
          claimedAt: null,
          def: { ...STUB_DEF, key: 'kill_100_monsters', goalAmount: 100 },
        },
      ],
    } as unknown as AchievementService;
    const { controller } = makeController({ achievement });
    const res = (await controller.achievementsState(makeReq())) as {
      ok: true;
      data: {
        achievements: Array<{
          achievementKey: string;
          progress: number;
          completedAt: string | null;
          claimedAt: string | null;
          def: AchievementDef;
        }>;
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.achievements).toHaveLength(2);
    expect(res.data.achievements[0].achievementKey).toBe('first_monster_kill');
    expect(res.data.achievements[0].completedAt).toBe(completedAt.toISOString());
    expect(res.data.achievements[0].claimedAt).toBe(claimedAt.toISOString());
    expect(res.data.achievements[1].progress).toBe(30);
    expect(res.data.achievements[1].completedAt).toBeNull();
    expect(res.data.achievements[1].claimedAt).toBeNull();
  });

  it('GET /character/achievements → 401 UNAUTHENTICATED nếu không có cookie', async () => {
    const { controller } = makeController({
      achievement: {} as AchievementService,
    });
    const req = { cookies: {}, ip: '203.0.113.2' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.achievementsState(req);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET /character/achievements → 501 ACHIEVEMENT_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ achievement: null });
    let caught: HttpException | null = null;
    try {
      await controller.achievementsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ACHIEVEMENT_UNAVAILABLE');
  });

  it('GET /character/achievements → 404 NO_CHARACTER nếu character chưa onboard', async () => {
    const achievement = {} as unknown as AchievementService;
    const { controller } = makeController({ character: null, achievement });
    let caught: HttpException | null = null;
    try {
      await controller.achievementsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });

  it('GET /character/achievements map AchievementError(CHARACTER_NOT_FOUND) → 404', async () => {
    const achievement = {
      listAllWithProgress: async (_id: string) => {
        throw new AchievementError('CHARACTER_NOT_FOUND');
      },
    } as unknown as AchievementService;
    const { controller } = makeController({ achievement });
    let caught: HttpException | null = null;
    try {
      await controller.achievementsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('CHARACTER_NOT_FOUND');
  });

  it('GET /character/achievements empty list → return ok + empty array', async () => {
    const achievement = {
      listAllWithProgress: async (_id: string) => [],
    } as unknown as AchievementService;
    const { controller } = makeController({ achievement });
    const res = (await controller.achievementsState(makeReq())) as {
      ok: true;
      data: { achievements: unknown[] };
    };
    expect(res.ok).toBe(true);
    expect(res.data.achievements).toEqual([]);
  });
});
