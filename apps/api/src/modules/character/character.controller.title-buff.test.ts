import { describe, it, expect } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import type { BuffDef, TitleDef } from '@xuantoi/shared';
import { CharacterController } from './character.controller';
import type { AuthService } from '../auth/auth.service';
import type { CharacterService } from './character.service';
import { TitleError, type TitleService } from './title.service';
import type { BuffService } from './buff.service';

/**
 * Phase 11.8.D / 11.9.C — controller-level tests cho 4 endpoint Title/Buff.
 *
 * Service mock; verify wiring + envelope format + ISO date serialization +
 * error → HTTP status mapping.
 */

const STUB_TITLE_DEF: TitleDef = {
  key: 'realm_kim_dan_adept',
  nameVi: 'Kim Đan Chân Tu',
  nameEn: 'Golden Core Adept',
  description: 'desc',
  rarity: 'rare',
  source: 'realm_milestone',
  element: null,
  unlockRealmKey: 'kim_dan',
  unlockAchievementKey: null,
  unlockSectRole: null,
  flavorStatBonus: null,
};

function makeReq(): Request {
  return {
    cookies: { xt_access: 'fake-cookie' },
    ip: '203.0.113.1',
  } as unknown as Request;
}

function makeNoCookieReq(): Request {
  return {
    cookies: {},
    ip: '203.0.113.2',
  } as unknown as Request;
}

interface CtrlOpts {
  character?: { id: string } | null;
  title?: Partial<TitleService> | null;
  buff?: Partial<BuffService> | null;
  fresh?: unknown;
}

function makeController(opts: CtrlOpts = {}) {
  const auth = {
    userIdFromAccess: async (token: string | undefined) =>
      token ? 'u1' : null,
  } as unknown as AuthService;
  const character =
    opts.character === undefined ? { id: 'c1' } : opts.character;
  const chars = {
    findByUser: async (_userId: string) => character,
    getStateOrThrow: async (_userId: string) =>
      opts.fresh ?? { id: 'c1', title: 'realm_kim_dan_adept' },
  } as unknown as CharacterService;
  const title =
    opts.title === null ? undefined : (opts.title as TitleService | undefined);
  const buff =
    opts.buff === null ? undefined : (opts.buff as BuffService | undefined);
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
    undefined, // talent
    undefined, // alchemy
    title,
    buff,
    undefined, // profileLimiter
  );
  return { controller };
}

