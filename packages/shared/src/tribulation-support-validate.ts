/**
 * Phase 14.3.C — Tribulation Support Item Consumption — shared validator.
 *
 * Phase 14.3.A đã có {@link composeTribulationSupports} (clamp per-entry +
 * tổng). Phase 14.3.B đã có {@link collectItemTribulationSupports} (read-only
 * preview list từ inventory). Phase 14.3.C wire **consume**: player chọn 1..N
 * stack `PILL_*`/`MISC` có `bonuses.tribulationSupport > 0` để consume khi
 * `POST /character/tribulation`. Module này cung cấp:
 *
 *   1. {@link TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS} — cap số item player
 *      được phép chọn cho 1 attempt (default 3, tránh "ăn mọi đan trong túi").
 *   2. {@link isTribulationSupportConsumable} — predicate "itemKey có phải
 *      consumable hỗ trợ vượt kiếp" (kind PILL_* / MISC, có `tribulationSupport
 *      > 0`, KHÔNG có `slot` để loại trừ equipment).
 *   3. {@link listTribulationSupportConsumables} — catalog accessor trả ra mọi
 *      consumable support item — FE dùng để render selection UI hợp lý.
 *   4. {@link buildSelectedSupportItemEntries} — convert `selectedItemKeys` +
 *      catalog → `TribulationSupportEntry[]` để feed
 *      {@link composeTribulationSupports}. Caller (server runtime) dùng giá
 *      trị bonus này thay cho FE-sent value.
 *   5. {@link validateTribulationSupportSelection} — pure validator. Trả ra
 *      `{ ok: true, entries }` hoặc `{ ok: false, code: ValidateError }` cho
 *      caller phân biệt 4xx error code mà KHÔNG cần inventory check (caller
 *      vẫn phải check inventory ownership riêng — pattern mirror
 *      {@link validateTerritoryPeriodKey}).
 *
 * Pure / no I/O / no mutate — caller wrap qua DB transaction để consume.
 *
 * @module tribulation-support-validate
 */

import type { ItemDef } from './items';
import { ITEMS, itemByKey } from './items';
import type { TribulationSupportEntry } from './tribulation-foundation';

/**
 * Cap số item player được phép chọn cho 1 attempt. Tránh "ăn mọi đan trong
 * túi" — ngay cả khi total bonus đã cap ở `TRIBULATION_SUPPORT_TOTAL_CEIL`,
 * player có thể bị mất hết stock chỉ vì lỡ tick nhiều checkbox. Cap 3 đủ
 * generous (3 × 0.10 = 0.30 = total cap) mà không tốn nhiều inventory.
 */
export const TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS = 3;

/**
 * Phase 14.3.C — kind nào thuộc danh mục consumable hỗ trợ vượt kiếp.
 * EQUIPMENT (`ARTIFACT`, `WEAPON`, ...) bị loại — chúng được provider
 * `equipment` xử lý (passive, không consume). Pill/MISC consumable được consume
 * 1 stack mỗi item / attempt.
 */
const TRIBULATION_SUPPORT_CONSUMABLE_KINDS: readonly ItemDef['kind'][] = [
  'PILL_HP',
  'PILL_MP',
  'PILL_EXP',
  'MISC',
];

/**
 * Predicate "itemKey là consumable hỗ trợ vượt kiếp".
 *
 * Điều kiện đồng thời:
 *   1. Catalog có entry với `def.bonuses.tribulationSupport > 0`. Negative
 *      bonus (debuff) KHÔNG được consume — chỉ consume positive support.
 *   2. `def.kind` thuộc {@link TRIBULATION_SUPPORT_CONSUMABLE_KINDS}.
 *   3. `def.slot` undefined → không phải equipment (Hộ Kiếp Phù
 *      `slot: 'ARTIFACT_2'` bị loại — passive equipment provider riêng).
 *
 * @param itemKey item catalog key.
 * @returns true nếu item hợp lệ cho consume khi attempt tribulation.
 */
export function isTribulationSupportConsumable(itemKey: string): boolean {
  const def = itemByKey(itemKey);
  if (!def) return false;
  return isDefTribulationSupportConsumable(def);
}

/** Predicate trên ItemDef thay vì itemKey — dùng nội bộ tránh lookup lại. */
function isDefTribulationSupportConsumable(def: ItemDef): boolean {
  if (def.slot !== undefined) return false;
  if (!TRIBULATION_SUPPORT_CONSUMABLE_KINDS.includes(def.kind)) return false;
  const bonus = def.bonuses?.tribulationSupport;
  if (typeof bonus !== 'number') return false;
  if (!Number.isFinite(bonus)) return false;
  if (bonus <= 0) return false;
  return true;
}

