import { describe, it, expect } from 'vitest';
import { REGION_KEYS } from './map-regions';
import {
  TERRITORY_REGION_BUFFS,
  TERRITORY_BUFF_VALUE_MAX,
  TERRITORY_BUFFS_PER_REGION_MAX,
  TERRITORY_DECAY_DEFAULT_BPS,
  TERRITORY_DECAY_MAX_BPS,
  validateTerritoryBuffCatalog,
  territoryRegionBuffsForRegion,
  territoryRegionBuffForOwner,
  territoryRegionBuffByKey,
  activeTerritoryBuffsForSect,
  computeTerritoryDecay,
  isValidTerritoryDecayBps,
  toBuffPreview,
} from './territory-buffs';

describe('Phase 14.0.C — territory buff catalog integrity', () => {
  it('production catalog pass validateTerritoryBuffCatalog', () => {
    expect(validateTerritoryBuffCatalog()).toEqual([]);
  });

  it('mọi buff regionKey thuộc MAP_REGIONS', () => {
    for (const b of TERRITORY_REGION_BUFFS) {
      expect(REGION_KEYS).toContain(b.regionKey);
    }
  });

  it('buffKey unique toàn catalog', () => {
    const keys = TERRITORY_REGION_BUFFS.map((b) => b.buffKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi buff value > 0 và <= cap, cap <= TERRITORY_BUFF_VALUE_MAX', () => {
    for (const b of TERRITORY_REGION_BUFFS) {
      expect(b.value).toBeGreaterThan(0);
      expect(b.value).toBeLessThanOrEqual(b.cap);
      expect(b.cap).toBeLessThanOrEqual(TERRITORY_BUFF_VALUE_MAX);
    }
  });

  it('mọi buff appliesTo có ít nhất 1 context valid', () => {
    const valid = new Set([
      'DUNGEON_REWARD',
      'BOSS_REWARD',
      'COMBAT',
      'ELEMENTAL',
      'CULTIVATION',
    ]);
    for (const b of TERRITORY_REGION_BUFFS) {
      expect(b.appliesTo.length).toBeGreaterThan(0);
      for (const ctx of b.appliesTo) {
        expect(valid.has(ctx)).toBe(true);
      }
    }
  });

  it('số buff / region không vượt TERRITORY_BUFFS_PER_REGION_MAX', () => {
    const counts = new Map<string, number>();
    for (const b of TERRITORY_REGION_BUFFS) {
      counts.set(b.regionKey, (counts.get(b.regionKey) ?? 0) + 1);
    }
    for (const c of counts.values()) {
      expect(c).toBeLessThanOrEqual(TERRITORY_BUFFS_PER_REGION_MAX);
    }
  });

  it('ELEMENTAL_DAMAGE buff có element key, type khác không có', () => {
    for (const b of TERRITORY_REGION_BUFFS) {
      if (b.buffType === 'ELEMENTAL_DAMAGE') {
        expect(b.element).toBeTruthy();
      } else {
        expect(b.element).toBeUndefined();
      }
    }
  });

  it('có ít nhất 5 region buff như spec', () => {
    expect(TERRITORY_REGION_BUFFS.length).toBeGreaterThanOrEqual(5);
  });

  it('contains expected sample buffs from spec', () => {
    const keys = TERRITORY_REGION_BUFFS.map((b) => b.buffKey);
    expect(keys).toContain('territory_son_coc_exp');
    expect(keys).toContain('territory_hac_lam_drop');
    expect(keys).toContain('territory_moc_huyen_lam_dmg');
    expect(keys).toContain('territory_kim_son_mach_dmg');
    expect(keys).toContain('territory_hoang_tho_huyet_def');
  });
});

describe('Phase 14.0.C — territoryRegionBuffsForRegion', () => {
  it('trả buff list cho region có buff', () => {
    const out = territoryRegionBuffsForRegion('son_coc');
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) expect(b.regionKey).toBe('son_coc');
  });

  it('trả [] cho region không có buff (unlock_realm only)', () => {
    // yeu_thu_dong + thuy_long_uyen + hoa_diem_son + cuu_la_dien — chưa
    // có buff entry trong catalog Phase 14.0.C.
    expect(territoryRegionBuffsForRegion('yeu_thu_dong')).toEqual([]);
  });

  it('trả [] cho region key invalid', () => {
    expect(territoryRegionBuffsForRegion('not_a_region')).toEqual([]);
    expect(territoryRegionBuffsForRegion('')).toEqual([]);
    expect(territoryRegionBuffsForRegion('world')).toEqual([]);
  });
});

describe('Phase 14.0.C — territoryRegionBuffForOwner', () => {
  it('trả [] khi ownerSectId null (region chưa settle)', () => {
    expect(territoryRegionBuffForOwner('son_coc', null)).toEqual([]);
  });

  it('trả buff list khi region có owner (caller match sect)', () => {
    const out = territoryRegionBuffForOwner('son_coc', 'sect-1');
    expect(out.length).toBeGreaterThan(0);
  });

  it('trả [] cho region invalid', () => {
    expect(territoryRegionBuffForOwner('not_a_region', 'sect-1')).toEqual([]);
  });
});

describe('Phase 14.0.C — territoryRegionBuffByKey', () => {
  it('lookup hợp lệ', () => {
    const b = territoryRegionBuffByKey('son_coc', 'territory_son_coc_exp');
    expect(b).toBeDefined();
    expect(b?.buffType).toBe('EXP_BONUS');
  });

  it('mismatch region/buff trả undefined', () => {
    expect(
      territoryRegionBuffByKey('hac_lam', 'territory_son_coc_exp'),
    ).toBeUndefined();
    expect(territoryRegionBuffByKey('son_coc', 'no_buff')).toBeUndefined();
  });
});