describe('CharacterController.titlesState — GET /character/titles', () => {
  it('happy path → trả owned + catalog + equipped, ISO date', async () => {
    const unlockedAt = new Date('2026-01-01T00:00:00.000Z');
    const title = {
      listOwned: async (_id: string) => [
        {
          titleKey: 'realm_kim_dan_adept',
          source: 'realm_milestone' as const,
          unlockedAt,
          def: STUB_TITLE_DEF,
        },
      ],
      getEquipped: async (_id: string) => ({
        titleKey: 'realm_kim_dan_adept',
        def: STUB_TITLE_DEF,
      }),
    } as unknown as TitleService;
    const { controller } = makeController({ title });
    const res = (await controller.titlesState(makeReq())) as {
      ok: true;
      data: {
        owned: Array<{ titleKey: string; unlockedAt: string }>;
        catalog: readonly TitleDef[];
        equipped: { titleKey: string; def: TitleDef } | null;
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.owned).toHaveLength(1);
    expect(res.data.owned[0].titleKey).toBe('realm_kim_dan_adept');
    expect(res.data.owned[0].unlockedAt).toBe(unlockedAt.toISOString());
    expect(res.data.catalog.length).toBeGreaterThan(0);
    expect(res.data.equipped?.titleKey).toBe('realm_kim_dan_adept');
  });

  it('null equipped → trả equipped: null', async () => {
    const title = {
      listOwned: async () => [],
      getEquipped: async () => null,
    } as unknown as TitleService;
    const { controller } = makeController({ title });
    const res = (await controller.titlesState(makeReq())) as {
      ok: true;
      data: { equipped: null };
    };
    expect(res.data.equipped).toBeNull();
  });

  it('chưa login → 401 UNAUTHENTICATED', async () => {
    const { controller } = makeController({ title: {} as TitleService });
    let caught: HttpException | null = null;
    try {
      await controller.titlesState(makeNoCookieReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('TitleService chưa wire → 501 TITLE_UNAVAILABLE', async () => {
    const { controller } = makeController({ title: null });
    let caught: HttpException | null = null;
    try {
      await controller.titlesState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
  });

  it('character không tồn tại → 404 NO_CHARACTER', async () => {
    const { controller } = makeController({
      character: null,
      title: {} as TitleService,
    });
    let caught: HttpException | null = null;
    try {
      await controller.titlesState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('CharacterController.titleEquip — POST /character/title/equip', () => {
  it('happy path → return character + equipped', async () => {
    const title = {
      equipTitle: async (_id: string, _key: string) => undefined,
      getEquipped: async () => ({
        titleKey: 'realm_kim_dan_adept',
        def: STUB_TITLE_DEF,
      }),
    } as unknown as TitleService;
    const { controller } = makeController({
      title,
      fresh: { id: 'c1', title: 'realm_kim_dan_adept' },
    });
    const res = (await controller.titleEquip(makeReq(), {
      titleKey: 'realm_kim_dan_adept',
    })) as {
      ok: true;
      data: { character: { title: string }; equipped: { titleKey: string } };
    };
    expect(res.ok).toBe(true);
    expect(res.data.character.title).toBe('realm_kim_dan_adept');
    expect(res.data.equipped.titleKey).toBe('realm_kim_dan_adept');
  });

  it('INVALID_INPUT khi body thiếu titleKey → 400', async () => {
    const { controller } = makeController({ title: {} as TitleService });
    let caught: HttpException | null = null;
    try {
      await controller.titleEquip(makeReq(), {});
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('TITLE_NOT_FOUND khi key không trong catalog → 404', async () => {
    const { controller } = makeController({ title: {} as TitleService });
    let caught: HttpException | null = null;
    try {
      await controller.titleEquip(makeReq(), {
        titleKey: 'totally_not_a_real_title',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('TitleError TITLE_NOT_OWNED → 409 CONFLICT', async () => {
    const title = {
      equipTitle: async () => {
        throw new TitleError('TITLE_NOT_OWNED', 'no own');
      },
    } as unknown as TitleService;
    const { controller } = makeController({ title });
    let caught: HttpException | null = null;
    try {
      await controller.titleEquip(makeReq(), {
        titleKey: 'realm_kim_dan_adept',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it('TitleError CHARACTER_NOT_FOUND → 404', async () => {
    const title = {
      equipTitle: async () => {
        throw new TitleError('CHARACTER_NOT_FOUND', 'gone');
      },
    } as unknown as TitleService;
    const { controller } = makeController({ title });
    let caught: HttpException | null = null;
    try {
      await controller.titleEquip(makeReq(), {
        titleKey: 'realm_kim_dan_adept',
      });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });
});

describe('CharacterController.titleUnequip — POST /character/title/unequip', () => {
  it('happy path → return character với title=null', async () => {
    const title = {
      unequipTitle: async (_id: string) => undefined,
    } as unknown as TitleService;
    const { controller } = makeController({
      title,
      fresh: { id: 'c1', title: null },
    });
    const res = (await controller.titleUnequip(makeReq())) as {
      ok: true;
      data: { character: { title: string | null } };
    };
    expect(res.ok).toBe(true);
    expect(res.data.character.title).toBeNull();
  });

  it('idempotent: unequip nhiều lần → vẫn ok', async () => {
    const title = {
      unequipTitle: async () => undefined,
    } as unknown as TitleService;
    const { controller } = makeController({
      title,
      fresh: { id: 'c1', title: null },
    });
    await controller.titleUnequip(makeReq());
    const res = (await controller.titleUnequip(makeReq())) as {
      ok: true;
      data: { character: { title: string | null } };
    };
    expect(res.ok).toBe(true);
  });

  it('chưa login → 401', async () => {
    const { controller } = makeController({ title: {} as TitleService });
    let caught: HttpException | null = null;
    try {
      await controller.titleUnequip(makeNoCookieReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });
});

describe('CharacterController.buffsState — GET /character/buffs', () => {
  it('happy path → return active list với ISO expiresAt + def', async () => {
    const expiresAt = new Date('2026-05-06T22:00:00.000Z');
    const buff = {
      listActive: async (_id: string) => [
        {
          buffKey: 'pill_atk_buff_t1',
          stacks: 1,
          source: 'pill' as const,
          expiresAt,
        },
      ],
    } as unknown as BuffService;
    const { controller } = makeController({ buff });
    const res = (await controller.buffsState(makeReq())) as {
      ok: true;
      data: {
        active: Array<{
          buffKey: string;
          expiresAt: string;
          def: BuffDef;
        }>;
      };
    };
    expect(res.ok).toBe(true);
    expect(res.data.active).toHaveLength(1);
    expect(res.data.active[0].buffKey).toBe('pill_atk_buff_t1');
    expect(res.data.active[0].expiresAt).toBe(expiresAt.toISOString());
    expect(res.data.active[0].def.key).toBe('pill_atk_buff_t1');
  });

  it('skip rows có buffKey không trong catalog (defensive, key rename)', async () => {
    const expiresAt = new Date('2026-05-06T22:00:00.000Z');
    const buff = {
      listActive: async () => [
        {
          buffKey: 'pill_atk_buff_t1',
          stacks: 1,
          source: 'pill' as const,
          expiresAt,
        },
        {
          buffKey: 'totally_renamed_buff_key',
          stacks: 1,
          source: 'pill' as const,
          expiresAt,
        },
      ],
    } as unknown as BuffService;
    const { controller } = makeController({ buff });
    const res = (await controller.buffsState(makeReq())) as {
      ok: true;
      data: { active: Array<{ buffKey: string }> };
    };
    expect(res.data.active).toHaveLength(1);
    expect(res.data.active[0].buffKey).toBe('pill_atk_buff_t1');
  });

  it('empty active list → trả { active: [] }', async () => {
    const buff = {
      listActive: async () => [],
    } as unknown as BuffService;
    const { controller } = makeController({ buff });
    const res = (await controller.buffsState(makeReq())) as {
      ok: true;
      data: { active: unknown[] };
    };
    expect(res.data.active).toEqual([]);
  });

  it('BuffService chưa wire → 501 BUFF_UNAVAILABLE', async () => {
    const { controller } = makeController({ buff: null });
    let caught: HttpException | null = null;
    try {
      await controller.buffsState(makeReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
  });

  it('chưa login → 401', async () => {
    const { controller } = makeController({ buff: {} as BuffService });
    let caught: HttpException | null = null;
    try {
      await controller.buffsState(makeNoCookieReq());
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });
});
