/**
 * Phase 23.3 — Gear Resonance helpers.
 *
 * Resonance là lớp cộng hưởng toàn bộ trang bị, kích hoạt khi đủ điều kiện về
 * tier / enhance / quality / element. Không thay thế tier/realm progression;
 * bonus ratio nhỏ (2–8%/mốc) để khuyến khích người chơi nâng đều cả bộ.
 *
 * Các rule:
 *
 * 1. **Same-Tier Resonance** — 6/6 món đạt tier yêu cầu hoặc cao hơn.
 * 2. **Enhance Resonance** — 6/6 món đạt mốc enhance (+5 / +8 / +12 / +15).
 * 3. **Quality Resonance** — 6/6 món đạt quality (≥ HUYEN / ≥ TIEN / THAN).
 * 4. **Elemental Resonance** — 4/6 cùng hệ (bonus nhỏ); 6/6 cùng hệ (bonus đặc biệt nhẹ).
 * 5. **Hybrid Resonance** — set tương sinh (Mộc+Hoả, Hoả+Thổ, Thổ+Kim, Kim+Thuỷ, Thuỷ+Mộc).
 *
 * Pure / deterministic.
 */

import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';
import type { EquipSlot, Quality } from './enums';
import { getEquipmentElement } from './elemental-equipment';
import { elementGenerates } from './spiritual-root';
import type { EquippedPiece, SetBonusBonusEnvelope } from './equipment-set-bonus';
import { clampEnvelopeToCap, sumEnvelope } from './equipment-set-bonus';
import type { ItemDef } from './items';

function addEnvelope(
  a: SetBonusBonusEnvelope,
  b: SetBonusBonusEnvelope,
): SetBonusBonusEnvelope {
  return {
    atkRatio: (a.atkRatio ?? 0) + (b.atkRatio ?? 0),
    defRatio: (a.defRatio ?? 0) + (b.defRatio ?? 0),
    hpMaxRatio: (a.hpMaxRatio ?? 0) + (b.hpMaxRatio ?? 0),
    mpMaxRatio: (a.mpMaxRatio ?? 0) + (b.mpMaxRatio ?? 0),
    spiritRatio: (a.spiritRatio ?? 0) + (b.spiritRatio ?? 0),
  };
}

const RESONANCE_SAME_TIER_RATIO = 0.03;
const RESONANCE_QUALITY_RATIOS: Record<'HUYEN' | 'TIEN' | 'THAN', number> = {
  HUYEN: 0.02,
  TIEN: 0.03,
  THAN: 0.04,
};
const RESONANCE_ENHANCE_LEVEL_TIERS: readonly { minLevel: number; ratio: number }[] = [
  { minLevel: 5, ratio: 0.02 },
  { minLevel: 8, ratio: 0.02 },
  { minLevel: 12, ratio: 0.03 },
  { minLevel: 15, ratio: 0.03 },
];
/** Tổng cap cho enhance resonance (sum 4 mốc trên = 0.10). */
export const RESONANCE_ENHANCE_TOTAL_CAP = 0.1;
const RESONANCE_ELEMENTAL_4_OF_6_RATIO = 0.04;
const RESONANCE_ELEMENTAL_6_OF_6_RATIO = 0.06;
const RESONANCE_HYBRID_RATIO = 0.03;

const QUALITY_ORDER: Readonly<Record<Quality, number>> = {
  PHAM: 0,
  LINH: 1,
  HUYEN: 2,
  TIEN: 3,
  THAN: 4,
};

export type GearResonanceKind =
  | 'SAME_TIER'
  | 'ENHANCE'
  | 'QUALITY'
  | 'ELEMENTAL'
  | 'HYBRID';

export interface GearResonanceEffect {
  kind: GearResonanceKind;
  /** Mã key i18n (eg `SAME_TIER`, `ENHANCE_5`, `QUALITY_TIEN`, `ELEMENTAL_4`, `HYBRID_KIM_THUY`). */
  key: string;
  /** Tổng ratio (atk/def/hpMax/mpMax/spirit) đã clamp. */
  ratio: SetBonusBonusEnvelope;
  /** Mô tả gameplay tiếng Anh. */
  description: string;
  descriptionVi?: string;
  /** Field meta tuỳ thuộc kind (eg minTier, minQuality, minEnhanceLevel, element pair). */
  meta?: Record<string, string | number | null>;
}

export interface GearResonanceComputeInput {
  piece: EquippedPiece;
  item: Pick<ItemDef, 'slot' | 'equipmentTier' | 'equipmentElement' | 'bonuses' | 'quality'>;
}

