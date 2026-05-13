/**
 * Phase 34.3 — Inventory Auto-sort / Lock (shared utilities)
 *
 * Pure shared helpers that classify, filter and sort inventory rows for the
 * Phase 34.3 inventory QoL feature. Kept in `@xuantoi/shared` so the API and
 * Web FE share a single source of truth for sort keys and filter buckets.
 *
 * No I/O. No Prisma. Deterministic. Idempotent.
 */
import { QUALITIES, type Quality } from './enums';
import type { ItemDef, ItemKind } from './items';

/**
 * Logical filter bucket used by the UI filter bar (`vat-pham`, `trang-bi`, …).
 * NOT the same as `ItemKind` — pills/herbs/ores are merged under `consumable`
 * + `material` to keep the UI compact. The bucket is computed deterministically
 * from `ItemDef`.
 */
export const INVENTORY_QOL_FILTER_BUCKETS = [
  'all',
  'equipment',
  'artifact',
  'consumable',
  'material',
  'skill_book',
  'quest',
  'locked',
] as const;
export type InventoryQolFilterBucket =
  (typeof INVENTORY_QOL_FILTER_BUCKETS)[number];

/**
 * Sort keys supported by the QoL view. Stable across calls so the FE can
 * persist user preference in localStorage.
 */
export const INVENTORY_QOL_SORT_KEYS = [
  'default',
  'quality_desc',
  'quality_asc',
  'kind',
  'equipped_first',
  'locked_first',
  'newest',
  'oldest',
] as const;
export type InventoryQolSortKey = (typeof INVENTORY_QOL_SORT_KEYS)[number];

const EQUIPMENT_KINDS: ReadonlySet<ItemKind> = new Set([
  'WEAPON',
  'ARMOR',
  'BELT',
  'BOOTS',
  'HAT',
  'TRAM',
]);
const CONSUMABLE_KINDS: ReadonlySet<ItemKind> = new Set([
  'PILL_HP',
  'PILL_MP',
  'PILL_EXP',
]);
const MATERIAL_KINDS: ReadonlySet<ItemKind> = new Set(['ORE', 'MISC']);

/**
 * Quality → numeric weight (PHAM = 1 … THAN = 5). Useful for sorting.
 */
export function qualityWeight(q: Quality): number {
  return QUALITIES.indexOf(q) + 1;
}

/**
 * Bucket an item to one of the UI filter bands. `locked` is a meta bucket and
 * is applied as an additional filter, see {@link matchesInventoryQolFilter}.
 *
 * We treat `marketTradeable === false` + `bindOnPickup === true` as a proxy
 * for "quest / bound" item — there is no dedicated `questBound` field in
 * `ItemDef`, but quest-style rewards are typically configured this way.
 */
export function inventoryQolBucketOf(
  item: Pick<ItemDef, 'kind' | 'marketTradeable' | 'bindOnPickup'>,
): Exclude<InventoryQolFilterBucket, 'all' | 'locked'> {
  if (isQuestBoundItem(item)) return 'quest';
  if (EQUIPMENT_KINDS.has(item.kind)) return 'equipment';
  if (item.kind === 'ARTIFACT') return 'artifact';
  if (CONSUMABLE_KINDS.has(item.kind)) return 'consumable';
  if (item.kind === 'SKILL_BOOK') return 'skill_book';
  if (MATERIAL_KINDS.has(item.kind)) return 'material';
  return 'material';
}

/**
 * Phase 34.3 — classify an item as "quest-bound / story-important". Used by:
 *  - {@link inventoryQolBucketOf} to bucket under `quest` in the UI.
 *  - {@link shouldDefaultLockOnGrant} to auto-lock at grant time.
 */
export function isQuestBoundItem(
  item: Pick<ItemDef, 'marketTradeable' | 'bindOnPickup'>,
): boolean {
  return item.marketTradeable === false && item.bindOnPickup === true;
}

/**
 * Minimal row shape consumed by sort/filter helpers. The API service uses
 * `InventoryView` (which has all these fields) — see
 * `apps/api/src/modules/inventory/inventory.service.ts`. Kept loose so tests
 * can use plain literals.
 */
export interface InventoryQolRow {
  id: string;
  itemKey: string;
  qty: number;
  equippedSlot: string | null;
  locked: boolean;
  createdAt: Date | string;
  item: Pick<
    ItemDef,
    'kind' | 'quality' | 'name' | 'marketTradeable' | 'bindOnPickup'
  >;
}

