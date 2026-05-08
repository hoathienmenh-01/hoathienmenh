/**
 * Phase 14.2.A — Elemental Combat Foundation.
 *
 * Light, additive Ngũ Hành layer trên top hệ thống Phase 11 (`spiritual-root.ts`,
 * `balance-dials.ts`, `combat.ts`, `items.ts`). PR này chỉ là foundation:
 *
 *   - English-named `ElementType` alias cho `ElementKey` (`WOOD/FIRE/EARTH/
 *     METAL/WATER`) để codebase mới (FE component, future PvP module) đọc dễ
 *     hơn — bidirectional convert qua {@link elementTypeToKey} /
 *     {@link elementKeyToType}.
 *   - {@link elementalAdvantage} trả `ElementRelation` (`counter | generate |
 *     countered | generated | same | neutral`) — single-call helper cho FE/AI
 *     không cần multiplier numeric.
 *   - {@link elementalMultiplier} alias cho `elementMultiplier` ở
 *     `spiritual-root.ts` — giữ tên rõ ràng theo gameplay design (Vietnamese
 *     "tương khắc" / "tương sinh").
 *   - {@link composeMonsterElementalResist} đọc {@link MonsterDef.elementalResist}
 *     (optional Phase 14.2.A field — Partial Record per element key, multiplier
 *     ≤ 1 = giảm sát thương chịu vào). Fallback `1.0` (neutral) khi không
 *     defined hoặc skill không có element.
 *   - {@link composeEquipmentElementalAtkBonus} đọc {@link ItemBonus.elementalAtkBonus}
 *     (optional Phase 14.2.A field — additive bonus theo skill element). Stack
 *     additive across all equipped items.
 *   - {@link applyElementalCombatAdjustment} foundation pipeline tổng hợp:
 *     base damage × multiplier × monsterResist × (1 + equipBonus) — clamp về
 *     `[ELEMENT_COMBAT_ADJUSTMENT_FLOOR, ELEMENT_COMBAT_ADJUSTMENT_CEIL]` để
 *     không phá balance hiện tại.
 *
 * **Không phá balance**:
 *   - 2 dial mới {@link ELEMENT_MONSTER_RESIST_FLOOR},
 *     {@link ELEMENT_EQUIPMENT_ATK_BONUS_CEIL} có biên hẹp (resist ≥ 0.7,
 *     equipment bonus ≤ 0.10) so với character primary +0.10 / secondary
 *     +0.05 đã có ở Phase 11.
 *   - Pipeline {@link applyElementalCombatAdjustment} cap tổng adjustment trong
 *     `[0.5, 1.6]` — chặt hơn `ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6 / CEIL=1.5`
 *     ở `balance-dials.ts` để legacy combat chain không bị over-amplified khi
 *     Phase 14.2.A wire.
 *   - Fallback neutral nếu skillElement = null (vô hệ skill / basic attack)
 *     hoặc target không có element — không gây regression cho dungeon vô hệ.
 *
 * Source-of-truth multiplier vẫn ở `balance-dials.ts` (`describeElementMatch`).
 * File này chỉ là **foundation helper layer** — không định nghĩa lại cycle.
 */

import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';
import {
  describeElementMatch,
  ELEMENT_MODIFIER_ABSOLUTE_CEIL,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
  ELEMENT_NEUTRAL_MULTIPLIER,
  type ElementRelation,
} from './balance-dials';

/**
 * English-named alias cho `ElementKey`. Dùng cho codebase mới (FE component
 * thuần English props, future PvP / cross-server module). Bidirectional
 * convert qua {@link elementTypeToKey} / {@link elementKeyToType}.
 *
 * Mapping cố định:
 *   - `WOOD`  ↔ `moc`
 *   - `FIRE`  ↔ `hoa`
 *   - `EARTH` ↔ `tho`
 *   - `METAL` ↔ `kim`
 *   - `WATER` ↔ `thuy`
 */
export type ElementType = 'WOOD' | 'FIRE' | 'EARTH' | 'METAL' | 'WATER';

export const ELEMENT_TYPES: readonly ElementType[] = [
  'WOOD',
  'FIRE',
  'EARTH',
  'METAL',
  'WATER',
];

const ELEMENT_TYPE_TO_KEY: Readonly<Record<ElementType, ElementKey>> = {
  WOOD: 'moc',
  FIRE: 'hoa',
  EARTH: 'tho',
  METAL: 'kim',
  WATER: 'thuy',
};