export interface GearResonanceSummary {
  active: readonly GearResonanceEffect[];
  /** Tổng ratio (atk/def/hpMax/mpMax/spirit) sau khi gộp + clamp `cap`. */
  totalRatio: SetBonusBonusEnvelope;
  /** Số piece được xét. Resonance yêu cầu ≥ 6 piece (full body). */
  pieceCount: number;
  /** Element chiếm đa số (≥ 4/6) — null nếu không có. */
  dominantElement: ElementKey | null;
  /** Distribution element của 6 piece, cho UI hiển thị. */
  elementDistribution: Readonly<Partial<Record<ElementKey, number>>>;
}

function getPieceTier(input: GearResonanceComputeInput): number | undefined {
  return input.item.equipmentTier ?? input.piece.equipmentTier;
}

function getPieceQuality(input: GearResonanceComputeInput): Quality {
  return input.piece.quality;
}

function getPieceEnhanceLevel(input: GearResonanceComputeInput): number {
  return input.piece.enhanceLevel ?? 0;
}

function getPieceElement(input: GearResonanceComputeInput): ElementKey | null {
  return input.piece.equipmentElement ?? getEquipmentElement(input.item) ?? null;
}

function dedupeByInventoryId(
  inputs: readonly GearResonanceComputeInput[],
): GearResonanceComputeInput[] {
  const seen = new Set<string>();
  const out: GearResonanceComputeInput[] = [];
  for (const input of inputs) {
    if (!input.piece.equippedSlot) continue;
    if (seen.has(input.piece.inventoryItemId)) continue;
    seen.add(input.piece.inventoryItemId);
    out.push(input);
  }
  return out;
}

function dedupeBySlot(
  inputs: readonly GearResonanceComputeInput[],
): GearResonanceComputeInput[] {
  const seen = new Set<EquipSlot>();
  const out: GearResonanceComputeInput[] = [];
  for (const input of inputs) {
    const slot = input.piece.equippedSlot;
    if (!slot) continue;
    if (seen.has(slot)) continue;
    seen.add(slot);
    out.push(input);
  }
  return out;
}

/** ≥ 6 piece body, mỗi piece có tier ≥ minTier. */
function computeSameTier(
  inputs: readonly GearResonanceComputeInput[],
): GearResonanceEffect | null {
  if (inputs.length < 6) return null;
  const tiers: number[] = [];
  for (const input of inputs) {
    const tier = getPieceTier(input);
    if (tier === undefined) return null;
    tiers.push(tier);
  }
  const minTier = Math.min(...tiers);
  return {
    kind: 'SAME_TIER',
    key: 'SAME_TIER',
    ratio: { atkRatio: RESONANCE_SAME_TIER_RATIO / 5, defRatio: RESONANCE_SAME_TIER_RATIO / 5, hpMaxRatio: RESONANCE_SAME_TIER_RATIO / 5, mpMaxRatio: RESONANCE_SAME_TIER_RATIO / 5, spiritRatio: RESONANCE_SAME_TIER_RATIO / 5 },
    description: `Full ${inputs.length}-piece body of tier ${minTier}+: +${(RESONANCE_SAME_TIER_RATIO * 100).toFixed(0)}% balanced stats.`,
    descriptionVi: `Mặc đủ ${inputs.length} món tier ${minTier}+: +${(RESONANCE_SAME_TIER_RATIO * 100).toFixed(0)}% chỉ số cơ bản.`,
    meta: { minTier },
  };
}

/** Enhance resonance — mỗi mốc kích hoạt độc lập, tổng cap = `RESONANCE_ENHANCE_TOTAL_CAP`. */
function computeEnhance(
  inputs: readonly GearResonanceComputeInput[],
): GearResonanceEffect[] {
  if (inputs.length < 6) return [];
  const minLevel = inputs.reduce<number | null>((acc, input) => {
    const level = getPieceEnhanceLevel(input);
    if (acc === null) return level;
    return Math.min(acc, level);
  }, null);
  if (minLevel === null) return [];
  const active: GearResonanceEffect[] = [];
  let cumulative = 0;
  for (const milestone of RESONANCE_ENHANCE_LEVEL_TIERS) {
    if (minLevel < milestone.minLevel) break;
    cumulative += milestone.ratio;
    if (cumulative > RESONANCE_ENHANCE_TOTAL_CAP + 1e-9) break;
    const balanced = milestone.ratio / 5;
    active.push({
      kind: 'ENHANCE',
      key: `ENHANCE_${milestone.minLevel}`,
      ratio: {
        atkRatio: balanced,
        defRatio: balanced,
        hpMaxRatio: balanced,
        mpMaxRatio: balanced,
        spiritRatio: balanced,
      },
      description: `Full body +${milestone.minLevel} or higher: +${(milestone.ratio * 100).toFixed(0)}% balanced stats.`,
      descriptionVi: `Toàn bộ trang bị đạt +${milestone.minLevel}: +${(milestone.ratio * 100).toFixed(0)}% chỉ số cơ bản.`,
      meta: { minLevel: milestone.minLevel },
    });
  }
  return active;
}

