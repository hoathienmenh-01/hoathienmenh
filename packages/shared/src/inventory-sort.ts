/**
 * Phase QOL-1 — Inventory auto-sort.
 *
 * Pure ordering helpers cho `InventoryView` (server hoặc client side). Không
 * import Nest/Prisma — dùng được cả FE & BE & unit test.
 *
 * Sort keys:
 *  - `kind`        — group theo `ItemKind` (WEAPON, ARMOR, PILL_HP, …).
 *  - `tier`        — `equipmentTier` (1..10). Item không có tier xếp cuối.
 *  - `quality`     — PHAM < LINH < HUYEN < TIEN < THAN (cao trước).
 *  - `level`       — `refineLevel` (15..0 — cao trước).
 *  - `element`     — `enchantElement` alphabetic (null cuối).
 *  - `acquiredAt`  — `createdAt` desc (mới nhất trước).
 *  - `locked`      — locked row group lên đầu (UI surfacing).
 *
 * Filter keys: `locked` (true/false), `kind`, `quality`, `element`.
 */
import type { Quality } from './enums';
import type { ItemKind } from './items';

export type InventorySortKey =
  | 'kind'
  | 'tier'
  | 'quality'
  | 'level'
  | 'element'
  | 'acquiredAt'
  | 'locked';

export type InventorySortDir = 'asc' | 'desc';

export interface InventorySortableRow {
  id: string;
  itemKey: string;
  qty: number;
  locked: boolean;
  createdAt: Date | string;
  refineLevel: number;
  enchantElement: string | null;
  item: {
    kind: ItemKind;
    quality: Quality;
    equipmentTier?: number;
    name?: string;
    nameVi?: string;
  };
}

/** Quality từ thấp → cao. Cao = ưu tiên hiển thị (desc default). */
export const QUALITY_ORDER: Record<Quality, number> = {
  PHAM: 1,
  LINH: 2,
  HUYEN: 3,
  TIEN: 4,
  THAN: 5,
};

/** ItemKind group order — equipment trước, pill ở giữa, misc cuối. */
export const KIND_ORDER: Record<ItemKind, number> = {
  WEAPON: 1,
  ARMOR: 2,
  HAT: 3,
  BELT: 4,
  BOOTS: 5,
  TRAM: 6,
  ARTIFACT: 7,
  PILL_HP: 10,
  PILL_MP: 11,
  PILL_EXP: 12,
  ORE: 20,
  SKILL_BOOK: 30,
  MISC: 99,
};

const DEFAULT_KIND_RANK = 100;
const DEFAULT_TIER_RANK = 0;

export function rankKind(kind: ItemKind | undefined): number {
  if (!kind) return DEFAULT_KIND_RANK;
  return KIND_ORDER[kind] ?? DEFAULT_KIND_RANK;
}

export function rankQuality(quality: Quality | undefined): number {
  if (!quality) return 0;
  return QUALITY_ORDER[quality] ?? 0;
}

export function rankTier(tier: number | undefined | null): number {
  if (typeof tier !== 'number' || !Number.isFinite(tier) || tier <= 0) {
    return DEFAULT_TIER_RANK;
  }
  return Math.floor(tier);
}

