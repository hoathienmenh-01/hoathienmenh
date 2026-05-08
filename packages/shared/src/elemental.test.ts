/**
 * Phase 14.2.A — Elemental Combat Foundation tests.
 *
 * Bao phủ:
 *   1. ElementType ↔ ElementKey converter (round-trip, mapping cố định).
 *   2. parseElementType permissive input.
 *   3. elementalAdvantage cycle đầy đủ (counter / generate / countered /
 *      generated / same / neutral).
 *   4. elementalMultiplier giá trị numeric "nhẹ" (không phá balance).
 *   5. composeMonsterElementalResist defensive guards + floor clamp.
 *   6. composeEquipmentElementalAtkBonus stack additive + per-item cap +
 *      total cap.
 *   7. applyElementalCombatAdjustment pipeline 3-layer + clamp envelope.
 *   8. Foundation không phá balance: stack tối đa Phase 14.2.A bound trong
 *      [floor, ceil] tuyệt đối.
 */
import { describe, expect, it } from 'vitest';
import { ELEMENTS, type ElementKey } from './combat';
import {
  ELEMENT_COMBAT_ADJUSTMENT_CEIL,
  ELEMENT_COMBAT_ADJUSTMENT_FLOOR,
  ELEMENT_EQUIPMENT_ATK_BONUS_CEIL,
  ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL,
  ELEMENT_MONSTER_RESIST_FLOOR,
  ELEMENT_TYPES,
  applyElementalCombatAdjustment,
  composeEquipmentElementalAtkBonus,
  composeMonsterElementalResist,
  elementalAdvantage,
  elementalMultiplier,
  elementKeyToType,
  elementTypeToKey,
  parseElementType,
  type ElementType,
} from './elemental';

describe('ElementType ↔ ElementKey converter', () => {
  it('ELEMENT_TYPES có 5 entry English', () => {
    expect(ELEMENT_TYPES).toEqual(['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER']);
  });

  it('mapping cố định: WOOD↔moc, FIRE↔hoa, EARTH↔tho, METAL↔kim, WATER↔thuy', () => {
    expect(elementTypeToKey('WOOD')).toBe('moc');
    expect(elementTypeToKey('FIRE')).toBe('hoa');
    expect(elementTypeToKey('EARTH')).toBe('tho');
    expect(elementTypeToKey('METAL')).toBe('kim');
    expect(elementTypeToKey('WATER')).toBe('thuy');

    expect(elementKeyToType('moc')).toBe('WOOD');
    expect(elementKeyToType('hoa')).toBe('FIRE');
    expect(elementKeyToType('tho')).toBe('EARTH');
    expect(elementKeyToType('kim')).toBe('METAL');
    expect(elementKeyToType('thuy')).toBe('WATER');
  });

  it('round-trip identity: ElementType → ElementKey → ElementType', () => {
    for (const t of ELEMENT_TYPES) {
      expect(elementKeyToType(elementTypeToKey(t))).toBe(t);
    }
  });

  it('round-trip identity: ElementKey → ElementType → ElementKey', () => {
    for (const k of ELEMENTS) {
      expect(elementTypeToKey(elementKeyToType(k))).toBe(k);
    }
  });
});

describe('parseElementType', () => {
  it('null/undefined/empty → null', () => {
    expect(parseElementType(null)).toBeNull();
    expect(parseElementType(undefined)).toBeNull();
    expect(parseElementType('')).toBeNull();
  });

  it('English ElementType (uppercase) hợp lệ', () => {
    expect(parseElementType('WOOD')).toBe('WOOD');
    expect(parseElementType('FIRE')).toBe('FIRE');
  });

  it('English ElementType (lowercase) cũng parse được (permissive)', () => {
    expect(parseElementType('wood')).toBe('WOOD');
    expect(parseElementType('water')).toBe('WATER');
  });

  it('Vietnamese ElementKey lowercase → ElementType', () => {
    expect(parseElementType('moc')).toBe('WOOD');
    expect(parseElementType('hoa')).toBe('FIRE');
    expect(parseElementType('tho')).toBe('EARTH');
    expect(parseElementType('kim')).toBe('METAL');
    expect(parseElementType('thuy')).toBe('WATER');
  });

  it('garbage input → null', () => {
    expect(parseElementType('foo')).toBeNull();
    expect(parseElementType('xyz')).toBeNull();
  });
});