const ELEMENT_KEY_TO_TYPE: Readonly<Record<ElementKey, ElementType>> = {
  moc: 'WOOD',
  hoa: 'FIRE',
  tho: 'EARTH',
  kim: 'METAL',
  thuy: 'WATER',
};

/** Convert English-named `ElementType` → internal `ElementKey`. */
export function elementTypeToKey(type: ElementType): ElementKey {
  return ELEMENT_TYPE_TO_KEY[type];
}

/** Convert internal `ElementKey` → English-named `ElementType`. */
export function elementKeyToType(key: ElementKey): ElementType {
  return ELEMENT_KEY_TO_TYPE[key];
}

/**
 * Type guard / parser cho external string (vd request DTO, admin form). Trả
 * `null` nếu không match `ElementType` hoặc lowercase `ElementKey`. Permissive
 * input: chấp nhận cả `'WOOD'`, `'wood'`, `'moc'`.
 */
export function parseElementType(input: string | null | undefined): ElementType | null {
  if (input === null || input === undefined) return null;
  const upper = input.toUpperCase();
  if ((ELEMENT_TYPES as readonly string[]).includes(upper)) {
    return upper as ElementType;
  }
  const lower = input.toLowerCase();
  if ((ELEMENTS as readonly string[]).includes(lower)) {
    return elementKeyToType(lower as ElementKey);
  }
  return null;
}

/**
 * Trả về `ElementRelation` giữa attacker element và defender element. Single
 * source-of-truth là `describeElementMatch()` ở `balance-dials.ts` — function
 * này delegate sang đó để có behavior identical với
 * {@link elementalMultiplier}. Trả `'neutral'` khi 1 trong 2 side `null`.
 *
 * Dùng cho FE/AI cần biết quan hệ Ngũ Hành mà không cần numeric multiplier
 * (vd "Kim khắc Mộc" UI badge, AI lựa chọn skill counter target).
 *
 * @example
 *   elementalAdvantage('kim', 'moc') // 'counter'
 *   elementalAdvantage('moc', 'hoa') // 'generate'
 *   elementalAdvantage('moc', 'kim') // 'countered'
 *   elementalAdvantage('hoa', 'moc') // 'generated'
 *   elementalAdvantage('kim', 'kim') // 'same'
 *   elementalAdvantage(null, 'moc')  // 'neutral'
 */
export function elementalAdvantage(
  attacker: ElementKey | null,
  defender: ElementKey | null,
): ElementRelation {
  return describeElementMatch(attacker, defender).relation;
}

/**
 * Alias cho `elementMultiplier()` ở `spiritual-root.ts` — giữ tên rõ ràng
 * theo gameplay (`elementalMultiplier` thay vì `elementMultiplier`) cho code
 * mới đọc dễ hơn. Behavior identical — single source-of-truth là
 * `describeElementMatch()`.
 */
export function elementalMultiplier(
  attacker: ElementKey | null,
  defender: ElementKey | null,
): number {
  return describeElementMatch(attacker, defender).multiplier;
}

// ---------------------------------------------------------------------------
// Phase 14.2.A — Combat balance dials (light, narrow envelope)
// ---------------------------------------------------------------------------

/**
 * Sàn tuyệt đối cho `MonsterDef.elementalResist[<elem>]` — Phase 14.2.A. Catalog
 * không nên đặt resist < 0.7 (giảm > 30% sát thương) ở foundation phase để
 * không phá tier progression của weapon/skill. `1.0` = neutral (no resist).
 */
export const ELEMENT_MONSTER_RESIST_FLOOR = 0.7;

/**
 * Trần tuyệt đối cho `ItemBonus.elementalAtkBonus[<elem>]` — Phase 14.2.A.
 * Catalog không nên đặt bonus > 0.10 (vượt character primary affinity bonus
 * `ELEMENT_CHARACTER_PRIMARY_BONUS=0.10` ở Phase 11) ở foundation phase. Stack
 * additive across equipped items, capped tổng additive ở
 * {@link ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL}.
 */
export const ELEMENT_EQUIPMENT_ATK_BONUS_CEIL = 0.1;

/**
 * Trần stack additive cho tổng equipment bonus sau khi compose nhiều item —
 * Phase 14.2.A. 5 trang bị × 0.10 = 0.50 nhưng cap về 0.20 để full set
 * không bypass character primary affinity logic.
 */
export const ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL = 0.2;

/**
 * Sàn tuyệt đối cho tổng adjustment Phase 14.2.A pipeline (sau khi compose
 * `multiplier × monsterResist × (1 + equipBonus)`). Chặt hơn
 * `ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6` ở `balance-dials.ts` để Phase 14.2.A
 * layer không over-amplify khi compose chồng với Phase 11 character bonus +
 * talent + buff.
 */