/**
 * Trả ra mọi consumable support item từ catalog (sort theo bonus DESC để FE
 * render từ mạnh đến yếu). Pure — caller cache nếu cần.
 *
 * @returns array `ItemDef` thoả mãn {@link isTribulationSupportConsumable}.
 */
export function listTribulationSupportConsumables(): readonly ItemDef[] {
  const out: ItemDef[] = [];
  for (const def of ITEMS) {
    if (isDefTribulationSupportConsumable(def)) out.push(def);
  }
  out.sort((a, b) => {
    const bA = a.bonuses?.tribulationSupport ?? 0;
    const bB = b.bonuses?.tribulationSupport ?? 0;
    if (bA !== bB) return bB - bA;
    return a.key.localeCompare(b.key);
  });
  return out;
}

/**
 * Phase 14.3.C — error code khi {@link validateTribulationSupportSelection}
 * reject input. Caller map sang HTTP status (controller) hoặc i18n (FE).
 */
export type TribulationSupportSelectionError =
  | 'INVALID_INPUT'
  | 'TOO_MANY_SELECTED'
  | 'DUPLICATE_SELECTED'
  | 'INVALID_SUPPORT_ITEM';

/**
 * Pure result của {@link validateTribulationSupportSelection}.
 *
 * - Success → `entries` chứa `TribulationSupportEntry[]` đã build từ catalog
 *   bonus (KHÔNG tin client-sent bonus). Caller feed vào
 *   {@link composeTribulationSupports} (cùng với passive sources) để có total
 *   bonus server-side.
 * - Failure → `code` enumerated cho controller map status.
 */
export type TribulationSupportSelectionResult =
  | {
      readonly ok: true;
      readonly entries: readonly TribulationSupportEntry[];
    }
  | {
      readonly ok: false;
      readonly code: TribulationSupportSelectionError;
    };

/**
 * Pure validator cho selection list — KHÔNG check inventory (caller phải verify
 * ownership/qty riêng vì cần DB transaction). Validate:
 *
 *   1. Input shape (array, mỗi phần tử là string non-empty).
 *   2. `length ≤ TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS`.
 *   3. Không duplicate key (player tick 2 lần cùng item → reject).
 *   4. Mỗi key thoả {@link isTribulationSupportConsumable}.
 *
 * Trả ra `entries[]` build từ catalog bonus — caller dùng giá trị này (server
 * trusted) thay vì FE-sent value. Mỗi entry đại diện 1 stack consume.
 *
 * @param selectedItemKeys client-sent keys (đã sanitize JSON parse).
 * @returns result discriminated union.
 */
export function validateTribulationSupportSelection(
  selectedItemKeys: readonly unknown[],
): TribulationSupportSelectionResult {
  if (!Array.isArray(selectedItemKeys)) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  if (selectedItemKeys.length > TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS) {
    return { ok: false, code: 'TOO_MANY_SELECTED' };
  }
  const seen = new Set<string>();
  const entries: TribulationSupportEntry[] = [];
  for (const raw of selectedItemKeys) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    if (seen.has(raw)) {
      return { ok: false, code: 'DUPLICATE_SELECTED' };
    }
    const def = itemByKey(raw);
    if (!def || !isDefTribulationSupportConsumable(def)) {
      return { ok: false, code: 'INVALID_SUPPORT_ITEM' };
    }
    seen.add(raw);
    entries.push({
      source: 'item',
      key: def.key,
      label: def.name,
      bonus: def.bonuses!.tribulationSupport!,
    });
  }
  return { ok: true, entries };
}

/**
 * Convenience: build entries từ list keys đã validate. Caller (test fixture
 * hoặc service) đã chắc chắn keys hợp lệ — bỏ qua validation. Throw nếu
 * catalog drift (chỉ xảy ra khi catalog change between phases).
 */
export function buildSelectedSupportItemEntries(
  selectedItemKeys: readonly string[],
): readonly TribulationSupportEntry[] {
  const out: TribulationSupportEntry[] = [];
  for (const k of selectedItemKeys) {
    const def = itemByKey(k);
    if (!def) {
      throw new Error(`buildSelectedSupportItemEntries: unknown itemKey '${k}'`);
    }
    if (!isDefTribulationSupportConsumable(def)) {
      throw new Error(
        `buildSelectedSupportItemEntries: itemKey '${k}' không phải consumable support`,
      );
    }
    out.push({
      source: 'item',
      key: def.key,
      label: def.name,
      bonus: def.bonuses!.tribulationSupport!,
    });
  }
  return out;
}
