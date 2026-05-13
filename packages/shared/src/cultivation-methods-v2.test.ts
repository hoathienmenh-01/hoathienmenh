import { describe, expect, it } from 'vitest';
import {
  CULTIVATION_METHODS_V2,
  METHOD_BONUS_CAPS,
  METHOD_CATEGORIES,
  METHOD_ELEMENTS,
  METHOD_EQUIP_SLOTS,
  METHOD_GRADES,
  METHOD_SOURCES,
  STARTER_METHOD_V2_KEYS,
  aggregateEquippedMethods,
  canEquipMethod,
  canStarUpMethod,
  canUpgradeMethod,
  computeMethodBodyRateBonus,
  computeMethodCultivationRateBonus,
  computeMethodElementalBonus,
  computeMethodStatBonus,
  filterMethods,
  getMethodV2Def,
  methodElementToElementKey,
  methodFragmentItemKey,
  methodGradeForTier,
  methodUpgradeExpCost,
  methodUpgradeLinhThachCost,
  tierBaseline,
  validateMethodCatalog,
  type CharacterEquipContext,
  type CultivationMethodV2Def,
  type EquippedMethodSnapshotEntry,
  type MethodCategory,
  type MethodEquipSlot,
} from './cultivation-methods-v2';
import { ITEMS, itemByKey } from './items';

/**
 * Phase 26.3 — Cultivation Method V2 catalog invariants. Đảm bảo catalog
 * không drift khỏi balance design + helper compose stat / equip / upgrade
 * / star-up đúng cap. Test purely pure — không đụng Prisma / runtime.
 */

describe('CULTIVATION_METHODS_V2 catalog (Phase 26.3)', () => {
  it('catalog non-empty và mỗi method có key unique', () => {
    expect(CULTIVATION_METHODS_V2.length).toBeGreaterThanOrEqual(20);
    const keys = new Set<string>();
    for (const m of CULTIVATION_METHODS_V2) {
      expect(keys.has(m.key), `duplicate methodKey: ${m.key}`).toBe(false);
      keys.add(m.key);
    }
  });

  it('mỗi method có tier ∈ 1..9 + grade khớp tier', () => {
    for (const m of CULTIVATION_METHODS_V2) {
      expect(m.tier, `${m.key} tier`).toBeGreaterThanOrEqual(1);
      expect(m.tier, `${m.key} tier`).toBeLessThanOrEqual(9);
      expect(m.grade, `${m.key} grade`).toBe(methodGradeForTier(m.tier));
    }
  });

  it('mỗi method có category / element / sourceHint hợp lệ', () => {
    for (const m of CULTIVATION_METHODS_V2) {
      expect(METHOD_CATEGORIES.includes(m.category), `${m.key} category`).toBe(true);
      expect(METHOD_ELEMENTS.includes(m.element), `${m.key} element`).toBe(true);
      expect(METHOD_GRADES.includes(m.grade), `${m.key} grade`).toBe(true);
      for (const s of m.sourceHint) {
        expect(METHOD_SOURCES.includes(s), `${m.key} source=${s}`).toBe(true);
      }
    }
  });

  it('mỗi method có primarySlot ∈ allowedSlots + slot ∈ METHOD_EQUIP_SLOTS', () => {
    for (const m of CULTIVATION_METHODS_V2) {
      expect(METHOD_EQUIP_SLOTS.includes(m.primarySlot), `${m.key} primarySlot`).toBe(
        true,
      );
      expect(m.allowedSlots.length, `${m.key} allowedSlots empty`).toBeGreaterThan(0);
      expect(m.allowedSlots.includes(m.primarySlot), `${m.key} primary not in allowed`).toBe(
        true,
      );
      for (const s of m.allowedSlots) {
        expect(METHOD_EQUIP_SLOTS.includes(s), `${m.key} allowedSlot=${s}`).toBe(true);
      }
    }
  });

  it('fragmentItemKey = `method_fragment_<key>` và mỗi fragment item tồn tại trong ITEMS', () => {
    for (const m of CULTIVATION_METHODS_V2) {
      expect(m.fragmentItemKey).toBe(methodFragmentItemKey(m.key));
      const def = itemByKey(m.fragmentItemKey);
      expect(def, `${m.key} fragment item missing from ITEMS catalog`).toBeDefined();
    }
  });

  it('STARTER_METHOD_V2_KEYS phải nằm trong catalog và có fragmentsRequired=0', () => {
    expect(STARTER_METHOD_V2_KEYS.length).toBeGreaterThan(0);
    for (const k of STARTER_METHOD_V2_KEYS) {
      const def = getMethodV2Def(k);
      expect(def, `starter ${k} not in catalog`).toBeDefined();
      expect(def!.fragmentsRequired, `${k} starter fragmentsRequired`).toBe(0);
      expect(def!.unlockLinhThachCost, `${k} starter linh thạch cost`).toBe(0);
    }
  });

  it('endgame tier ≥ 8 phải bind / không trade qua market', () => {
    for (const m of CULTIVATION_METHODS_V2.filter((x) => x.tier >= 8)) {
      expect(m.tradeable, `${m.key} endgame tradeable`).toBe(false);
      expect(m.bindOnUnlock, `${m.key} endgame bindOnUnlock`).toBe(true);
    }
  });

  it('phủ đủ ít nhất 1 method mỗi tier 1..9', () => {
    const tiers = new Set(CULTIVATION_METHODS_V2.map((m) => m.tier));
    for (let t = 1; t <= 9; t++) {
      expect(tiers.has(t), `missing method tier ${t}`).toBe(true);
    }
  });

  it('phủ đủ các category cốt lõi (QI/BODY/HYBRID/ELEMENTAL/SPECIAL)', () => {
    const cats = new Set(CULTIVATION_METHODS_V2.map((m) => m.category));
    // Core categories phải có. SECT/FORBIDDEN tách phase nội dung sau.
    const required: MethodCategory[] = ['QI', 'BODY', 'HYBRID', 'ELEMENTAL', 'SPECIAL'];
    for (const c of required) {
      expect(cats.has(c), `missing category ${c}`).toBe(true);
    }
  });

  it('validateMethodCatalog() pass trên catalog mặc định', () => {
    expect(validateMethodCatalog()).toBe(true);
  });
});