function toTimestamp(d: Date | string): number {
  if (d instanceof Date) return d.getTime();
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Stable compare cho 1 sort key + direction. Trả về số âm/dương/0 theo
 * convention `Array.prototype.sort`.
 *
 * Quy ước: `desc` = cao trước (vd quality THAN trước PHAM, refine 15 trước 0).
 * Anti-tie: vì sort là stable trong Node 12+, tie-break dựa thứ tự nhập.
 * Caller dùng `compareInventory` cho multi-key tie-break.
 */
export function compareSingle(
  a: InventorySortableRow,
  b: InventorySortableRow,
  key: InventorySortKey,
  dir: InventorySortDir,
): number {
  let diff = 0;
  switch (key) {
    case 'kind':
      diff = rankKind(a.item.kind) - rankKind(b.item.kind);
      break;
    case 'tier':
      diff = rankTier(a.item.equipmentTier) - rankTier(b.item.equipmentTier);
      break;
    case 'quality':
      diff = rankQuality(a.item.quality) - rankQuality(b.item.quality);
      break;
    case 'level':
      diff = a.refineLevel - b.refineLevel;
      break;
    case 'element': {
      const ea = a.enchantElement ?? '';
      const eb = b.enchantElement ?? '';
      // null xếp cuối — convert empty → 'zzz' để asc đẩy null về sau.
      const sa = ea === '' ? 'zzz' : ea;
      const sb = eb === '' ? 'zzz' : eb;
      diff = sa.localeCompare(sb);
      break;
    }
    case 'acquiredAt':
      diff = toTimestamp(a.createdAt) - toTimestamp(b.createdAt);
      break;
    case 'locked':
      // locked=true xếp trước locked=false khi dir='desc' (default).
      diff = Number(a.locked) - Number(b.locked);
      break;
    default:
      diff = 0;
  }
  return dir === 'desc' ? -diff : diff;
}

/**
 * Multi-key compare. Mỗi entry `{ key, dir }` được apply theo thứ tự — entry
 * đầu tiên là primary sort, entry sau tie-break.
 *
 * Convention default cho UI: `[locked desc, kind asc, quality desc, tier desc, level desc, acquiredAt desc]`.
 */
export function compareInventory(
  a: InventorySortableRow,
  b: InventorySortableRow,
  sortKeys: { key: InventorySortKey; dir: InventorySortDir }[],
): number {
  for (const sk of sortKeys) {
    const diff = compareSingle(a, b, sk.key, sk.dir);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Sort inventory rows theo nhiều key. KHÔNG mutate input — trả về mảng mới.
 *
 * `defaultSortKeys()` được prepend nếu caller chỉ cung cấp 1 key thì lock vẫn
 * xếp trước (UX không bị invert khi đổi sort).
 */
export function sortInventory<T extends InventorySortableRow>(
  rows: readonly T[],
  sortKeys: { key: InventorySortKey; dir: InventorySortDir }[],
): T[] {
  const arr = rows.slice();
  arr.sort((a, b) => compareInventory(a, b, sortKeys));
  return arr;
}

/** Sort presets — UI dropdown options. */
export const SORT_PRESETS = {
  default: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'kind' as const, dir: 'asc' as const },
    { key: 'quality' as const, dir: 'desc' as const },
    { key: 'tier' as const, dir: 'desc' as const },
    { key: 'level' as const, dir: 'desc' as const },
    { key: 'acquiredAt' as const, dir: 'desc' as const },
  ],
  newest: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'acquiredAt' as const, dir: 'desc' as const },
  ],
  quality: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'quality' as const, dir: 'desc' as const },
    { key: 'kind' as const, dir: 'asc' as const },
    { key: 'tier' as const, dir: 'desc' as const },
  ],
  tier: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'tier' as const, dir: 'desc' as const },
    { key: 'quality' as const, dir: 'desc' as const },
  ],
  level: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'level' as const, dir: 'desc' as const },
    { key: 'tier' as const, dir: 'desc' as const },
  ],
  element: [
    { key: 'locked' as const, dir: 'desc' as const },
    { key: 'element' as const, dir: 'asc' as const },
    { key: 'kind' as const, dir: 'asc' as const },
  ],
} as const;

export type SortPresetKey = keyof typeof SORT_PRESETS;

export function isSortPresetKey(value: unknown): value is SortPresetKey {
  return typeof value === 'string' && value in SORT_PRESETS;
}

/**
 * Filter inventory rows. Predicate boolean — caller chain với `sortInventory`.
 *
 * Empty filter object → identity (return rows as-is).
 */
export interface InventoryFilter {
  locked?: boolean | undefined;
  kind?: ItemKind | undefined;
  quality?: Quality | undefined;
  element?: string | null | undefined;
}

export function filterInventory<T extends InventorySortableRow>(
  rows: readonly T[],
  filter: InventoryFilter,
): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (filter.locked !== undefined && r.locked !== filter.locked) continue;
    if (filter.kind !== undefined && r.item.kind !== filter.kind) continue;
    if (filter.quality !== undefined && r.item.quality !== filter.quality) {
      continue;
    }
    if (filter.element !== undefined) {
      if (filter.element === null && r.enchantElement !== null) continue;
      if (
        typeof filter.element === 'string' &&
        r.enchantElement !== filter.element
      ) {
        continue;
      }
    }
    out.push(r);
  }
  return out;
}
