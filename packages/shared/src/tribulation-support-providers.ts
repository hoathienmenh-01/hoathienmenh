/**
 * Phase 14.3.B — Tribulation Support Providers.
 *
 * Pure helpers (NO I/O / NO mutate) gom `TribulationSupportEntry[]` từ:
 *   - inventory items có `ItemBonus.tribulationSupport > 0` (kind PILL_HP/
 *     PILL_MP/MISC, qty ≥ 1, equippedSlot null) — provider `item`.
 *   - equipped items (`equippedSlot != null`) có
 *     `ItemBonus.tribulationSupport` — provider `equipment`.
 *   - active buffs có `BuffDef.tribulationSupport` (positive: hỗ trợ, negative:
 *     Tâm Ma debuff). Stacks count linearly trước per-entry clamp ở
 *     `composeTribulationSupports`. Provider `buff`.
 *   - composed `PassiveTalentMods.elementResistByElement` — wave element nếu
 *     match → entry. Provider `talent`.
 *
 * Caller (`TribulationService.previewTribulation()`) compose tổng:
 *   `composeTribulationSupports([...item, ...equipment, ...buff, ...talent])`
 * Cap per-entry `0.1` + total `0.3` ở foundation đảm bảo stack rộng vẫn
 * không lật base chance.
 *
 * **Read-only**: tất cả helpers pure, không decrement inventory / consume buff
 * / mutate state. Phase 14.3.B-W (ngoài scope) sẽ wire consume khi player
 * confirm attempt qua endpoint riêng.
 */

import type { ElementKey } from './combat';
import type { ItemDef } from './items';
import { itemByKey } from './items';
import type { BuffDef } from './buffs';
import { getBuffDef } from './buffs';
import type { TalentDef } from './talents';
import { getTalentDef } from './talents';
import type { TribulationSupportEntry } from './tribulation-foundation';
import { TRIBULATION_SUPPORT_PER_ENTRY_CEIL } from './tribulation-foundation';

/**
 * Slim shape của 1 inventory row — caller (API service) map từ
 * `prisma.inventoryItem.findMany` rồi pass xuống.
 *
 * - `qty` ≥ 1 invariant (caller filter ra row qty=0 / negative).
 * - `equippedSlot` null = item nằm trong túi (consumable / unequipped gear).
 *   Provider `item` xét tier consumable; provider `equipment` xét equipped.
 */
export interface InventorySupportRow {
  readonly itemKey: string;
  readonly qty: number;
  readonly equippedSlot: string | null;
}

/**
 * Slim shape của 1 active buff row — caller map từ
 * `BuffService.listActive()` rồi pass xuống.
 *
 * - `stacks` ≥ 1 invariant; non-stackable buff stacks luôn = 1.
 * - `expiresAt > now` invariant — provider trust caller đã prune expired.
 */
export interface ActiveBuffRow {
  readonly buffKey: string;
  readonly stacks: number;
}

/**
 * Slim shape của 1 learned talent — caller map từ
 * `prisma.characterTalent.findMany` rồi pass xuống.
 *
 * Note: provider hiện tại không dùng directly mà consume composed
 * `PassiveTalentMods` (đã có `elementResistByElement` aggregated). Để
 * forward-compat shape vẫn expose talent rows nếu phase sau cần fan-out.
 */
export interface LearnedTalentRow {
  readonly talentKey: string;
}

/**
 * Build entries từ inventory items có `bonuses.tribulationSupport > 0` và
 * `equippedSlot === null` (consumable). Skip equipped items — chúng được
 * provider `equipment` xử lý.
 *
 * Convention:
 *   - Multi-stack qty ≥ 1: chỉ surface 1 entry per item key (single-use
 *     hỗ trợ — qty không multiply support magnitude). Nhiều stack chỉ cho
 *     phép multiple attempts tương lai (Phase 14.3.B-W consume).
 *   - `bonus < 0` không expected cho item (catalog không có debuff item),
 *     nhưng helper vẫn pass-through cho composer clamp đối xứng.
 *
 * @param rows danh sách inventory rows (qty ≥ 1) — caller filter trước.
 * @returns array `TribulationSupportEntry` (rỗng nếu không match).
 */
export function collectItemTribulationSupports(
  rows: readonly InventorySupportRow[],
): readonly TribulationSupportEntry[] {
  const out: TribulationSupportEntry[] = [];
  const seenKeys = new Set<string>();
  for (const r of rows) {
    if (r.equippedSlot !== null) continue;
    if (r.qty <= 0) continue;
    if (seenKeys.has(r.itemKey)) continue;
    const def: ItemDef | undefined = itemByKey(r.itemKey);
    if (!def) continue;
    const bonus = def.bonuses?.tribulationSupport;
    if (typeof bonus !== 'number' || bonus === 0) continue;
    if (!Number.isFinite(bonus)) continue;
    seenKeys.add(r.itemKey);
    out.push({
      source: 'item',
      key: def.key,
      label: def.name,
      bonus,
    });
  }
  return out;
}