describe('Catalog cross-check vs items.ts (Phase 26.3 fragment item drop)', () => {
  it('mỗi fragment item có materialCategory=METHOD_FRAGMENT + materialTier khớp method.tier', () => {
    for (const m of CULTIVATION_METHODS_V2) {
      const def = itemByKey(m.fragmentItemKey);
      expect(def, `${m.fragmentItemKey} missing`).toBeDefined();
      // ItemDef có materialCategory/materialTier field; cho phép undefined
      // (fallback) nhưng nếu set phải đúng.
      const def2 = def as unknown as {
        materialCategory?: string;
        materialTier?: number;
      };
      if (def2.materialCategory !== undefined) {
        expect(def2.materialCategory, `${m.fragmentItemKey} category`).toBe(
          'METHOD_FRAGMENT',
        );
      }
      if (def2.materialTier !== undefined) {
        expect(def2.materialTier, `${m.fragmentItemKey} tier`).toBe(m.tier);
      }
    }
  });

  it('không tồn tại item key trùng method fragment outside CULTIVATION_METHODS_V2', () => {
    const allowed = new Set(
      CULTIVATION_METHODS_V2.map((m) => m.fragmentItemKey),
    );
    for (const it of ITEMS) {
      if (!it.key.startsWith('method_fragment_')) continue;
      expect(allowed.has(it.key), `orphan fragment item: ${it.key}`).toBe(true);
    }
  });
});

