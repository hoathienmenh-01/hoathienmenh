import { describe, expect, it } from 'vitest';
import {
  TALENTS,
  canCharacterLearnTalent,
  composePassiveTalentMods,
  computePassiveTalentTribulationResist,
  computeTalentPointBudget,
  getTalentDef,
  simulateActiveTalent,
  talentsAvailableAtRealm,
  talentsByElement,
  talentsByType,
} from './talents';
import { REALMS } from './realms';
import type { ElementKey } from './combat';

const realmKeyToOrder = new Map(REALMS.map((r) => [r.key, r.order]));

describe('TALENTS catalog shape', () => {
  it('có ít nhất 12 talent baseline', () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(12);
  });

  it('tất cả key duy nhất', () => {
    const keys = TALENTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tất cả key bắt đầu bằng "talent_"', () => {
    for (const t of TALENTS) {
      expect(t.key.startsWith('talent_')).toBe(true);
    }
  });

  it('mỗi talent có name + description không rỗng', () => {
    for (const t of TALENTS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('type là "passive" hoặc "active"', () => {
    for (const t of TALENTS) {
      expect(['passive', 'active']).toContain(t.type);
    }
  });

  it('passive talent CHỈ có passiveEffect, không activeEffect', () => {
    const passives = talentsByType('passive');
    for (const t of passives) {
      expect(t.passiveEffect).not.toBeNull();
      expect(t.activeEffect).toBeNull();
    }
  });

  it('active talent CHỈ có activeEffect, không passiveEffect', () => {
    const actives = talentsByType('active');
    for (const t of actives) {
      expect(t.activeEffect).not.toBeNull();
      expect(t.passiveEffect).toBeNull();
    }
  });

  it('element nullable nhưng nếu set thì hợp lệ', () => {
    const valid: (ElementKey | null)[] = ['kim', 'moc', 'thuy', 'hoa', 'tho', null];
    for (const t of TALENTS) {
      expect(valid).toContain(t.element);
    }
  });

  it('realmRequirement tham chiếu key tồn tại trong REALMS', () => {
    const realmKeys = new Set(REALMS.map((r) => r.key));
    for (const t of TALENTS) {
      expect(realmKeys.has(t.realmRequirement)).toBe(true);
    }
  });

  it('talentPointCost trong [1, 3]', () => {
    for (const t of TALENTS) {
      expect(t.talentPointCost).toBeGreaterThanOrEqual(1);
      expect(t.talentPointCost).toBeLessThanOrEqual(3);
      expect(Number.isInteger(t.talentPointCost)).toBe(true);
    }
  });
});

describe('PassiveTalentEffect shape', () => {
  it('passive stat_mod có statTarget hợp lệ + value > 1', () => {
    const validTargets = ['atk', 'def', 'hpMax', 'mpMax', 'spirit'];
    for (const t of talentsByType('passive')) {
      const eff = t.passiveEffect;
      if (eff && eff.kind === 'stat_mod') {
        expect(eff.statTarget).not.toBeNull();
        if (eff.statTarget) expect(validTargets).toContain(eff.statTarget);
        expect(eff.value).toBeGreaterThan(1);
      }
    }
  });

  it('passive regen có statTarget hpMax|mpMax + value > 0 flat', () => {
    for (const t of talentsByType('passive')) {
      const eff = t.passiveEffect;
      if (eff && eff.kind === 'regen') {
        expect(['hpMax', 'mpMax']).toContain(eff.statTarget);
        expect(eff.value).toBeGreaterThan(0);
      }
    }
  });

  it('passive damage_bonus có elementTarget hợp lệ', () => {
    const valid: ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
    for (const t of talentsByType('passive')) {
      const eff = t.passiveEffect;
      if (eff && eff.kind === 'damage_bonus') {
        expect(eff.elementTarget).not.toBeNull();
        if (eff.elementTarget) expect(valid).toContain(eff.elementTarget);
        expect(eff.value).toBeGreaterThan(1);
      }
    }
  });

  it('passive drop_bonus + exp_bonus value > 1', () => {
    for (const t of talentsByType('passive')) {
      const eff = t.passiveEffect;
      if (eff && (eff.kind === 'drop_bonus' || eff.kind === 'exp_bonus')) {
        expect(eff.value).toBeGreaterThan(1);
      }
    }
  });

  // Phase 11.6.D — element_resist invariants:
  //   value < 1 (giảm damage) + elementTarget hợp lệ + statTarget null.
  it('passive element_resist có elementTarget hợp lệ + value < 1', () => {
    const valid: ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
    for (const t of talentsByType('passive')) {
      const eff = t.passiveEffect;
      if (eff && eff.kind === 'element_resist') {
        expect(eff.elementTarget).not.toBeNull();
        if (eff.elementTarget) expect(valid).toContain(eff.elementTarget);
        expect(eff.value).toBeGreaterThan(0);
        expect(eff.value).toBeLessThan(1);
        expect(eff.statTarget).toBeNull();
      }
    }
  });
});

describe('ActiveTalentEffect shape', () => {
  it('active có cooldownTurns >= 1 + mpCost > 0', () => {
    for (const t of talentsByType('active')) {
      const eff = t.activeEffect;
      expect(eff).not.toBeNull();
      if (eff) {
        expect(eff.cooldownTurns).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(eff.cooldownTurns)).toBe(true);
        expect(eff.mpCost).toBeGreaterThan(0);
        expect(Number.isInteger(eff.mpCost)).toBe(true);
      }
    }
  });

  it('active có aoe boolean hợp lệ', () => {
    for (const t of talentsByType('active')) {
      const eff = t.activeEffect;
      if (eff) expect(typeof eff.aoe).toBe('boolean');
    }
  });

  it('active damage value >= 1.0 (multiplier)', () => {
    for (const t of talentsByType('active')) {
      const eff = t.activeEffect;
      if (eff && eff.kind === 'damage') {
        expect(eff.value).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it('active cc value (turns) trong [1, 5]', () => {
    for (const t of talentsByType('active')) {
      const eff = t.activeEffect;
      if (eff && eff.kind === 'cc') {
        expect(eff.value).toBeGreaterThanOrEqual(1);
        expect(eff.value).toBeLessThanOrEqual(5);
      }
    }
  });

  it('active heal value trong (0, 1] (ratio of hpMax)', () => {
    for (const t of talentsByType('active')) {
      const eff = t.activeEffect;
      if (eff && eff.kind === 'heal') {
        expect(eff.value).toBeGreaterThan(0);
        expect(eff.value).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

describe('Curve sanity', () => {
  it('có ít nhất 5 passive', () => {
    expect(talentsByType('passive').length).toBeGreaterThanOrEqual(5);
  });

  it('có ít nhất 5 active', () => {
    expect(talentsByType('active').length).toBeGreaterThanOrEqual(5);
  });

  it('cover 5 element kim/moc/thuy/hoa/tho ít nhất 1 talent mỗi hệ', () => {
    const elements: ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
    for (const e of elements) {
      expect(talentsByElement(e).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('có talent neutral (element = null)', () => {
    expect(talentsByElement(null).length).toBeGreaterThanOrEqual(1);
  });

  it('mỗi type cover ít nhất 3 element khác nhau', () => {
    const passiveElems = new Set(talentsByType('passive').map((t) => t.element));
    const activeElems = new Set(talentsByType('active').map((t) => t.element));
    expect(passiveElems.size).toBeGreaterThanOrEqual(3);
    expect(activeElems.size).toBeGreaterThanOrEqual(3);
  });
});

describe('getTalentDef', () => {
  it('trả talent khi key hợp lệ', () => {
    const t = getTalentDef('talent_kim_thien_co');
    expect(t).toBeDefined();
    expect(t?.element).toBe('kim');
  });

  it('trả undefined khi key sai', () => {
    expect(getTalentDef('talent_invalid')).toBeUndefined();
  });
});

describe('talentsByType', () => {
  it('passive trả non-empty list', () => {
    expect(talentsByType('passive').length).toBeGreaterThan(0);
  });

  it('active trả non-empty list', () => {
    expect(talentsByType('active').length).toBeGreaterThan(0);
  });

  it('union 2 type = TALENTS.length', () => {
    expect(
      talentsByType('passive').length + talentsByType('active').length
    ).toBe(TALENTS.length);
  });
});

describe('talentsByElement', () => {
  it('kim trả các talent element=kim', () => {
    const list = talentsByElement('kim');
    for (const t of list) expect(t.element).toBe('kim');
  });

  it('null trả neutral talents', () => {
    const list = talentsByElement(null);
    for (const t of list) expect(t.element).toBeNull();
  });

  it('union 6 element (5 + null) = TALENTS.length', () => {
    const total =
      talentsByElement('kim').length +
      talentsByElement('moc').length +
      talentsByElement('thuy').length +
      talentsByElement('hoa').length +
      talentsByElement('tho').length +
      talentsByElement(null).length;
    expect(total).toBe(TALENTS.length);
  });
});

describe('talentsAvailableAtRealm', () => {
  it('phamnhan(0) trả empty (không talent nào học được)', () => {
    expect(talentsAvailableAtRealm(0, realmKeyToOrder).length).toBe(0);
  });

  it('truc_co(2) trả các talent yêu cầu truc_co hoặc thấp hơn', () => {
    const list = talentsAvailableAtRealm(2, realmKeyToOrder);
    for (const t of list) {
      const reqOrder = realmKeyToOrder.get(t.realmRequirement) ?? -1;
      expect(reqOrder).toBeLessThanOrEqual(2);
    }
  });

  it('endgame realm trả tất cả talent', () => {
    const maxOrder = Math.max(...REALMS.map((r) => r.order));
    const list = talentsAvailableAtRealm(maxOrder, realmKeyToOrder);
    expect(list.length).toBe(TALENTS.length);
  });

  it('throw nếu currentRealmOrder âm', () => {
    expect(() => talentsAvailableAtRealm(-1, realmKeyToOrder)).toThrow();
  });

  it('throw nếu currentRealmOrder = NaN', () => {
    expect(() => talentsAvailableAtRealm(NaN, realmKeyToOrder)).toThrow();
  });
});

describe('computeTalentPointBudget', () => {
  it('phamnhan(0) = 0 points', () => {
    expect(computeTalentPointBudget(0)).toBe(0);
  });

  it('luyenkhi(1)..truc_co(2) = 0 points (chưa đến 3-realm milestone)', () => {
    expect(computeTalentPointBudget(1)).toBe(0);
    expect(computeTalentPointBudget(2)).toBe(0);
  });

  it('kim_dan(3) = 1 point (first milestone)', () => {
    expect(computeTalentPointBudget(3)).toBe(1);
  });

  it('luyen_hu(6) = 2 points (second milestone)', () => {
    expect(computeTalentPointBudget(6)).toBe(2);
  });

  it('do_kiep(9) = 3 points (third milestone)', () => {
    expect(computeTalentPointBudget(9)).toBe(3);
  });

  it('endgame = max points', () => {
    const maxOrder = Math.max(...REALMS.map((r) => r.order));
    const expected = Math.floor(maxOrder / 3);
    expect(computeTalentPointBudget(maxOrder)).toBe(expected);
  });

  it('throw nếu order âm', () => {
    expect(() => computeTalentPointBudget(-1)).toThrow();
  });
});

describe('canCharacterLearnTalent', () => {
  const kimThienCo = getTalentDef('talent_kim_thien_co')!;

  it('canLearn=true khi đủ realm + đủ point', () => {
    const result = canCharacterLearnTalent(kimThienCo, 3, realmKeyToOrder, 0);
    expect(result.canLearn).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('canLearn=false realm_too_low khi chưa đủ realm', () => {
    const result = canCharacterLearnTalent(kimThienCo, 2, realmKeyToOrder, 0);
    expect(result.canLearn).toBe(false);
    expect(result.reason).toBe('realm_too_low');
  });

  it('canLearn=false insufficient_talent_points khi đã spent hết', () => {
    const result = canCharacterLearnTalent(kimThienCo, 3, realmKeyToOrder, 1);
    expect(result.canLearn).toBe(false);
    expect(result.reason).toBe('insufficient_talent_points');
  });

  it('canLearn=false invalid_realm_requirement nếu realm key sai', () => {
    const fake = { ...kimThienCo, realmRequirement: 'invalid_realm' };
    const result = canCharacterLearnTalent(fake, 99, realmKeyToOrder, 0);
    expect(result.canLearn).toBe(false);
    expect(result.reason).toBe('invalid_realm_requirement');
  });
});

describe('composePassiveTalentMods', () => {
  it('empty list → identity mods', () => {
    const mods = composePassiveTalentMods([]);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.dropMul).toBe(1);
    expect(mods.expMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('kim_thien_co → atkMul = 1.1', () => {
    const mods = composePassiveTalentMods(['talent_kim_thien_co']);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
  });

  it('thuy_long_an → hpMaxMul = 1.1', () => {
    const mods = composePassiveTalentMods(['talent_thuy_long_an']);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
  });

  it('huyen_thuy_tam → spiritMul = 1.1 (Phase 11.X.AA producer cho 11.4.G/11.X.U wire)', () => {
    const mods = composePassiveTalentMods(['talent_huyen_thuy_tam']);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=spirit bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('combine kim_thien_co + huyen_thuy_tam → atk=1.1 + spirit=1.1 (multiplicative isolated by statTarget)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_co',
      'talent_huyen_thuy_tam',
    ]);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Cross-stat verification: atk + spirit độc lập.
    expect(mods.hpMaxMul).toBe(1);
  });

  it('moc_linh_quy → hpRegenFlat = 5', () => {
    const mods = composePassiveTalentMods(['talent_moc_linh_quy']);
    expect(mods.hpRegenFlat).toBe(5);
  });

  it('moc_linh_co → spiritMul = 1.1 (Phase 11.X.AB producer thứ 2 cho 11.4.G/11.X.U/11.X.X wire, fill 5-element coverage)', () => {
    const mods = composePassiveTalentMods(['talent_moc_linh_co']);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=spirit bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
  });

  it('combine huyen_thuy_tam + moc_linh_co → spiritMul = 1.1 × 1.1 = 1.21 (multiplicative cross-element)', () => {
    const mods = composePassiveTalentMods([
      'talent_huyen_thuy_tam',
      'talent_moc_linh_co',
    ]);
    expect(mods.spiritMul).toBeCloseTo(1.21, 5);
    // Cross-stat verification: chỉ spirit bị stack, atk/hpMax giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('hoa_dan_tam → spiritMul = 1.1 (Phase 11.X.AC producer thứ 3 cho 11.4.G/11.X.U/11.X.X/11.X.Y wire, fill 5-element coverage)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_dan_tam']);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=spirit bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    // damageBonusByElement không bị set bởi spirit producer (khác với talent_hoa_tam_dao).
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine huyen_thuy_tam + moc_linh_co + hoa_dan_tam → spiritMul = 1.1 × 1.1 × 1.1 = 1.331 (multiplicative 3-element stack)', () => {
    const mods = composePassiveTalentMods([
      'talent_huyen_thuy_tam',
      'talent_moc_linh_co',
      'talent_hoa_dan_tam',
    ]);
    expect(mods.spiritMul).toBeCloseTo(1.331, 5);
    // Cross-stat verification: chỉ spirit bị stack, atk/hpMax giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('tho_linh_an → spiritMul = 1.1 (Phase 11.X.AD producer thứ 4 cho 11.4.G/11.X.U/11.X.X/11.X.Y wire, fill 5-element coverage)', () => {
    const mods = composePassiveTalentMods(['talent_tho_linh_an']);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=spirit bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    // damageBonusByElement không bị set bởi spirit producer.
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine huyen_thuy_tam + moc_linh_co + tho_linh_an → spiritMul = 1.1 × 1.1 × 1.1 = 1.331 (multiplicative 3-element stack)', () => {
    const mods = composePassiveTalentMods([
      'talent_huyen_thuy_tam',
      'talent_moc_linh_co',
      'talent_tho_linh_an',
    ]);
    expect(mods.spiritMul).toBeCloseTo(1.331, 5);
    // Cross-stat verification: chỉ spirit bị stack, atk/hpMax giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('kim_linh_tam → spiritMul = 1.1 (Phase 11.X.AE producer thứ 5 cho 11.4.G/11.X.U/11.X.X/11.X.Y wire, hoàn tất 5-element coverage)', () => {
    const mods = composePassiveTalentMods(['talent_kim_linh_tam']);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=spirit bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    // damageBonusByElement không bị set bởi spirit producer.
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine kim_thien_co (atk) + kim_linh_tam (spirit) → atkMul = 1.1 × spiritMul = 1.1 (cross-stat kim, no overlap)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_co',
      'talent_kim_linh_tam',
    ]);
    // Hai kim talent độc lập: atk path vs spirit path, không overlap.
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.spiritMul).toBeCloseTo(1.1, 5);
    // Cross-stat: hpMax/def giữ identity vì cả hai đều không touch.
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.defMul).toBe(1);
  });

  it('combine all 5 spirit producers (thuy + moc + hoa + tho + kim) → spiritMul = 1.1⁵ = 1.61051 (5-element ceiling)', () => {
    const mods = composePassiveTalentMods([
      'talent_huyen_thuy_tam',
      'talent_moc_linh_co',
      'talent_hoa_dan_tam',
      'talent_tho_linh_an',
      'talent_kim_linh_tam',
    ]);
    // Hoàn tất 5-element spirit coverage roadmap.
    expect(mods.spiritMul).toBeCloseTo(1.61051, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('moc_lam_phach → atkMul = 1.1 (Phase 11.X.AF producer thứ 2 cho atkMul, mở đầu fill 5-element atk coverage)', () => {
    const mods = composePassiveTalentMods(['talent_moc_lam_phach']);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ statTarget=atk bị tác động, các stat khác giữ identity.
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    // damageBonusByElement không bị set bởi atk producer.
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine kim_thien_co + moc_lam_phach → atkMul = 1.1² = 1.21 (2-element atk multiplicative stack)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_co',
      'talent_moc_lam_phach',
    ]);
    // 2 atk producers cùng statTarget=atk → multiplicative compose 1.1 × 1.1.
    expect(mods.atkMul).toBeCloseTo(1.21, 5);
    // Cross-stat: spirit/hpMax/def giữ identity.
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.defMul).toBe(1);
  });

  it('thuy_long_trao → atkMul = 1.1 (Phase 11.X.AG producer thứ 3 cho atkMul)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_long_trao']);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_phen_kiem → atkMul = 1.1 (Phase 11.X.AH producer thứ 4 cho atkMul)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_phen_kiem']);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('tho_son_phach → atkMul = 1.1 (Phase 11.X.AI producer thứ 5 cho atkMul, hoàn tất 5-element atk coverage)', () => {
    const mods = composePassiveTalentMods(['talent_tho_son_phach']);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 atk producers (kim + moc + thuy + hoa + tho) → atkMul = 1.1⁵ = 1.61051 (5-element atk ceiling)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_co',
      'talent_moc_lam_phach',
      'talent_thuy_long_trao',
      'talent_hoa_phen_kiem',
      'talent_tho_son_phach',
    ]);
    // Hoàn tất 5-element atk coverage roadmap, khớp 5-element spirit ceiling.
    expect(mods.atkMul).toBeCloseTo(1.61051, 5);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.defMul).toBe(1);
  });

  it('kim_thiet_giap → defMul = 1.1 (Phase 11.X.AJ kim def producer)', () => {
    const mods = composePassiveTalentMods(['talent_kim_thiet_giap']);
    expect(mods.defMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('moc_dan_giap → defMul = 1.1 (Phase 11.X.AJ moc def producer)', () => {
    const mods = composePassiveTalentMods(['talent_moc_dan_giap']);
    expect(mods.defMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('thuy_kien_giap → defMul = 1.1 (Phase 11.X.AJ thuy def producer)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_kien_giap']);
    expect(mods.defMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_phap_giap → defMul = 1.1 (Phase 11.X.AJ hoa def producer)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_phap_giap']);
    expect(mods.defMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 def producers (kim + moc + thuy + hoa + tho) → defMul = 1.1⁵ = 1.61051 (5-element def ceiling, hoàn tất Phase 11.X.AJ)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thiet_giap',
      'talent_moc_dan_giap',
      'talent_thuy_kien_giap',
      'talent_hoa_phap_giap',
      'talent_tho_son_tuong',
    ]);
    // Hoàn tất 5-element def coverage roadmap, khớp 5-element atk + spirit ceiling.
    expect(mods.defMul).toBeCloseTo(1.61051, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('kim_thach_thai → hpMaxMul = 1.1 (Phase 11.X.AK kim hpMax producer)', () => {
    const mods = composePassiveTalentMods(['talent_kim_thach_thai']);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('moc_phach_thai → hpMaxMul = 1.1 (Phase 11.X.AK moc hpMax producer)', () => {
    const mods = composePassiveTalentMods(['talent_moc_phach_thai']);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_huyet_thai → hpMaxMul = 1.1 (Phase 11.X.AK hoa hpMax producer)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_huyet_thai']);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('tho_son_thai → hpMaxMul = 1.1 (Phase 11.X.AK tho hpMax producer)', () => {
    const mods = composePassiveTalentMods(['talent_tho_son_thai']);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 hpMax producers (kim + moc + thuy + hoa + tho) → hpMaxMul = 1.1⁵ = 1.61051 (5-element hpMax ceiling, hoàn tất Phase 11.X.AK)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thach_thai',
      'talent_moc_phach_thai',
      'talent_thuy_long_an',
      'talent_hoa_huyet_thai',
      'talent_tho_son_thai',
    ]);
    // Hoàn tất 5-element hpMax coverage roadmap, khớp 5-element atk + spirit + def ceiling.
    expect(mods.hpMaxMul).toBeCloseTo(1.61051, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.defMul).toBe(1);
  });

  it('hoa_tam_dao → damageBonusByElement[kim] = 1.15', () => {
    const mods = composePassiveTalentMods(['talent_hoa_tam_dao']);
    expect(mods.damageBonusByElement.get('kim')).toBeCloseTo(1.15, 5);
  });

  it('kim_phach_dao → damageBonusByElement[moc] = 1.15 (Phase 11.X.AM kim khắc moc)', () => {
    const mods = composePassiveTalentMods(['talent_kim_phach_dao']);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('moc_xuyen_dao → damageBonusByElement[tho] = 1.15 (Phase 11.X.AM moc khắc tho)', () => {
    const mods = composePassiveTalentMods(['talent_moc_xuyen_dao']);
    expect(mods.damageBonusByElement.get('tho')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('thuy_diet_dao → damageBonusByElement[hoa] = 1.15 (Phase 11.X.AM thuy khắc hoa)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_diet_dao']);
    expect(mods.damageBonusByElement.get('hoa')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('tho_chan_dao → damageBonusByElement[thuy] = 1.15 (Phase 11.X.AM tho khắc thuy)', () => {
    const mods = composePassiveTalentMods(['talent_tho_chan_dao']);
    expect(mods.damageBonusByElement.get('thuy')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('combine all 5 tương khắc damage_bonus producers → 5 distinct entries each 1.15 (5-element tương khắc chain coverage, hoàn tất Phase 11.X.AM)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_phach_dao',
      'talent_moc_xuyen_dao',
      'talent_thuy_diet_dao',
      'talent_hoa_tam_dao',
      'talent_tho_chan_dao',
    ]);
    // Hoàn tất 5-element tương khắc chain damage_bonus coverage:
    // kim → moc, moc → tho, thuy → hoa, hoa → kim, tho → thuy.
    expect(mods.damageBonusByElement.size).toBe(5);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.get('tho')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.get('hoa')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.get('kim')).toBeCloseTo(1.15, 5);
    expect(mods.damageBonusByElement.get('thuy')).toBeCloseTo(1.15, 5);
    // Cross-stat: stat mods giữ identity vì chỉ damage_bonus path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
  });

  it('kim_linh_quy → hpRegenFlat = 5 (Phase 11.X.AN producer thứ 2 cho hpRegen, mở đầu fill 5-element hpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_kim_linh_quy']);
    expect(mods.hpRegenFlat).toBe(5);
    // Verify isolation: chỉ regen path bị tác động, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('thuy_linh_quy → hpRegenFlat = 5 (Phase 11.X.AN producer thứ 3 cho hpRegen, fill 5-element hpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_linh_quy']);
    expect(mods.hpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_linh_quy → hpRegenFlat = 5 (Phase 11.X.AN producer thứ 4 cho hpRegen, fill 5-element hpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_linh_quy']);
    expect(mods.hpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('tho_linh_quy → hpRegenFlat = 5 (Phase 11.X.AN producer thứ 5 cho hpRegen, hoàn tất 5-element hpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_tho_linh_quy']);
    expect(mods.hpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 hpRegen producers (moc + kim + thuy + hoa + tho) → hpRegenFlat = 5 × 5 = 25 (5-element hpRegen ceiling, hoàn tất Phase 11.X.AN)', () => {
    const mods = composePassiveTalentMods([
      'talent_moc_linh_quy',
      'talent_kim_linh_quy',
      'talent_thuy_linh_quy',
      'talent_hoa_linh_quy',
      'talent_tho_linh_quy',
    ]);
    // Hoàn tất 5-element hpRegen coverage roadmap. Additive (không multiplicative)
    // — khác với atk/def/hpMax/spirit ceiling 1.61051.
    expect(mods.hpRegenFlat).toBe(25);
    // Cross-stat: stat mods + damage_bonus giữ identity vì chỉ regen path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('kim_linh_hai → mpMaxMul = 1.1 (Phase 11.X.AO producer thứ 1 cho mpMax, mở đầu fill 5-element mpMax coverage)', () => {
    const mods = composePassiveTalentMods(['talent_kim_linh_hai']);
    expect(mods.mpMaxMul).toBeCloseTo(1.1, 5);
    // Verify isolation: chỉ mpMax stat_mod path active, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('thuy_linh_hai → mpMaxMul = 1.1 (Phase 11.X.AO producer thứ 2 cho mpMax, fill 5-element mpMax coverage)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_linh_hai']);
    expect(mods.mpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('moc_linh_hai → mpMaxMul = 1.1 (Phase 11.X.AO producer thứ 3 cho mpMax, fill 5-element mpMax coverage)', () => {
    const mods = composePassiveTalentMods(['talent_moc_linh_hai']);
    expect(mods.mpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_linh_hai → mpMaxMul = 1.1 (Phase 11.X.AO producer thứ 4 cho mpMax, fill 5-element mpMax coverage)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_linh_hai']);
    expect(mods.mpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('tho_linh_hai → mpMaxMul = 1.1 (Phase 11.X.AO producer thứ 5 cho mpMax, hoàn tất 5-element mpMax coverage)', () => {
    const mods = composePassiveTalentMods(['talent_tho_linh_hai']);
    expect(mods.mpMaxMul).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 mpMax producers (kim + thuy + moc + hoa + tho) → mpMaxMul = 1.1⁵ = 1.61051 (5-element ceiling, hoàn tất Phase 11.X.AO + 5/5 stat_mod path)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_linh_hai',
      'talent_thuy_linh_hai',
      'talent_moc_linh_hai',
      'talent_hoa_linh_hai',
      'talent_tho_linh_hai',
    ]);
    // Hoàn tất 5-element mpMax coverage roadmap; khớp atk/def/hpMax/spirit
    // ceiling 1.61051 (multiplicative). 5/5 stat_mod path đã có 5-element coverage.
    expect(mods.mpMaxMul).toBeCloseTo(1.61051, 5);
    // Cross-stat: các stat khác giữ identity vì chỉ mpMax path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('kim_linh_dan → mpRegenFlat = 5 (Phase 11.X.AP producer thứ 1 cho mpRegen, mở đầu fill 5-element mpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_kim_linh_dan']);
    expect(mods.mpRegenFlat).toBe(5);
    // Verify isolation: chỉ mpRegen path active, các stat khác giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('thuy_linh_dan → mpRegenFlat = 5 (Phase 11.X.AP producer thứ 2 cho mpRegen, fill 5-element mpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_linh_dan']);
    expect(mods.mpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('moc_linh_dan → mpRegenFlat = 5 (Phase 11.X.AP producer thứ 3 cho mpRegen, fill 5-element mpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_moc_linh_dan']);
    expect(mods.mpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('hoa_linh_dan → mpRegenFlat = 5 (Phase 11.X.AP producer thứ 4 cho mpRegen, fill 5-element mpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_linh_dan']);
    expect(mods.mpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('tho_linh_dan → mpRegenFlat = 5 (Phase 11.X.AP producer thứ 5 cho mpRegen, hoàn tất 5-element mpRegen coverage)', () => {
    const mods = composePassiveTalentMods(['talent_tho_linh_dan']);
    expect(mods.mpRegenFlat).toBe(5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('combine all 5 mpRegen producers (kim + thuy + moc + hoa + tho) → mpRegenFlat = 5 × 5 = 25 (5-element mpRegen ceiling, hoàn tất Phase 11.X.AP + 2/2 regen path)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_linh_dan',
      'talent_thuy_linh_dan',
      'talent_moc_linh_dan',
      'talent_hoa_linh_dan',
      'talent_tho_linh_dan',
    ]);
    // Hoàn tất 5-element mpRegen coverage roadmap. Additive (không multiplicative)
    // — đối xứng với 5-element hpRegen ceiling 25 (Phase 11.X.AN). 2/2 regen path
    // đã có 5-element coverage.
    expect(mods.mpRegenFlat).toBe(25);
    // Cross-stat: stat mods + hpRegen + damage_bonus giữ identity vì chỉ mpRegen path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('kim_sinh_dao → damageBonusByElement[thuy] = 1.1 (Phase 11.X.AQ producer thứ 1 chain tương sinh, kim sinh thuỷ)', () => {
    const mods = composePassiveTalentMods(['talent_kim_sinh_dao']);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.damageBonusByElement.get('thuy')).toBeCloseTo(1.1, 5);
    // Cross-stat: stat_mod + regen + damage_bonus khác element giữ identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('thuy_sinh_dao → damageBonusByElement[moc] = 1.1 (Phase 11.X.AQ producer thứ 2 chain tương sinh, thuỷ sinh mộc)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_sinh_dao']);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('moc_sinh_dao → damageBonusByElement[hoa] = 1.1 (Phase 11.X.AQ producer thứ 3 chain tương sinh, mộc sinh hoả)', () => {
    const mods = composePassiveTalentMods(['talent_moc_sinh_dao']);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.damageBonusByElement.get('hoa')).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('hoa_sinh_dao → damageBonusByElement[tho] = 1.1 (Phase 11.X.AQ producer thứ 4 chain tương sinh, hoả sinh thổ)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_sinh_dao']);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.damageBonusByElement.get('tho')).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('tho_sinh_dao → damageBonusByElement[kim] = 1.1 (Phase 11.X.AQ producer thứ 5 chain tương sinh, thổ sinh kim)', () => {
    const mods = composePassiveTalentMods(['talent_tho_sinh_dao']);
    expect(mods.damageBonusByElement.size).toBe(1);
    expect(mods.damageBonusByElement.get('kim')).toBeCloseTo(1.1, 5);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('combine all 5 tương sinh producers → 5 distinct elementTargets {thuy/moc/hoa/tho/kim} = 1.1 each (hoàn tất 5-element tương sinh chain Phase 11.X.AQ)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_sinh_dao',
      'talent_thuy_sinh_dao',
      'talent_moc_sinh_dao',
      'talent_hoa_sinh_dao',
      'talent_tho_sinh_dao',
    ]);
    // Tương sinh chain: kim→thuy, thuy→moc, moc→hoa, hoa→tho, tho→kim.
    // Mỗi target distinct, không multiplicative stack vì chỉ 1 producer per target.
    expect(mods.damageBonusByElement.size).toBe(5);
    expect(mods.damageBonusByElement.get('thuy')).toBeCloseTo(1.1, 5);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.1, 5);
    expect(mods.damageBonusByElement.get('hoa')).toBeCloseTo(1.1, 5);
    expect(mods.damageBonusByElement.get('tho')).toBeCloseTo(1.1, 5);
    expect(mods.damageBonusByElement.get('kim')).toBeCloseTo(1.1, 5);
    // Cross-stat: stat_mod + regen identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('combine 5 tương khắc + 5 tương sinh producers → damageBonusByElement size = 5 với 4 multiplicative stack 1.15×1.1 = 1.265 + 1 single-source (kim) (2/2 damage_bonus chain complete)', () => {
    // 5 tương khắc producer (Phase 11.X.AM):
    //   kim→moc, thuy→hoa, moc→tho, hoa→kim, tho→thuy (đều 1.15)
    // 5 tương sinh producer (this phase 11.X.AQ):
    //   kim→thuy, thuy→moc, moc→hoa, hoa→tho, tho→kim (đều 1.1)
    // Targets union:
    //   moc: kim_phach_dao (1.15) only
    //   hoa: thuy_diet_dao (1.15) only
    //   tho: moc_xuyen_dao (1.15) only
    //   thuy: tho_chan_dao (1.15) + kim_sinh_dao (1.1) → 1.15 × 1.1 = 1.265
    //   kim: hoa_tam_dao (1.15) + tho_sinh_dao (1.1) → 1.265
    //   moc: kim_phach_dao (1.15) + thuy_sinh_dao (1.1) → 1.265
    //   hoa: thuy_diet_dao (1.15) + moc_sinh_dao (1.1) → 1.265
    //   tho: moc_xuyen_dao (1.15) + hoa_sinh_dao (1.1) → 1.265
    // → all 5 elements get 1.265 multiplicative stack, size = 5.
    const mods = composePassiveTalentMods([
      'talent_kim_phach_dao',
      'talent_thuy_diet_dao',
      'talent_moc_xuyen_dao',
      'talent_hoa_tam_dao',
      'talent_tho_chan_dao',
      'talent_kim_sinh_dao',
      'talent_thuy_sinh_dao',
      'talent_moc_sinh_dao',
      'talent_hoa_sinh_dao',
      'talent_tho_sinh_dao',
    ]);
    expect(mods.damageBonusByElement.size).toBe(5);
    expect(mods.damageBonusByElement.get('kim')).toBeCloseTo(1.265, 5);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.265, 5);
    expect(mods.damageBonusByElement.get('thuy')).toBeCloseTo(1.265, 5);
    expect(mods.damageBonusByElement.get('hoa')).toBeCloseTo(1.265, 5);
    expect(mods.damageBonusByElement.get('tho')).toBeCloseTo(1.265, 5);
    // Cross-stat: stat_mod + regen identity.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('combine 5 hpRegen + 5 mpRegen producers → hpRegenFlat = 25 + mpRegenFlat = 25 (regen path symmetry, hpRegen + mpRegen độc lập theo statTarget)', () => {
    // 5 hpRegen producer (Phase 11.X.AN) + 5 mpRegen producer (Phase 11.X.AP)
    // → 2/2 regen path active đồng thời, isolated theo statTarget.
    const mods = composePassiveTalentMods([
      'talent_moc_linh_quy',
      'talent_kim_linh_quy',
      'talent_thuy_linh_quy',
      'talent_hoa_linh_quy',
      'talent_tho_linh_quy',
      'talent_kim_linh_dan',
      'talent_thuy_linh_dan',
      'talent_moc_linh_dan',
      'talent_hoa_linh_dan',
      'talent_tho_linh_dan',
    ]);
    expect(mods.hpRegenFlat).toBe(25);
    expect(mods.mpRegenFlat).toBe(25);
    // Cross-stat: stat mods + damage_bonus giữ identity vì chỉ regen path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('thien_di → dropMul = 1.2', () => {
    const mods = composePassiveTalentMods(['talent_thien_di']);
    expect(mods.dropMul).toBeCloseTo(1.2, 5);
  });

  it('ngo_dao → expMul = 1.15', () => {
    const mods = composePassiveTalentMods(['talent_ngo_dao']);
    expect(mods.expMul).toBeCloseTo(1.15, 5);
  });

  it('combine 2 stat_mod khác target → cùng multiplicative path nhưng isolated by statTarget', () => {
    // 2 talent khác statTarget (atk vs hpMax) → mỗi statTarget multiplicative
    // độc lập: atkMul=1.1, hpMaxMul=1.1, không cross-stat overlap.
    const mods = composePassiveTalentMods([
      'talent_kim_thien_co', // atk × 1.1
      'talent_thuy_long_an', // hpMax × 1.1
    ]);
    expect(mods.atkMul).toBeCloseTo(1.1, 5);
    expect(mods.hpMaxMul).toBeCloseTo(1.1, 5);
  });

  it('ignore active talent key', () => {
    const mods = composePassiveTalentMods(['talent_kim_quang_tram']);
    expect(mods.atkMul).toBe(1);
  });

  it('ignore invalid talent key', () => {
    const mods = composePassiveTalentMods(['talent_invalid_key']);
    expect(mods.atkMul).toBe(1);
  });

  // Phase 11.6.D — element_resist compose tests (5 producer
  // talent_<elem>_thien_giap, value=0.95 multiplicative per elementTarget).
  it('empty list → elementResistByElement empty Map (identity)', () => {
    const mods = composePassiveTalentMods([]);
    expect(mods.elementResistByElement.size).toBe(0);
  });

  it('kim_thien_giap → elementResistByElement[kim] = 0.95 (Phase 11.6.D producer kim resist)', () => {
    const mods = composePassiveTalentMods(['talent_kim_thien_giap']);
    expect(mods.elementResistByElement.get('kim')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.size).toBe(1);
    // Verify isolation: stat mods + damage_bonus giữ identity vì chỉ
    // element_resist path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  it('moc_thien_giap → elementResistByElement[moc] = 0.95 (Phase 11.6.D moc resist)', () => {
    const mods = composePassiveTalentMods(['talent_moc_thien_giap']);
    expect(mods.elementResistByElement.get('moc')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.size).toBe(1);
  });

  it('thuy_thien_giap → elementResistByElement[thuy] = 0.95 (Phase 11.6.D thuy resist)', () => {
    const mods = composePassiveTalentMods(['talent_thuy_thien_giap']);
    expect(mods.elementResistByElement.get('thuy')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.size).toBe(1);
  });

  it('hoa_thien_giap → elementResistByElement[hoa] = 0.95 (Phase 11.6.D hoa resist)', () => {
    const mods = composePassiveTalentMods(['talent_hoa_thien_giap']);
    expect(mods.elementResistByElement.get('hoa')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.size).toBe(1);
  });

  it('tho_thien_giap → elementResistByElement[tho] = 0.95 (Phase 11.6.D tho resist)', () => {
    const mods = composePassiveTalentMods(['talent_tho_thien_giap']);
    expect(mods.elementResistByElement.get('tho')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.size).toBe(1);
  });

  it('combine all 5 element_resist producers → 5 distinct entries each 0.95 (5-element resist coverage, hoàn tất Phase 11.6.D)', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_giap',
      'talent_moc_thien_giap',
      'talent_thuy_thien_giap',
      'talent_hoa_thien_giap',
      'talent_tho_thien_giap',
    ]);
    // Hoàn tất 5-element tribulation resist coverage. Per-element multiplicative
    // (mỗi entry độc lập) — khác với 5-element atk/def stack 1.1⁵=1.61051.
    expect(mods.elementResistByElement.size).toBe(5);
    expect(mods.elementResistByElement.get('kim')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.get('moc')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.get('thuy')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.get('hoa')).toBeCloseTo(0.95, 5);
    expect(mods.elementResistByElement.get('tho')).toBeCloseTo(0.95, 5);
    // Cross-stat: stat mods + damage_bonus giữ identity vì chỉ element_resist
    // path active.
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.damageBonusByElement.size).toBe(0);
  });

  // Hypothetical stack same element (catalog hiện chỉ 1 talent / element nhưng
  // future Equipment runtime có thể stack tiếp; verify multiplicative semantic).
  it('stack 2 hypothetical kim resist talent → 0.95 × 0.95 = 0.9025 (multiplicative per element)', () => {
    // Composer chỉ thấy talent đã học → 2 lần cùng key effectively là 1
    // talent (key dedupe ở persistence layer). Verify với 2 talent KHÁC nhưng
    // CÙNG elementTarget: catalog hiện không có 2 talent _resist cho cùng
    // element, nên test bằng cách gọi composer với same key 2 lần (phản
    // ánh đúng "dedupe expected — composer KHÔNG dedupe, chính persistence
    // mới dedupe").
    const mods = composePassiveTalentMods([
      'talent_kim_thien_giap',
      'talent_kim_thien_giap',
    ]);
    expect(mods.elementResistByElement.get('kim')).toBeCloseTo(0.9025, 5);
  });
});

describe('computePassiveTalentTribulationResist (Phase 11.6.D)', () => {
  it('null waveElement (Tâm Kiếp / vô hệ) → 1.0 fallback', () => {
    const mods = composePassiveTalentMods(['talent_kim_thien_giap']);
    expect(computePassiveTalentTribulationResist(mods, null)).toBe(1.0);
  });

  it('mods empty + element non-null → 1.0 identity', () => {
    const mods = composePassiveTalentMods([]);
    expect(computePassiveTalentTribulationResist(mods, 'kim')).toBe(1.0);
    expect(computePassiveTalentTribulationResist(mods, 'thuy')).toBe(1.0);
  });

  it('kim resist learned, wave kim → 0.95 (matched element, talent active)', () => {
    const mods = composePassiveTalentMods(['talent_kim_thien_giap']);
    expect(computePassiveTalentTribulationResist(mods, 'kim')).toBeCloseTo(
      0.95,
      5,
    );
  });

  it('kim resist learned, wave moc → 1.0 (mismatched element, no resist)', () => {
    const mods = composePassiveTalentMods(['talent_kim_thien_giap']);
    expect(computePassiveTalentTribulationResist(mods, 'moc')).toBe(1.0);
  });

  it('full 5-element stack → mỗi wave element có 0.95 resist độc lập', () => {
    const mods = composePassiveTalentMods([
      'talent_kim_thien_giap',
      'talent_moc_thien_giap',
      'talent_thuy_thien_giap',
      'talent_hoa_thien_giap',
      'talent_tho_thien_giap',
    ]);
    expect(computePassiveTalentTribulationResist(mods, 'kim')).toBeCloseTo(
      0.95,
      5,
    );
    expect(computePassiveTalentTribulationResist(mods, 'moc')).toBeCloseTo(
      0.95,
      5,
    );
    expect(computePassiveTalentTribulationResist(mods, 'thuy')).toBeCloseTo(
      0.95,
      5,
    );
    expect(computePassiveTalentTribulationResist(mods, 'hoa')).toBeCloseTo(
      0.95,
      5,
    );
    expect(computePassiveTalentTribulationResist(mods, 'tho')).toBeCloseTo(
      0.95,
      5,
    );
  });
});

describe('simulateActiveTalent', () => {
  const kimQuang = getTalentDef('talent_kim_quang_tram')!;
  const thuyYen = getTalentDef('talent_thuy_yen_nguc')!;
  const mocChu = getTalentDef('talent_moc_chu_lam')!;
  const hoaLong = getTalentDef('talent_hoa_long_phun')!;
  const phongLui = getTalentDef('talent_phong_lui')!;

  it('damage talent: damage = atk × value', () => {
    const r = simulateActiveTalent(kimQuang, 1000, 500);
    expect(r.damage).toBe(2000); // 1000 × 2.0
    expect(r.aoe).toBe(true);
    expect(r.heal).toBe(0);
    expect(r.ccTurns).toBe(0);
  });

  it('cc talent: ccTurns = value, không có damage', () => {
    const r = simulateActiveTalent(thuyYen, 1000, 500);
    expect(r.ccTurns).toBe(3);
    expect(r.damage).toBe(0);
    expect(r.aoe).toBe(false);
  });

  it('heal talent: heal = atk × value (Phase 11.7.B sẽ wire hpMax)', () => {
    const r = simulateActiveTalent(mocChu, 1000, 500);
    expect(r.heal).toBe(300); // 1000 × 0.3
    expect(r.damage).toBe(0);
  });

  it('dot talent: dotTurns = value', () => {
    const r = simulateActiveTalent(hoaLong, 1000, 500);
    expect(r.dotTurns).toBe(5);
    expect(r.damage).toBe(0);
  });

  it('utility talent: damage/heal/cc/dot = 0', () => {
    const r = simulateActiveTalent(phongLui, 1000, 500);
    expect(r.damage).toBe(0);
    expect(r.heal).toBe(0);
    expect(r.ccTurns).toBe(0);
    expect(r.dotTurns).toBe(0);
  });

  it('mpConsumed = activeEffect.mpCost', () => {
    const r = simulateActiveTalent(kimQuang, 1000, 500);
    expect(r.mpConsumed).toBe(30);
  });

  it('deterministic — cùng input cùng output', () => {
    const r1 = simulateActiveTalent(kimQuang, 1000, 500);
    const r2 = simulateActiveTalent(kimQuang, 1000, 500);
    expect(r1).toEqual(r2);
  });

  it('throw nếu talent không phải active', () => {
    const passive = getTalentDef('talent_kim_thien_co')!;
    expect(() => simulateActiveTalent(passive, 1000, 500)).toThrow();
  });

  it('throw nếu attackerAtk âm', () => {
    expect(() => simulateActiveTalent(kimQuang, -1, 500)).toThrow();
  });

  it('throw nếu attackerSpirit = NaN', () => {
    expect(() => simulateActiveTalent(kimQuang, 1000, NaN)).toThrow();
  });
});

describe('Talent point budget end-to-end', () => {
  it('endgame budget >= sum required talent point cost của 5 talent đầu (rough)', () => {
    const maxOrder = Math.max(...REALMS.map((r) => r.order));
    const budget = computeTalentPointBudget(maxOrder);
    // Ít nhất là 6 (mỗi 3 realm = 1 point, max ~20 realm)
    expect(budget).toBeGreaterThanOrEqual(5);
  });

  it('budget tăng monotonic theo order', () => {
    let prev = 0;
    for (const r of REALMS) {
      const cur = computeTalentPointBudget(r.order);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
