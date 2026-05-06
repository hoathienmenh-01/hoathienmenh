import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import { TalentError, type TalentService } from './talent.service';
import type { TalentDef } from '@xuantoi/shared';

/**
 * Phase 11.X.AS — controller-level tests cho `GET /character/talents/state` +
 * `POST /character/talents/learn`. Không cần Postgres — service được mock,
 * chỉ verify wiring + error mapping + Zod validation + idempotent contract.
 */

const STUB_DEF: TalentDef = {
  key: 'kim_battery_passive',
  type: 'passive',
  element: 'kim',
  realmRequired: 'phamnhan',
  talentPointCost: 1,
  passive: {
    kind: 'stat_mod',
    statTarget: 'atk',
    multiplier: 1.05,
  },
  // The shared TalentDef accepts more fields; cast for test ergonomics.
} as unknown as TalentDef;

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  /** Override findByUser → return character or null. */
  character?: { id: string } | null;
  talent?: Partial<TalentService> | null;
}

function makeController(opts: ControllerOpts = {}) {
  const auth = {
    userIdFromAccess: async (token: string | undefined) =>
      token ? 'u1' : null,
  } as unknown as AuthService;
  const character = opts.character === undefined ? { id: 'c1' } : opts.character;
  const chars = {
    findByUser: async (_userId: string) => character,
  } as unknown as CharacterService;
  // Khi opts.talent === null → unwired (NOT_IMPLEMENTED branch).
  const talent =
    opts.talent === null ? undefined : (opts.talent as TalentService | undefined);
  const controller = new CharacterController(
    chars,
    auth,
    undefined, // spiritualRoot
    undefined, // cultivationMethod
    undefined, // characterSkill
    undefined, // gem
    undefined, // refine
    undefined, // tribulation
    undefined, // achievement
    talent,
    undefined, // alchemy
    undefined, // title
    undefined, // buff
    undefined, // profileLimiter
  );
  return { controller };
}