describe('methodUpgradeLinhThachCost / methodUpgradeExpCost (Phase 26.3 helpers)', () => {
  it('cost > 0 với level ≥ 1', () => {
    for (let t = 1; t <= 9; t++) {
      for (let l = 1; l <= 5; l++) {
        expect(methodUpgradeLinhThachCost(t, l), `tier ${t} lvl ${l}`).toBeGreaterThan(0);
        expect(
          methodUpgradeExpCost(t, l),
          `tier ${t} lvl ${l}`,
        ).toBeGreaterThan(0n);
      }
    }
  });

  it('monotonic non-decreasing theo level (cùng tier)', () => {
    for (let t = 1; t <= 9; t++) {
      let prevLinh = -1;
      let prevExp = -1n;
      for (let l = 1; l <= 20; l++) {
        const linh = methodUpgradeLinhThachCost(t, l);
        const exp = methodUpgradeExpCost(t, l);
        expect(linh, `tier ${t} lvl ${l} linhThach monotonic`).toBeGreaterThanOrEqual(
          prevLinh,
        );
        expect(exp >= prevExp, `tier ${t} lvl ${l} exp monotonic`).toBe(true);
        prevLinh = linh;
        prevExp = exp;
      }
    }
  });

  it('monotonic non-decreasing theo tier (cùng level)', () => {
    for (let l = 1; l <= 5; l++) {
      let prevLinh = -1;
      let prevExp = -1n;
      for (let t = 1; t <= 9; t++) {
        const linh = methodUpgradeLinhThachCost(t, l);
        const exp = methodUpgradeExpCost(t, l);
        expect(linh, `lvl ${l} tier ${t} linhThach monotonic`).toBeGreaterThan(
          prevLinh,
        );
        expect(exp > prevExp, `lvl ${l} tier ${t} exp monotonic`).toBe(true);
        prevLinh = linh;
        prevExp = exp;
      }
    }
  });

  it('tierBaseline trả về cost = 0 cho tier 1 (starter)', () => {
    expect(tierBaseline(1).unlockLinhThachCost).toBe(0);
    expect(tierBaseline(1).fragmentsRequired).toBeGreaterThan(0);
  });
});

describe('computeMethodStatBonus (Phase 26.3 pure stat compose)', () => {
  const sample: CultivationMethodV2Def = {
    key: 'test_method',
    name: 'Test',
    description: 'Test',
    category: 'QI',
    element: 'NONE',
    grade: 'PHAM',
    tier: 1,
    unlockRealmOrder: 0,
    maxLevel: 10,
    maxStar: 3,
    fragmentItemKey: 'method_fragment_test_method',
    fragmentsRequired: 0,
    fragmentsPerStar: 4,
    upgradeMaterials: [],
    breakthroughMaterials: [],
    baseStats: { qiExpPercent: 10, atkPercent: 5 },
    perLevelStats: { qiExpPercent: 2, atkPercent: 1 },
    perStarStats: { qiExpPercent: 5, hpMaxPercent: 4 },
    passiveEffects: [],
    sourceHint: ['STARTER'],
    primarySlot: 'QI_MAIN',
    allowedSlots: ['QI_MAIN'],
    tradeable: false,
    bindOnUnlock: true,
    enabled: true,
    unlockLinhThachCost: 0,
  };

  it('level=1 star=0 → base only', () => {
    const out = computeMethodStatBonus(sample, 1, 0);
    expect(out.qiExpPercent).toBe(10);
    expect(out.atkPercent).toBe(5);
    expect(out.hpMaxPercent ?? 0).toBe(0);
  });

  it('level=5 star=2 → base + perLevel*4 + perStar*2', () => {
    const out = computeMethodStatBonus(sample, 5, 2);
    // qiExp = 10 + 2*4 + 5*2 = 28
    expect(out.qiExpPercent).toBe(28);
    // atk = 5 + 1*4 + 0*2 = 9
    expect(out.atkPercent).toBe(9);
    // hp = 0 + 0 + 4*2 = 8
    expect(out.hpMaxPercent).toBe(8);
  });

  it('clamp level/star vào [1..maxLevel] / [0..maxStar]', () => {
    const a = computeMethodStatBonus(sample, 100, 99);
    const b = computeMethodStatBonus(sample, sample.maxLevel, sample.maxStar);
    expect(a).toEqual(b);
    const c = computeMethodStatBonus(sample, 0, -5);
    const d = computeMethodStatBonus(sample, 1, 0);
    expect(c).toEqual(d);
  });
});

