import { describe, expect, it } from 'vitest';
import {
  canAutoBattle,
  compareDangerLevel,
  computeEffectiveDangerLevel,
  DANGEROUS_TIER_GAP,
  EXTREME_TIER_GAP,
  FAMILY_DROP_HINT,
  getFamilyDropHint,
  mapV1MonsterTypeToV2,
  MONSTER_DANGER_LEVELS,
  MONSTER_FAMILIES,
  MONSTER_TYPES_V2,
  type MonsterDangerLevel,
  type MonsterFamily,
} from './monster-taxonomy';

describe('monster-taxonomy — type / danger / family enums', () => {
  it('MONSTER_TYPES_V2 chứa 12 type unique', () => {
    expect(MONSTER_TYPES_V2.length).toBe(12);
    expect(new Set(MONSTER_TYPES_V2).size).toBe(12);
  });

  it('MONSTER_DANGER_LEVELS có 4 mức theo thứ tự SAFE → EXTREME', () => {
    expect(MONSTER_DANGER_LEVELS).toEqual(['SAFE', 'CAUTION', 'DANGEROUS', 'EXTREME']);
  });

  it('MONSTER_FAMILIES có 12 family unique và có FAMILY_DROP_HINT cho từng family', () => {
    expect(MONSTER_FAMILIES.length).toBe(12);
    expect(new Set(MONSTER_FAMILIES).size).toBe(12);
    for (const family of MONSTER_FAMILIES) {
      const hint = getFamilyDropHint(family);
      expect(hint, `missing hint for ${family}`).toBeDefined();
      expect(hint!.family).toBe(family);
      expect(hint!.primaryCategories.length).toBeGreaterThan(0);
      expect(hint!.flavorVi.length).toBeGreaterThan(5);
      expect(hint!.flavorEn.length).toBeGreaterThan(5);
    }
  });

  it('compareDangerLevel monotonic increasing', () => {
    const levels = MONSTER_DANGER_LEVELS;
    for (let i = 0; i < levels.length - 1; i++) {
      expect(compareDangerLevel(levels[i], levels[i + 1])).toBeLessThan(0);
    }
  });
});

describe('monster-taxonomy — V1 ↔ V2 mapping', () => {
  it('BOSS V1 → REGION_BOSS V2 (default)', () => {
    expect(mapV1MonsterTypeToV2('BOSS')).toBe('REGION_BOSS');
  });

  it('ELITE V1 → ELITE V2', () => {
    expect(mapV1MonsterTypeToV2('ELITE')).toBe('ELITE');
  });

  it('BEAST / HUMANOID / SPIRIT / undefined → NORMAL', () => {
    expect(mapV1MonsterTypeToV2('BEAST')).toBe('NORMAL');
    expect(mapV1MonsterTypeToV2('HUMANOID')).toBe('NORMAL');
    expect(mapV1MonsterTypeToV2('SPIRIT')).toBe('NORMAL');
    expect(mapV1MonsterTypeToV2(undefined)).toBe('NORMAL');
  });
});

describe('monster-taxonomy — canAutoBattle (anti-P2W auto-farm rule)', () => {
  it('NORMAL cùng tier + SAFE → cho auto', () => {
    expect(
      canAutoBattle({
        monsterType: 'NORMAL',
        monsterRealmTier: 3,
        playerRealmTier: 3,
        dangerLevel: 'SAFE',
      }),
    ).toBe(true);
  });

  it('NORMAL thấp hơn player → cho auto (farm map cũ)', () => {
    expect(
      canAutoBattle({
        monsterType: 'NORMAL',
        monsterRealmTier: 2,
        playerRealmTier: 5,
      }),
    ).toBe(true);
  });

  it('NORMAL cao hơn player tier → KHÔNG auto', () => {
    expect(
      canAutoBattle({
        monsterType: 'NORMAL',
        monsterRealmTier: 4,
        playerRealmTier: 3,
      }),
    ).toBe(false);
  });

  it('ELITE / MINI_BOSS / REGION_BOSS / WORLD_BOSS / EVENT_BOSS / QUEST_BOSS / HIDDEN_BOSS / TOWER_GUARDIAN — không bao giờ auto', () => {
    const noAuto = [
      'ELITE',
      'MINI_BOSS',
      'REGION_BOSS',
      'DUNGEON_BOSS',
      'WORLD_BOSS',
      'EVENT_BOSS',
      'QUEST_BOSS',
      'SIDE_QUEST_BOSS',
      'SECT_BOSS',
      'HIDDEN_BOSS',
      'TOWER_GUARDIAN',
    ] as const;
    for (const t of noAuto) {
      expect(
        canAutoBattle({
          monsterType: t,
          monsterRealmTier: 1,
          playerRealmTier: 9,
          dangerLevel: 'SAFE',
        }),
        `${t} must never auto`,
      ).toBe(false);
    }
  });

  it('dangerLevel > SAFE → KHÔNG auto dù NORMAL cùng tier', () => {
    const bumps: MonsterDangerLevel[] = ['CAUTION', 'DANGEROUS', 'EXTREME'];
    for (const d of bumps) {
      expect(
        canAutoBattle({
          monsterType: 'NORMAL',
          monsterRealmTier: 3,
          playerRealmTier: 3,
          dangerLevel: d,
        }),
      ).toBe(false);
    }
  });
});

