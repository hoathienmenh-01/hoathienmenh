import { describe, expect, it } from 'vitest';
import type { ItemDef } from './items';
import {
  applyInventoryQolView,
  filterInventoryQol,
  INVENTORY_QOL_FILTER_BUCKETS,
  INVENTORY_QOL_SORT_KEYS,
  inventoryQolBucketOf,
  isQuestBoundItem,
  qualityWeight,
  shouldDefaultLockOnGrant,
  sortInventoryQol,
  type InventoryQolRow,
} from './inventory-qol';

function makeItem(over: Partial<ItemDef> = {}): ItemDef {
  return {
    key: over.key ?? 'so_kiem',
    name: over.name ?? 'Sơ Kiếm',
    description: over.description ?? '',
    kind: over.kind ?? 'WEAPON',
    quality: over.quality ?? 'PHAM',
    stackable: over.stackable ?? false,
    price: over.price ?? 0,
    marketTradeable: over.marketTradeable,
    bindOnPickup: over.bindOnPickup,
    ...over,
  };
}

function makeRow(over: Partial<InventoryQolRow> = {}): InventoryQolRow {
  return {
    id: over.id ?? 'inv-1',
    itemKey: over.itemKey ?? 'so_kiem',
    qty: over.qty ?? 1,
    equippedSlot: over.equippedSlot ?? null,
    locked: over.locked ?? false,
    createdAt: over.createdAt ?? new Date('2025-01-01'),
    item: over.item ?? makeItem(),
  };
}

describe('inventory-qol — catalog enums', () => {
  it('exposes the documented filter buckets', () => {
    expect(INVENTORY_QOL_FILTER_BUCKETS).toEqual([
      'all',
      'equipment',
      'artifact',
      'consumable',
      'material',
      'skill_book',
      'quest',
      'locked',
    ]);
  });

  it('exposes the documented sort keys', () => {
    expect(INVENTORY_QOL_SORT_KEYS).toEqual([
      'default',
      'quality_desc',
      'quality_asc',
      'kind',
      'equipped_first',
      'locked_first',
      'newest',
      'oldest',
    ]);
  });
});

describe('inventory-qol — quality weight', () => {
  it('PHAM=1 LINH=2 HUYEN=3 TIEN=4 THAN=5', () => {
    expect(qualityWeight('PHAM')).toBe(1);
    expect(qualityWeight('LINH')).toBe(2);
    expect(qualityWeight('HUYEN')).toBe(3);
    expect(qualityWeight('TIEN')).toBe(4);
    expect(qualityWeight('THAN')).toBe(5);
  });
});

describe('inventory-qol — bucketOf', () => {
  it('buckets equipment kinds under equipment', () => {
    expect(inventoryQolBucketOf(makeItem({ kind: 'WEAPON' }))).toBe('equipment');
    expect(inventoryQolBucketOf(makeItem({ kind: 'ARMOR' }))).toBe('equipment');
    expect(inventoryQolBucketOf(makeItem({ kind: 'BELT' }))).toBe('equipment');
    expect(inventoryQolBucketOf(makeItem({ kind: 'BOOTS' }))).toBe('equipment');
    expect(inventoryQolBucketOf(makeItem({ kind: 'HAT' }))).toBe('equipment');
    expect(inventoryQolBucketOf(makeItem({ kind: 'TRAM' }))).toBe('equipment');
  });

  it('buckets artifact / pill / ore / misc correctly', () => {
    expect(inventoryQolBucketOf(makeItem({ kind: 'ARTIFACT' }))).toBe('artifact');
    expect(inventoryQolBucketOf(makeItem({ kind: 'PILL_HP' }))).toBe('consumable');
    expect(inventoryQolBucketOf(makeItem({ kind: 'PILL_MP' }))).toBe('consumable');
    expect(inventoryQolBucketOf(makeItem({ kind: 'PILL_EXP' }))).toBe('consumable');
    expect(inventoryQolBucketOf(makeItem({ kind: 'SKILL_BOOK' }))).toBe('skill_book');
    expect(inventoryQolBucketOf(makeItem({ kind: 'ORE' }))).toBe('material');
    expect(inventoryQolBucketOf(makeItem({ kind: 'MISC' }))).toBe('material');
  });

  it('prefers quest bucket when quest-bound metadata is set', () => {
    const quest = makeItem({
      kind: 'WEAPON',
      marketTradeable: false,
      bindOnPickup: true,
    });
    expect(isQuestBoundItem(quest)).toBe(true);
    expect(inventoryQolBucketOf(quest)).toBe('quest');
  });

  it('does NOT mark untradeable-only or pickup-only items as quest', () => {
    expect(
      isQuestBoundItem(makeItem({ marketTradeable: false, bindOnPickup: false })),
    ).toBe(false);
    expect(
      isQuestBoundItem(makeItem({ marketTradeable: true, bindOnPickup: true })),
    ).toBe(false);
  });
});