describe('aggregateEquippedMethods (Phase 26.3 cap enforcement)', () => {
  function entry(
    def: Partial<CultivationMethodV2Def>,
    level = 1,
    star = 0,
    slot: MethodEquipSlot = 'QI_MAIN',
  ): EquippedMethodSnapshotEntry {
    const full: CultivationMethodV2Def = {
      key: def.key ?? 'k',
      name: def.name ?? 'k',
      description: '',
      category: def.category ?? 'QI',
      element: def.element ?? 'NONE',
      grade: 'PHAM',
      tier: def.tier ?? 1,
      unlockRealmOrder: 0,
      maxLevel: 30,
      maxStar: 5,
      fragmentItemKey: `method_fragment_${def.key ?? 'k'}`,
      fragmentsRequired: 0,
      fragmentsPerStar: 0,
      upgradeMaterials: [],
      breakthroughMaterials: [],
      baseStats: def.baseStats ?? {},
      perLevelStats: def.perLevelStats ?? {},
      perStarStats: def.perStarStats ?? {},
      passiveEffects: [],
      sourceHint: ['STARTER'],
      primarySlot: slot,
      allowedSlots: [slot],
      tradeable: false,
      bindOnUnlock: true,
      enabled: true,
      unlockLinhThachCost: 0,
    };
    return { def: full, level, star, slot };
  }

  it('empty → all zeros', () => {
    const out = aggregateEquippedMethods([]);
    expect(out.qiExpPercent).toBe(0);
    expect(out.bodyExpPercent).toBe(0);
    expect(out.atkPercent).toBe(0);
    expect(out.elementalAtkBonus).toBe(0);
  });

  it('cộng dồn các stat từ nhiều method', () => {
    const out = aggregateEquippedMethods([
      entry({ key: 'a', baseStats: { qiExpPercent: 10, atkPercent: 5 } }),
      entry({ key: 'b', baseStats: { qiExpPercent: 20, defPercent: 8 } }, 1, 0, 'BODY_MAIN'),
    ]);
    expect(out.qiExpPercent).toBe(30);
    expect(out.atkPercent).toBe(5);
    expect(out.defPercent).toBe(8);
  });

  it('cap qiExpPercent theo METHOD_BONUS_CAPS.qiExpPercent', () => {
    const out = aggregateEquippedMethods([
      entry({ key: 'a', baseStats: { qiExpPercent: 999 } }),
    ]);
    expect(out.qiExpPercent).toBe(METHOD_BONUS_CAPS.qiExpPercent);
  });

  it('cap atkPercent / defPercent / elementalAtkBonus', () => {
    const out = aggregateEquippedMethods([
      entry({
        key: 'a',
        baseStats: {
          atkPercent: 999,
          defPercent: 999,
          elementalAtkBonus: 9.99,
          tribulationSupport: 9.99,
          bossDamageReduction: 9.99,
        },
      }),
    ]);
    expect(out.atkPercent).toBe(METHOD_BONUS_CAPS.atkPercent);
    expect(out.defPercent).toBe(METHOD_BONUS_CAPS.defPercent);
    expect(out.elementalAtkBonus).toBe(METHOD_BONUS_CAPS.elementalAtkBonus);
    expect(out.tribulationSupport).toBe(METHOD_BONUS_CAPS.tribulationSupport);
    expect(out.bossDamageReduction).toBe(METHOD_BONUS_CAPS.bossDamageReduction);
  });

  it('computeMethodCultivationRateBonus = 1 + qiExp%/100 (capped)', () => {
    expect(computeMethodCultivationRateBonus([])).toBe(1);
    const mul = computeMethodCultivationRateBonus([
      entry({ key: 'a', baseStats: { qiExpPercent: 50 } }),
    ]);
    expect(mul).toBeCloseTo(1.5, 5);
  });

  it('computeMethodBodyRateBonus = 1 + bodyExp%/100 (capped)', () => {
    const mul = computeMethodBodyRateBonus([
      entry({ key: 'a', baseStats: { bodyExpPercent: 30 } }, 1, 0, 'BODY_MAIN'),
    ]);
    expect(mul).toBeCloseTo(1.3, 5);
  });

  it('computeMethodElementalBonus = max(0, elementalAtkBonus)', () => {
    expect(computeMethodElementalBonus([])).toBe(0);
    const v = computeMethodElementalBonus([
      entry({ key: 'a', baseStats: { elementalAtkBonus: 0.1 } }),
    ]);
    expect(v).toBeCloseTo(0.1, 5);
  });
});