export const ELEMENT_COMBAT_ADJUSTMENT_FLOOR = 0.5;

/**
 * Trần tuyệt đối cho tổng adjustment Phase 14.2.A pipeline. Chặt hơn
 * `ELEMENT_MODIFIER_ABSOLUTE_CEIL=1.5` ở `balance-dials.ts` để cap top-end
 * counter+generate stack.
 */
export const ELEMENT_COMBAT_ADJUSTMENT_CEIL = 1.6;

// ---------------------------------------------------------------------------
// Phase 14.2.A — Monster elemental resist composer
// ---------------------------------------------------------------------------

/**
 * Read `MonsterDef.elementalResist[skillElement]` an toàn. Trả `1.0` (neutral
 * — không resist) nếu:
 *   - `skillElement` null (vô hệ skill / basic attack).
 *   - `resist` undefined hoặc empty map (legacy monster không khai báo).
 *   - Element key không có trong map (monster không resist hệ này).
 *   - Value invalid (NaN / ≤ 0) — defensive guard.
 *
 * Convention: value `< 1` = monster resist (giảm sát thương chịu vào);
 * `1.0` = neutral; `> 1` = vulnerability (Phase 14.2.A foundation chưa wire
 * nhưng không reject để future PR dùng được).
 *
 * Cap floor `ELEMENT_MONSTER_RESIST_FLOOR=0.7` để catalog không thể đặt
 * resist quá mạnh (giảm > 30% damage) — anti-cheese.
 */
export function composeMonsterElementalResist(
  resist: Partial<Record<ElementKey, number>> | undefined,
  skillElement: ElementKey | null,
): number {
  if (skillElement === null) return ELEMENT_NEUTRAL_MULTIPLIER;
  if (!resist) return ELEMENT_NEUTRAL_MULTIPLIER;
  const v = resist[skillElement];
  if (v === undefined || !Number.isFinite(v) || v <= 0) {
    return ELEMENT_NEUTRAL_MULTIPLIER;
  }
  // Clamp về floor để catalog drift / typo không phá balance.
  if (v < ELEMENT_MONSTER_RESIST_FLOOR) return ELEMENT_MONSTER_RESIST_FLOOR;
  return v;
}

// ---------------------------------------------------------------------------
// Phase 14.2.A — Equipment elemental ATK bonus composer
// ---------------------------------------------------------------------------

/**
 * Shape của `ItemBonus.elementalAtkBonus` — Phase 14.2.A optional field. Map
 * skill element → bonus additive (e.g. 0.05 = +5% sát thương khi cast skill
 * `kim`). Stack additive across equipped items, capped tổng ở
 * {@link ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL}.
 *
 * Khác với `ItemBonus.elementResist` (Phase 11.6.E — multiplier resist cho
 * tribulation, không phải combat). 2 field hoàn toàn độc lập.
 */
export type ElementalAtkBonus = Partial<Record<ElementKey, number>>;

/**
 * Compose additive bonus từ list `ItemBonus`-like input (filter `bonuses`
 * field từ `ItemDef`). Stack additive (sum) per element, clamp value invalid,
 * cap per-item ceil + total ceil.
 *
 * @param bonuses list bonus object có optional `elementalAtkBonus` field.
 *   Caller (InventoryService) lọc trang bị đang đeo trước khi pass.
 * @param skillElement element của skill đang cast. `null` = vô hệ → return 0.
 * @returns additive bonus (e.g. `0.07` = +7% damage). Clamp [0, total_ceil].
 *   `0` nếu không có item nào có bonus cho element này.
 */
