import { describe, it, expect } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import {
  CharacterSkillError,
  type CharacterSkillService,
} from './character-skill.service';

/**
 * Phase 11.2.D — controller-level test cho:
 *   - POST /character/skill/learn-from-book
 *
 * Service được mock; verify wiring + error mapping (404
 * INVENTORY_ITEM_NOT_FOUND, 409 NOT_SKILL_BOOK / ALREADY_LEARNED, 501
 * CHARACTER_SKILL_UNAVAILABLE, 404 NO_CHARACTER, 400 INVALID_INPUT).
 */

const STUB_OUT = {
  skillKey: 'kim_quang_tram',
  consumedItemKey: 'skill_book_kim_quang_tram',
  state: {
    maxEquipped: 4,
    learned: [],
  },
};

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  character?: { id: string } | null;
  characterSkill?: Partial<CharacterSkillService> | null;
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
  const characterSkill =
    opts.characterSkill === null
      ? undefined
      : (opts.characterSkill as CharacterSkillService | undefined);
  const controller = new CharacterController(
    chars,
    auth,
    undefined, // spiritualRoot
    undefined, // cultivationMethod
    characterSkill,
    undefined, // gem
    undefined, // refine
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

describe('CharacterController.skillLearnFromBook — POST /character/skill/learn-from-book', () => {
  it('happy path → return { learn: { skillKey, consumedItemKey, state } }', async () => {
    const characterSkill = {
      learnFromBook: async (_id: string, _invId: string) => STUB_OUT,
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    const res = (await controller.skillLearnFromBook(makeReq(), {
      inventoryItemId: 'inv-1',
    })) as {
      ok: true;
      data: { learn: typeof STUB_OUT };
    };
    expect(res.ok).toBe(true);
    expect(res.data.learn.skillKey).toBe('kim_quang_tram');
    expect(res.data.learn.consumedItemKey).toBe('skill_book_kim_quang_tram');
  });

  it('CharacterSkillService không có (DI) → 501 CHARACTER_SKILL_UNAVAILABLE', async () => {
    const { controller } = makeController({ characterSkill: null });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'CHARACTER_SKILL_UNAVAILABLE' } },
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it('body không có inventoryItemId → 400 INVALID_INPUT', async () => {
    const characterSkill = {
      learnFromBook: async () => STUB_OUT,
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), {}),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('character không tồn tại → 404 NO_CHARACTER', async () => {
    const characterSkill = {
      learnFromBook: async () => STUB_OUT,
    } as unknown as CharacterSkillService;
    const { controller } = makeController({
      character: null,
      characterSkill,
    });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'NO_CHARACTER' } },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('INVENTORY_ITEM_NOT_FOUND → 404 NOT_FOUND', async () => {
    const characterSkill = {
      learnFromBook: async () => {
        throw new CharacterSkillError('INVENTORY_ITEM_NOT_FOUND');
      },
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-x' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVENTORY_ITEM_NOT_FOUND' } },
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('NOT_SKILL_BOOK → 409 CONFLICT', async () => {
    const characterSkill = {
      learnFromBook: async () => {
        throw new CharacterSkillError('NOT_SKILL_BOOK');
      },
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'NOT_SKILL_BOOK' } },
      status: HttpStatus.CONFLICT,
    });
  });

  it('ALREADY_LEARNED → 409 CONFLICT', async () => {
    const characterSkill = {
      learnFromBook: async () => {
        throw new CharacterSkillError('ALREADY_LEARNED');
      },
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'ALREADY_LEARNED' } },
      status: HttpStatus.CONFLICT,
    });
  });

  it('REALM_TOO_LOW (unlock fail) → 409 CONFLICT', async () => {
    const characterSkill = {
      learnFromBook: async () => {
        throw new CharacterSkillError('REALM_TOO_LOW');
      },
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'REALM_TOO_LOW' } },
      status: HttpStatus.CONFLICT,
    });
  });

  it('SKILL_NOT_FOUND (orphan) → 404 NOT_FOUND', async () => {
    const characterSkill = {
      learnFromBook: async () => {
        throw new CharacterSkillError('SKILL_NOT_FOUND');
      },
    } as unknown as CharacterSkillService;
    const { controller } = makeController({ characterSkill });
    await expect(
      controller.skillLearnFromBook(makeReq(), { inventoryItemId: 'inv-1' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'SKILL_NOT_FOUND' } },
      status: HttpStatus.NOT_FOUND,
    });
  });
});
