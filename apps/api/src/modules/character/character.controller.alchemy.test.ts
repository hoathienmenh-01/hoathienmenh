import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import {
  AlchemyError,
  type AlchemyCraftOutcome,
  type AlchemyService,
} from './alchemy.service';
import type { AlchemyRecipeDef } from '@xuantoi/shared';

/**
 * Phase 11.11.C — controller-level tests cho `GET /character/alchemy/recipes` +
 * `POST /character/alchemy/craft`. Không cần Postgres — service được mock,
 * chỉ verify wiring + error mapping + Zod validation + idempotent contract.
 */

const STUB_RECIPE: AlchemyRecipeDef = {
  key: 'recipe_tieu_phuc_dan',
  name: 'Tiểu Phục Đan',
  description: 'HP pill tier PHAM',
  outputItem: 'tieu_phuc_dan',
  outputQty: 2,
  outputQuality: 'PHAM',
  inputs: [{ itemKey: 'linh_thao', qty: 3 }],
  recipeTier: 1,
  recipeCategory: 'HEAL_HP',
  requiredAlchemyLevel: 1,
  alchemyExpReward: 40n,
  furnaceLevel: 1,
  realmRequirement: null,
  linhThachCost: 50,
  successRate: 0.85,
};

const STUB_OUTCOME: AlchemyCraftOutcome = {
  recipeKey: 'recipe_tieu_phuc_dan',
  success: true,
  rollValue: 0.1,
  outputItem: 'tieu_phuc_dan',
  outputQty: 2,
  pillGrade: 'TRUNG_PHAM',
  successRate: 0.85,
  alchemyExpGained: '40',
  alchemyLevelBefore: 1,
  alchemyLevelAfter: 1,
  linhThachConsumed: 50,
  inputsConsumed: [{ itemKey: 'linh_thao', qty: 3 }],
};

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

interface ControllerOpts {
  character?: { id: string } | null;
  alchemy?: Partial<AlchemyService> | null;
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
  const alchemy =
    opts.alchemy === null
      ? undefined
      : (opts.alchemy as AlchemyService | undefined);
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
    undefined, // achievement
    undefined, // talent
    alchemy,
    undefined, // title
    undefined, // buff
    undefined, // profileLimiter
  );
  return { controller };
}

// ---------- GET /character/alchemy/recipes ----------

