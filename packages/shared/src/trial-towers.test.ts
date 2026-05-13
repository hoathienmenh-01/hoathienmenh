import { describe, expect, it } from 'vitest';
import {
  FLOOR_ENEMY_TYPES,
  TRIAL_TOWER_TYPES,
  TRIAL_TOWERS,
  computeFloorFirstClearReward,
  computeFloorPower,
  computeFloorRepeatReward,
  getTrialTowerByKey,
  getTrialTowersByType,
  resolveFloorEnemyType,
  resolveFloorPowerMultiplier,
} from './trial-towers';

describe('trial-towers — catalog integrity', () => {
  it('mỗi tower có key unique', () => {
    const keys = TRIAL_TOWERS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('towerType thuộc TRIAL_TOWER_TYPES', () => {
    const allowed = new Set(TRIAL_TOWER_TYPES);
    for (const t of TRIAL_TOWERS) {
      expect(allowed.has(t.towerType)).toBe(true);
    }
  });

  it('3 tower chính (DANG_TIEN / LINH_KHI / HUYET_THE) đều enabled', () => {
    for (const type of ['DANG_TIEN_THAP', 'LINH_KHI_THAP', 'HUYET_THE_THAP'] as const) {
      const towers = getTrialTowersByType(type);
      expect(towers.length, `${type} thiếu seed`).toBeGreaterThanOrEqual(1);
      expect(towers.every((t) => t.enabled), `${type} phải enabled`).toBe(true);
    }
  });

  it('floorFormula hợp lệ', () => {
    for (const t of TRIAL_TOWERS) {
      expect(t.floorFormula.basePower).toBeGreaterThan(0);
      expect(t.floorFormula.linearStep).toBeGreaterThan(0);
      expect(t.floorFormula.expBase).toBeGreaterThan(1);
      expect(t.floorFormula.expDivisor).toBeGreaterThan(0);
    }
  });

  it('statWeights tất cả ≥ 0', () => {
    for (const t of TRIAL_TOWERS) {
      for (const v of Object.values(t.statWeights)) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('LINH_KHI_THAP weights — qi=1.0, body=0.4 (test trong spec)', () => {
    const linhKhi = getTrialTowerByKey('linh_khi_thap')!;
    expect(linhKhi.statWeights.qi).toBe(1.0);
    expect(linhKhi.statWeights.body).toBeCloseTo(0.4);
  });

  it('HUYET_THE_THAP weights — body=1.0, qi=0.4 (test trong spec)', () => {
    const huyetThe = getTrialTowerByKey('huyet_the_thap')!;
    expect(huyetThe.statWeights.body).toBe(1.0);
    expect(huyetThe.statWeights.qi).toBeCloseTo(0.4);
  });

  it('milestoneRules sorted descending theo everyFloors (1000 → 500 → 100 → 50)', () => {
    for (const t of TRIAL_TOWERS) {
      const fs = t.milestoneRules.map((r) => r.everyFloors);
      const sorted = [...fs].sort((a, b) => b - a);
      expect(fs).toEqual(sorted);
    }
  });

  it('dailyAttempts ≥ 1', () => {
    for (const t of TRIAL_TOWERS) {
      expect(t.dailyAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it('infiniteScaling=true → maxGeneratedFloor = null', () => {
    for (const t of TRIAL_TOWERS) {
      if (t.infiniteScaling) {
        expect(t.maxGeneratedFloor).toBeNull();
      }
    }
  });
});

describe('trial-towers — resolveFloorEnemyType', () => {
  it.each([
    [1, 'NORMAL_GUARDIAN'],
    [9, 'NORMAL_GUARDIAN'],
    [10, 'ELITE_GUARDIAN'],
    [11, 'NORMAL_GUARDIAN'],
    [50, 'MILESTONE_BOSS'],
    [51, 'NORMAL_GUARDIAN'],
    [100, 'CHECKPOINT_BOSS'],
    [150, 'MILESTONE_BOSS'],
    [500, 'DAI_KIEP_NAN'],
    [1000, 'DAI_MOC_SERVER'],
    [2000, 'DAI_MOC_SERVER'],
    [2500, 'DAI_KIEP_NAN'],
  ] as const)('floor=%i → %s', (floor, expected) => {
    expect(resolveFloorEnemyType(floor)).toBe(expected);
  });

  it('floor ≤ 0 → NORMAL_GUARDIAN', () => {
    expect(resolveFloorEnemyType(0)).toBe('NORMAL_GUARDIAN');
    expect(resolveFloorEnemyType(-5)).toBe('NORMAL_GUARDIAN');
  });

  it('FloorEnemyType complete', () => {
    const used = new Set(FLOOR_ENEMY_TYPES);
    expect(used.size).toBe(FLOOR_ENEMY_TYPES.length);
  });
});

describe('trial-towers — resolveFloorPowerMultiplier', () => {
  it.each([
    [1, 1.0],
    [10, 1.25],
    [50, 1.75],
    [100, 2.5],
    [500, 4.0],
    [1000, 6.0],
  ] as const)('floor=%i → multiplier %f', (floor, mult) => {
    expect(resolveFloorPowerMultiplier(floor)).toBeCloseTo(mult);
  });

  it('Multiplier strict tăng dần theo milestone (1 < 10 < 50 < 100 < 500 < 1000)', () => {
    const mults = [1, 10, 50, 100, 500, 1000].map((f) => resolveFloorPowerMultiplier(f));
    for (let i = 1; i < mults.length; i++) {
      expect(mults[i], `floor mức ${i} không lớn hơn ${i - 1}`).toBeGreaterThan(mults[i - 1]);
    }
  });
});

describe('trial-towers — computeFloorPower', () => {
  const tower = getTrialTowerByKey('dang_tien_thap')!;

  it('Floor 1 ≥ basePower', () => {
    expect(computeFloorPower(tower, 1)).toBeGreaterThanOrEqual(tower.floorFormula.basePower);
  });

  it('Power strict tăng dần theo floor (1 < 10 < 50 < 100)', () => {
    const p1 = computeFloorPower(tower, 1);
    const p10 = computeFloorPower(tower, 10);
    const p50 = computeFloorPower(tower, 50);
    const p100 = computeFloorPower(tower, 100);
    expect(p10).toBeGreaterThan(p1);
    expect(p50).toBeGreaterThan(p10);
    expect(p100).toBeGreaterThan(p50);
  });

  it('Floor 100 mạnh hơn nhiều floor 99 (milestone multiplier x2.5)', () => {
    const p99 = computeFloorPower(tower, 99);
    const p100 = computeFloorPower(tower, 100);
    expect(p100 / p99).toBeGreaterThan(2.0);
  });

  it('Floor 1000 mạnh hơn floor 999 (multiplier x6.0)', () => {
    const p999 = computeFloorPower(tower, 999);
    const p1000 = computeFloorPower(tower, 1000);
    expect(p1000 / p999).toBeGreaterThan(4.5);
  });
});

describe('trial-towers — first-clear vs repeat reward', () => {
  const tower = getTrialTowerByKey('dang_tien_thap')!;

  it('Normal floor → normalFloorReward', () => {
    const r = computeFloorFirstClearReward(tower, 1);
    expect(r).toEqual(tower.normalFloorReward);
  });

  it('Elite floor (10) → eliteFloorReward', () => {
    const r = computeFloorFirstClearReward(tower, 10);
    expect(r).toEqual(tower.eliteFloorReward);
  });

  it('Milestone 100 → reward lớn hơn elite floor', () => {
    const elite = computeFloorFirstClearReward(tower, 10);
    const milestone = computeFloorFirstClearReward(tower, 100);
    expect(milestone.linhThach).toBeGreaterThan(elite.linhThach);
    expect(milestone.trialPoints).toBeGreaterThan(elite.trialPoints);
  });

  it('Milestone 1000 → reward lớn nhất', () => {
    const checkpoint = computeFloorFirstClearReward(tower, 100);
    const grand = computeFloorFirstClearReward(tower, 1000);
    expect(grand.linhThach).toBeGreaterThan(checkpoint.linhThach);
  });

  it('Repeat reward = 0 (anti-P2W)', () => {
    expect(computeFloorRepeatReward()).toEqual({ linhThach: 0, exp: 0, trialPoints: 0 });
  });
});