describe('elementalAdvantage — Ngũ Hành cycle', () => {
  // Tương khắc: kim → moc → tho → thuy → hoa → kim
  it('counter cycle: kim khắc moc, moc khắc tho, tho khắc thuy, thuy khắc hoa, hoa khắc kim', () => {
    expect(elementalAdvantage('kim', 'moc')).toBe('counter');
    expect(elementalAdvantage('moc', 'tho')).toBe('counter');
    expect(elementalAdvantage('tho', 'thuy')).toBe('counter');
    expect(elementalAdvantage('thuy', 'hoa')).toBe('counter');
    expect(elementalAdvantage('hoa', 'kim')).toBe('counter');
  });

  // Tương sinh: kim → thuy → moc → hoa → tho → kim
  it('generate cycle: kim sinh thuy, thuy sinh moc, moc sinh hoa, hoa sinh tho, tho sinh kim', () => {
    expect(elementalAdvantage('kim', 'thuy')).toBe('generate');
    expect(elementalAdvantage('thuy', 'moc')).toBe('generate');
    expect(elementalAdvantage('moc', 'hoa')).toBe('generate');
    expect(elementalAdvantage('hoa', 'tho')).toBe('generate');
    expect(elementalAdvantage('tho', 'kim')).toBe('generate');
  });

  it('countered (bị khắc): moc bị kim khắc → moc vs kim = countered', () => {
    expect(elementalAdvantage('moc', 'kim')).toBe('countered');
    expect(elementalAdvantage('tho', 'moc')).toBe('countered');
    expect(elementalAdvantage('thuy', 'tho')).toBe('countered');
    expect(elementalAdvantage('hoa', 'thuy')).toBe('countered');
    expect(elementalAdvantage('kim', 'hoa')).toBe('countered');
  });

  it('generated (được sinh): hoa được moc sinh → hoa vs moc = generated', () => {
    expect(elementalAdvantage('hoa', 'moc')).toBe('generated');
    expect(elementalAdvantage('tho', 'hoa')).toBe('generated');
    expect(elementalAdvantage('kim', 'tho')).toBe('generated');
    expect(elementalAdvantage('thuy', 'kim')).toBe('generated');
    expect(elementalAdvantage('moc', 'thuy')).toBe('generated');
  });

  it('same element → "same"', () => {
    for (const e of ELEMENTS) {
      expect(elementalAdvantage(e, e)).toBe('same');
    }
  });

  it('null attacker / defender → "neutral" (fallback)', () => {
    expect(elementalAdvantage(null, 'moc')).toBe('neutral');
    expect(elementalAdvantage('moc', null)).toBe('neutral');
    expect(elementalAdvantage(null, null)).toBe('neutral');
  });
});

