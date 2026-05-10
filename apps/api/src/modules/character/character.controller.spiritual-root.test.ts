import { describe, it, expect } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import { SpiritualRootError, type SpiritualRootService } from './spiritual-root.service';

/**
 * Phase 11.3.D — controller-level test cho:
 *   - GET  /character/spiritual-root (existing Phase 11.3.A)
 *   - POST /character/spiritual-root/reroll (new Phase 11.3.D)
 *
 * Service được mock; verify wiring + error mapping (LINH_CAN_DAN_INSUFFICIENT
 * 409, NOT_INITIALIZED 409, NO_CHARACTER 404, SPIRITUAL_ROOT_UNAVAILABLE 501).
 */

const STUB_STATE = {
  grade: 'linh' as const,
  primaryElement: 'kim' as const,
  secondaryElements: ['moc'] as const,
  purity: 88,
  rerollCount: 0,
};

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  character?: { id: string } | null;
  spiritualRoot?: Partial<SpiritualRootService> | null;
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
  const spiritualRoot =
    opts.spiritualRoot === null
      ? undefined
      : (opts.spiritualRoot as SpiritualRootService | undefined);
  const controller = new CharacterController(
    chars,
    auth,
    spiritualRoot,
    undefined, // cultivationMethod
    undefined, // characterSkill
    undefined, // gem
    undefined, // refine
    undefined, // equipment (Phase 15.0.A)
    undefined, // tribulation
    undefined, // achievement
    undefined, // talent
    undefined, // alchemy
    undefined, // title
    undefined, // buff
    undefined, // profileLimiter
  );
  return { controller };
}

describe('CharacterController.spiritualRootState — GET /character/spiritual-root', () => {
  it('happy path → return state', async () => {
    const spiritualRoot = {
      getState: async (_id: string) => STUB_STATE,
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    const res = (await controller.spiritualRootState(makeReq())) as {
      ok: true;
      data: { spiritualRoot: typeof STUB_STATE };
    };
    expect(res.ok).toBe(true);
    expect(res.data.spiritualRoot).toEqual(STUB_STATE);
  });

  it('SpiritualRootService không có (DI) → 501 NOT_IMPLEMENTED', async () => {
    const { controller } = makeController({ spiritualRoot: null });
    await expect(controller.spiritualRootState(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'SPIRITUAL_ROOT_UNAVAILABLE' } },
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it('character không tồn tại → 404 NO_CHARACTER', async () => {
    const spiritualRoot = {
      getState: async () => STUB_STATE,
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ character: null, spiritualRoot });
    await expect(controller.spiritualRootState(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'NO_CHARACTER' } },
      status: HttpStatus.NOT_FOUND,
    });
  });
});

describe('CharacterController.spiritualRootReroll — POST /character/spiritual-root/reroll', () => {
  it('happy path → return new state', async () => {
    const spiritualRoot = {
      reroll: async (_id: string) => ({ ...STUB_STATE, rerollCount: 1, grade: 'huyen' as const }),
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    const res = (await controller.spiritualRootReroll(makeReq())) as {
      ok: true;
      data: { spiritualRoot: typeof STUB_STATE };
    };
    expect(res.ok).toBe(true);
    expect(res.data.spiritualRoot.grade).toBe('huyen');
    expect(res.data.spiritualRoot.rerollCount).toBe(1);
  });

  it('LINH_CAN_DAN_INSUFFICIENT → 409 CONFLICT', async () => {
    const spiritualRoot = {
      reroll: async (_id: string) => {
        throw new SpiritualRootError('LINH_CAN_DAN_INSUFFICIENT');
      },
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'LINH_CAN_DAN_INSUFFICIENT' } },
      status: HttpStatus.CONFLICT,
    });
  });

  it('NOT_INITIALIZED → 409 CONFLICT', async () => {
    const spiritualRoot = {
      reroll: async (_id: string) => {
        throw new SpiritualRootError('NOT_INITIALIZED');
      },
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'NOT_INITIALIZED' } },
      status: HttpStatus.CONFLICT,
    });
  });

  it('CHARACTER_NOT_FOUND từ service → 404 NO_CHARACTER', async () => {
    const spiritualRoot = {
      reroll: async (_id: string) => {
        throw new SpiritualRootError('CHARACTER_NOT_FOUND');
      },
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'NO_CHARACTER' } },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('character chưa có trong DB → 404 NO_CHARACTER (controller check)', async () => {
    const spiritualRoot = {
      reroll: async () => STUB_STATE,
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ character: null, spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'NO_CHARACTER' } },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('SpiritualRootService không có (DI) → 501 NOT_IMPLEMENTED', async () => {
    const { controller } = makeController({ spiritualRoot: null });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toMatchObject({
      response: { error: { code: 'SPIRITUAL_ROOT_UNAVAILABLE' } },
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it('non-SpiritualRootError exception → bubble up unchanged', async () => {
    const spiritualRoot = {
      reroll: async () => {
        throw new Error('unexpected_db_failure');
      },
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toThrow(
      /unexpected_db_failure/,
    );
  });

  it('SpiritualRootError với code lạ → bubble up unchanged (defensive)', async () => {
    const spiritualRoot = {
      reroll: async () => {
        // Cast vì code phải là một trong 3 union member, ở đây giả lập future code mới.
        const err = new SpiritualRootError('CHARACTER_NOT_FOUND');
        (err as unknown as { code: string }).code = 'NEW_FUTURE_CODE';
        throw err;
      },
    } as unknown as SpiritualRootService;
    const { controller } = makeController({ spiritualRoot });
    await expect(controller.spiritualRootReroll(makeReq())).rejects.toBeInstanceOf(
      SpiritualRootError,
    );
  });
});

