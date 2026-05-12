/**
 * Phase 23.4 — Equipment Upgrade Economy / Resource Sink (shared layer).
 *
 * Helper deterministic (không IO, không phụ thuộc Prisma) cho:
 *
 *   - {@link getEquipmentEnhanceCost}: cost cường hóa (refine) — kết hợp
 *     `REFINE_LEVELS` legacy + slot/tier weight Phase 23.4.
 *   - {@link getEquipmentMergeCost}: cost ghép 3 món cùng tier/quality/slot
 *     thành 1 món quality cao hơn.
 *   - {@link getEquipmentDismantleYield}: yield phân giải đồ cũ → nguyên liệu.
 *   - {@link getGemSocketCost} / {@link getGemUnsocketCost}: cost khảm / tháo.
 *   - {@link getReforgeCost}: cost reforge substat (tăng theo `reforgeCount`,
 *     cap theo `maxReforgeCount`).
 *   - {@link getProtectionCharmRequirement}: gợi ý / bắt buộc protection charm
 *     khi cường hóa mốc cao (hook monetization Phase 25.1).
 *   - {@link validateEquipmentUpgradeRequest} / {@link validateEquipmentMergeRequest}
 *     / {@link validateDismantleRequest}: pre-flight validator (server gọi
 *     trước khi mutate, UI gọi trước khi enable nút).
 *
 * Nguyên tắc:
 *   - Không hardcode rải rác — mọi cost / yield qua helper.
 *   - Dismantle yield tổng giá trị < cost merge tạo item cùng quality
 *     (anti-infinite-resource invariant — xem
 *     {@link getEquipmentDismantleValueScore}).
 *   - Helper thuần (no Math.random / no Date.now) → test deterministic.
 *   - Phase 23.4 KHÔNG thêm Prisma migration; idempotency dùng ledger meta.
 */

import type { EquipSlot, Quality } from './enums';
import {
  EQUIPMENT_TIERS,
  type EquipmentTierNumber,
  type EquipmentSlotLike,
  getEnhanceCapForTier,
  getQualityMultiplier,
  getSlotWeight,
  getTierBasePower,
} from './equipment-progression';

// ---------------------------------------------------------------------------
// Quality ladder
// ---------------------------------------------------------------------------

/** PHAM → LINH → HUYEN → TIEN → THAN; THAN không ghép tiếp. */
export const MERGE_QUALITY_LADDER: readonly Quality[] = [
  'PHAM',
  'LINH',
  'HUYEN',
  'TIEN',
  'THAN',
] as const;

/** Quality kế tiếp khi merge thành công. `null` cho `THAN`. */
export function getNextMergeQuality(quality: Quality): Quality | null {
  const idx = MERGE_QUALITY_LADDER.indexOf(quality);
  if (idx < 0) return null;
  if (idx >= MERGE_QUALITY_LADDER.length - 1) return null;
  return MERGE_QUALITY_LADDER[idx + 1];
}

/** Bậc của quality trong ladder (PHAM=0, THAN=4). `-1` nếu unknown. */
export function getQualityLadderIndex(quality: Quality): number {
  return MERGE_QUALITY_LADDER.indexOf(quality);
}

/** Số item nguồn cần để ghép — mặc định 3, tunable nếu cần. */
export const EQUIPMENT_MERGE_INPUT_COUNT = 3;

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

function clampTier(input: number): EquipmentTierNumber {
  if (!Number.isInteger(input) || input < 1 || input > EQUIPMENT_TIERS.length) {
    throw new RangeError(`equipmentTier out of range: ${input} (must be 1..10)`);
  }
  return input as EquipmentTierNumber;
}

// ---------------------------------------------------------------------------
// Quality cost multiplier (lower than power multiplier — economy curve)
// ---------------------------------------------------------------------------

/** Cost multiplier per quality. Steeper than power multiplier để late-game sink mạnh hơn. */
const QUALITY_COST_MULTIPLIER: Readonly<Record<Quality, number>> = {
  PHAM: 1,
  LINH: 1.6,
  HUYEN: 2.6,
  TIEN: 4.5,
  THAN: 8,
};

