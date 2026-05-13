/**
 * QOL-1 — Unit test cho pure-function inventory sort & filter.
 */
import { describe, expect, it } from 'vitest';
import {
  SORT_PRESETS,
  compareInventory,
  filterInventory,
  isSortPresetKey,
  rankKind,
  rankQuality,
  rankTier,
  sortInventory,
  type InventorySortableRow,
} from './inventory-sort';

function row(
  overrides: Partial<InventorySortableRow> & { id: string },
): InventorySortableRow {
  return {
    id: overrides.id,
    itemKey: overrides.itemKey ?? overrides.id,
    qty: overrides.qty ?? 1,
    locked: overrides.locked ?? false,
    createdAt: overrides.createdAt ?? new Date('2025-01-01T00:00:00Z'),
    refineLevel: overrides.refineLevel ?? 0,
    enchantElement: overrides.enchantElement ?? null,
    item: {
      kind: overrides.item?.kind ?? 'MISC',
      quality: overrides.item?.quality ?? 'PHAM',
      equipmentTier: overrides.item?.equipmentTier,
      name: overrides.item?.name,
      nameVi: overrides.item?.nameVi,
    },
  };
}

describe('rank helpers', () => {
  it('rankKind: WEAPON < ARMOR < PILL_HP < MISC', () => {
    expect(rankKind('WEAPON')).toBeLessThan(rankKind('ARMOR'));
    expect(rankKind('ARMOR')).toBeLessThan(rankKind('PILL_HP'));
    expect(rankKind('PILL_HP')).toBeLessThan(rankKind('MISC'));
  });

  it('rankQuality: THAN > TIEN > HUYEN > LINH > PHAM', () => {
    expect(rankQuality('THAN')).toBeGreaterThan(rankQuality('TIEN'));
    expect(rankQuality('TIEN')).toBeGreaterThan(rankQuality('HUYEN'));
    expect(rankQuality('HUYEN')).toBeGreaterThan(rankQuality('LINH'));
    expect(rankQuality('LINH')).toBeGreaterThan(rankQuality('PHAM'));
  });

  it('rankTier: invalid → 0', () => {
    expect(rankTier(undefined)).toBe(0);
    expect(rankTier(null)).toBe(0);
    expect(rankTier(0)).toBe(0);
    expect(rankTier(-5)).toBe(0);
    expect(rankTier(NaN)).toBe(0);
    expect(rankTier(7.4)).toBe(7);
  });
});

