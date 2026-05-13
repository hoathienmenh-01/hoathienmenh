import { describe, expect, it } from 'vitest';
import { MONSTERS } from './combat';
import { MAP_REGIONS } from './map-regions';
import { REALMS } from './realms';
import {
  DUNGEON_CATEGORIES,
  DUNGEONS_V2,
  canEnterDungeonV2,
  getDungeonV2ByKey,
  getDungeonsV2ByCategory,
  getDungeonsV2ByRegion,
} from './world-dungeons-v2';

describe('world-dungeons-v2 — catalog integrity', () => {
  it('mỗi dungeon có key unique', () => {
    const keys = DUNGEONS_V2.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('regionKey thuộc MAP_REGIONS', () => {
    const known = new Set(MAP_REGIONS.map((r) => r.key));
    for (const d of DUNGEONS_V2) {
      expect(known.has(d.regionKey)).toBe(true);
    }
  });

  it('category thuộc DUNGEON_CATEGORIES', () => {
    const allowed = new Set(DUNGEON_CATEGORIES);
    for (const d of DUNGEONS_V2) {
      expect(allowed.has(d.category)).toBe(true);
    }
  });

  it('sourceTier ∈ [1..9] và dungeonTier ∈ [1..5]', () => {
    for (const d of DUNGEONS_V2) {
      expect(d.sourceTier).toBeGreaterThanOrEqual(1);
      expect(d.sourceTier).toBeLessThanOrEqual(9);
      expect(d.dungeonTier).toBeGreaterThanOrEqual(1);
      expect(d.dungeonTier).toBeLessThanOrEqual(5);
    }
  });

  it('unlockRealmOrder ∈ [0..27]', () => {
    for (const d of DUNGEONS_V2) {
      expect(d.unlockRealmOrder).toBeGreaterThanOrEqual(0);
      expect(d.unlockRealmOrder).toBeLessThan(REALMS.length);
    }
  });

  it('dailyAttempts ≥ 1, weeklyAttempts (nếu có) ≥ dailyAttempts', () => {
    for (const d of DUNGEONS_V2) {
      expect(d.dailyAttempts).toBeGreaterThanOrEqual(1);
      if (d.weeklyAttempts != null) {
        expect(d.weeklyAttempts).toBeGreaterThanOrEqual(d.dailyAttempts);
      }
    }
  });

  it('firstClearReward (nếu có) >= repeatRewardProfile theo linhThach (anti repeat-farm-first-clear)', () => {
    for (const d of DUNGEONS_V2) {
      if (d.firstClearReward?.linhThach != null && d.repeatRewardProfile.linhThach != null) {
        expect(d.firstClearReward.linhThach).toBeGreaterThanOrEqual(d.repeatRewardProfile.linhThach);
      }
    }
  });

  it('monsterPool tham chiếu MONSTERS hợp lệ', () => {
    const monsterKeys = new Set(MONSTERS.map((m) => m.key));
    for (const d of DUNGEONS_V2) {
      for (const mk of d.monsterPool) {
        expect(monsterKeys.has(mk), `${d.key} unknown monster ${mk}`).toBe(true);
      }
    }
  });

  it('Bao phủ đủ category chính: ALCHEMY_MATERIAL / BODY_MATERIAL / METHOD_FRAGMENT / ARTIFACT_MATERIAL / EQUIPMENT_MATERIAL / SIDE_QUEST / TRIBULATION', () => {
    const present = new Set(DUNGEONS_V2.filter((d) => d.enabled || d.category === 'TRIBULATION').map((d) => d.category));
    for (const cat of [
      'ALCHEMY_MATERIAL',
      'BODY_MATERIAL',
      'METHOD_FRAGMENT',
      'ARTIFACT_MATERIAL',
      'EQUIPMENT_MATERIAL',
      'SIDE_QUEST',
      'TRIBULATION',
    ] as const) {
      expect(present.has(cat), `category ${cat} missing seed`).toBe(true);
    }
  });
});

describe('world-dungeons-v2 — canEnterDungeonV2 gating', () => {
  const dungeon = getDungeonV2ByKey('son_coc_duoc_vien')!;

  it('Realm chưa đủ → REALM_TOO_LOW', () => {
    expect(canEnterDungeonV2(dungeon, { playerRealmOrder: 0 })).toEqual({
      allowed: false,
      reason: 'REALM_TOO_LOW',
    });
  });

  it('Realm đủ → allowed', () => {
    expect(canEnterDungeonV2(dungeon, { playerRealmOrder: 1 })).toEqual({ allowed: true });
  });

  it('Disabled → reason DISABLED', () => {
    const disabled = DUNGEONS_V2.find((d) => !d.enabled);
    expect(disabled).toBeDefined();
    expect(canEnterDungeonV2(disabled!, { playerRealmOrder: 27 })).toEqual({
      allowed: false,
      reason: 'DISABLED',
    });
  });
});

describe('world-dungeons-v2 — region / category indexing', () => {
  it('getDungeonsV2ByRegion trả đúng tập', () => {
    const sonCoc = getDungeonsV2ByRegion('son_coc');
    for (const d of sonCoc) expect(d.regionKey).toBe('son_coc');
  });

  it('getDungeonsV2ByCategory trả đúng tập', () => {
    const alchemy = getDungeonsV2ByCategory('ALCHEMY_MATERIAL');
    for (const d of alchemy) expect(d.category).toBe('ALCHEMY_MATERIAL');
  });
});