export function getQualityCostMultiplier(quality: Quality): number {
  return QUALITY_COST_MULTIPLIER[quality];
}

// ---------------------------------------------------------------------------
// Reforge cap per quality
// ---------------------------------------------------------------------------

/** Max số lần reforge cho 1 item — cap theo quality (giữ economy không vô hạn). */
const MAX_REFORGE_COUNT_BY_QUALITY: Readonly<Record<Quality, number>> = {
  PHAM: 5,
  LINH: 8,
  HUYEN: 12,
  TIEN: 16,
  THAN: 20,
};

export function getMaxReforgeCount(quality: Quality): number {
  return MAX_REFORGE_COUNT_BY_QUALITY[quality];
}

// ---------------------------------------------------------------------------
// Materials per quality (matches existing catalog keys)
// ---------------------------------------------------------------------------

const MERGE_MATERIAL_KEY_BY_QUALITY: Readonly<Record<Quality, string>> = {
  PHAM: 'tinh_thiet',
  LINH: 'tinh_thiet',
  HUYEN: 'yeu_dan',
  TIEN: 'han_ngoc',
  THAN: 'han_ngoc',
};

/** Item key cho protection charm khi cường hóa mốc cao. Item đã có Phase 11.5.B. */
export const EQUIPMENT_UPGRADE_PROTECTION_ITEM_KEY = 'refine_protection_charm';

// ---------------------------------------------------------------------------
// Enhance cost
// ---------------------------------------------------------------------------

export interface EquipmentEnhanceCostInput {
  /** Equipment tier 1..10 (Phase 23.2). */
  equipmentTier: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  /** Level hiện tại (0..`maxEnhanceLevel-1`). Next level = +1. */
  currentEnhanceLevel: number;
}

export interface EquipmentEnhanceCostOutput {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  /** True nếu mốc kế tiếp khuyến nghị / bắt buộc dùng protection charm. */
  protectionRecommended: boolean;
  /** True nếu mốc kế tiếp **bắt buộc** protection charm (high tier + extreme stage). */
  protectionRequired: boolean;
}

/**
 * Cost cường hóa 1 cấp (currentEnhanceLevel → currentEnhanceLevel+1).
 *
 * Formula: `enhanceCost = baseTierCost * slotWeight * qualityMultiplier
 *                       * (1.25 ^ currentEnhanceLevel)`.
 *
 * baseTierCost = `getTierBasePower(equipmentTier) / 5` (rounded). Material
 * theo quality (`tinh_thiet`/`yeu_dan`/`han_ngoc`). Material qty scale
 * theo `floor(currentEnhanceLevel / 3) + 1`.
 *
 * Throws nếu `currentEnhanceLevel >= maxEnhanceLevel(equipmentTier)`.
 */
export function getEquipmentEnhanceCost(
  input: EquipmentEnhanceCostInput,
): EquipmentEnhanceCostOutput {
  const tier = clampTier(input.equipmentTier);
  const cap = getEnhanceCapForTier(tier);
  if (!Number.isInteger(input.currentEnhanceLevel) || input.currentEnhanceLevel < 0) {
    throw new RangeError(`currentEnhanceLevel invalid: ${input.currentEnhanceLevel}`);
  }
  if (input.currentEnhanceLevel >= cap) {
    throw new RangeError(
      `currentEnhanceLevel ${input.currentEnhanceLevel} >= cap ${cap} for tier ${tier}`,
    );
  }
  const baseTierCost = Math.max(20, Math.round(getTierBasePower(tier) / 5));
  const slotWeight = getSlotWeight(input.slot);
  const qualityMul = getQualityCostMultiplier(input.quality);
  const growth = Math.pow(1.25, input.currentEnhanceLevel);
  const linhThachCost = Math.round(baseTierCost * slotWeight * qualityMul * growth);
  const materialKey = MERGE_MATERIAL_KEY_BY_QUALITY[input.quality];
  const materialQty = Math.floor(input.currentEnhanceLevel / 3) + 1;
  const protectionInfo = getProtectionCharmRequirement({
    equipmentTier: tier,
    quality: input.quality,
    nextEnhanceLevel: input.currentEnhanceLevel + 1,
  });
  return {
    linhThachCost,
    materialKey,
    materialQty,
    protectionRecommended: protectionInfo.recommended,
    protectionRequired: protectionInfo.required,
  };
}

