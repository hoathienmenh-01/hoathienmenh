/**
 * Phase 23.3 — Equipment build orchestrator.
 *
 * Gộp `computeActiveSetBonuses` + `computeGearResonance` thành 1 summary cho
 * UI và stat aggregation (server). Áp **tổng cap** chung
 * `EQUIPMENT_BUILD_TOTAL_BONUS_CAP` để bonus phụ (set + resonance) không
 * vượt 30% baseline — bảo vệ Phase 23.2 power budget không bị phá.
 *
 * Pure / deterministic.
 */

import type { ElementKey } from './combat';
import type { EquipSlot } from './enums';
import type { ItemDef } from './items';
import { itemWithProgression } from './items';
import {
  type ActiveSetBonus,
  type EquippedPiece,
  type EquippedSetGroup,
  type SetBonusBonusEnvelope,
  clampEnvelopeToCap,
  computeActiveSetBonuses,
  getEquippedSetPieces,
  sumEnvelope,
} from './equipment-set-bonus';
import {
  computeGearResonance,
  type GearResonanceEffect,
  type GearResonanceSummary,
} from './equipment-resonance';
import { getEquipmentElement } from './elemental-equipment';

/**
 * Tổng cap cho bonus phụ (set + resonance) cộng dồn. 30% baseline atk/def/
 * hpMax/mpMax/spirit. Không cộng vào socket / refine / substat / enchant
 * — những hệ đó đã có cap riêng (`EQUIPMENT_GEM_BONUS_RATIO_CAP` etc.).
 */
export const EQUIPMENT_BUILD_TOTAL_BONUS_CAP = 0.3;

export interface EquipmentBuildInputPiece {
  piece: EquippedPiece;
  item: ItemDef;
}

export interface EquipmentBuildSummary {
  /** Số piece body đang equip + match progression metadata. */
  pieceCount: number;
  /** Element chiếm đa số (≥ 4/6) — null nếu không có. */
  mainElement: ElementKey | null;
  /** Element distribution 6 slot. */
  elementDistribution: Readonly<Partial<Record<ElementKey, number>>>;
  /** Active sets (mỗi setKey 1 entry, 2/4/6-piece đã gộp). */
  activeSets: readonly ActiveSetBonus[];
  /** Số set đang active (pieceCount ≥ 2). */
  activeSetCount: number;
  /** Set groups raw (mọi setKey có ≥ 1 piece equip), cho UI hiển thị slot còn thiếu. */
  setGroups: ReadonlyMap<string, EquippedSetGroup>;
  /** Gear resonance summary. */
  resonance: GearResonanceSummary;
  /** Tổng bonus ratio sau khi clamp về `EQUIPMENT_BUILD_TOTAL_BONUS_CAP`. */
  totalBonusRatio: SetBonusBonusEnvelope;
  /** Tổng power score xấp xỉ (sum `computedPowerScore` / `powerBudget`). */
  totalPowerScore: number;
  /** Resonance tier nhãn cho UI (NONE / BASIC / TUNED / HARMONIZED / ASCENDANT). */
  resonanceTier: ResonanceTier;
}

export type ResonanceTier =
  | 'NONE'
  | 'BASIC'
  | 'TUNED'
  | 'HARMONIZED'
  | 'ASCENDANT';

function resonanceTierFor(effects: readonly GearResonanceEffect[]): ResonanceTier {
  if (effects.length === 0) return 'NONE';
  if (effects.length >= 5) return 'ASCENDANT';
  if (effects.length >= 4) return 'HARMONIZED';
  if (effects.length >= 2) return 'TUNED';
  return 'BASIC';
}

function withProgression(item: ItemDef): ItemDef {
  return itemWithProgression(item);
}

/**
 * Compute toàn bộ summary build từ list trang bị đang đeo. Input có thể là
 * row `InventoryItem` + `ItemDef` raw — helper tự apply
 * `itemWithProgression` để fill `equipmentTier` cho legacy items.
 */