describe('CharacterController.alchemyRecipes — Phase 11.11.C', () => {
  it('GET /character/alchemy/recipes returns furnaceLevel + recipe list + nextUpgrade preview', async () => {
    const alchemy = {
      getAlchemyProfile: async (_id: string) => ({ alchemyLevel: 1, alchemyLevelName: 'Đan Sư Nhập Môn', alchemyExp: '0', alchemyExpNext: '120', alchemyMastery: 0, furnaceLevel: 1 }),
      listAvailableRecipes: async (_id: string) => [STUB_RECIPE],
      getFurnaceUpgradePreview: async (_id: string) => ({
        toLevel: 2,
        linhThachCost: 500,
        realmRequirement: null,
      }),
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyRecipes(makeReq())) as {
      ok: true;
      data: {
        alchemy: {
          furnaceLevel: number;
          nextUpgrade: {
            toLevel: number;
            linhThachCost: number;
            realmRequirement: string | null;
          } | null;
          recipes: Array<{
            key: string;
            name: string;
            outputItem: string;
            successRate: number;
          }>;
        };
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.alchemy.furnaceLevel).toBe(1);
    expect(res.data.alchemy.nextUpgrade).toEqual({
      toLevel: 2,
      linhThachCost: 500,
      realmRequirement: null,
    });
    expect(res.data.alchemy.recipes).toHaveLength(1);
    expect(res.data.alchemy.recipes[0].key).toBe('recipe_tieu_phuc_dan');
    expect(res.data.alchemy.recipes[0].successRate).toBe(0.85);
  });

  it('GET /character/alchemy/recipes returns nextUpgrade=null khi furnace ở MAX_LEVEL', async () => {
    const alchemy = {
      getAlchemyProfile: async (_id: string) => ({ alchemyLevel: 9, alchemyLevelName: 'Đan Đạo Tông Sư', alchemyExp: '0', alchemyExpNext: '0', alchemyMastery: 0, furnaceLevel: 9 }),
      listAvailableRecipes: async (_id: string) => [STUB_RECIPE],
      getFurnaceUpgradePreview: async (_id: string) => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyRecipes(makeReq())) as {
      ok: true;
      data: {
        alchemy: { furnaceLevel: number; nextUpgrade: unknown };
      };
    };
    expect(res.data.alchemy.furnaceLevel).toBe(9);
    expect(res.data.alchemy.nextUpgrade).toBeNull();
  });

  it('GET /character/alchemy/recipes → 401 UNAUTHENTICATED nếu không có cookie', async () => {
    const { controller } = makeController({ alchemy: {} as AlchemyService });
    const req = { cookies: {}, ip: '203.0.113.2' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.alchemyRecipes(req);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET /character/alchemy/recipes → 501 ALCHEMY_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ alchemy: null });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyRecipes(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ALCHEMY_UNAVAILABLE');
  });

  it('GET /character/alchemy/recipes → 404 NO_CHARACTER nếu character chưa onboard', async () => {
    const alchemy = {} as unknown as AlchemyService;
    const { controller } = makeController({ character: null, alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyRecipes(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });

  it('GET /character/alchemy/recipes map AlchemyError(CHARACTER_NOT_FOUND) → 404', async () => {
    const alchemy = {
      getAlchemyProfile: async (_id: string) => {
        throw new AlchemyError('CHARACTER_NOT_FOUND');
      },
      listAvailableRecipes: async (_id: string) => [],
      getFurnaceUpgradePreview: async (_id: string) => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyRecipes(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('CHARACTER_NOT_FOUND');
  });
});

// ---------- POST /character/alchemy/craft ----------

describe('CharacterController.alchemyCraft — Phase 11.11.C', () => {
  it('POST /character/alchemy/craft ok → return outcome + furnaceLevel', async () => {
    let receivedKey = '';
    const alchemy = {
      attemptCraft: async (_charId: string, recipeKey: string) => {
        receivedKey = recipeKey;
        return STUB_OUTCOME;
      },
      getFurnaceLevel: async (_id: string) => 1,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyCraft(makeReq(), {
      recipeKey: 'recipe_tieu_phuc_dan',
    })) as {
      ok: true;
      data: {
        alchemy: {
          furnaceLevel: number;
          outcome: {
            recipeKey: string;
            success: boolean;
            rollValue: number;
            outputItem: string | null;
            outputQty: number;
            linhThachConsumed: number;
            inputsConsumed: Array<{ itemKey: string; qty: number }>;
          };
        };
      };
    };
    expect(receivedKey).toBe('recipe_tieu_phuc_dan');
    expect(res.ok).toBe(true);
    expect(res.data.alchemy.outcome.success).toBe(true);
    expect(res.data.alchemy.outcome.recipeKey).toBe('recipe_tieu_phuc_dan');
    expect(res.data.alchemy.outcome.outputItem).toBe('tieu_phuc_dan');
    expect(res.data.alchemy.outcome.linhThachConsumed).toBe(50);
    expect(res.data.alchemy.furnaceLevel).toBe(1);
  });

  it('POST /character/alchemy/craft → 400 INVALID_INPUT nếu body thiếu recipeKey', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new Error('should-not-call');
      },
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), {});
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /character/alchemy/craft → 404 RECIPE_NOT_FOUND', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new AlchemyError('RECIPE_NOT_FOUND');
      },
      getFurnaceLevel: async () => 1,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'xxx' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('RECIPE_NOT_FOUND');
  });

  it('POST /character/alchemy/craft → 409 FURNACE_LEVEL_TOO_LOW', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new AlchemyError('FURNACE_LEVEL_TOO_LOW');
      },
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_thanh_lam_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('FURNACE_LEVEL_TOO_LOW');
  });

  it('POST /character/alchemy/craft → 409 REALM_REQUIREMENT_NOT_MET', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new AlchemyError('REALM_REQUIREMENT_NOT_MET');
      },
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_tien_phach_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('REALM_REQUIREMENT_NOT_MET');
  });

  it('POST /character/alchemy/craft → 409 INSUFFICIENT_INGREDIENTS', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new AlchemyError('INSUFFICIENT_INGREDIENTS');
      },
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_tieu_phuc_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_INGREDIENTS');
  });

  it('POST /character/alchemy/craft → 409 INSUFFICIENT_FUNDS', async () => {
    const alchemy = {
      attemptCraft: async () => {
        throw new AlchemyError('INSUFFICIENT_FUNDS');
      },
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_tieu_phuc_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('POST /character/alchemy/craft → 401 UNAUTHENTICATED nếu cookie thiếu', async () => {
    const { controller } = makeController({ alchemy: {} as AlchemyService });
    const req = { cookies: {}, ip: '127.0.0.1' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(req, { recipeKey: 'recipe_tieu_phuc_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('POST /character/alchemy/craft → 501 ALCHEMY_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ alchemy: null });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_tieu_phuc_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ALCHEMY_UNAVAILABLE');
  });

  it('POST /character/alchemy/craft → 404 NO_CHARACTER nếu character chưa onboard', async () => {
    const alchemy = {} as unknown as AlchemyService;
    const { controller } = makeController({ character: null, alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyCraft(makeReq(), { recipeKey: 'recipe_tieu_phuc_dan' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });

  it('POST /character/alchemy/craft fail outcome → success=false, outputItem=null', async () => {
    const failOutcome: AlchemyCraftOutcome = {
      ...STUB_OUTCOME,
      success: false,
      rollValue: 0.99,
      outputItem: null,
      outputQty: 0,
    };
    const alchemy = {
      attemptCraft: async () => failOutcome,
      getFurnaceLevel: async () => 1,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyCraft(makeReq(), {
      recipeKey: 'recipe_tieu_phuc_dan',
    })) as {
      ok: true;
      data: {
        alchemy: {
          outcome: {
            success: boolean;
            outputItem: string | null;
            outputQty: number;
          };
        };
      };
    };
    expect(res.data.alchemy.outcome.success).toBe(false);
    expect(res.data.alchemy.outcome.outputItem).toBeNull();
    expect(res.data.alchemy.outcome.outputQty).toBe(0);
  });
});

// ---------- POST /character/alchemy/upgrade-furnace (Phase 11.11.D-2) ----------

describe('CharacterController.alchemyUpgradeFurnace — Phase 11.11.D-2', () => {
  it('200 happy: trả về outcome + nextUpgrade preview', async () => {
    const alchemy = {
      upgradeFurnace: async (_id: string) => ({
        fromLevel: 1,
        toLevel: 2,
        linhThachConsumed: 500,
      }),
      getFurnaceUpgradePreview: async (_id: string) => ({
        toLevel: 3,
        linhThachCost: 2_000,
        realmRequirement: 'truc_co',
      }),
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyUpgradeFurnace(makeReq())) as {
      ok: true;
      data: {
        alchemy: {
          furnaceLevel: number;
          outcome: { fromLevel: number; toLevel: number; linhThachConsumed: number };
          nextUpgrade: {
            toLevel: number;
            linhThachCost: number;
            realmRequirement: string | null;
          } | null;
        };
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.alchemy.furnaceLevel).toBe(2);
    expect(res.data.alchemy.outcome).toEqual({
      fromLevel: 1,
      toLevel: 2,
      linhThachConsumed: 500,
    });
    expect(res.data.alchemy.nextUpgrade).toEqual({
      toLevel: 3,
      linhThachCost: 2_000,
      realmRequirement: 'truc_co',
    });
  });

  it('200 với nextUpgrade=null nếu vừa đạt MAX_LEVEL', async () => {
    const alchemy = {
      upgradeFurnace: async (_id: string) => ({
        fromLevel: 8,
        toLevel: 9,
        linhThachConsumed: 800_000,
      }),
      getFurnaceUpgradePreview: async (_id: string) => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    const res = (await controller.alchemyUpgradeFurnace(makeReq())) as {
      ok: true;
      data: { alchemy: { furnaceLevel: number; nextUpgrade: unknown } };
    };
    expect(res.data.alchemy.furnaceLevel).toBe(9);
    expect(res.data.alchemy.nextUpgrade).toBeNull();
  });

  it('401 UNAUTHENTICATED nếu không có cookie', async () => {
    const { controller } = makeController({ alchemy: {} as AlchemyService });
    const req = { cookies: {}, ip: '203.0.113.2' } as unknown as Request;
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(req);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('501 ALCHEMY_UNAVAILABLE nếu service unwired', async () => {
    const { controller } = makeController({ alchemy: null });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ALCHEMY_UNAVAILABLE');
  });

  it('404 NO_CHARACTER nếu character chưa onboard', async () => {
    const alchemy = {} as unknown as AlchemyService;
    const { controller } = makeController({ character: null, alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('NO_CHARACTER');
  });

  it('409 INSUFFICIENT_FUNDS map từ AlchemyError', async () => {
    const alchemy = {
      upgradeFurnace: async () => {
        throw new AlchemyError('INSUFFICIENT_FUNDS');
      },
      getFurnaceUpgradePreview: async () => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('409 REALM_REQUIREMENT_NOT_MET map từ AlchemyError', async () => {
    const alchemy = {
      upgradeFurnace: async () => {
        throw new AlchemyError('REALM_REQUIREMENT_NOT_MET');
      },
      getFurnaceUpgradePreview: async () => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('REALM_REQUIREMENT_NOT_MET');
  });

  it('409 FURNACE_LEVEL_MAX map từ AlchemyError', async () => {
    const alchemy = {
      upgradeFurnace: async () => {
        throw new AlchemyError('FURNACE_LEVEL_MAX');
      },
      getFurnaceUpgradePreview: async () => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: HttpException | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = caught?.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('FURNACE_LEVEL_MAX');
  });

  it('non-AlchemyError được rethrow nguyên dạng (defensive)', async () => {
    const alchemy = {
      upgradeFurnace: async () => {
        throw new Error('UNEXPECTED');
      },
      getFurnaceUpgradePreview: async () => null,
    } as unknown as AlchemyService;
    const { controller } = makeController({ alchemy });
    let caught: Error | null = null;
    try {
      await controller.alchemyUpgradeFurnace(makeReq());
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(HttpException);
    expect(caught?.message).toBe('UNEXPECTED');
  });
});
