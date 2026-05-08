import { describe, it, expect } from 'vitest';
import { MAP_REGIONS, REGION_KEYS } from './map-regions';
import {
  TERRITORY_REGIONS,
  TERRITORY_INFLUENCE_SOURCES,
  territoryRegionByKey,
  territorySourceByKey,
  isTerritoryInfluenceSourceKey,
  validateTerritoryCatalog,
  territoryMaxPersonalPointsPerWeek,
  isTerritoryPeriodKey,
  territoryPeriodKeyForDate,
  previousTerritoryPeriodKey,
  TERRITORY_PERIOD_ISO_WEEK_RE,
  TERRITORY_PERIOD_MANUAL_RE,
} from './territory';

describe('Phase 14.0.A — territory catalog parity', () => {
  it('TERRITORY_REGIONS có entry parity 1-1 với MAP_REGIONS', () => {
    expect(TERRITORY_REGIONS).toHaveLength(MAP_REGIONS.length);
    const territoryKeys = TERRITORY_REGIONS.map((r) => r.key).sort();
    const mapKeys = [...REGION_KEYS].sort();
    expect(territoryKeys).toEqual(mapKeys);
  });

  it('mọi entry có labelI18nKey + descriptionI18nKey theo pattern', () => {
    for (const r of TERRITORY_REGIONS) {
      expect(r.labelI18nKey).toBe(`territory.region.${r.key}.label`);
      expect(r.descriptionI18nKey).toBe(`territory.region.${r.key}.desc`);
    }
  });

  it('influenceCap = +Infinity ở Phase 14.0.A (no enforcement)', () => {
    for (const r of TERRITORY_REGIONS) {
      expect(r.influenceCap).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('Phase 14.0.A — territory source catalog', () => {
  it('có đủ 3 source: dungeon_clear, boss_participation, boss_top_damage', () => {
    const keys = TERRITORY_INFLUENCE_SOURCES.map((s) => s.key);
    expect(keys).toEqual([
      'dungeon_clear',
      'boss_participation',
      'boss_top_damage',
    ]);
  });

  it('mọi source có points > 0 và dailyCap/weeklyCap (nếu set) >= 0', () => {
    for (const s of TERRITORY_INFLUENCE_SOURCES) {
      expect(s.points).toBeGreaterThan(0);
      if (s.dailyCap !== undefined) {
        expect(s.dailyCap).toBeGreaterThanOrEqual(0);
      }
      if (s.weeklyCap !== undefined) {
        expect(s.weeklyCap).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('dailyCap không vượt weeklyCap khi cả hai set', () => {
    for (const s of TERRITORY_INFLUENCE_SOURCES) {
      if (s.dailyCap !== undefined && s.weeklyCap !== undefined) {
        expect(s.dailyCap).toBeLessThanOrEqual(s.weeklyCap);
      }
    }
  });

  it('source dungeon_clear có sourceType DungeonRun', () => {
    const def = territorySourceByKey('dungeon_clear');
    expect(def).toBeDefined();
    expect(def?.sourceType).toBe('DungeonRun');
  });

  it('source boss_participation + boss_top_damage có sourceType WorldBoss', () => {
    expect(territorySourceByKey('boss_participation')?.sourceType).toBe(
      'WorldBoss',
    );
    expect(territorySourceByKey('boss_top_damage')?.sourceType).toBe(
      'WorldBoss',
    );
  });
});

describe('Phase 14.0.A — territoryRegionByKey', () => {
  it('trả def + map cho region tồn tại', () => {
    const r = territoryRegionByKey('son_coc');
    expect(r).toBeDefined();
    expect(r?.def.key).toBe('son_coc');
    expect(r?.map.nameVi).toBe('Sơn Cốc');
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(territoryRegionByKey('not_a_region')).toBeUndefined();
    expect(territoryRegionByKey('')).toBeUndefined();
  });
});

describe('Phase 14.0.A — territorySourceByKey + type guard', () => {
  it('trả def cho source tồn tại', () => {
    const s = territorySourceByKey('dungeon_clear');
    expect(s).toBeDefined();
    expect(s?.points).toBeGreaterThan(0);
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(territorySourceByKey('not_a_source')).toBeUndefined();
  });

  it('type guard isTerritoryInfluenceSourceKey narrow đúng', () => {
    expect(isTerritoryInfluenceSourceKey('dungeon_clear')).toBe(true);
    expect(isTerritoryInfluenceSourceKey('boss_participation')).toBe(true);
    expect(isTerritoryInfluenceSourceKey('boss_top_damage')).toBe(true);
    expect(isTerritoryInfluenceSourceKey('quest_complete')).toBe(false);
    expect(isTerritoryInfluenceSourceKey('')).toBe(false);
  });
});

describe('Phase 14.0.A — validateTerritoryCatalog', () => {
  it('production catalog pass validation', () => {
    expect(validateTerritoryCatalog()).toEqual([]);
  });
});

describe('Phase 14.0.A — territoryMaxPersonalPointsPerWeek', () => {
  it('trả tổng weeklyCap finite (không Infinity với production catalog)', () => {
    const max = territoryMaxPersonalPointsPerWeek();
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThan(0);
  });

  it('matches expected envelope (≈ 596 pts/region/tuần) trong production catalog', () => {
    // dungeon_clear weeklyCap 420 + boss_participation weeklyCap 96 +
    // boss_top_damage weeklyCap 80 = 596.
    expect(territoryMaxPersonalPointsPerWeek()).toBe(596);
  });
});

describe('Phase 14.0.B — territory period key validators', () => {
  it('TERRITORY_PERIOD_ISO_WEEK_RE match ISO week YYYY-Www', () => {
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026-W23')).toBe(true);
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026-W01')).toBe(true);
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026-W53')).toBe(true);
    // Invalid format
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026-w23')).toBe(false);
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('26-W23')).toBe(false);
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026-W3')).toBe(false);
    expect(TERRITORY_PERIOD_ISO_WEEK_RE.test('2026W23')).toBe(false);
  });

  it('TERRITORY_PERIOD_MANUAL_RE match manual_xxx', () => {
    expect(TERRITORY_PERIOD_MANUAL_RE.test('manual_admin_001')).toBe(true);
    expect(TERRITORY_PERIOD_MANUAL_RE.test('manual_x')).toBe(true);
    expect(TERRITORY_PERIOD_MANUAL_RE.test('manual')).toBe(false);
    expect(TERRITORY_PERIOD_MANUAL_RE.test('Manual_x')).toBe(false);
  });

  it('isTerritoryPeriodKey accept ISO week + manual_*', () => {
    expect(isTerritoryPeriodKey('2026-W23')).toBe(true);
    expect(isTerritoryPeriodKey('manual_x')).toBe(true);
    expect(isTerritoryPeriodKey('2026-W23-extra')).toBe(false);
    expect(isTerritoryPeriodKey('')).toBe(false);
    expect(isTerritoryPeriodKey('weekly_x')).toBe(false);
  });

  it('territoryPeriodKeyForDate trả ISO week format', () => {
    // 2026-06-01 (Monday) → ISO week 23 of 2026.
    const k = territoryPeriodKeyForDate(new Date('2026-06-01T12:00:00Z'));
    expect(k).toBe('2026-W23');
    expect(isTerritoryPeriodKey(k)).toBe(true);
  });

  it('territoryPeriodKeyForDate handle ISO year boundary correctly', () => {
    // 2025-12-29 (Monday) → ISO week 1 of 2026 (theo ISO 8601 rule).
    const k = territoryPeriodKeyForDate(new Date('2025-12-29T12:00:00Z'));
    expect(k).toBe('2026-W01');
  });

  it('previousTerritoryPeriodKey trả ISO week của tuần trước', () => {
    const prev = previousTerritoryPeriodKey(
      new Date('2026-06-08T12:00:00Z'),
    );
    // 2026-06-08 = W24, vậy prev = W23.
    expect(prev).toBe('2026-W23');
  });

  it('previousTerritoryPeriodKey không có arg → ok (uses now())', () => {
    const prev = previousTerritoryPeriodKey();
    expect(isTerritoryPeriodKey(prev)).toBe(true);
  });
});
