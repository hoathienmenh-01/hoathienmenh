import { describe, expect, it } from 'vitest';
import { MONSTERS } from './combat';
import {
  canEnterFarmMap,
  FARM_MAPS,
  getFarmMapByKey,
  getFarmMapsByRegion,
  getFarmSessionLimit,
} from './farm-maps';
import { REALMS } from './realms';
import { MAP_REGIONS } from './map-regions';

describe('farm-maps — catalog integrity', () => {
  it('mỗi map có key unique', () => {
    const keys = FARM_MAPS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('regionKey thuộc MAP_REGIONS', () => {
    const known = new Set(MAP_REGIONS.map((r) => r.key));
    for (const m of FARM_MAPS) {
      expect(known.has(m.regionKey), `${m.key} unknown region ${m.regionKey}`).toBe(true);
    }
  });

  it('sourceTier ∈ [1..9]', () => {
    for (const m of FARM_MAPS) {
      expect(m.sourceTier).toBeGreaterThanOrEqual(1);
      expect(m.sourceTier).toBeLessThanOrEqual(9);
    }
  });

  it('unlockRealmOrder ∈ [0..27] và recommendedRealmOrder ≥ unlock', () => {
    for (const m of FARM_MAPS) {
      expect(m.unlockRealmOrder).toBeGreaterThanOrEqual(0);
      expect(m.unlockRealmOrder).toBeLessThan(REALMS.length);
      expect(m.recommendedRealmOrder).toBeGreaterThanOrEqual(m.unlockRealmOrder);
    }
  });

  it('session minutes: free ≤ monthlyCard ≤ premium ≤ max', () => {
    for (const m of FARM_MAPS) {
      expect(m.freeSessionMinutes).toBeGreaterThan(0);
      expect(m.freeSessionMinutes).toBeLessThanOrEqual(m.monthlyCardSessionMinutes);
      expect(m.monthlyCardSessionMinutes).toBeLessThanOrEqual(m.premiumSessionMinutes);
      expect(m.premiumSessionMinutes).toBeLessThanOrEqual(m.maxSessionMinutes);
    }
  });

  it('Khu seed sâu son_coc / hac_lam / kim_son_mach mỗi khu có ≥ 3 farm map enabled', () => {
    for (const region of ['son_coc', 'hac_lam', 'kim_son_mach'] as const) {
      const maps = FARM_MAPS.filter((m) => m.regionKey === region && m.enabled);
      expect(maps.length, `region ${region} cần ≥ 3 farm map enabled`).toBeGreaterThanOrEqual(3);
    }
  });

  it('monsterPool tham chiếu MONSTERS key tồn tại', () => {
    const monsterKeys = new Set(MONSTERS.map((m) => m.key));
    for (const map of FARM_MAPS) {
      const all = [
        ...map.monsterPool,
        ...map.eliteEncounterPool,
        ...map.miniBossEncounterPool,
        ...map.higherTierMonsterPool,
      ];
      for (const e of all) {
        expect(
          monsterKeys.has(e.monsterKey),
          `farm map ${map.key} references unknown monster ${e.monsterKey}`,
        ).toBe(true);
      }
    }
  });

  it('NORMAL monsterPool đều có canAutoBattle=true & dangerLevel SAFE/CAUTION; elite/mini-boss/higher đều manualOnly', () => {
    for (const map of FARM_MAPS) {
      for (const e of map.monsterPool) {
        expect(
          e.canAutoBattle,
          `${map.key} normal pool ${e.monsterKey} must allow auto-battle`,
        ).toBe(true);
      }
      for (const e of map.eliteEncounterPool) {
        expect(
          e.canAutoBattle,
          `${map.key} elite pool ${e.monsterKey} must be manual-only (no auto)`,
        ).toBe(false);
        expect(e.manualOnly).toBe(true);
      }
      for (const e of map.miniBossEncounterPool) {
        expect(e.canAutoBattle).toBe(false);
        expect(e.manualOnly).toBe(true);
      }
      for (const e of map.higherTierMonsterPool) {
        expect(e.canAutoBattle).toBe(false);
        expect(e.manualOnly).toBe(true);
      }
    }
  });
});

describe('farm-maps — getFarmSessionLimit (anti-P2W)', () => {
  const map = FARM_MAPS[0];

  it('Free → freeSessionMinutes', () => {
    expect(getFarmSessionLimit(map, {})).toBe(map.freeSessionMinutes);
  });

  it('Monthly card → ≥ free', () => {
    expect(getFarmSessionLimit(map, { hasActiveMonthlyCard: true })).toBeGreaterThanOrEqual(
      map.freeSessionMinutes,
    );
    expect(getFarmSessionLimit(map, { hasActiveMonthlyCard: true })).toBe(map.monthlyCardSessionMinutes);
  });

  it('VIP → ≥ monthly card', () => {
    const limitVip = getFarmSessionLimit(map, { hasActiveVip: true });
    expect(limitVip).toBeGreaterThanOrEqual(map.monthlyCardSessionMinutes);
    expect(limitVip).toBe(map.premiumSessionMinutes);
  });

  it('VIP + monthly card không vượt maxSessionMinutes (cap floor)', () => {
    const limit = getFarmSessionLimit(map, {
      hasActiveMonthlyCard: true,
      hasActiveVip: true,
    });
    expect(limit).toBeLessThanOrEqual(map.maxSessionMinutes);
  });
});

describe('farm-maps — canEnterFarmMap gating', () => {
  const map = getFarmMapByKey('son_coc_thao_nguyen')!;

  it('Đủ realm + map enabled → allowed', () => {
    expect(canEnterFarmMap(map, { playerRealmOrder: map.unlockRealmOrder })).toEqual({
      allowed: true,
    });
  });

  it('Realm chưa đủ → REALM_TOO_LOW', () => {
    expect(canEnterFarmMap(map, { playerRealmOrder: 0 })).toEqual({
      allowed: false,
      reason: 'REALM_TOO_LOW',
    });
  });

  it('Map disabled → DISABLED', () => {
    const disabled = FARM_MAPS.find((m) => !m.enabled);
    expect(disabled, 'expect at least one disabled placeholder map').toBeDefined();
    expect(
      canEnterFarmMap(disabled!, { playerRealmOrder: 27 }),
    ).toEqual({ allowed: false, reason: 'DISABLED' });
  });
});

describe('farm-maps — region indexing helpers', () => {
  it('getFarmMapsByRegion trả đúng tập', () => {
    const son_coc = getFarmMapsByRegion('son_coc');
    expect(son_coc.length).toBeGreaterThanOrEqual(3);
    for (const m of son_coc) expect(m.regionKey).toBe('son_coc');
  });

  it('getFarmMapByKey trả undefined khi không có', () => {
    expect(getFarmMapByKey('does_not_exist')).toBeUndefined();
  });
});