/**
 * Build entries từ equipped items (`equippedSlot != null`) có
 * `bonuses.tribulationSupport != 0`. 1 entry per equipped slot.
 *
 * Khác `collectItemTribulationSupports`: chỉ xét rows đeo trên người (hộ phù
 * / khôi giáp pháp bảo). Items đặt trong túi không count ở đây.
 *
 * @param rows tất cả inventory rows; helper filter equipped trong.
 * @returns array `TribulationSupportEntry`.
 */
export function collectEquipmentTribulationSupports(
  rows: readonly InventorySupportRow[],
): readonly TribulationSupportEntry[] {
  const out: TribulationSupportEntry[] = [];
  for (const r of rows) {
    if (r.equippedSlot === null) continue;
    const def: ItemDef | undefined = itemByKey(r.itemKey);
    if (!def) continue;
    const bonus = def.bonuses?.tribulationSupport;
    if (typeof bonus !== 'number' || bonus === 0) continue;
    if (!Number.isFinite(bonus)) continue;
    out.push({
      source: 'equipment',
      key: def.key,
      label: def.name,
      bonus,
    });
  }
  return out;
}

/**
 * Build entries từ active buffs có `BuffDef.tribulationSupport != 0`.
 *
 * Stacks count: total per-entry bonus = `stacks × tribulationSupport`. Cap
 * pre-compose ở `TRIBULATION_SUPPORT_PER_ENTRY_CEIL` (`0.1`) để 1 buff
 * stack rộng (e.g. 5 stacks × 0.05 = 0.25) không bypass per-entry ceil.
 * Composer chính (`composeTribulationSupports`) cũng clamp lần 2 — defense
 * in depth.
 *
 * Tâm Ma debuff sẽ có `tribulationSupport` âm — entry âm trừ thành công.
 *
 * @param buffs active buff rows (caller đã prune expired).
 * @returns array `TribulationSupportEntry`.
 */
export function collectBuffTribulationSupports(
  buffs: readonly ActiveBuffRow[],
): readonly TribulationSupportEntry[] {
  const out: TribulationSupportEntry[] = [];
  for (const b of buffs) {
    if (b.stacks <= 0) continue;
    const def: BuffDef | undefined = getBuffDef(b.buffKey);
    if (!def) continue;
    const perStack = def.tribulationSupport;
    if (typeof perStack !== 'number' || perStack === 0) continue;
    if (!Number.isFinite(perStack)) continue;
    const raw = perStack * b.stacks;
    // Pre-clamp magnitude per-entry — composer clamp lại defensively.
    const sign = raw >= 0 ? 1 : -1;
    const mag = Math.min(Math.abs(raw), TRIBULATION_SUPPORT_PER_ENTRY_CEIL);
    out.push({
      source: 'buff',
      key: def.key,
      label: def.name,
      bonus: sign * mag,
    });
  }
  return out;
}

/**
 * Build entries từ learned talents có `passiveEffect.kind === 'element_resist'`
 * matching ít nhất 1 wave element của kiếp sắp tới.
 *
 * Convention bonus encoding:
 *   - Talent value `< 1` (e.g. `0.95` = giảm 5% damage taken) → entry bonus
 *     `1 - value = 0.05` (positive support).
 *   - Talent value `≥ 1` hoặc invalid → skip.
 *   - `waveElements` rỗng (Tâm kiếp / vô hệ) → skip toàn bộ (talent resist
 *     không apply).
 *
 * Multi-wave: kiếp có nhiều wave (severity-driven 3..7) với element khác
 * nhau (`waves[i].element`). Helper accept array `waveElements` (duplicates
 * cho phép — caller không cần dedup) và surface 1 entry per talent matching
 * bất kỳ wave nào (dedup theo talent key, không double-count khi 2 waves
 * trùng element).
 *
 * Khác layer `computePassiveTalentTribulationResist` (multiplicative on
 * damage taken) — provider này chỉ cho UI hiển thị talent là 1 nguồn supports
 * (không double-count damage layer).
 *
 * @param talentKeys list learned talent keys.
 * @param waveElements element list của kiếp waves (có thể duplicate, có thể
 *   chứa null — null waves skip).
 * @returns array `TribulationSupportEntry`, dedup theo talent key.
 */
export function collectTalentTribulationSupports(
  talentKeys: readonly string[],
  waveElements: readonly (ElementKey | null)[],
): readonly TribulationSupportEntry[] {
  const elementSet = new Set<ElementKey>();
  for (const e of waveElements) {
    if (e !== null) elementSet.add(e);
  }
  if (elementSet.size === 0) return [];
  const out: TribulationSupportEntry[] = [];
  const seen = new Set<string>();
  for (const key of talentKeys) {
    if (seen.has(key)) continue;
    const t: TalentDef | undefined = getTalentDef(key);
    if (!t) continue;
    if (t.type !== 'passive' || !t.passiveEffect) continue;
    const eff = t.passiveEffect;
    if (eff.kind !== 'element_resist') continue;
    if (!eff.elementTarget) continue;
    if (!elementSet.has(eff.elementTarget)) continue;
    const v = eff.value;
    if (!Number.isFinite(v) || v >= 1) continue;
    seen.add(key);
    out.push({
      source: 'talent',
      key: t.key,
      label: t.name,
      bonus: 1 - v,
      element: eff.elementTarget,
    });
  }
  return out;
}