describe('CharacterController.talentsState — Phase 11.X.AS', () => {
  it('GET /character/talents/state returns budget/spent/remaining + learned list', async () => {
    const learnedAt = new Date('2026-05-01T12:00:00Z');
    const talent = {
      listLearned: async (_id: string) => [
        {
          talentKey: 'kim_battery_passive',
          learnedAt,
          cooldownTurnsRemaining: 0,
          def: STUB_DEF,
        },
      ],
      getRemainingTalentPoints: async (_id: string) => 4,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    const res = (await controller.talentsState(makeReq())) as {
      ok: true;
      data: {
        talents: {
          learned: Array<{
            talentKey: string;
            learnedAt: string;
            cooldownTurnsRemaining: number;
          }>;
          spent: number;
          remaining: number;
          budget: number;
        };
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.talents.learned).toEqual([
      {
        talentKey: 'kim_battery_passive',
        learnedAt: learnedAt.toISOString(),
        cooldownTurnsRemaining: 0,
      },
    ]);
    expect(res.data.talents.spent).toBe(1);
    expect(res.data.talents.remaining).toBe(4);
    expect(res.data.talents.budget).toBe(5);
  });

  it('GET /character/talents/state expose cooldownTurnsRemaining > 0 cho active talent vừa cast (Phase 11.7.E++)', async () => {
    const learnedAt = new Date('2026-05-02T10:00:00Z');
    const ACTIVE_DEF: TalentDef = {
      key: 'hoa_dragon_strike_active',
      type: 'active',
      element: 'hoa',
      realmRequired: 'truc_co',
      talentPointCost: 2,
      activeEffect: { kind: 'damage', value: 1.5, mpCost: 30, cooldownTurns: 5 },
    } as unknown as TalentDef;
    const talent = {
      listLearned: async (_id: string) => [
        {
          talentKey: 'hoa_dragon_strike_active',
          learnedAt,
          cooldownTurnsRemaining: 4,
          def: ACTIVE_DEF,
        },
      ],
      getRemainingTalentPoints: async (_id: string) => 3,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    const res = (await controller.talentsState(makeReq())) as {
      ok: true;
      data: {
        talents: {
          learned: Array<{
            talentKey: string;
            learnedAt: string;
            cooldownTurnsRemaining: number;
          }>;
        };
      };
    };
    expect(res.data.talents.learned[0]).toEqual({
      talentKey: 'hoa_dragon_strike_active',
      learnedAt: learnedAt.toISOString(),
      cooldownTurnsRemaining: 4,
    });
  });

  it('GET /character/talents/state → 401 UNAUTHENTICATED nếu không có cookie', async () => {
    const { controller } = makeController({ talent: {} as TalentService });
    const req = { cookies: {}, ip: '203.0.113.2' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.talentsState(req);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET /character/talents/state → 501 TALENT_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ talent: null });
    let caught: HttpException | null = null;
    try {
      await controller.talentsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('TALENT_UNAVAILABLE');
  });

  it('GET /character/talents/state → 404 NO_CHARACTER nếu character chưa onboard', async () => {
    const talent = {} as unknown as TalentService;
    const { controller } = makeController({ character: null, talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });

  it('GET /character/talents/state map TalentError(INVALID_REALM) → 500', async () => {
    const talent = {
      listLearned: async (_id: string) => {
        throw new TalentError('INVALID_REALM');
      },
      getRemainingTalentPoints: async (_id: string) => 0,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_REALM');
  });
});

describe('CharacterController.talentsLearn — Phase 11.X.AS', () => {
  it('POST /character/talents/learn ok → return learn row + remaining', async () => {
    const learnedAt = new Date('2026-05-02T08:30:00Z');
    let receivedKey = '';
    const talent = {
      learnTalent: async (_charId: string, talentKey: string) => {
        receivedKey = talentKey;
        return { talentKey, learnedAt };
      },
      getRemainingTalentPoints: async (_id: string) => 3,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    const res = (await controller.talentsLearn(makeReq(), {
      talentKey: 'kim_battery_passive',
    })) as {
      ok: true;
      data: {
        learn: { talentKey: string; learnedAt: string };
        remaining: number;
      };
    };
    expect(receivedKey).toBe('kim_battery_passive');
    expect(res.ok).toBe(true);
    expect(res.data.learn.talentKey).toBe('kim_battery_passive');
    expect(res.data.learn.learnedAt).toBe(learnedAt.toISOString());
    expect(res.data.remaining).toBe(3);
  });

  it('POST /character/talents/learn → 400 INVALID_INPUT nếu body sai', async () => {
    const talent = {
      learnTalent: async () => {
        throw new Error('should-not-call');
      },
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {});
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /character/talents/learn → 404 TALENT_NOT_FOUND nếu key không tồn tại', async () => {
    const talent = {
      learnTalent: async () => {
        throw new TalentError('TALENT_NOT_FOUND');
      },
      getRemainingTalentPoints: async () => 0,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), { talentKey: 'xxx' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('TALENT_NOT_FOUND');
  });

  it('POST /character/talents/learn → 409 ALREADY_LEARNED', async () => {
    const talent = {
      learnTalent: async () => {
        throw new TalentError('ALREADY_LEARNED');
      },
      getRemainingTalentPoints: async () => 0,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {
        talentKey: 'kim_battery_passive',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_LEARNED');
  });

  it('POST /character/talents/learn → 409 REALM_TOO_LOW', async () => {
    const talent = {
      learnTalent: async () => {
        throw new TalentError('REALM_TOO_LOW');
      },
      getRemainingTalentPoints: async () => 0,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {
        talentKey: 'high_realm_passive',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('REALM_TOO_LOW');
  });

  it('POST /character/talents/learn → 409 INSUFFICIENT_TALENT_POINTS', async () => {
    const talent = {
      learnTalent: async () => {
        throw new TalentError('INSUFFICIENT_TALENT_POINTS');
      },
      getRemainingTalentPoints: async () => 0,
    } as unknown as TalentService;
    const { controller } = makeController({ talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {
        talentKey: 'kim_battery_passive',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_TALENT_POINTS');
  });

  it('POST /character/talents/learn → 501 TALENT_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ talent: null });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {
        talentKey: 'kim_battery_passive',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
  });

  it('POST /character/talents/learn → 401 UNAUTHENTICATED nếu không có cookie', async () => {
    const talent = {} as unknown as TalentService;
    const { controller } = makeController({ talent });
    const req = { cookies: {}, ip: '203.0.113.3' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(req, { talentKey: 'kim_battery_passive' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('POST /character/talents/learn → 404 NO_CHARACTER nếu character chưa onboard', async () => {
    const talent = {} as unknown as TalentService;
    const { controller } = makeController({ character: null, talent });
    let caught: HttpException | null = null;
    try {
      await controller.talentsLearn(makeReq(), {
        talentKey: 'kim_battery_passive',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });
});