/** Quality resonance — mốc cao nhất kích hoạt (≥ HUYEN / ≥ TIEN / THAN). */
function computeQuality(
  inputs: readonly GearResonanceComputeInput[],
): GearResonanceEffect | null {
  if (inputs.length < 6) return null;
  const minQualityOrder = inputs.reduce<number | null>((acc, input) => {
    const q = QUALITY_ORDER[getPieceQuality(input)];
    if (acc === null) return q;
    return Math.min(acc, q);
  }, null);
  if (minQualityOrder === null) return null;
  if (minQualityOrder < QUALITY_ORDER.HUYEN) return null;
  let quality: 'HUYEN' | 'TIEN' | 'THAN';
  if (minQualityOrder >= QUALITY_ORDER.THAN) quality = 'THAN';
  else if (minQualityOrder >= QUALITY_ORDER.TIEN) quality = 'TIEN';
  else quality = 'HUYEN';
  const ratio = RESONANCE_QUALITY_RATIOS[quality];
  const balanced = ratio / 5;
  return {
    kind: 'QUALITY',
    key: `QUALITY_${quality}`,
    ratio: {
      atkRatio: balanced,
      defRatio: balanced,
      hpMaxRatio: balanced,
      mpMaxRatio: balanced,
      spiritRatio: balanced,
    },
    description: `Full body ≥ ${quality}: +${(ratio * 100).toFixed(0)}% balanced stats.`,
    descriptionVi: `Toàn bộ trang bị từ phẩm ${quality} trở lên: +${(ratio * 100).toFixed(0)}% chỉ số cơ bản.`,
    meta: { minQuality: quality },
  };
}

/** Build dominant element distribution. */
function buildElementDistribution(
  inputs: readonly GearResonanceComputeInput[],
): { distribution: Partial<Record<ElementKey, number>>; dominant: ElementKey | null } {
  const distribution: Partial<Record<ElementKey, number>> = {};
  for (const input of inputs) {
    const element = getPieceElement(input);
    if (!element) continue;
    distribution[element] = (distribution[element] ?? 0) + 1;
  }
  let dominant: ElementKey | null = null;
  let max = 0;
  for (const element of ELEMENTS) {
    const count = distribution[element] ?? 0;
    if (count > max) {
      dominant = element;
      max = count;
    }
  }
  return { distribution, dominant: max >= 4 ? dominant : null };
}

function computeElemental(
  inputs: readonly GearResonanceComputeInput[],
  distribution: Partial<Record<ElementKey, number>>,
  dominant: ElementKey | null,
): GearResonanceEffect | null {
  if (!dominant) return null;
  const count = distribution[dominant] ?? 0;
  if (count < 4) return null;
  const ratio = count >= 6 ? RESONANCE_ELEMENTAL_6_OF_6_RATIO : RESONANCE_ELEMENTAL_4_OF_6_RATIO;
  // Elemental resonance bonus thiên hướng theo dominant element vai trò.
  let envelope: SetBonusBonusEnvelope;
  switch (dominant) {
    case 'kim':
      envelope = { atkRatio: ratio * 0.6, spiritRatio: ratio * 0.2, defRatio: ratio * 0.2 };
      break;
    case 'moc':
      envelope = { hpMaxRatio: ratio * 0.5, mpMaxRatio: ratio * 0.3, spiritRatio: ratio * 0.2 };
      break;
    case 'thuy':
      envelope = { spiritRatio: ratio * 0.5, mpMaxRatio: ratio * 0.3, defRatio: ratio * 0.2 };
      break;
    case 'hoa':
      envelope = { atkRatio: ratio * 0.5, spiritRatio: ratio * 0.3, mpMaxRatio: ratio * 0.2 };
      break;
    case 'tho':
      envelope = { defRatio: ratio * 0.5, hpMaxRatio: ratio * 0.4, spiritRatio: ratio * 0.1 };
      break;
  }
  // Inputs param chỉ dùng để xác định "context". Không phụ thuộc trực tiếp.
  void inputs;
  return {
    kind: 'ELEMENTAL',
    key: `ELEMENTAL_${count}_OF_6_${dominant.toUpperCase()}`,
    ratio: envelope,
    description: `${count}/6 ${dominant} affinity: +${(ratio * 100).toFixed(0)}% role-tuned stats.`,
    descriptionVi: `${count}/6 cùng hệ ${dominant}: +${(ratio * 100).toFixed(0)}% chỉ số theo vai trò.`,
    meta: { element: dominant, count },
  };
}