// ---------------------------------------------------------------------------
// Merge cost
// ---------------------------------------------------------------------------

export interface EquipmentMergeCostInput {
  equipmentTier: number;
  /** Quality của 3 món nguồn (PHAM/LINH/HUYEN/TIEN). THAN sẽ throw. */
  sourceQuality: Quality;
  slot: EquipmentSlotLike;
}

export interface EquipmentMergeCostOutput {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  /** Quality của item output (= next quality của sourceQuality). */
  outputQuality: Quality;
}

/**
 * Cost ghép 3 món `sourceQuality` cùng tier/slot → 1 món `next(sourceQuality)`.
 *
 * Throws nếu `sourceQuality === 'THAN'` (đã ở cap).
 *
 * Cost gợi ý:
 *   - linhThach = baseLinhThach(quality) × equipmentTier.
 *   - material qty = baseMatQty(quality) × equipmentTier.
 */
export function getEquipmentMergeCost(
  input: EquipmentMergeCostInput,
): EquipmentMergeCostOutput {
  const tier = clampTier(input.equipmentTier);
  const next = getNextMergeQuality(input.sourceQuality);
  if (next === null) {
    throw new RangeError(`Cannot merge from quality ${input.sourceQuality} (already at cap)`);
  }
  const slotMul = Math.max(0.5, getSlotWeight(input.slot)); // slot có cost thấp không cho free
  const baseByQuality: Record<Quality, { lt: number; matQty: number }> = {
    PHAM: { lt: 200, matQty: 2 },
    LINH: { lt: 600, matQty: 4 },
    HUYEN: { lt: 1800, matQty: 2 },
    TIEN: { lt: 6000, matQty: 1 },
    THAN: { lt: 0, matQty: 0 }, // unreachable (throw above)
  };
  const base = baseByQuality[input.sourceQuality];
  const linhThachCost = Math.round(base.lt * tier * slotMul);
  const materialKey = MERGE_MATERIAL_KEY_BY_QUALITY[input.sourceQuality];
  const materialQty = Math.max(1, Math.round(base.matQty * tier));
  return {
    linhThachCost,
    materialKey,
    materialQty,
    outputQuality: next,
  };
}

// ---------------------------------------------------------------------------
// Dismantle yield
// ---------------------------------------------------------------------------

export interface EquipmentDismantleYieldInput {
  equipmentTier: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  /** Level cường hóa hiện tại — yield một phần linhThach bồi thường. */
  enhanceLevel?: number;
  /** Số gem đã khảm — gem được trả về riêng, không tính ở `yield`. */
  socketCount?: number;
}

export interface EquipmentDismantleYieldEntry {
  itemKey: string;
  qty: number;
}

export interface EquipmentDismantleYieldOutput {
  linhThachYield: number;
  materials: EquipmentDismantleYieldEntry[];
  /** Tổng "score" trị giá (linhThach equivalent) — dùng để verify invariant. */
  valueScore: number;
}

/**
 * Yield khi phân giải 1 item.
 *
 * Yield theo bậc:
 *   - PHAM: ít `tinh_thiet`.
 *   - LINH: `tinh_thiet` × 2 + `linh_thao` × 1 (PHASE 23.4 dùng `linh_thao`
 *     thay cho `spirit_dust` để giữ catalog hiện tại).
 *   - HUYEN: `yeu_dan` × 1 + `phu_van_ngoc` × 1.
 *   - TIEN: `yeu_dan` × 2 + `han_ngoc` × 1.
 *   - THAN: `han_ngoc` × 2 + `tien_kim_sa` × 1.
 *
 * LinhThach yield = `baseLT(quality) × equipmentTier × (1 + enhanceLevel × 0.05)`
 * — bonus theo cấp cường hóa (đầu tư nhiều = yield cao hơn nhưng vẫn dưới cost
 * merge).
 *
 * Invariant: tổng `valueScore` < cost merge cùng quality
 * (xem {@link assertDismantleYieldInvariant}).
 */