export function composeEquipmentElementalAtkBonus(
  bonuses: ReadonlyArray<{ elementalAtkBonus?: ElementalAtkBonus } | undefined | null>,
  skillElement: ElementKey | null,
): number {
  if (skillElement === null) return 0;
  let total = 0;
  for (const b of bonuses) {
    if (!b || !b.elementalAtkBonus) continue;
    const v = b.elementalAtkBonus[skillElement];
    if (v === undefined || !Number.isFinite(v) || v <= 0) continue;
    // Per-item cap để 1 trang bị catalog drift không single-handed phá balance.
    const capped = v > ELEMENT_EQUIPMENT_ATK_BONUS_CEIL
      ? ELEMENT_EQUIPMENT_ATK_BONUS_CEIL
      : v;
    total += capped;
  }
  if (total < 0) return 0;
  if (total > ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL) {
    return ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Phase 14.2.A — Pipeline
// ---------------------------------------------------------------------------

/**
 * Pipeline foundation Phase 14.2.A — compose 3 layer Ngũ Hành adjustment cho
 * 1 phát skill cast:
 *
 *   1. **Base multiplier**: `elementalMultiplier(skillElement, targetElement)`
 *      — chu kỳ Ngũ Hành (`describeElementMatch`).
 *   2. **Monster resist** (optional): `composeMonsterElementalResist(target.
 *      elementalResist, skillElement)` — multiplier ≤ 1 nếu monster có resist.
 *   3. **Equipment bonus** (optional): `composeEquipmentElementalAtkBonus(equip.
 *      bonuses, skillElement)` — additive +x% damage nếu trang bị có bonus.
 *
 * Cuối cùng: `final = base × monsterResist × (1 + equipBonus)`, clamp về
 * `[ELEMENT_COMBAT_ADJUSTMENT_FLOOR, ELEMENT_COMBAT_ADJUSTMENT_CEIL]`.
 *
 * Pure function — caller (CombatService) gọi trước khi compose với character/
 * talent/buff layer của Phase 11. Phase 14.2.A KHÔNG override Phase 11 chain;
 * thay vào đó dùng làm 1 layer phụ.
 *
 * @example
 *   // Phase 11 chain: characterSkillElementBonus(...) trả base 1.3 (counter)
 *   // Phase 14.2.A layer: monster resist 0.85 + equip bonus 0.07
 *   //   → final = 1.3 × 0.85 × 1.07 = 1.182  (Phase 11 chain compose riêng)
 *   //   Phase 14.2.A pipeline (skill='kim', target='moc'):
 *   //   base = elementalMultiplier('kim', 'moc') = 1.3
 *   //   monsterResist = 0.85, equipBonus = 0.07
 *   //   final = 1.3 × 0.85 × 1.07 = 1.182 (clamped 1.6)
 */
export interface ElementalCombatAdjustmentInput {
  skillElement: ElementKey | null;
  targetElement: ElementKey | null;
  monsterElementalResist?: Partial<Record<ElementKey, number>>;
  equipmentBonuses?: ReadonlyArray<{ elementalAtkBonus?: ElementalAtkBonus } | undefined | null>;
}

export interface ElementalCombatAdjustmentResult {
  /** Final adjustment multiplier — apply trực tiếp lên damage. */
  multiplier: number;
  /** Base multiplier từ Ngũ Hành cycle (chưa cap). */
  baseMultiplier: number;
  /** Monster resist multiplier (1.0 = neutral). */
  monsterResistMultiplier: number;
  /** Tổng equipment bonus additive (0 = không có bonus). */
  equipmentBonus: number;
  /** Element relation tag — UI hint. */
  relation: ElementRelation;
  /** True nếu pipeline kích hoạt clamp floor/ceil. */
  clamped: boolean;
}

export function applyElementalCombatAdjustment(
  input: ElementalCombatAdjustmentInput,
): ElementalCombatAdjustmentResult {
  const { skillElement, targetElement, monsterElementalResist, equipmentBonuses } = input;
  const match = describeElementMatch(skillElement, targetElement);
  const baseMultiplier = match.multiplier;
  const monsterResistMultiplier = composeMonsterElementalResist(
    monsterElementalResist,
    skillElement,
  );
  const equipmentBonus = composeEquipmentElementalAtkBonus(
    equipmentBonuses ?? [],
    skillElement,
  );
  const raw = baseMultiplier * monsterResistMultiplier * (1 + equipmentBonus);
  let clamped = false;
  let multiplier = raw;
  if (multiplier < ELEMENT_COMBAT_ADJUSTMENT_FLOOR) {
    multiplier = ELEMENT_COMBAT_ADJUSTMENT_FLOOR;
    clamped = true;
  } else if (multiplier > ELEMENT_COMBAT_ADJUSTMENT_CEIL) {
    multiplier = ELEMENT_COMBAT_ADJUSTMENT_CEIL;
    clamped = true;
  }
  return {
    multiplier,
    baseMultiplier,
    monsterResistMultiplier,
    equipmentBonus,
    relation: match.relation,
    clamped,
  };
}

// Re-export Phase 11 envelope cho convenience callsite chỉ import từ
// `elemental.ts` foundation file.
export {
  ELEMENT_MODIFIER_ABSOLUTE_CEIL,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
  ELEMENT_NEUTRAL_MULTIPLIER,
} from './balance-dials';
export type { ElementRelation } from './balance-dials';