/**
 * Hybrid resonance — set tương sinh:
 *   - Mộc → Hoả
 *   - Hoả → Thổ
 *   - Thổ → Kim
 *   - Kim → Thuỷ
 *   - Thuỷ → Mộc
 * Kích hoạt khi 2 element tương sinh đều có ≥ 2 piece (tổng ≥ 4 piece trong
 * 6 piece body — phần còn lại có thể là vô hệ hoặc khác).
 */
function computeHybrid(
  distribution: Partial<Record<ElementKey, number>>,
): GearResonanceEffect | null {
  for (const a of ELEMENTS) {
    const b = elementGenerates(a);
    const countA = distribution[a] ?? 0;
    const countB = distribution[b] ?? 0;
    if (countA >= 2 && countB >= 2 && countA + countB >= 4) {
      const ratio = RESONANCE_HYBRID_RATIO;
      return {
        kind: 'HYBRID',
        key: `HYBRID_${a.toUpperCase()}_${b.toUpperCase()}`,
        ratio: {
          atkRatio: ratio * 0.4,
          defRatio: ratio * 0.2,
          hpMaxRatio: ratio * 0.2,
          spiritRatio: ratio * 0.2,
        },
        description: `${a} generates ${b} hybrid resonance: +${(ratio * 100).toFixed(0)}% balanced stats.`,
        descriptionVi: `Tương sinh ${a} → ${b}: +${(ratio * 100).toFixed(0)}% chỉ số cân bằng.`,
        meta: { from: a, to: b, countA, countB },
      };
    }
  }
  return null;
}

/**
 * Compute toàn bộ gear resonance từ trang bị đang đeo. Dedup theo
 * `inventoryItemId` rồi theo slot (không cho phép 2 item cùng slot).
 *
 * @param cap Tổng cap tối đa cho resonance. Mặc định 0.2 (= 20%) để chừa room cho
 *            set bonus envelope ở `equipment-build.ts`.
 */
export function computeGearResonance(
  inputs: readonly GearResonanceComputeInput[],
  cap = 0.2,
): GearResonanceSummary {
  const dedupedById = dedupeByInventoryId(inputs);
  const deduped = dedupeBySlot(dedupedById);
  const active: GearResonanceEffect[] = [];

  if (deduped.length >= 6) {
    const sameTier = computeSameTier(deduped);
    if (sameTier) active.push(sameTier);
    for (const e of computeEnhance(deduped)) active.push(e);
    const quality = computeQuality(deduped);
    if (quality) active.push(quality);
  }

  const { distribution, dominant } = buildElementDistribution(deduped);
  if (deduped.length >= 6) {
    const elemental = computeElemental(deduped, distribution, dominant);
    if (elemental) active.push(elemental);
  }
  const hybrid = computeHybrid(distribution);
  if (hybrid) active.push(hybrid);

  let total: SetBonusBonusEnvelope = {};
  for (const effect of active) total = addEnvelope(total, effect.ratio);
  total = clampEnvelopeToCap(total, cap);

  return {
    active,
    totalRatio: total,
    pieceCount: deduped.length,
    dominantElement: dominant,
    elementDistribution: distribution,
  };
}

/**
 * Compute riêng elemental resonance (4/6 và 6/6 cùng hệ) — wrap quanh
 * `computeGearResonance` để filter chỉ effect ELEMENTAL/HYBRID. Hữu ích cho
 * UI hiển thị nhóm "Ngũ Hành" tách bạch.
 */
export function computeElementalResonance(
  inputs: readonly GearResonanceComputeInput[],
): readonly GearResonanceEffect[] {
  const summary = computeGearResonance(inputs);
  return summary.active.filter((e) => e.kind === 'ELEMENTAL' || e.kind === 'HYBRID');
}

export type ResonanceValidationError =
  | 'INVALID_KIND'
  | 'INVALID_RATIO_TOTAL'
  | 'INVALID_RATIO_NEGATIVE';

export function validateResonanceDefinition(effect: GearResonanceEffect): {
  ok: boolean;
  errors: readonly ResonanceValidationError[];
} {
  const errors: ResonanceValidationError[] = [];
  const validKinds: readonly GearResonanceKind[] = [
    'SAME_TIER',
    'ENHANCE',
    'QUALITY',
    'ELEMENTAL',
    'HYBRID',
  ];
  if (!validKinds.includes(effect.kind)) errors.push('INVALID_KIND');
  const total = sumEnvelope(effect.ratio);
  if (total > 0.12 + 1e-9) errors.push('INVALID_RATIO_TOTAL');
  for (const v of [
    effect.ratio.atkRatio,
    effect.ratio.defRatio,
    effect.ratio.hpMaxRatio,
    effect.ratio.mpMaxRatio,
    effect.ratio.spiritRatio,
  ]) {
    if (v !== undefined && (v < 0 || !Number.isFinite(v))) {
      errors.push('INVALID_RATIO_NEGATIVE');
      break;
    }
  }
  return { ok: errors.length === 0, errors };
}