export function getEquipmentDismantleYield(
  input: EquipmentDismantleYieldInput,
): EquipmentDismantleYieldOutput {
  const tier = clampTier(input.equipmentTier);
  const enhanceLevel = input.enhanceLevel ?? 0;
  if (!Number.isInteger(enhanceLevel) || enhanceLevel < 0) {
    throw new RangeError(`enhanceLevel invalid: ${enhanceLevel}`);
  }
  const baseLTByQuality: Record<Quality, number> = {
    PHAM: 10,
    LINH: 30,
    HUYEN: 100,
    TIEN: 300,
    THAN: 1000,
  };
  const linhThachYield = Math.round(
    baseLTByQuality[input.quality] * tier * (1 + enhanceLevel * 0.05),
  );
  const materials: EquipmentDismantleYieldEntry[] = [];
  switch (input.quality) {
    case 'PHAM':
      materials.push({ itemKey: 'tinh_thiet', qty: 1 });
      break;
    case 'LINH':
      materials.push({ itemKey: 'tinh_thiet', qty: 2 });
      if (tier >= 3) materials.push({ itemKey: 'linh_thao', qty: 1 });
      break;
    case 'HUYEN':
      materials.push({ itemKey: 'yeu_dan', qty: 1 });
      materials.push({ itemKey: 'phu_van_ngoc', qty: 1 });
      break;
    case 'TIEN':
      materials.push({ itemKey: 'yeu_dan', qty: 2 });
      materials.push({ itemKey: 'han_ngoc', qty: 1 });
      break;
    case 'THAN':
      materials.push({ itemKey: 'han_ngoc', qty: 1 });
      materials.push({ itemKey: 'tien_kim_sa', qty: 1 });
      break;
  }
  const valueScore = computeDismantleValueScore(linhThachYield, materials);
  return { linhThachYield, materials, valueScore };
}

/** Approximate linh thạch equivalent của 1 yield entry (giống price trong ITEMS). */
const MATERIAL_PRICE_APPROX: Readonly<Record<string, number>> = {
  tinh_thiet: 80,
  yeu_dan: 250,
  han_ngoc: 1200,
  linh_thao: 35,
  phu_van_ngoc: 280,
  tien_kim_sa: 1600,
};

function computeDismantleValueScore(
  linhThach: number,
  materials: readonly EquipmentDismantleYieldEntry[],
): number {
  let score = linhThach;
  for (const m of materials) {
    const price = MATERIAL_PRICE_APPROX[m.itemKey] ?? 50;
    score += price * m.qty;
  }
  return score;
}

/** Cost merge "score" approximation cho invariant check. */
function computeMergeCostScore(merge: EquipmentMergeCostOutput): number {
  const price = MATERIAL_PRICE_APPROX[merge.materialKey] ?? 50;
  return merge.linhThachCost + price * merge.materialQty;
}

/**
 * Invariant: yield phân giải < cost merge cùng quality.
 *
 * `dismantle(quality=Q).valueScore < merge(sourceQuality=Q).valueScore` cho mọi
 * Q ∈ {PHAM, LINH, HUYEN, TIEN}. Phía THAN dismantle so với merge HUYEN → TIEN
 * × 3 (slot vô hạn) sẽ skip — guard riêng để THAN yield < merge từ TIEN.
 *
 * Throws nếu vi phạm — test catalog drift.
 */