describe('elementalMultiplier — Phase 14.2.A foundation balance', () => {
  it('counter (tương khắc) → > 1 (amplify) nhưng không quá mạnh', () => {
    const m = elementalMultiplier('kim', 'moc');
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThanOrEqual(1.5); // ELEMENT_MODIFIER_ABSOLUTE_CEIL
  });

  it('countered → < 1 (dampen) nhưng không quá yếu', () => {
    const m = elementalMultiplier('moc', 'kim');
    expect(m).toBeLessThan(1);
    expect(m).toBeGreaterThanOrEqual(0.6); // ELEMENT_MODIFIER_ABSOLUTE_FLOOR
  });

  it('same element → < 1 (lệch hệ slight dampen)', () => {
    const m = elementalMultiplier('kim', 'kim');
    expect(m).toBeLessThan(1);
  });

  it('null → 1.0 (neutral fallback)', () => {
    expect(elementalMultiplier(null, 'moc')).toBe(1);
    expect(elementalMultiplier('moc', null)).toBe(1);
    expect(elementalMultiplier(null, null)).toBe(1);
  });

  it('mọi cycle giá trị nằm trong envelope tuyệt đối [0.6, 1.5]', () => {
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        const m = elementalMultiplier(a, d);
        expect(m).toBeGreaterThanOrEqual(0.6);
        expect(m).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe('composeMonsterElementalResist', () => {
  it('skillElement null → 1.0 neutral (vô hệ skill)', () => {
    expect(composeMonsterElementalResist({ kim: 0.8 }, null)).toBe(1);
  });

  it('resist undefined → 1.0 neutral (legacy monster)', () => {
    expect(composeMonsterElementalResist(undefined, 'kim')).toBe(1);
  });

  it('resist empty map → 1.0 neutral', () => {
    expect(composeMonsterElementalResist({}, 'kim')).toBe(1);
  });

  it('resist không có element → 1.0 neutral', () => {
    expect(composeMonsterElementalResist({ hoa: 0.85 }, 'kim')).toBe(1);
  });

  it('resist có element → trả value', () => {
    expect(composeMonsterElementalResist({ kim: 0.85 }, 'kim')).toBeCloseTo(
      0.85,
      6,
    );
  });

  it('value < ELEMENT_MONSTER_RESIST_FLOOR → clamp về floor', () => {
    expect(
      composeMonsterElementalResist({ kim: 0.4 }, 'kim'),
    ).toBe(ELEMENT_MONSTER_RESIST_FLOOR);
    expect(
      composeMonsterElementalResist({ kim: 0.0 }, 'kim'),
    ).toBe(1); // 0 → invalid → fallback 1
  });

  it('value invalid (NaN/Infinity/âm) → 1.0 neutral', () => {
    expect(composeMonsterElementalResist({ kim: NaN }, 'kim')).toBe(1);
    expect(composeMonsterElementalResist({ kim: Infinity }, 'kim')).toBe(1);
    expect(composeMonsterElementalResist({ kim: -0.5 }, 'kim')).toBe(1);
  });

  it('value > 1 (vulnerability) chấp nhận để future PR', () => {
    expect(composeMonsterElementalResist({ kim: 1.2 }, 'kim')).toBeCloseTo(
      1.2,
      6,
    );
  });
});

describe('composeEquipmentElementalAtkBonus', () => {
  it('skillElement null → 0 (no bonus, vô hệ skill)', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [{ elementalAtkBonus: { kim: 0.05 } }],
        null,
      ),
    ).toBe(0);
  });

  it('empty list → 0', () => {
    expect(composeEquipmentElementalAtkBonus([], 'kim')).toBe(0);
  });

  it('list không có elementalAtkBonus field → 0 (legacy)', () => {
    expect(
      composeEquipmentElementalAtkBonus([{}, undefined, null], 'kim'),
    ).toBe(0);
  });

  it('1 item bonus 0.05 → 0.05', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [{ elementalAtkBonus: { kim: 0.05 } }],
        'kim',
      ),
    ).toBeCloseTo(0.05, 6);
  });

  it('2 item cùng element → stack additive', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [
          { elementalAtkBonus: { kim: 0.05 } },
          { elementalAtkBonus: { kim: 0.07 } },
        ],
        'kim',
      ),
    ).toBeCloseTo(0.12, 6);
  });

  it('per-item cap: 1 item bonus 0.5 → clamp về ELEMENT_EQUIPMENT_ATK_BONUS_CEIL', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [{ elementalAtkBonus: { kim: 0.5 } }],
        'kim',
      ),
    ).toBe(ELEMENT_EQUIPMENT_ATK_BONUS_CEIL);
  });

  it('total cap: 5 item × 0.10 = 0.50 → clamp về ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL', () => {
    const items = Array.from({ length: 5 }, () => ({
      elementalAtkBonus: { kim: 0.1 },
    }));
    expect(composeEquipmentElementalAtkBonus(items, 'kim')).toBe(
      ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL,
    );
  });

  it('skip item element khác', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [
          { elementalAtkBonus: { kim: 0.05 } },
          { elementalAtkBonus: { hoa: 0.07 } },
        ],
        'kim',
      ),
    ).toBeCloseTo(0.05, 6);
  });

  it('skip value invalid (NaN / Infinity / âm / 0)', () => {
    expect(
      composeEquipmentElementalAtkBonus(
        [
          { elementalAtkBonus: { kim: NaN } },
          { elementalAtkBonus: { kim: Infinity } },
          { elementalAtkBonus: { kim: -0.05 } },
          { elementalAtkBonus: { kim: 0 } },
          { elementalAtkBonus: { kim: 0.05 } },
        ],
        'kim',
      ),
    ).toBeCloseTo(0.05, 6);
  });
});