describe('Phase 14.0.C — activeTerritoryBuffsForSect', () => {
  it('trả [] khi sectId null', () => {
    const map = new Map<string, { ownerSectId: string | null }>();
    map.set('son_coc', { ownerSectId: 'sect-A' });
    expect(activeTerritoryBuffsForSect(null, map)).toEqual([]);
  });

  it('trả buff cho mọi region sect đang sở hữu', () => {
    const map = new Map<string, { ownerSectId: string | null }>([
      ['son_coc', { ownerSectId: 'sect-A' }],
      ['hac_lam', { ownerSectId: 'sect-A' }],
      ['moc_huyen_lam', { ownerSectId: 'sect-B' }],
      ['kim_son_mach', { ownerSectId: null }],
    ]);
    const out = activeTerritoryBuffsForSect('sect-A', map);
    const keys = out.map((b) => b.buffKey).sort();
    expect(keys).toEqual(
      ['territory_hac_lam_drop', 'territory_son_coc_exp'].sort(),
    );
  });

  it('trả [] cho sect không sở hữu region nào', () => {
    const map = new Map<string, { ownerSectId: string | null }>([
      ['son_coc', { ownerSectId: 'sect-X' }],
    ]);
    expect(activeTerritoryBuffsForSect('sect-Y', map)).toEqual([]);
  });

  it('skip region với ownerSectId null', () => {
    const map = new Map<string, { ownerSectId: string | null }>([
      ['son_coc', { ownerSectId: null }],
    ]);
    expect(activeTerritoryBuffsForSect('sect-A', map)).toEqual([]);
  });
});

describe('Phase 14.0.C — toBuffPreview', () => {
  it('map element undefined → null', () => {
    const expBuff = TERRITORY_REGION_BUFFS.find(
      (b) => b.buffKey === 'territory_son_coc_exp',
    );
    expect(expBuff).toBeDefined();
    const p = toBuffPreview(expBuff!);
    expect(p.element).toBeNull();
  });

  it('giữ nguyên element cho ELEMENTAL_DAMAGE buff', () => {
    const moc = TERRITORY_REGION_BUFFS.find(
      (b) => b.buffKey === 'territory_moc_huyen_lam_dmg',
    );
    expect(moc).toBeDefined();
    const p = toBuffPreview(moc!);
    expect(p.element).toBe('moc');
  });
});

describe('Phase 14.0.C — computeTerritoryDecay deterministic', () => {
  it('25% (2500 bps) reduce 100 → 75 → 56 → 42 (floor)', () => {
    const r1 = computeTerritoryDecay(100, 2500);
    expect(r1).toEqual({ decayBps: 2500, pointsAfter: 75, delta: 25 });
    const r2 = computeTerritoryDecay(r1.pointsAfter, 2500);
    expect(r2.pointsAfter).toBe(56);
    const r3 = computeTerritoryDecay(r2.pointsAfter, 2500);
    expect(r3.pointsAfter).toBe(42);
  });

  it('0 / negative points trả 0', () => {
    expect(computeTerritoryDecay(0, 2500)).toMatchObject({
      pointsAfter: 0,
      delta: 0,
    });
    expect(computeTerritoryDecay(-10, 2500)).toMatchObject({
      pointsAfter: 0,
      delta: 0,
    });
  });

  it('decayBps 0 → no-op', () => {
    expect(computeTerritoryDecay(100, 0)).toMatchObject({
      pointsAfter: 100,
      delta: 0,
    });
  });

  it('decayBps > MAX clamp xuống MAX (50% = 5000)', () => {
    const r = computeTerritoryDecay(100, 9999);
    expect(r.decayBps).toBe(TERRITORY_DECAY_MAX_BPS);
    expect(r.pointsAfter).toBe(50);
  });

  it('floor at 0 với điểm rất nhỏ', () => {
    const r = computeTerritoryDecay(1, 5000);
    expect(r.pointsAfter).toBe(0);
    expect(r.delta).toBe(1);
  });

  it('default decay rate đúng giá trị 2500 bps (25%)', () => {
    expect(TERRITORY_DECAY_DEFAULT_BPS).toBe(2500);
  });

  it('deterministic — cùng input trả cùng output', () => {
    const a = computeTerritoryDecay(12345, 2500);
    const b = computeTerritoryDecay(12345, 2500);
    expect(a).toEqual(b);
  });
});

describe('Phase 14.0.C — isValidTerritoryDecayBps', () => {
  it('reject NaN / non-integer / 0 / negative / > MAX', () => {
    expect(isValidTerritoryDecayBps(NaN)).toBe(false);
    expect(isValidTerritoryDecayBps(0)).toBe(false);
    expect(isValidTerritoryDecayBps(-100)).toBe(false);
    expect(isValidTerritoryDecayBps(2500.5)).toBe(false);
    expect(isValidTerritoryDecayBps(TERRITORY_DECAY_MAX_BPS + 1)).toBe(false);
    expect(isValidTerritoryDecayBps(10000)).toBe(false);
  });

  it('accept 1..TERRITORY_DECAY_MAX_BPS', () => {
    expect(isValidTerritoryDecayBps(1)).toBe(true);
    expect(isValidTerritoryDecayBps(TERRITORY_DECAY_DEFAULT_BPS)).toBe(true);
    expect(isValidTerritoryDecayBps(TERRITORY_DECAY_MAX_BPS)).toBe(true);
  });
});