describe('inventory-qol — filter', () => {
  const rows: InventoryQolRow[] = [
    makeRow({ id: 'eq', itemKey: 'so_kiem', item: makeItem({ kind: 'WEAPON' }) }),
    makeRow({
      id: 'pill',
      itemKey: 'hoi_xuan_dan',
      item: makeItem({ kind: 'PILL_HP', name: 'Hồi Xuân Đan' }),
    }),
    makeRow({
      id: 'locked-eq',
      itemKey: 'huyen_kiem',
      locked: true,
      item: makeItem({ kind: 'WEAPON', name: 'Huyền Kiếm', quality: 'LINH' }),
    }),
    makeRow({
      id: 'quest-key',
      itemKey: 'tien_thach_chia_khoa',
      item: makeItem({
        kind: 'MISC',
        marketTradeable: false,
        bindOnPickup: true,
        name: 'Chìa Khóa',
      }),
    }),
  ];

  it('all bucket returns everything', () => {
    expect(filterInventoryQol(rows, { bucket: 'all' }).map((r) => r.id)).toEqual([
      'eq',
      'pill',
      'locked-eq',
      'quest-key',
    ]);
  });

  it('equipment bucket filters non-equipment out', () => {
    expect(filterInventoryQol(rows, { bucket: 'equipment' }).map((r) => r.id)).toEqual([
      'eq',
      'locked-eq',
    ]);
  });

  it('locked bucket only keeps locked rows', () => {
    expect(filterInventoryQol(rows, { bucket: 'locked' }).map((r) => r.id)).toEqual([
      'locked-eq',
    ]);
  });

  it('quest bucket only keeps quest-bound rows', () => {
    expect(filterInventoryQol(rows, { bucket: 'quest' }).map((r) => r.id)).toEqual([
      'quest-key',
    ]);
  });

  it('search matches itemKey case-insensitively', () => {
    expect(filterInventoryQol(rows, { search: 'huyen' }).map((r) => r.id)).toEqual([
      'locked-eq',
    ]);
  });

  it('search matches name', () => {
    expect(filterInventoryQol(rows, { search: 'hồi' }).map((r) => r.id)).toEqual([
      'pill',
    ]);
  });

  it('returns an empty array (no mutation) on no match', () => {
    const original = rows.slice();
    const out = filterInventoryQol(rows, { search: 'does-not-exist' });
    expect(out).toEqual([]);
    expect(rows).toEqual(original);
  });
});

describe('inventory-qol — sort', () => {
  const rows: InventoryQolRow[] = [
    makeRow({
      id: 'a-old-low',
      createdAt: new Date('2024-01-01'),
      item: makeItem({ kind: 'WEAPON', quality: 'PHAM' }),
    }),
    makeRow({
      id: 'b-new-high',
      createdAt: new Date('2025-06-01'),
      item: makeItem({ kind: 'ARMOR', quality: 'THAN' }),
    }),
    makeRow({
      id: 'c-mid',
      locked: true,
      createdAt: new Date('2024-12-01'),
      item: makeItem({ kind: 'BOOTS', quality: 'HUYEN' }),
    }),
    makeRow({
      id: 'd-equipped',
      equippedSlot: 'WEAPON',
      createdAt: new Date('2024-06-01'),
      item: makeItem({ kind: 'WEAPON', quality: 'TIEN' }),
    }),
  ];

  it('default sort: locked → equipped → quality desc → kind → newest', () => {
    expect(sortInventoryQol(rows, 'default').map((r) => r.id)).toEqual([
      'c-mid',
      'd-equipped',
      'b-new-high',
      'a-old-low',
    ]);
  });

  it('quality_desc orders THAN before PHAM', () => {
    expect(sortInventoryQol(rows, 'quality_desc').map((r) => r.id)).toEqual([
      'b-new-high',
      'd-equipped',
      'c-mid',
      'a-old-low',
    ]);
  });

  it('quality_asc reverses', () => {
    expect(sortInventoryQol(rows, 'quality_asc').map((r) => r.id)).toEqual([
      'a-old-low',
      'c-mid',
      'd-equipped',
      'b-new-high',
    ]);
  });

  it('newest sort by createdAt desc', () => {
    expect(sortInventoryQol(rows, 'newest').map((r) => r.id)).toEqual([
      'b-new-high',
      'c-mid',
      'd-equipped',
      'a-old-low',
    ]);
  });

  it('oldest sort by createdAt asc', () => {
    expect(sortInventoryQol(rows, 'oldest').map((r) => r.id)).toEqual([
      'a-old-low',
      'd-equipped',
      'c-mid',
      'b-new-high',
    ]);
  });

  it('locked_first places locked rows first', () => {
    expect(sortInventoryQol(rows, 'locked_first').map((r) => r.id)).toEqual([
      'c-mid',
      'a-old-low',
      'b-new-high',
      'd-equipped',
    ]);
  });

  it('equipped_first places equipped rows first', () => {
    expect(sortInventoryQol(rows, 'equipped_first').map((r) => r.id)).toEqual([
      'd-equipped',
      'a-old-low',
      'b-new-high',
      'c-mid',
    ]);
  });

  it('applyInventoryQolView filters then sorts', () => {
    const result = applyInventoryQolView(rows, {
      bucket: 'equipment',
      sort: 'quality_desc',
    });
    expect(result.map((r) => r.id)).toEqual([
      'b-new-high',
      'd-equipped',
      'c-mid',
      'a-old-low',
    ]);
  });
});

describe('inventory-qol — shouldDefaultLockOnGrant', () => {
  it('returns true for quest-bound items', () => {
    expect(
      shouldDefaultLockOnGrant(
        makeItem({ marketTradeable: false, bindOnPickup: true }),
      ),
    ).toBe(true);
  });

  it('returns false for normal items', () => {
    expect(
      shouldDefaultLockOnGrant(makeItem({ marketTradeable: true })),
    ).toBe(false);
    expect(shouldDefaultLockOnGrant(makeItem())).toBe(false);
  });
});