describe('applyElementalCombatAdjustment — pipeline', () => {
  it('all neutral → multiplier 1.0', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: null,
      targetElement: null,
    });
    expect(out.multiplier).toBe(1);
    expect(out.relation).toBe('neutral');
    expect(out.clamped).toBe(false);
  });

  it('counter no resist no bonus → multiplier = base counter (~1.3)', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'kim',
      targetElement: 'moc',
    });
    expect(out.relation).toBe('counter');
    expect(out.multiplier).toBeGreaterThan(1);
    expect(out.multiplier).toBeLessThanOrEqual(ELEMENT_COMBAT_ADJUSTMENT_CEIL);
    expect(out.monsterResistMultiplier).toBe(1);
    expect(out.equipmentBonus).toBe(0);
  });

  it('counter + monster resist 0.85 → reduce', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'kim',
      targetElement: 'moc',
      monsterElementalResist: { kim: 0.85 },
    });
    expect(out.monsterResistMultiplier).toBeCloseTo(0.85, 6);
    expect(out.multiplier).toBeCloseTo(out.baseMultiplier * 0.85, 4);
  });

  it('counter + equip bonus 0.07 → amplify additive', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'kim',
      targetElement: 'moc',
      equipmentBonuses: [{ elementalAtkBonus: { kim: 0.07 } }],
    });
    expect(out.equipmentBonus).toBeCloseTo(0.07, 6);
    expect(out.multiplier).toBeCloseTo(out.baseMultiplier * 1.07, 4);
  });

  it('full stack counter × resist × bonus → compose multiplicatively', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'kim',
      targetElement: 'moc',
      monsterElementalResist: { kim: 0.85 },
      equipmentBonuses: [{ elementalAtkBonus: { kim: 0.07 } }],
    });
    expect(out.multiplier).toBeCloseTo(
      out.baseMultiplier * 0.85 * 1.07,
      4,
    );
  });

  it('countered + max equip bonus → vẫn dampen (foundation không phá balance)', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'moc',
      targetElement: 'kim',
      equipmentBonuses: [
        { elementalAtkBonus: { moc: 0.1 } },
        { elementalAtkBonus: { moc: 0.1 } },
        { elementalAtkBonus: { moc: 0.1 } },
      ],
    });
    expect(out.multiplier).toBeLessThan(1);
  });

  it('clamp ceil: counter + max equip bonus + vulnerable monster (>1) → cap về CEIL', () => {
    const out = applyElementalCombatAdjustment({
      skillElement: 'kim',
      targetElement: 'moc',
      monsterElementalResist: { kim: 1.4 },
      equipmentBonuses: Array.from({ length: 5 }, () => ({
        elementalAtkBonus: { kim: 0.1 },
      })),
    });
    // 1.3 × 1.4 × 1.2 = 2.184 > 1.6 → clamp
    expect(out.multiplier).toBe(ELEMENT_COMBAT_ADJUSTMENT_CEIL);
    expect(out.clamped).toBe(true);
  });

  it('clamp floor: countered + monster resist mạnh → cap về FLOOR', () => {
    // moc vs kim countered base ~0.7 × monster resist clamp 0.7 = 0.49 < 0.5 → clamp
    const out = applyElementalCombatAdjustment({
      skillElement: 'moc',
      targetElement: 'kim',
      monsterElementalResist: { moc: 0.7 },
    });
    expect(out.multiplier).toBe(ELEMENT_COMBAT_ADJUSTMENT_FLOOR);
    expect(out.clamped).toBe(true);
  });

  it('mọi cycle x mọi monster resist trong envelope → multiplier ∈ [FLOOR, CEIL]', () => {
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        for (const r of [0.7, 0.85, 1.0]) {
          for (const b of [0, 0.1, 0.2]) {
            const items = b > 0
              ? [{ elementalAtkBonus: { [a]: b / 2 } as Partial<Record<ElementKey, number>> },
                 { elementalAtkBonus: { [a]: b / 2 } as Partial<Record<ElementKey, number>> }]
              : [];
            const out = applyElementalCombatAdjustment({
              skillElement: a,
              targetElement: d,
              monsterElementalResist: { [a]: r },
              equipmentBonuses: items,
            });
            expect(out.multiplier).toBeGreaterThanOrEqual(
              ELEMENT_COMBAT_ADJUSTMENT_FLOOR,
            );
            expect(out.multiplier).toBeLessThanOrEqual(
              ELEMENT_COMBAT_ADJUSTMENT_CEIL,
            );
          }
        }
      }
    }
  });
});

describe('Phase 14.2.A — Balance dial sanity', () => {
  it('ELEMENT_MONSTER_RESIST_FLOOR đủ rộng để không phá tier (≥ 0.5)', () => {
    expect(ELEMENT_MONSTER_RESIST_FLOOR).toBeGreaterThanOrEqual(0.5);
    expect(ELEMENT_MONSTER_RESIST_FLOOR).toBeLessThanOrEqual(1);
  });

  it('ELEMENT_EQUIPMENT_ATK_BONUS_CEIL không vượt character primary affinity (0.10)', () => {
    expect(ELEMENT_EQUIPMENT_ATK_BONUS_CEIL).toBeLessThanOrEqual(0.1);
  });

  it('ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL ≥ per-item cap (cho phép stack)', () => {
    expect(ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL).toBeGreaterThanOrEqual(
      ELEMENT_EQUIPMENT_ATK_BONUS_CEIL,
    );
  });

  it('Adjustment envelope chặt hơn balance-dials envelope (anti over-amplify)', () => {
    expect(ELEMENT_COMBAT_ADJUSTMENT_FLOOR).toBeLessThanOrEqual(0.6);
    expect(ELEMENT_COMBAT_ADJUSTMENT_CEIL).toBeGreaterThanOrEqual(1.5);
    // Cho phép Phase 11 chain compose qua Phase 14.2.A pipeline mà không lệch
    // khỏi `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6, CEIL=1.5]` ở balance-dials.
    expect(ELEMENT_COMBAT_ADJUSTMENT_FLOOR).toBeLessThan(
      ELEMENT_COMBAT_ADJUSTMENT_CEIL,
    );
  });
});

describe('Phase 14.2.A — Type-level smoke', () => {
  it('ElementType là union literal', () => {
    const t: ElementType = 'WOOD';
    expect(t).toBe('WOOD');
  });
});