describe('compareInventory — primary key', () => {
  it('locked desc → locked row trước', () => {
    const a = row({ id: 'a', locked: true });
    const b = row({ id: 'b', locked: false });
    expect(
      compareInventory(a, b, [{ key: 'locked', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('quality desc → THAN trước PHAM', () => {
    const a = row({ id: 'a', item: { kind: 'WEAPON', quality: 'THAN' } });
    const b = row({ id: 'b', item: { kind: 'WEAPON', quality: 'PHAM' } });
    expect(
      compareInventory(a, b, [{ key: 'quality', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('tier desc → cao trước', () => {
    const a = row({
      id: 'a',
      item: { kind: 'WEAPON', quality: 'LINH', equipmentTier: 8 },
    });
    const b = row({
      id: 'b',
      item: { kind: 'WEAPON', quality: 'LINH', equipmentTier: 2 },
    });
    expect(
      compareInventory(a, b, [{ key: 'tier', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('level desc → refine 15 trước refine 0', () => {
    const a = row({ id: 'a', refineLevel: 15 });
    const b = row({ id: 'b', refineLevel: 0 });
    expect(
      compareInventory(a, b, [{ key: 'level', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('acquiredAt desc → mới nhất trước', () => {
    const a = row({ id: 'a', createdAt: new Date('2025-06-01') });
    const b = row({ id: 'b', createdAt: new Date('2024-12-01') });
    expect(
      compareInventory(a, b, [{ key: 'acquiredAt', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('acquiredAt accept string isoDate', () => {
    const a = row({ id: 'a', createdAt: '2025-06-01T00:00:00.000Z' });
    const b = row({ id: 'b', createdAt: '2024-12-01T00:00:00.000Z' });
    expect(
      compareInventory(a, b, [{ key: 'acquiredAt', dir: 'desc' }]),
    ).toBeLessThan(0);
  });

  it('element asc — null xếp cuối', () => {
    const a = row({ id: 'a', enchantElement: 'kim' });
    const b = row({ id: 'b', enchantElement: null });
    expect(
      compareInventory(a, b, [{ key: 'element', dir: 'asc' }]),
    ).toBeLessThan(0);
  });

  it('kind asc — WEAPON trước MISC', () => {
    const a = row({ id: 'a', item: { kind: 'WEAPON', quality: 'PHAM' } });
    const b = row({ id: 'b', item: { kind: 'MISC', quality: 'PHAM' } });
    expect(
      compareInventory(a, b, [{ key: 'kind', dir: 'asc' }]),
    ).toBeLessThan(0);
  });
});

describe('compareInventory — multi-key tie-break', () => {
  it('cùng kind → quality tie-break', () => {
    const a = row({ id: 'a', item: { kind: 'WEAPON', quality: 'TIEN' } });
    const b = row({ id: 'b', item: { kind: 'WEAPON', quality: 'PHAM' } });
    const d = compareInventory(a, b, [
      { key: 'kind', dir: 'asc' },
      { key: 'quality', dir: 'desc' },
    ]);
    expect(d).toBeLessThan(0);
  });

  it('cùng kind + quality → tier tie-break', () => {
    const a = row({
      id: 'a',
      item: { kind: 'ARMOR', quality: 'LINH', equipmentTier: 9 },
    });
    const b = row({
      id: 'b',
      item: { kind: 'ARMOR', quality: 'LINH', equipmentTier: 4 },
    });
    const d = compareInventory(a, b, [
      { key: 'kind', dir: 'asc' },
      { key: 'quality', dir: 'desc' },
      { key: 'tier', dir: 'desc' },
    ]);
    expect(d).toBeLessThan(0);
  });

  it('tất cả tie → 0', () => {
    const a = row({ id: 'a' });
    const b = row({ id: 'b' });
    const d = compareInventory(a, b, SORT_PRESETS.default.slice());
    expect(d).toBe(0);
  });
});

describe('sortInventory — không mutate input', () => {
  it('immutable: input array giữ thứ tự', () => {
    const input: InventorySortableRow[] = [
      row({ id: 'a', refineLevel: 0 }),
      row({ id: 'b', refineLevel: 5 }),
    ];
    const beforeIds = input.map((r) => r.id);
    const out = sortInventory(input, [{ key: 'level', dir: 'desc' }]);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
    expect(input.map((r) => r.id)).toEqual(beforeIds);
  });

  it('default preset: locked first, kind asc, quality desc, tier desc, level desc, acquiredAt desc', () => {
    const input = [
      row({
        id: 'pill-old',
        item: { kind: 'PILL_HP', quality: 'PHAM' },
        createdAt: new Date('2024-01-01'),
      }),
      row({
        id: 'sword-than-new',
        item: { kind: 'WEAPON', quality: 'THAN', equipmentTier: 10 },
        createdAt: new Date('2025-06-01'),
      }),
      row({
        id: 'armor-locked-pham',
        locked: true,
        item: { kind: 'ARMOR', quality: 'PHAM', equipmentTier: 1 },
      }),
      row({
        id: 'sword-pham',
        item: { kind: 'WEAPON', quality: 'PHAM' },
      }),
    ];
    const out = sortInventory(input, SORT_PRESETS.default.slice());
    // locked đầu tiên (mặc dù quality PHAM thấp nhất).
    expect(out[0]?.id).toBe('armor-locked-pham');
    // sau locked, WEAPON trước ARMOR theo kind asc (nhưng locked là ARMOR
    // đã xếp đầu). Tiếp theo WEAPON THAN trước WEAPON PHAM.
    expect(out[1]?.id).toBe('sword-than-new');
    expect(out[2]?.id).toBe('sword-pham');
    expect(out[3]?.id).toBe('pill-old');
  });
});

describe('SORT_PRESETS', () => {
  it('isSortPresetKey: valid', () => {
    expect(isSortPresetKey('default')).toBe(true);
    expect(isSortPresetKey('newest')).toBe(true);
    expect(isSortPresetKey('quality')).toBe(true);
    expect(isSortPresetKey('tier')).toBe(true);
    expect(isSortPresetKey('level')).toBe(true);
    expect(isSortPresetKey('element')).toBe(true);
  });

  it('isSortPresetKey: reject invalid', () => {
    expect(isSortPresetKey('hack')).toBe(false);
    expect(isSortPresetKey(null)).toBe(false);
    expect(isSortPresetKey(undefined)).toBe(false);
    expect(isSortPresetKey(123)).toBe(false);
  });

  it('mỗi preset bắt đầu bằng locked desc (lock surfacing)', () => {
    for (const k of Object.keys(SORT_PRESETS) as (keyof typeof SORT_PRESETS)[]) {
      const preset = SORT_PRESETS[k];
      expect(preset[0]).toEqual({ key: 'locked', dir: 'desc' });
    }
  });
});

describe('filterInventory', () => {
  const items: InventorySortableRow[] = [
    row({
      id: 'a',
      locked: true,
      item: { kind: 'WEAPON', quality: 'LINH' },
      enchantElement: 'kim',
    }),
    row({
      id: 'b',
      locked: false,
      item: { kind: 'ARMOR', quality: 'PHAM' },
      enchantElement: null,
    }),
    row({
      id: 'c',
      locked: false,
      item: { kind: 'PILL_HP', quality: 'LINH' },
    }),
  ];

  it('locked=true → chỉ a', () => {
    const out = filterInventory(items, { locked: true });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('locked=false → b + c', () => {
    const out = filterInventory(items, { locked: false });
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('kind=WEAPON → chỉ a', () => {
    const out = filterInventory(items, { kind: 'WEAPON' });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('quality=LINH → a + c', () => {
    const out = filterInventory(items, { quality: 'LINH' });
    expect(out.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('element=null → b + c (c không enchant, b enchantElement=null)', () => {
    const out = filterInventory(items, { element: null });
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('element=kim → chỉ a', () => {
    const out = filterInventory(items, { element: 'kim' });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('multi filter (kind=ARMOR + locked=false) → b', () => {
    const out = filterInventory(items, { kind: 'ARMOR', locked: false });
    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('empty filter → identity copy', () => {
    const out = filterInventory(items, {});
    expect(out.map((r) => r.id)).toEqual(items.map((r) => r.id));
    expect(out).not.toBe(items);
  });

  it('filter không khớp → empty', () => {
    const out = filterInventory(items, { kind: 'ORE' });
    expect(out).toEqual([]);
  });
});
