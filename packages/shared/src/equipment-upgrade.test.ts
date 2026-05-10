import { describe, expect, it } from 'vitest';
import {
  ALLOWED_SUBSTAT_KINDS,
  composeEnchantBonus,
  composeSubstatBonus,
  ELEMENTAL_ENCHANT_EFFECTS,
  EQUIPMENT_ENCHANT_CONFIG,
  EQUIPMENT_REFORGE_CONFIG,
  getEnchantCost,
  getReforgeCost,
  isEquipmentSubstatKind,
  isUpgradableItemKind,
  MAX_ENCHANT_LEVEL,
  parseEnchantElement,
  rollReforgedSubstats,
} from './equipment-upgrade';
import type { Quality } from './enums';
import type { ElementKey } from './combat';

const QUALITIES: readonly Quality[] = ['PHAM', 'LINH', 'HUYEN', 'TIEN', 'THAN'];
const ELEMENTS: readonly ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];

describe('equipment-upgrade — config validity', () => {
  it('reforge config covers all 5 qualities', () => {
    for (const q of QUALITIES) {
      const rule = EQUIPMENT_REFORGE_CONFIG[q];
      expect(rule).toBeDefined();
      expect(rule.quality).toBe(q);
      expect(rule.slots).toBeGreaterThan(0);
      expect(rule.linhThachCost).toBeGreaterThan(0);
      expect(rule.material.qty).toBeGreaterThan(0);
      expect(rule.material.itemKey).toMatch(/[a-z_]+/);
      // All allowed substat kinds have valid range.
      for (const kind of ALLOWED_SUBSTAT_KINDS) {
        const r = rule.ranges[kind];
        expect(r.min).toBeGreaterThan(0);
        expect(r.max).toBeGreaterThanOrEqual(r.min);
      }
    }
  });

  it('reforge cost monotonically scales with quality', () => {
    let prev = 0;
    for (const q of QUALITIES) {
      const cost = getReforgeCost(q);
      expect(cost.linhThachCost).toBeGreaterThan(prev);
      prev = cost.linhThachCost;
    }
  });

  it('reforge slot count never exceeds 4 (anti-power-creep)', () => {
    for (const q of QUALITIES) {
      const rule = EQUIPMENT_REFORGE_CONFIG[q];
      expect(rule.slots).toBeLessThanOrEqual(4);
    }
  });

  it('reforge max value caps stay sub-tier (THAN atk max ≤ 10)', () => {
    expect(EQUIPMENT_REFORGE_CONFIG.THAN.ranges.atk.max).toBeLessThanOrEqual(10);
    expect(EQUIPMENT_REFORGE_CONFIG.THAN.ranges.def.max).toBeLessThanOrEqual(10);
  });

  it('enchant config covers all 5 qualities', () => {
    for (const q of QUALITIES) {
      const rule = EQUIPMENT_ENCHANT_CONFIG[q];
      expect(rule).toBeDefined();
      expect(rule.baseLinhThachCost).toBeGreaterThan(0);
      expect(rule.material.qty).toBeGreaterThan(0);
    }
  });

  it('enchant cost grows with currentLevel and quality', () => {
    const huyenL0 = getEnchantCost('HUYEN', 0);
    const huyenL3 = getEnchantCost('HUYEN', 3);
    expect(huyenL3.linhThachCost).toBeGreaterThan(huyenL0.linhThachCost);
    const tienL0 = getEnchantCost('TIEN', 0);
    expect(tienL0.linhThachCost).toBeGreaterThan(huyenL0.linhThachCost);
  });

  it('getEnchantCost throws at MAX_ENCHANT_LEVEL', () => {
    expect(() => getEnchantCost('LINH', MAX_ENCHANT_LEVEL)).toThrow();
    expect(() => getEnchantCost('LINH', MAX_ENCHANT_LEVEL + 1)).toThrow();
    expect(() => getEnchantCost('LINH', -1)).toThrow();
  });

  it('elemental enchant effects cover all 5 elements with matching stat kind', () => {
    for (const elem of ELEMENTS) {
      const eff = ELEMENTAL_ENCHANT_EFFECTS[elem];
      expect(eff).toBeDefined();
      expect(eff.element).toBe(elem);
      expect(eff.bonusPerLevel).toBeGreaterThan(0);
      expect(isEquipmentSubstatKind(eff.statKind)).toBe(true);
    }
  });

  it('enchant bonus per level keeps total cap modest (level 5 ≤ 75)', () => {
    for (const elem of ELEMENTS) {
      const eff = ELEMENTAL_ENCHANT_EFFECTS[elem];
      // level 5 cap × bonusPerLevel — keep < 1 tier of base armor (HUYEN
      // armor hpMax = 60). Wood hpMax 12*5 = 60 OK, others lower.
      expect(eff.bonusPerLevel * MAX_ENCHANT_LEVEL).toBeLessThanOrEqual(75);
    }
  });
});