/**
 * Apply filter+search to an inventory list. Returns a new array (does not
 * mutate input).
 *
 * - `bucket` `'all'` returns every row.
 * - `bucket` `'locked'` returns only locked rows.
 * - Other buckets filter via {@link inventoryQolBucketOf}.
 * - `search` is case-insensitive prefix-match on `itemKey` + `name` + `nameVi`.
 */
export function filterInventoryQol(
  rows: ReadonlyArray<InventoryQolRow>,
  opts: { bucket?: InventoryQolFilterBucket; search?: string } = {},
): InventoryQolRow[] {
  const bucket = opts.bucket ?? 'all';
  const searchRaw = (opts.search ?? '').trim().toLowerCase();
  let out: InventoryQolRow[] = [...rows];
  if (bucket === 'locked') {
    out = out.filter((r) => r.locked);
  } else if (bucket !== 'all') {
    out = out.filter((r) => inventoryQolBucketOf(r.item) === bucket);
  }
  if (searchRaw.length > 0) {
    out = out.filter((r) => {
      const keys = [r.itemKey, r.item.name ?? ''];
      return keys.some((k) => k.toLowerCase().includes(searchRaw));
    });
  }
  return out;
}

/**
 * Default sort: locked first → equipped first → quality desc → kind asc →
 * createdAt desc. Mirrors UI default ordering.
 */
function defaultComparator(a: InventoryQolRow, b: InventoryQolRow): number {
  if (a.locked !== b.locked) return a.locked ? -1 : 1;
  const ae = a.equippedSlot != null;
  const be = b.equippedSlot != null;
  if (ae !== be) return ae ? -1 : 1;
  const qa = qualityWeight(a.item.quality);
  const qb = qualityWeight(b.item.quality);
  if (qa !== qb) return qb - qa;
  if (a.item.kind !== b.item.kind) return a.item.kind.localeCompare(b.item.kind);
  return (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Apply one of the supported sort keys. Always stable (uses tie-break on
 * `id`).
 */
export function sortInventoryQol(
  rows: ReadonlyArray<InventoryQolRow>,
  sort: InventoryQolSortKey,
): InventoryQolRow[] {
  const arr = [...rows];
  const tie = (a: InventoryQolRow, b: InventoryQolRow) => a.id.localeCompare(b.id);
  switch (sort) {
    case 'default':
      arr.sort((a, b) => defaultComparator(a, b) || tie(a, b));
      break;
    case 'quality_desc':
      arr.sort(
        (a, b) =>
          qualityWeight(b.item.quality) - qualityWeight(a.item.quality) ||
          tie(a, b),
      );
      break;
    case 'quality_asc':
      arr.sort(
        (a, b) =>
          qualityWeight(a.item.quality) - qualityWeight(b.item.quality) ||
          tie(a, b),
      );
      break;
    case 'kind':
      arr.sort(
        (a, b) => a.item.kind.localeCompare(b.item.kind) || tie(a, b),
      );
      break;
    case 'equipped_first':
      arr.sort((a, b) => {
        const ae = a.equippedSlot != null ? 0 : 1;
        const be = b.equippedSlot != null ? 0 : 1;
        return ae - be || tie(a, b);
      });
      break;
    case 'locked_first':
      arr.sort((a, b) => {
        const al = a.locked ? 0 : 1;
        const bl = b.locked ? 0 : 1;
        return al - bl || tie(a, b);
      });
      break;
    case 'newest':
      arr.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          tie(a, b),
      );
      break;
    case 'oldest':
      arr.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          tie(a, b),
      );
      break;
  }
  return arr;
}

/**
 * Convenience: filter then sort.
 */
export function applyInventoryQolView(
  rows: ReadonlyArray<InventoryQolRow>,
  opts: {
    bucket?: InventoryQolFilterBucket;
    search?: string;
    sort?: InventoryQolSortKey;
  } = {},
): InventoryQolRow[] {
  return sortInventoryQol(
    filterInventoryQol(rows, opts),
    opts.sort ?? 'default',
  );
}

/**
 * Convenience: returns true if `bucket`/`search` would match the row.
 */
export function matchesInventoryQolFilter(
  row: InventoryQolRow,
  opts: { bucket?: InventoryQolFilterBucket; search?: string } = {},
): boolean {
  return filterInventoryQol([row], opts).length === 1;
}

/**
 * Phase 34.3 audit: quest-bound items SHOULD default to `locked=true` on
 * grant. Centralised here so `InventoryService.grantTx` (and any future grant
 * site) can call a single function. Returns the recommended lock state given
 * the `ItemDef` and an optional explicit override.
 */
export function shouldDefaultLockOnGrant(
  item: Pick<ItemDef, 'marketTradeable' | 'bindOnPickup'>,
): boolean {
  return isQuestBoundItem(item);
}