describe('canEquipMethod (Phase 26.3 equip validation)', () => {
  const baseDef: CultivationMethodV2Def = {
    key: 'm',
    name: 'm',
    description: '',
    category: 'SECT',
    element: 'NONE',
    grade: 'HUYEN',
    tier: 3,
    unlockRealmOrder: 3,
    requiredSect: 'thanh_van',
    maxLevel: 10,
    maxStar: 3,
    fragmentItemKey: 'method_fragment_m',
    fragmentsRequired: 0,
    fragmentsPerStar: 0,
    upgradeMaterials: [],
    breakthroughMaterials: [],
    baseStats: {},
    perLevelStats: {},
    perStarStats: {},
    passiveEffects: [],
    sourceHint: ['SECT_SHOP'],
    primarySlot: 'SECT',
    allowedSlots: ['SECT'],
    tradeable: false,
    bindOnUnlock: true,
    enabled: true,
    unlockLinhThachCost: 0,
  };

  const okCtx: CharacterEquipContext = {
    realmOrder: 3,
    bodyRealmOrder: 0,
    sectKey: 'thanh_van',
    unlocked: true,
    occupyingMethodKey: null,
  };

  it('unlocked + đúng slot/realm/sect → ok', () => {
    expect(canEquipMethod(baseDef, 'SECT', okCtx).ok).toBe(true);
  });

  it('chưa unlocked → NOT_UNLOCKED', () => {
    const r = canEquipMethod(baseDef, 'SECT', { ...okCtx, unlocked: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_UNLOCKED');
  });

  it('slot không trong allowedSlots → SLOT_NOT_ALLOWED', () => {
    const r = canEquipMethod(baseDef, 'QI_MAIN', okCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SLOT_NOT_ALLOWED');
  });

  it('realm thấp hơn unlockRealmOrder → REALM_TOO_LOW', () => {
    const r = canEquipMethod(baseDef, 'SECT', { ...okCtx, realmOrder: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REALM_TOO_LOW');
  });

  it('sai sect → WRONG_SECT', () => {
    const r = canEquipMethod(baseDef, 'SECT', { ...okCtx, sectKey: 'huyen_thuy' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('WRONG_SECT');
  });

  it('slot bị method khác chiếm → SLOT_CONFLICT', () => {
    const r = canEquipMethod(baseDef, 'SECT', {
      ...okCtx,
      occupyingMethodKey: 'other_method',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SLOT_CONFLICT');
  });

  it('disabled method → METHOD_DISABLED', () => {
    const r = canEquipMethod({ ...baseDef, enabled: false }, 'SECT', okCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('METHOD_DISABLED');
  });
});

describe('canUpgradeMethod / canStarUpMethod (Phase 26.3 upgrade gating)', () => {
  const def: CultivationMethodV2Def = {
    key: 'm',
    name: 'm',
    description: '',
    category: 'QI',
    element: 'NONE',
    grade: 'PHAM',
    tier: 1,
    unlockRealmOrder: 0,
    maxLevel: 10,
    maxStar: 3,
    fragmentItemKey: 'method_fragment_m',
    fragmentsRequired: 0,
    fragmentsPerStar: 6,
    upgradeMaterials: [],
    breakthroughMaterials: [],
    baseStats: {},
    perLevelStats: {},
    perStarStats: {},
    passiveEffects: [],
    sourceHint: ['STARTER'],
    primarySlot: 'QI_MAIN',
    allowedSlots: ['QI_MAIN'],
    tradeable: false,
    bindOnUnlock: true,
    enabled: true,
    unlockLinhThachCost: 0,
  };

  it('chưa unlocked → NOT_UNLOCKED', () => {
    const r = canUpgradeMethod(def, { unlocked: false, level: 1, methodExp: 0n });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_UNLOCKED');
  });

  it('đã max level → MAX_LEVEL', () => {
    const r = canUpgradeMethod(def, {
      unlocked: true,
      level: def.maxLevel,
      methodExp: 10n ** 9n,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MAX_LEVEL');
  });

  it('thiếu methodExp → INSUFFICIENT_EXP', () => {
    const r = canUpgradeMethod(def, { unlocked: true, level: 1, methodExp: 0n });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INSUFFICIENT_EXP');
  });

  it('đủ exp → ok', () => {
    const need = methodUpgradeExpCost(def.tier, 1);
    const r = canUpgradeMethod(def, { unlocked: true, level: 1, methodExp: need });
    expect(r.ok).toBe(true);
  });

  it('chưa unlocked → starUp NOT_UNLOCKED', () => {
    const r = canStarUpMethod(def, { unlocked: false, star: 0, fragmentsOwned: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_UNLOCKED');
  });

  it('đã max star → MAX_STAR', () => {
    const r = canStarUpMethod(def, {
      unlocked: true,
      star: def.maxStar,
      fragmentsOwned: 99,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MAX_STAR');
  });

  it('thiếu fragment → INSUFFICIENT_FRAGMENTS', () => {
    const r = canStarUpMethod(def, { unlocked: true, star: 0, fragmentsOwned: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INSUFFICIENT_FRAGMENTS');
  });

  it('đủ fragment → ok', () => {
    const r = canStarUpMethod(def, {
      unlocked: true,
      star: 0,
      fragmentsOwned: def.fragmentsPerStar,
    });
    expect(r.ok).toBe(true);
  });
});

describe('methodElementToElementKey (Phase 26.3 element mapping)', () => {
  it('KIM/MOC/THUY/HOA/THO → ElementKey thường', () => {
    expect(methodElementToElementKey('KIM')).toBe('kim');
    expect(methodElementToElementKey('MOC')).toBe('moc');
    expect(methodElementToElementKey('THUY')).toBe('thuy');
    expect(methodElementToElementKey('HOA')).toBe('hoa');
    expect(methodElementToElementKey('THO')).toBe('tho');
  });

  it('NONE/MIXED/HUYEN/HON_NGUYEN → null', () => {
    expect(methodElementToElementKey('NONE')).toBeNull();
    expect(methodElementToElementKey('MIXED')).toBeNull();
    expect(methodElementToElementKey('HUYEN')).toBeNull();
    expect(methodElementToElementKey('HON_NGUYEN')).toBeNull();
  });
});

describe('filterMethods (Phase 26.3 UI catalog filter)', () => {
  it('filter theo category trả về subset đúng', () => {
    const qis = filterMethods({ category: 'QI' });
    expect(qis.length).toBeGreaterThan(0);
    for (const m of qis) expect(m.category).toBe('QI');
  });

  it('filter theo tier trả về subset đúng', () => {
    const t1 = filterMethods({ tier: 1 });
    expect(t1.length).toBeGreaterThan(0);
    for (const m of t1) expect(m.tier).toBe(1);
  });

  it('filter theo slot trả về method allow slot đó', () => {
    const supports = filterMethods({ slot: 'SUPPORT' });
    for (const m of supports) {
      expect(m.allowedSlots.includes('SUPPORT'), `${m.key}`).toBe(true);
    }
  });

  it('filter rỗng → trả full catalog', () => {
    expect(filterMethods({}).length).toBe(CULTIVATION_METHODS_V2.length);
  });
});
