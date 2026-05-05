/**
 * Phase 11.6.E — Equipment elemental tribulation resist.
 *
 * Pure shared helpers tested:
 *   - `composeEquippedItemElementResist(bonuses)` — fold list ItemBonus thành
 *     ReadonlyMap<ElementKey, number> stack multiplicatively per element.
 *   - `computeEquipmentTribulationResist(equipMods, waveElement)` — derive
 *     multiplier cho 1 wave element (`null` element → 1.0).
 *
 * Catalog invariant tests:
 *   - 5 armor `huyen_giap_phong_<elem>` tồn tại với element resist key đúng
 *     element + value khớp `EQUIPMENT_ELEMENT_RESIST_VALUE`.
 *   - Stat budget ≤ HUYEN cap (đã verify ở items-balance.test.ts), bonus power
 *     đánh đổi vs raw HUYEN armor (han_thiet_giap).
 *   - `ItemBonus.elementResist` keys ∈ ELEMENTS (anti-typo).
 */
import { describe, it, expect } from 'vitest';
import { ELEMENTS, type ElementKey } from './combat';
import {
  composeEquippedItemElementResist,
  computeEquipmentTribulationResist,
  ITEMS,
  itemByKey,
  type ItemBonus,
} from './items';
import {
  EQUIPMENT_ELEMENT_RESIST_VALUE,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
} from './balance-dials';

describe('composeEquippedItemElementResist — empty / no resist', () => {
  it('empty list → empty map (identity)', () => {
    const out = composeEquippedItemElementResist([]);
    expect(out.size).toBe(0);
  });

  it('list không có elementResist field → empty map', () => {
    const bonuses: ItemBonus[] = [
      { atk: 10 },
      { def: 5, hpMax: 50 },
      { spirit: 8 },
    ];
    const out = composeEquippedItemElementResist(bonuses);
    expect(out.size).toBe(0);
  });

  it('list có elementResist field rỗng (`{}`) → empty map', () => {
    const bonuses: ItemBonus[] = [{ elementResist: {} }];
    const out = composeEquippedItemElementResist(bonuses);
    expect(out.size).toBe(0);
  });
});

describe('composeEquippedItemElementResist — single + multi-element', () => {
  it('1 item resist hệ kim → map có 1 entry kim', () => {
    const out = composeEquippedItemElementResist([
      { def: 22, elementResist: { kim: 0.95 } },
    ]);
    expect(out.size).toBe(1);
    expect(out.get('kim')).toBeCloseTo(0.95, 6);
  });

  it('1 item multi-element resist (kim + hoa) → map có 2 entry', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: 0.9, hoa: 0.85 } },
    ]);
    expect(out.size).toBe(2);
    expect(out.get('kim')).toBeCloseTo(0.9, 6);
    expect(out.get('hoa')).toBeCloseTo(0.85, 6);
  });

  it('2 item cùng element → stack multiplicatively', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: 0.95 } },
      { elementResist: { kim: 0.9 } },
    ]);
    expect(out.size).toBe(1);
    // 0.95 × 0.9 = 0.855
    expect(out.get('kim')).toBeCloseTo(0.855, 6);
  });

  it('2 item khác element → map có 2 entry độc lập', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: 0.95 } },
      { elementResist: { hoa: 0.92 } },
    ]);
    expect(out.size).toBe(2);
    expect(out.get('kim')).toBeCloseTo(0.95, 6);
    expect(out.get('hoa')).toBeCloseTo(0.92, 6);
  });

  it('5-stack equipment same element → 0.95⁵ ≈ 0.7738', () => {
    const out = composeEquippedItemElementResist(
      Array.from({ length: 5 }, () => ({ elementResist: { kim: 0.95 } })),
    );
    expect(out.get('kim')).toBeCloseTo(0.7738, 4);
    // Vẫn cao hơn ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6 trước khi clamp.
    expect(out.get('kim')!).toBeGreaterThan(ELEMENT_MODIFIER_ABSOLUTE_FLOOR);
  });

  it('input order không ảnh hưởng kết quả (commutative)', () => {
    const a = composeEquippedItemElementResist([
      { elementResist: { kim: 0.95 } },
      { elementResist: { kim: 0.9 } },
      { elementResist: { kim: 0.85 } },
    ]);
    const b = composeEquippedItemElementResist([
      { elementResist: { kim: 0.85 } },
      { elementResist: { kim: 0.95 } },
      { elementResist: { kim: 0.9 } },
    ]);
    expect(a.get('kim')).toBeCloseTo(b.get('kim')!, 6);
  });
});

describe('composeEquippedItemElementResist — defensive guards', () => {
  it('skip undefined value (TS partial record)', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: undefined, hoa: 0.95 } },
    ]);
    expect(out.size).toBe(1);
    expect(out.get('hoa')).toBeCloseTo(0.95, 6);
  });

  it('skip 0 / âm value (anti silent identity)', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: 0 } },
      { elementResist: { hoa: -0.1 } },
      { elementResist: { thuy: 0.95 } },
    ]);
    expect(out.size).toBe(1);
    expect(out.get('thuy')).toBeCloseTo(0.95, 6);
  });

  it('skip NaN / Infinity value', () => {
    const out = composeEquippedItemElementResist([
      { elementResist: { kim: NaN } },
      { elementResist: { hoa: Infinity } },
      { elementResist: { tho: 0.95 } },
    ]);
    expect(out.size).toBe(1);
    expect(out.get('tho')).toBeCloseTo(0.95, 6);
  });
});

