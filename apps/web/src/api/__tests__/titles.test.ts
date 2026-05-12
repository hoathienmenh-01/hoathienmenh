import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CharacterStatePayload, TitleDef } from '@xuantoi/shared';

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (k: string) => k,
    },
  },
}));

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
  },
}));

import {
  getTitlesState,
  equipTitle,
  unequipTitle,
} from '@/api/titles';

const STUB_DEF: TitleDef = {
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

const STUB_CHAR: CharacterStatePayload = {
  id: 'char_1',
  name: 'Tester',
  realmKey: 'kim_dan',
  realmStage: 1,
  level: 1,
  exp: '0',
  expNext: '100',
  hp: 100,
  hpMax: 100,
  mp: 50,
  mpMax: 50,
  stamina: 100,
  staminaMax: 100,
  power: 10,
  spirit: 10,
  speed: 10,
  luck: 5,
  linhThach: '0',
  tienNgoc: 0,
  cultivating: false,
  sectId: null,
  sectKey: null,
  role: 'PLAYER',
  banned: false,
  tribulationCooldownAt: null,
  taoMaUntil: null,
  spiritualRootGrade: null,
  primaryElement: null,
  secondaryElements: [],
  rootPurity: 100,
  title: 'realm_kim_dan_adept',
  bodyRealmKey: 'pham_than',
  bodyRealmName: 'Phàm Thân',
  bodyStage: 1,
  bodyExp: '0',
  bodyExpNext: '120',
  bodyRate: 2.5,
  bodyCultivating: false,
  bodyInjuryUntil: null,
  physiqueKey: null,
  bodyStatBonus: {
    hpMax: 0,
    power: 0,
    def: 0,
    staminaMax: 0,
    bossDamageReduction: 0,
  },
};

describe('api/titles — Phase 11.9.C client', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('getTitlesState: GET /character/titles → owned + catalog + equipped', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          owned: [
            {
              titleKey: 'realm_kim_dan_adept',
              source: 'realm_milestone',
              unlockedAt: '2026-01-01T00:00:00.000Z',
              def: STUB_DEF,
            },
          ],
          catalog: [STUB_DEF],
          equipped: { titleKey: 'realm_kim_dan_adept', def: STUB_DEF },
        },
      },
    });
    const out = await getTitlesState();
    expect(getMock).toHaveBeenCalledWith('/character/titles');
    expect(out.owned).toHaveLength(1);
    expect(out.owned[0].titleKey).toBe('realm_kim_dan_adept');
    expect(out.catalog).toHaveLength(1);
    expect(out.equipped?.titleKey).toBe('realm_kim_dan_adept');
  });

  it('getTitlesState: server error envelope → throws preserving code', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'NO_CHARACTER', message: 'no char' } },
    });
    await expect(getTitlesState()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });

  it('getTitlesState: empty data → throws fallback error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(getTitlesState()).rejects.toBeInstanceOf(Error);
  });

  it('equipTitle: POST /character/title/equip body { titleKey }', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: {
          character: STUB_CHAR,
          equipped: { titleKey: 'realm_kim_dan_adept', def: STUB_DEF },
        },
      },
    });
    const out = await equipTitle('realm_kim_dan_adept');
    expect(postMock).toHaveBeenCalledWith('/character/title/equip', {
      titleKey: 'realm_kim_dan_adept',
    });
    expect(out.character.title).toBe('realm_kim_dan_adept');
    expect(out.equipped?.titleKey).toBe('realm_kim_dan_adept');
  });

  it('equipTitle: ok=false → throws preserving code (TITLE_NOT_OWNED)', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'TITLE_NOT_OWNED', message: 'x' } },
    });
    await expect(equipTitle('realm_kim_dan_adept')).rejects.toMatchObject({
      code: 'TITLE_NOT_OWNED',
    });
  });

  it('equipTitle: empty data → throws fallback error', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(equipTitle('x')).rejects.toBeInstanceOf(Error);
  });

  it('unequipTitle: POST /character/title/unequip body {} → returns character', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { character: { ...STUB_CHAR, title: null } },
      },
    });
    const out = await unequipTitle();
    expect(postMock).toHaveBeenCalledWith('/character/title/unequip', {});
    expect(out.character.title).toBeNull();
  });

  it('unequipTitle: ok=false → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'NO_CHARACTER', message: 'x' } },
    });
    await expect(unequipTitle()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });
});