export function summarizeEquipmentBuild(
  inputs: readonly EquipmentBuildInputPiece[],
): EquipmentBuildSummary {
  const normalized: EquipmentBuildInputPiece[] = inputs
    .filter((i) => i.piece.equippedSlot !== null)
    .map((i) => ({ piece: i.piece, item: withProgression(i.item) }));

  const setGroups = getEquippedSetPieces(
    normalized.map((i) => ({ piece: i.piece, item: i.item })),
  );
  const activeSets = computeActiveSetBonuses(setGroups);
  const resonance = computeGearResonance(normalized.map((i) => ({ piece: i.piece, item: i.item })));

  // Dedup theo slot để tính pieceCount + element distribution chính xác.
  const seenSlots = new Set<EquipSlot>();
  const dedupedSlots: EquipmentBuildInputPiece[] = [];
  const seenIds = new Set<string>();
  for (const i of normalized) {
    if (!i.piece.equippedSlot) continue;
    if (seenIds.has(i.piece.inventoryItemId)) continue;
    seenIds.add(i.piece.inventoryItemId);
    if (seenSlots.has(i.piece.equippedSlot)) continue;
    seenSlots.add(i.piece.equippedSlot);
    dedupedSlots.push(i);
  }

  const distribution: Partial<Record<ElementKey, number>> = {};
  let totalPowerScore = 0;
  for (const i of dedupedSlots) {
    const element = i.piece.equipmentElement ?? getEquipmentElement(i.item);
    if (element) distribution[element] = (distribution[element] ?? 0) + 1;
    totalPowerScore += i.item.computedPowerScore ?? i.item.powerBudget ?? 0;
  }

  // Gộp tổng bonus ratio (set + resonance) → clamp về EQUIPMENT_BUILD_TOTAL_BONUS_CAP.
  let combined: SetBonusBonusEnvelope = {};
  for (const set of activeSets) {
    combined = {
      atkRatio: (combined.atkRatio ?? 0) + (set.totalRatio.atkRatio ?? 0),
      defRatio: (combined.defRatio ?? 0) + (set.totalRatio.defRatio ?? 0),
      hpMaxRatio: (combined.hpMaxRatio ?? 0) + (set.totalRatio.hpMaxRatio ?? 0),
      mpMaxRatio: (combined.mpMaxRatio ?? 0) + (set.totalRatio.mpMaxRatio ?? 0),
      spiritRatio: (combined.spiritRatio ?? 0) + (set.totalRatio.spiritRatio ?? 0),
    };
  }
  combined = {
    atkRatio: (combined.atkRatio ?? 0) + (resonance.totalRatio.atkRatio ?? 0),
    defRatio: (combined.defRatio ?? 0) + (resonance.totalRatio.defRatio ?? 0),
    hpMaxRatio: (combined.hpMaxRatio ?? 0) + (resonance.totalRatio.hpMaxRatio ?? 0),
    mpMaxRatio: (combined.mpMaxRatio ?? 0) + (resonance.totalRatio.mpMaxRatio ?? 0),
    spiritRatio: (combined.spiritRatio ?? 0) + (resonance.totalRatio.spiritRatio ?? 0),
  };
  combined = clampEnvelopeToCap(combined, EQUIPMENT_BUILD_TOTAL_BONUS_CAP);

  // Main element: ≥ 4/6 cùng hệ (giống dominantElement của resonance).
  const mainElement = resonance.dominantElement;

  return {
    pieceCount: dedupedSlots.length,
    mainElement,
    elementDistribution: distribution,
    activeSets,
    activeSetCount: activeSets.length,
    setGroups,
    resonance,
    totalBonusRatio: combined,
    totalPowerScore,
    resonanceTier: resonanceTierFor(resonance.active),
  };
}

/**
 * Re-export tổng bonus ratio (atk/def/hpMax/mpMax/spirit) đã clamp.
 * Hữu ích cho stat aggregation: cộng vào baseline atk/def/hpMax sau khi
 * gộp item + socket + refine + substat + enchant.
 */
export function getBuildBonusRatio(
  inputs: readonly EquipmentBuildInputPiece[],
): SetBonusBonusEnvelope {
  return summarizeEquipmentBuild(inputs).totalBonusRatio;
}

/**
 * Apply ratio envelope lên baseline. Mỗi field nhân với 1 + ratio (additive
 * percent). Return integer (round) cho stat aggregation backend.
 *
 * Bonus = baseline * ratio.
 */
export function applyBuildBonusRatio(
  baseline: { atk: number; def: number; hpMax: number; mpMax: number; spirit: number },
  ratio: SetBonusBonusEnvelope,
): { atk: number; def: number; hpMax: number; mpMax: number; spirit: number } {
  return {
    atk: Math.round(baseline.atk * (ratio.atkRatio ?? 0)),
    def: Math.round(baseline.def * (ratio.defRatio ?? 0)),
    hpMax: Math.round(baseline.hpMax * (ratio.hpMaxRatio ?? 0)),
    mpMax: Math.round(baseline.mpMax * (ratio.mpMaxRatio ?? 0)),
    spirit: Math.round(baseline.spirit * (ratio.spiritRatio ?? 0)),
  };
}

/** Total bonus % (sum of all stat ratios) — convenience cho UI tooltip. */
export function getTotalBonusPercent(ratio: SetBonusBonusEnvelope): number {
  return Math.round(sumEnvelope(ratio) * 100);
}