export function assertDismantleYieldInvariant(
  equipmentTier: number,
  slot: EquipmentSlotLike,
): void {
  for (const quality of MERGE_QUALITY_LADDER) {
    const yieldRes = getEquipmentDismantleYield({ equipmentTier, quality, slot });
    if (quality === 'THAN') {
      // THAN không merge tiếp, so sánh với TIEN merge cost cùng tier — yield
      // THAN phải < cost merge TIEN → THAN.
      const mergeUp = getEquipmentMergeCost({
        equipmentTier,
        sourceQuality: 'TIEN',
        slot,
      });
      const mergeScore = computeMergeCostScore(mergeUp);
      if (yieldRes.valueScore >= mergeScore) {
        throw new Error(
          `dismantle(THAN tier ${equipmentTier} ${String(slot)}) yield ` +
            `${yieldRes.valueScore} >= mergeCost(TIEN→THAN) ${mergeScore}`,
        );
      }
      continue;
    }
    const merge = getEquipmentMergeCost({
      equipmentTier,
      sourceQuality: quality,
      slot,
    });
    const mergeScore = computeMergeCostScore(merge);
    if (yieldRes.valueScore >= mergeScore) {
      throw new Error(
        `dismantle(${quality} tier ${equipmentTier} ${String(slot)}) yield ` +
          `${yieldRes.valueScore} >= mergeCost(${quality}→${merge.outputQuality}) ${mergeScore}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Gem socket / unsocket cost
// ---------------------------------------------------------------------------

export interface GemSocketCostInput {
  equipmentTier: number;
  /** Số gem đang khảm trước thao tác (0..socketCap). */
  currentSocketCount: number;
}

export interface GemSocketCostOutput {
  linhThachCost: number;
}

export interface GemUnsocketCostOutput {
  linhThachCost: number;
  materialKey: string | null;
  materialQty: number;
}

/** Cost khảm 1 gem: `50 × tier × (1 + currentSocketCount × 0.5)` linh thạch. */
export function getGemSocketCost(input: GemSocketCostInput): GemSocketCostOutput {
  const tier = clampTier(input.equipmentTier);
  if (!Number.isInteger(input.currentSocketCount) || input.currentSocketCount < 0) {
    throw new RangeError(`currentSocketCount invalid: ${input.currentSocketCount}`);
  }
  const linhThachCost = Math.round(50 * tier * (1 + input.currentSocketCount * 0.5));
  return { linhThachCost };
}

/**
 * Cost tháo 1 gem: linh thạch + optional `tach_ngoc_phu`. Phase 23.4 chưa
 * thêm catalog item `tach_ngoc_phu` (sẽ thêm Phase 25.1) — caller có thể
 * gate qua `requireMaterial=false` để tạm bypass material cost.
 */
export function getGemUnsocketCost(
  input: GemSocketCostInput & { requireMaterial?: boolean },
): GemUnsocketCostOutput {
  const tier = clampTier(input.equipmentTier);
  if (!Number.isInteger(input.currentSocketCount) || input.currentSocketCount < 1) {
    throw new RangeError(`currentSocketCount invalid: ${input.currentSocketCount}`);
  }
  const linhThachCost = Math.round(100 * tier * (1 + input.currentSocketCount * 0.5));
  if (input.requireMaterial === false) {
    return { linhThachCost, materialKey: null, materialQty: 0 };
  }
  // Material catalog Phase 25.1; placeholder key để future-proof. Server runtime
  // có thể chọn requireMaterial=false đến khi item key chính thức được wire.
  return { linhThachCost, materialKey: null, materialQty: 0 };
}

// ---------------------------------------------------------------------------
// Reforge cost (Phase 23.4 wrap quanh legacy `getReforgeCost(quality)`)
// ---------------------------------------------------------------------------

export interface ReforgeCostInput {
  quality: Quality;
  /** Số lần đã reforge trước đó (0..). Cap theo `maxReforgeCount`. */
  reforgeCount: number;
}

export interface ReforgeCostOutput {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
  /** Cap tối đa số lần reforge cho quality này. */
  maxReforgeCount: number;
}

const REFORGE_BASE_BY_QUALITY: Readonly<Record<Quality, {
  lt: number;
  matKey: string;
  matQty: number;
}>> = {
  PHAM: { lt: 80, matKey: 'tinh_thiet', matQty: 1 },
  LINH: { lt: 240, matKey: 'tinh_thiet', matQty: 2 },
  HUYEN: { lt: 720, matKey: 'yeu_dan', matQty: 1 },
  TIEN: { lt: 1800, matKey: 'han_ngoc', matQty: 1 },
  THAN: { lt: 4500, matKey: 'han_ngoc', matQty: 2 },
};

/**
 * Cost 1 lần reforge (Phase 23.4 variant — replace legacy flat-cost
 * {@link import('./equipment-upgrade').getReforgeCost}).
 *
 *   - base theo quality
 *   - × `1.15 ^ min(reforgeCount, 20)` — tăng dần.
 *   - Throws nếu `reforgeCount >= maxReforgeCount(quality)`.
 */
export function getEquipmentReforgeCost(input: ReforgeCostInput): ReforgeCostOutput {
  const max = getMaxReforgeCount(input.quality);
  if (!Number.isInteger(input.reforgeCount) || input.reforgeCount < 0) {
    throw new RangeError(`reforgeCount invalid: ${input.reforgeCount}`);
  }
  if (input.reforgeCount >= max) {
    throw new RangeError(
      `reforgeCount ${input.reforgeCount} >= cap ${max} for quality ${input.quality}`,
    );
  }
  const base = REFORGE_BASE_BY_QUALITY[input.quality];
  const growthCap = Math.min(input.reforgeCount, 20);
  const growth = Math.pow(1.15, growthCap);
  return {
    linhThachCost: Math.round(base.lt * growth),
    materialKey: base.matKey,
    materialQty: Math.max(1, Math.round(base.matQty * Math.pow(1.05, growthCap))),
    maxReforgeCount: max,
  };
}

// ---------------------------------------------------------------------------
// Protection charm requirement
// ---------------------------------------------------------------------------

export interface ProtectionCharmRequirementInput {
  equipmentTier: number;
  quality: Quality;
  /** Level kế tiếp định đẩy tới (`currentEnhanceLevel + 1`). */
  nextEnhanceLevel: number;
}

export interface ProtectionCharmRequirementOutput {
  /** UI nên hiển thị "khuyến nghị dùng bảo hộ phù". */
  recommended: boolean;
  /** Server nên reject nếu thiếu protection charm. */
  required: boolean;
  /** Item key của protection charm (cố định trong PR này). */
  itemKey: string;
}

/**
 * Quyết định mốc cường hóa nào cần protection charm.
 *
 * Rule:
 *   - `recommended` khi `nextEnhanceLevel >= 6` (stage `risky` của legacy
 *     refine catalog) cho mọi quality.
 *   - `required` khi `nextEnhanceLevel >= 11` (stage `extreme`) cho phẩm
 *     ≥ HUYEN, hoặc tier ≥ 6 bất kể quality.
 */
export function getProtectionCharmRequirement(
  input: ProtectionCharmRequirementInput,
): ProtectionCharmRequirementOutput {
  const tier = clampTier(input.equipmentTier);
  const next = input.nextEnhanceLevel;
  if (!Number.isInteger(next) || next < 1) {
    return {
      recommended: false,
      required: false,
      itemKey: EQUIPMENT_UPGRADE_PROTECTION_ITEM_KEY,
    };
  }
  const recommended = next >= 6;
  const qIdx = getQualityLadderIndex(input.quality);
  const required = next >= 11 && (qIdx >= getQualityLadderIndex('HUYEN') || tier >= 6);
  return {
    recommended,
    required,
    itemKey: EQUIPMENT_UPGRADE_PROTECTION_ITEM_KEY,
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export type EquipmentUpgradeValidationCode =
  | 'OK'
  | 'INVALID_TIER'
  | 'INVALID_QUALITY'
  | 'INVALID_SLOT'
  | 'ENHANCE_CAP_REACHED'
  | 'EQUIPMENT_EQUIPPED'
  | 'EQUIPMENT_LOCKED'
  | 'PROTECTION_REQUIRED'
  | 'UNKNOWN';

export interface EquipmentUpgradeValidationResult {
  ok: boolean;
  code: EquipmentUpgradeValidationCode;
  message?: string;
}

export interface EquipmentUpgradeValidationInput {
  equipmentTier: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  currentEnhanceLevel: number;
  /** Item đang đeo? */
  equipped?: boolean;
  /** Item bị locked / favorited? */
  locked?: boolean;
  /** Player có protection charm trong inventory? */
  hasProtectionCharm?: boolean;
}

/**
 * Pre-flight check cho enhance request. Trả `ok=false` + code lý do để
 * server reject + UI hiển thị message.
 */
export function validateEquipmentUpgradeRequest(
  input: EquipmentUpgradeValidationInput,
): EquipmentUpgradeValidationResult {
  if (!Number.isInteger(input.equipmentTier) || input.equipmentTier < 1 || input.equipmentTier > 10) {
    return { ok: false, code: 'INVALID_TIER' };
  }
  if (!MERGE_QUALITY_LADDER.includes(input.quality)) {
    return { ok: false, code: 'INVALID_QUALITY' };
  }
  if (input.equipped) {
    return { ok: false, code: 'EQUIPMENT_EQUIPPED' };
  }
  if (input.locked) {
    return { ok: false, code: 'EQUIPMENT_LOCKED' };
  }
  const cap = getEnhanceCapForTier(input.equipmentTier);
  if (input.currentEnhanceLevel >= cap) {
    return { ok: false, code: 'ENHANCE_CAP_REACHED' };
  }
  const prot = getProtectionCharmRequirement({
    equipmentTier: input.equipmentTier,
    quality: input.quality,
    nextEnhanceLevel: input.currentEnhanceLevel + 1,
  });
  if (prot.required && input.hasProtectionCharm === false) {
    return { ok: false, code: 'PROTECTION_REQUIRED' };
  }
  return { ok: true, code: 'OK' };
}

// --- merge ---

export type EquipmentMergeValidationCode =
  | 'OK'
  | 'INPUT_COUNT_INVALID'
  | 'MIXED_TIER'
  | 'MIXED_SLOT'
  | 'MIXED_QUALITY'
  | 'MIXED_FAMILY'
  | 'MERGE_CAP_REACHED'
  | 'EQUIPMENT_EQUIPPED'
  | 'EQUIPMENT_LOCKED'
  | 'OUTPUT_REALM_TOO_HIGH'
  | 'OUTPUT_UNAVAILABLE'
  | 'UNKNOWN';

export interface EquipmentMergeItemInput {
  inventoryItemId: string;
  itemFamilyKey: string;
  equipmentTier: number;
  quality: Quality;
  slot: EquipSlot;
  equipped?: boolean;
  locked?: boolean;
}

export interface EquipmentMergeValidationInput {
  items: readonly EquipmentMergeItemInput[];
  /** Character realm order tại thời điểm merge — guard output `requiredRealmOrder`. */
  characterRealmOrder: number;
  /** `requiredRealmOrder` của output dự kiến (tra catalog target item). */
  outputRequiredRealmOrder: number;
  /** Has matching output item in catalog? */
  outputItemAvailable: boolean;
}

export interface EquipmentMergeValidationResult {
  ok: boolean;
  code: EquipmentMergeValidationCode;
  /** Quality output nếu ok. */
  outputQuality?: Quality;
  message?: string;
}

/**
 * Pre-flight check cho merge request: 3 món cùng tier/slot/quality/family,
 * không equipped, không locked, không vượt cap THAN, output không vượt
 * realm gate, catalog có output item.
 */
export function validateEquipmentMergeRequest(
  input: EquipmentMergeValidationInput,
): EquipmentMergeValidationResult {
  const items = input.items;
  if (!Array.isArray(items) || items.length !== EQUIPMENT_MERGE_INPUT_COUNT) {
    return { ok: false, code: 'INPUT_COUNT_INVALID' };
  }
  const first = items[0];
  if (!first) return { ok: false, code: 'INPUT_COUNT_INVALID' };
  if (!MERGE_QUALITY_LADDER.includes(first.quality)) {
    return { ok: false, code: 'MIXED_QUALITY' };
  }
  const next = getNextMergeQuality(first.quality);
  if (next === null) {
    return { ok: false, code: 'MERGE_CAP_REACHED' };
  }
  for (const it of items) {
    if (it.equipmentTier !== first.equipmentTier) {
      return { ok: false, code: 'MIXED_TIER' };
    }
    if (it.slot !== first.slot) {
      return { ok: false, code: 'MIXED_SLOT' };
    }
    if (it.quality !== first.quality) {
      return { ok: false, code: 'MIXED_QUALITY' };
    }
    if (it.itemFamilyKey !== first.itemFamilyKey) {
      return { ok: false, code: 'MIXED_FAMILY' };
    }
    if (it.equipped) {
      return { ok: false, code: 'EQUIPMENT_EQUIPPED' };
    }
    if (it.locked) {
      return { ok: false, code: 'EQUIPMENT_LOCKED' };
    }
  }
  if (!input.outputItemAvailable) {
    return { ok: false, code: 'OUTPUT_UNAVAILABLE' };
  }
  if (
    Number.isInteger(input.outputRequiredRealmOrder) &&
    Number.isInteger(input.characterRealmOrder) &&
    input.outputRequiredRealmOrder > input.characterRealmOrder
  ) {
    return { ok: false, code: 'OUTPUT_REALM_TOO_HIGH' };
  }
  return { ok: true, code: 'OK', outputQuality: next };
}

// --- dismantle ---

export type DismantleValidationCode =
  | 'OK'
  | 'INVALID_TIER'
  | 'INVALID_QUALITY'
  | 'EQUIPMENT_EQUIPPED'
  | 'EQUIPMENT_LOCKED'
  | 'HAS_SOCKETS'
  | 'UNKNOWN';

export interface DismantleValidationInput {
  equipmentTier: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  equipped?: boolean;
  locked?: boolean;
  socketCount?: number;
  /** Nếu `true`, item có gem khảm vẫn được phân giải (gem auto trả về inventory). */
  allowDetachSockets?: boolean;
}

export interface DismantleValidationResult {
  ok: boolean;
  code: DismantleValidationCode;
}

/**
 * Pre-flight check cho dismantle: chặn equipped / locked, optional chặn item
 * có gem khảm (caller chọn `allowDetachSockets=true` để auto-tách).
 */
export function validateDismantleRequest(
  input: DismantleValidationInput,
): DismantleValidationResult {
  if (!Number.isInteger(input.equipmentTier) || input.equipmentTier < 1 || input.equipmentTier > 10) {
    return { ok: false, code: 'INVALID_TIER' };
  }
  if (!MERGE_QUALITY_LADDER.includes(input.quality)) {
    return { ok: false, code: 'INVALID_QUALITY' };
  }
  if (input.equipped) return { ok: false, code: 'EQUIPMENT_EQUIPPED' };
  if (input.locked) return { ok: false, code: 'EQUIPMENT_LOCKED' };
  if (
    input.socketCount !== undefined &&
    input.socketCount > 0 &&
    input.allowDetachSockets !== true
  ) {
    return { ok: false, code: 'HAS_SOCKETS' };
  }
  return { ok: true, code: 'OK' };
}

// ---------------------------------------------------------------------------
// Re-export quality helpers for caller convenience
// ---------------------------------------------------------------------------

export function getEquipmentDismantleValueScore(
  input: EquipmentDismantleYieldInput,
): number {
  return getEquipmentDismantleYield(input).valueScore;
}

/**
 * Get quality multiplier used in cost helpers — exposed cho UI preview hoặc
 * test diagnostic.
 */
export function getEquipmentEconomyQualityMultiplier(quality: Quality): {
  costMultiplier: number;
  powerMultiplier: number;
} {
  return {
    costMultiplier: getQualityCostMultiplier(quality),
    powerMultiplier: getQualityMultiplier(quality),
  };
}