describe('equipment-upgrade — rollReforgedSubstats', () => {
  it('returns exactly slots count substats', () => {
    const rule = EQUIPMENT_REFORGE_CONFIG.HUYEN;
    const out = rollReforgedSubstats('HUYEN', () => 0);
    expect(out.length).toBe(rule.slots);
  });

  it('returns valid kinds + values within range', () => {
    let seed = 0.123;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (const q of QUALITIES) {
      const out = rollReforgedSubstats(q, rng);
      const rule = EQUIPMENT_REFORGE_CONFIG[q];
      for (const s of out) {
        expect(isEquipmentSubstatKind(s.kind)).toBe(true);
        const range = rule.ranges[s.kind];
        expect(s.value).toBeGreaterThanOrEqual(range.min);
        expect(s.value).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it('deterministic with same seed', () => {
    const fixedSeed = (() => {
      const seq = [0.1, 0.4, 0.7, 0.2, 0.6, 0.3];
      let i = 0;
      return () => seq[i++ % seq.length];
    })();
    const a = rollReforgedSubstats('LINH', fixedSeed);
    // re-init and roll again — same sequence should produce same result.
    const fixedSeed2 = (() => {
      const seq = [0.1, 0.4, 0.7, 0.2, 0.6, 0.3];
      let i = 0;
      return () => seq[i++ % seq.length];
    })();
    const b = rollReforgedSubstats('LINH', fixedSeed2);
    expect(a).toEqual(b);
  });
});

describe('equipment-upgrade — composeSubstatBonus', () => {
  it('sums values per kind', () => {
    const out = composeSubstatBonus([
      { kind: 'atk', value: 5 },
      { kind: 'atk', value: 3 },
      { kind: 'def', value: 2 },
    ]);
    expect(out.atk).toBe(8);
    expect(out.def).toBe(2);
    expect(out.hpMax).toBe(0);
  });

  it('skips invalid entries gracefully', () => {
    const out = composeSubstatBonus([
      { kind: 'atk', value: 5 },
      { kind: 'spirit' as const, value: -3 }, // negative skipped
      { kind: 'def', value: NaN }, // NaN skipped
    ]);
    expect(out.atk).toBe(5);
    expect(out.def).toBe(0);
    expect(out.spirit).toBe(0);
  });

  it('empty input returns zeroed map', () => {
    const out = composeSubstatBonus([]);
    expect(out).toEqual({ atk: 0, def: 0, hpMax: 0, mpMax: 0, spirit: 0 });
  });
});

describe('equipment-upgrade — composeEnchantBonus', () => {
  it('null element returns zero', () => {
    const out = composeEnchantBonus(null, 5);
    expect(out).toEqual({ atk: 0, def: 0, hpMax: 0, mpMax: 0, spirit: 0 });
  });

  it('level 0 returns zero', () => {
    const out = composeEnchantBonus('hoa', 0);
    expect(out.atk).toBe(0);
  });

  it('moc gives hpMax bonus', () => {
    const out = composeEnchantBonus('moc', 3);
    const eff = ELEMENTAL_ENCHANT_EFFECTS.moc;
    expect(out.hpMax).toBe(eff.bonusPerLevel * 3);
    expect(out.atk).toBe(0);
  });

  it('hoa gives atk bonus', () => {
    const out = composeEnchantBonus('hoa', 5);
    const eff = ELEMENTAL_ENCHANT_EFFECTS.hoa;
    expect(out.atk).toBe(eff.bonusPerLevel * 5);
  });

  it('caps level at MAX_ENCHANT_LEVEL (defensive)', () => {
    const out = composeEnchantBonus('thuy', 99);
    const eff = ELEMENTAL_ENCHANT_EFFECTS.thuy;
    expect(out.mpMax).toBe(eff.bonusPerLevel * MAX_ENCHANT_LEVEL);
  });

  it('all elements deterministic at level 1', () => {
    for (const elem of ELEMENTS) {
      const out = composeEnchantBonus(elem, 1);
      const eff = ELEMENTAL_ENCHANT_EFFECTS[elem];
      expect(out[eff.statKind]).toBe(eff.bonusPerLevel);
    }
  });
});

describe('equipment-upgrade — parseEnchantElement', () => {
  it('accepts valid element keys', () => {
    expect(parseEnchantElement('kim')).toBe('kim');
    expect(parseEnchantElement('hoa')).toBe('hoa');
  });

  it('rejects invalid + null', () => {
    expect(parseEnchantElement(null)).toBe(null);
    expect(parseEnchantElement(undefined)).toBe(null);
    expect(parseEnchantElement('')).toBe(null);
    expect(parseEnchantElement('FIRE')).toBe(null); // case-sensitive lowercase only
    expect(parseEnchantElement('xyz')).toBe(null);
  });
});

describe('equipment-upgrade — isUpgradableItemKind', () => {
  it('weapon/armor/belt/boots/hat/tram/artifact upgradable', () => {
    expect(isUpgradableItemKind('WEAPON')).toBe(true);
    expect(isUpgradableItemKind('ARMOR')).toBe(true);
    expect(isUpgradableItemKind('BELT')).toBe(true);
    expect(isUpgradableItemKind('BOOTS')).toBe(true);
    expect(isUpgradableItemKind('HAT')).toBe(true);
    expect(isUpgradableItemKind('TRAM')).toBe(true);
    expect(isUpgradableItemKind('ARTIFACT')).toBe(true);
  });

  it('pill/ore/skill book/misc not upgradable', () => {
    expect(isUpgradableItemKind('PILL_HP')).toBe(false);
    expect(isUpgradableItemKind('PILL_MP')).toBe(false);
    expect(isUpgradableItemKind('PILL_EXP')).toBe(false);
    expect(isUpgradableItemKind('ORE')).toBe(false);
    expect(isUpgradableItemKind('SKILL_BOOK')).toBe(false);
    expect(isUpgradableItemKind('MISC')).toBe(false);
  });
});