describe('computeEquipmentTribulationResist', () => {
  it('null wave element → fallback 1.0 (no resist)', () => {
    const mods = new Map<ElementKey, number>([['kim', 0.9]]);
    expect(computeEquipmentTribulationResist(mods, null)).toBe(1.0);
  });

  it('wave element không có trong mods → fallback 1.0 (identity)', () => {
    const mods = new Map<ElementKey, number>([['kim', 0.9]]);
    expect(computeEquipmentTribulationResist(mods, 'hoa')).toBe(1.0);
  });

  it('wave element khớp mods → return stored multiplier', () => {
    const mods = new Map<ElementKey, number>([['kim', 0.9]]);
    expect(computeEquipmentTribulationResist(mods, 'kim')).toBeCloseTo(0.9, 6);
  });

  it('empty mods → mọi wave fallback 1.0', () => {
    const mods = new Map<ElementKey, number>();
    for (const e of ELEMENTS) {
      expect(computeEquipmentTribulationResist(mods, e)).toBe(1.0);
    }
    expect(computeEquipmentTribulationResist(mods, null)).toBe(1.0);
  });
});

describe('Catalog — huyen_giap_phong_<elem> Phase 11.6.E armor', () => {
  for (const elem of ELEMENTS) {
    it(`huyen_giap_phong_${elem} tồn tại và elementResist[${elem}] = EQUIPMENT_ELEMENT_RESIST_VALUE`, () => {
      const def = itemByKey(`huyen_giap_phong_${elem}`);
      expect(def, `missing armor huyen_giap_phong_${elem}`).toBeDefined();
      expect(def!.kind).toBe('ARMOR');
      expect(def!.quality).toBe('HUYEN');
      expect(def!.slot).toBe('ARMOR');
      expect(def!.bonuses).toBeDefined();
      expect(def!.bonuses!.elementResist).toBeDefined();
      expect(def!.bonuses!.elementResist![elem]).toBeCloseTo(
        EQUIPMENT_ELEMENT_RESIST_VALUE,
        6,
      );
    });
  }

  it('huyen_giap_phong_<elem> có 5 catalog entry (mỗi element 1)', () => {
    const armors = ITEMS.filter(
      (i) => i.kind === 'ARMOR' && i.key.startsWith('huyen_giap_phong_'),
    );
    expect(armors.length).toBe(5);
  });

  it('mọi armor elementResist key ∈ ELEMENTS (anti-typo)', () => {
    for (const item of ITEMS) {
      const er = item.bonuses?.elementResist;
      if (!er) continue;
      for (const k of Object.keys(er)) {
        expect(ELEMENTS, `${item.key}.elementResist key ${k} không hợp lệ`).toContain(
          k as ElementKey,
        );
      }
    }
  });

  it('mọi armor elementResist value ∈ (0, 1] (resist không vượt identity)', () => {
    for (const item of ITEMS) {
      const er = item.bonuses?.elementResist;
      if (!er) continue;
      for (const [k, v] of Object.entries(er)) {
        if (v === undefined) continue;
        expect(v, `${item.key}.elementResist.${k} âm hoặc 0`).toBeGreaterThan(0);
        expect(
          v,
          `${item.key}.elementResist.${k} > 1 (vượt identity, không phải resist)`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Catalog → composer end-to-end', () => {
  it('compose 5-element giáp phòng kiếp → map 5 entry, mỗi value = 0.95', () => {
    const armors = ELEMENTS.map((e) =>
      itemByKey(`huyen_giap_phong_${e}`)!,
    );
    const bonuses = armors.map((a) => a.bonuses!);
    const out = composeEquippedItemElementResist(bonuses);
    expect(out.size).toBe(5);
    for (const e of ELEMENTS) {
      expect(out.get(e)).toBeCloseTo(EQUIPMENT_ELEMENT_RESIST_VALUE, 6);
    }
  });

  it('compose chỉ 1 giáp Kim + tribulation Mộc → equipment resist = 1.0 (identity)', () => {
    const armor = itemByKey('huyen_giap_phong_kim')!;
    const out = composeEquippedItemElementResist([armor.bonuses!]);
    expect(computeEquipmentTribulationResist(out, 'moc')).toBe(1.0);
  });

  it('compose 1 giáp Kim + tribulation Kim → equipment resist = 0.95', () => {
    const armor = itemByKey('huyen_giap_phong_kim')!;
    const out = composeEquippedItemElementResist([armor.bonuses!]);
    expect(computeEquipmentTribulationResist(out, 'kim')).toBeCloseTo(0.95, 6);
  });
});