describe('monster-taxonomy — computeEffectiveDangerLevel (encounter risk preview)', () => {
  it('NORMAL gap=0 → giữ base SAFE', () => {
    expect(
      computeEffectiveDangerLevel({
        monsterType: 'NORMAL',
        monsterRealmTier: 3,
        playerRealmTier: 3,
      }),
    ).toBe('SAFE');
  });

  it(`NORMAL gap=${DANGEROUS_TIER_GAP} → DANGEROUS`, () => {
    expect(
      computeEffectiveDangerLevel({
        monsterType: 'NORMAL',
        monsterRealmTier: 5,
        playerRealmTier: 3,
      }),
    ).toBe('DANGEROUS');
  });

  it(`gap >= ${EXTREME_TIER_GAP} → EXTREME bất kể type`, () => {
    for (const t of MONSTER_TYPES_V2) {
      expect(
        computeEffectiveDangerLevel({
          monsterType: t,
          monsterRealmTier: 10,
          playerRealmTier: 1,
        }),
        `${t} gap=9 should be EXTREME`,
      ).toBe('EXTREME');
    }
  });

  it('ELITE / MINI_BOSS / REGION_BOSS base → CAUTION khi cùng tier', () => {
    for (const t of [
      'ELITE',
      'MINI_BOSS',
      'REGION_BOSS',
      'DUNGEON_BOSS',
      'QUEST_BOSS',
      'SIDE_QUEST_BOSS',
      'SECT_BOSS',
    ] as const) {
      expect(
        computeEffectiveDangerLevel({
          monsterType: t,
          monsterRealmTier: 3,
          playerRealmTier: 3,
        }),
      ).toBe('CAUTION');
    }
  });

  it('WORLD_BOSS / EVENT_BOSS / HIDDEN_BOSS / TOWER_GUARDIAN base → DANGEROUS khi cùng tier', () => {
    for (const t of ['WORLD_BOSS', 'EVENT_BOSS', 'HIDDEN_BOSS', 'TOWER_GUARDIAN'] as const) {
      expect(
        computeEffectiveDangerLevel({
          monsterType: t,
          monsterRealmTier: 3,
          playerRealmTier: 3,
        }),
      ).toBe('DANGEROUS');
    }
  });
});

describe('monster-taxonomy — FAMILY_DROP_HINT integrity', () => {
  it('Mỗi family có ít nhất 1 primary category', () => {
    for (const hint of FAMILY_DROP_HINT) {
      expect(hint.primaryCategories.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Primary và secondary KHÔNG overlap', () => {
    for (const hint of FAMILY_DROP_HINT) {
      const primary = new Set(hint.primaryCategories);
      for (const sec of hint.secondaryCategories) {
        expect(primary.has(sec), `${hint.family} primary/secondary overlap on ${sec}`).toBe(false);
      }
    }
  });

  it('THIEN_KIEP family chứa TRIBULATION ở primary (invariant balance)', () => {
    const hint = getFamilyDropHint('THIEN_KIEP' as MonsterFamily);
    expect(hint).toBeDefined();
    expect(hint!.primaryCategories).toContain('TRIBULATION');
  });

  it('KHOI_LOI family chứa ARTIFACT_CRAFT hoặc EQUIPMENT_CRAFT ở primary', () => {
    const hint = getFamilyDropHint('KHOI_LOI' as MonsterFamily);
    expect(hint).toBeDefined();
    const has =
      hint!.primaryCategories.includes('ARTIFACT_CRAFT') ||
      hint!.primaryCategories.includes('EQUIPMENT_CRAFT');
    expect(has).toBe(true);
  });
});
