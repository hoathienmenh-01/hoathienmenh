import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { CharacterStatePayload, TitleDef } from '@xuantoi/shared';

vi.mock('@/api/titles', () => ({
  getTitlesState: vi.fn(),
  equipTitle: vi.fn(),
  unequipTitle: vi.fn(),
}));

import * as api from '@/api/titles';
import { useTitlesStore } from '@/stores/titles';
import { useGameStore } from '@/stores/game';

const mockedGet = vi.mocked(api.getTitlesState);
const mockedEquip = vi.mocked(api.equipTitle);
const mockedUnequip = vi.mocked(api.unequipTitle);

const DEF_A: TitleDef = {
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

const DEF_B: TitleDef = {
  ...DEF_A,
  key: 'element_kim_blade_master',
  nameVi: 'Kim Đao Tông Chủ',
  nameEn: 'Metal Blade Master',
  source: 'element_mastery',
  element: 'kim',
  unlockRealmKey: null,
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
  title: null,
};

describe('useTitlesStore — Phase 11.9.C', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: empty + not loaded', () => {
    const s = useTitlesStore();
    expect(s.owned).toEqual([]);
    expect(s.catalog).toEqual([]);
    expect(s.equipped).toBeNull();
    expect(s.loaded).toBe(false);
    expect(s.inFlight).toBe(false);
    expect(s.ownedCount).toBe(0);
    expect(s.totalCount).toBe(0);
  });

  it('fetchState: hydrate owned/catalog/equipped + loaded=true', async () => {
    mockedGet.mockResolvedValueOnce({
      owned: [
        {
          titleKey: 'realm_kim_dan_adept',
          source: 'realm_milestone',
          unlockedAt: '2026-01-01T00:00:00.000Z',
          def: DEF_A,
        },
      ],
      catalog: [DEF_A, DEF_B],
      equipped: { titleKey: 'realm_kim_dan_adept', def: DEF_A },
    });
    const s = useTitlesStore();
    await s.fetchState();
    expect(s.loaded).toBe(true);
    expect(s.ownedCount).toBe(1);
    expect(s.totalCount).toBe(2);
    expect(s.equipped?.titleKey).toBe('realm_kim_dan_adept');
    expect(s.unlockedRatio).toBe(0.5);
  });

  it('isOwned / isEquipped helpers', async () => {
    mockedGet.mockResolvedValueOnce({
      owned: [
        {
          titleKey: 'realm_kim_dan_adept',
          source: 'realm_milestone',
          unlockedAt: '2026-01-01T00:00:00.000Z',
          def: DEF_A,
        },
      ],
      catalog: [DEF_A, DEF_B],
      equipped: { titleKey: 'realm_kim_dan_adept', def: DEF_A },
    });
    const s = useTitlesStore();
    await s.fetchState();
    expect(s.isOwned('realm_kim_dan_adept')).toBe(true);
    expect(s.isOwned('element_kim_blade_master')).toBe(false);
    expect(s.isEquipped('realm_kim_dan_adept')).toBe(true);
    expect(s.isEquipped('element_kim_blade_master')).toBe(false);
  });

  it('equip success: patches equipped + game.character', async () => {
    const s = useTitlesStore();
    s.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_A,
      },
    ];
    s.catalog = [DEF_A];
    s.loaded = true;

    const game = useGameStore();
    game.character = { ...STUB_CHAR };

    mockedEquip.mockResolvedValueOnce({
      character: { ...STUB_CHAR, title: 'realm_kim_dan_adept' },
      equipped: { titleKey: 'realm_kim_dan_adept', def: DEF_A },
    });

    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBeNull();
    expect(s.equipped?.titleKey).toBe('realm_kim_dan_adept');
    expect(game.character?.title).toBe('realm_kim_dan_adept');
  });

  it('equip pre-check TITLE_NOT_OWNED: skip API call', async () => {
    const s = useTitlesStore();
    s.owned = [];
    s.catalog = [DEF_A];
    s.loaded = true;

    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBe('TITLE_NOT_OWNED');
    expect(mockedEquip).not.toHaveBeenCalled();
  });

  it('equip pre-check ALREADY_EQUIPPED: skip API call', async () => {
    const s = useTitlesStore();
    s.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_A,
      },
    ];
    s.catalog = [DEF_A];
    s.equipped = { titleKey: 'realm_kim_dan_adept', def: DEF_A };
    s.loaded = true;

    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBe('ALREADY_EQUIPPED');
    expect(mockedEquip).not.toHaveBeenCalled();
  });

  it('equip server error code: trả code, không update state', async () => {
    const s = useTitlesStore();
    s.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_A,
      },
    ];
    s.catalog = [DEF_A];
    s.equipped = null;
    s.loaded = true;

    mockedEquip.mockRejectedValueOnce({ code: 'TITLE_NOT_FOUND' });
    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBe('TITLE_NOT_FOUND');
    expect(s.equipped).toBeNull();
  });

  it('equip nested error.code: extract đúng (axios envelope)', async () => {
    const s = useTitlesStore();
    s.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_A,
      },
    ];
    s.catalog = [DEF_A];
    s.loaded = true;

    mockedEquip.mockRejectedValueOnce({
      error: { code: 'TITLE_NOT_OWNED', message: 'x' },
    });
    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBe('TITLE_NOT_OWNED');
  });

  it('equip unknown error: trả "UNKNOWN"', async () => {
    const s = useTitlesStore();
    s.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_A,
      },
    ];
    s.catalog = [DEF_A];
    s.loaded = true;

    mockedEquip.mockRejectedValueOnce(new Error('boom'));
    const err = await s.equip('realm_kim_dan_adept');
    expect(err).toBe('UNKNOWN');
  });

  it('unequip success: clear equipped + sync game.character', async () => {
    const s = useTitlesStore();
    s.equipped = { titleKey: 'realm_kim_dan_adept', def: DEF_A };
    s.loaded = true;

    const game = useGameStore();
    game.character = { ...STUB_CHAR, title: 'realm_kim_dan_adept' };

    mockedUnequip.mockResolvedValueOnce({
      character: { ...STUB_CHAR, title: null },
    });

    const err = await s.unequip();
    expect(err).toBeNull();
    expect(s.equipped).toBeNull();
    expect(game.character?.title).toBeNull();
  });

  it('unequip pre-check NOT_EQUIPPED: skip API call', async () => {
    const s = useTitlesStore();
    s.equipped = null;

    const err = await s.unequip();
    expect(err).toBe('NOT_EQUIPPED');
    expect(mockedUnequip).not.toHaveBeenCalled();
  });

  it('reset: clear toàn bộ', async () => {
    mockedGet.mockResolvedValueOnce({
      owned: [
        {
          titleKey: 'realm_kim_dan_adept',
          source: 'realm_milestone',
          unlockedAt: '2026-01-01T00:00:00.000Z',
          def: DEF_A,
        },
      ],
      catalog: [DEF_A],
      equipped: { titleKey: 'realm_kim_dan_adept', def: DEF_A },
    });
    const s = useTitlesStore();
    await s.fetchState();
    s.reset();
    expect(s.owned).toEqual([]);
    expect(s.catalog).toEqual([]);
    expect(s.equipped).toBeNull();
    expect(s.loaded).toBe(false);
  });
});
