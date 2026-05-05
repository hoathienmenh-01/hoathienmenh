/**
 * Breakthrough chance model (Phase 11 nâng cao §5 PR1) — pure shared helper
 * compute success chance breakdown cho `POST /character/breakthrough`.
 *
 * Reference: `XuanToi_Phase11_NangCao_Report.docx` §5 "Đột phá nâng cao +
 * Tâm Ma / Thiên Kiếp nhẹ" — chance dựa trên realmStage=9 + đủ EXP,
 * cộng bonus từ root purity + method element affinity + pill/item.
 *
 * **Forward-compat**: hiện endpoint `POST /character/breakthrough` deterministic
 * (realmStage=9 + exp>=cost → advance). Module này expose pure formula để
 * Phase 11 nâng cao §5 PR2 (Tâm Ma debuff wire) + PR3 (UI history) consume
 * mà không phá runtime. KHÔNG có side-effect — caller (service) tự decide
 * có roll RNG hay không.
 *
 * **Server-authoritative**: chance breakdown trả về cho FE chỉ là display.
 * Server resolve roll bằng deterministic RNG (ledger seed) trong service —
 * KHÔNG để FE tự tính / tự cộng.
 *
 * **Cap envelope**:
 *   - `finalChance ∈ [BREAKTHROUGH_CHANCE_MIN, BREAKTHROUGH_CHANCE_MAX]`
 *     (mặc định `[0.3, 0.99]` — không 100% để giữ tu tiên flavor, không
 *     <30% để new player không nản).
 *   - `rootPurityBonus ∈ [0, BREAKTHROUGH_ROOT_PURITY_BONUS_MAX]`
 *   - `methodAffinityBonus ∈ {0, BREAKTHROUGH_METHOD_AFFINITY_BONUS / 2,
 *     BREAKTHROUGH_METHOD_AFFINITY_BONUS}` (no match / secondary / primary)
 *   - `itemBonus ∈ [0, BREAKTHROUGH_ITEM_BONUS_MAX]` (caller dồn buff)
 */
import type { ElementKey } from './combat';
import {
  BREAKTHROUGH_CHANCE_BASE,
  BREAKTHROUGH_CHANCE_MAX,
  BREAKTHROUGH_CHANCE_MIN,
  BREAKTHROUGH_ITEM_BONUS_MAX,
  BREAKTHROUGH_METHOD_AFFINITY_BONUS,
  BREAKTHROUGH_ROOT_PURITY_BONUS_MAX,
} from './balance-dials';

/**
 * Input cho `computeBreakthroughChance`. Tất cả field optional (root /
 * method / item) — caller pass partial context, formula tự fallback 0
 * cho bonus thiếu.
 */
export interface BreakthroughChanceInput {
  /** Realm stage hiện tại (1..9). Phải === 9 để có chance > 0 (peak gate). */
  readonly realmStage: number;
  /** EXP hiện tại — BigInt. */
  readonly expCurrent: bigint;
  /** EXP cost cần để cross realm — BigInt. */
  readonly expCost: bigint;
  /** Root purity ∈ [0, 1]. Caller `clamp` trước; formula clamp lại defensive. */
  readonly rootPurity?: number;
  /** Linh căn primary element (kim/moc/thuy/hoa/tho). */
  readonly rootPrimaryElement?: ElementKey;
  /** Linh căn secondary elements (∅ hoặc 1-N elements). */
  readonly rootSecondaryElements?: ReadonlyArray<ElementKey>;
  /** Element của method đang equip (nếu có). */
  readonly methodElement?: ElementKey;
  /**
   * Aggregated bonus từ items / pills / buffs (đột phá đan, etc). Caller
   * sum trước (per-source budget) — formula clamp lại `[0, MAX]` defensive.
   */
  readonly itemBonus?: number;
}

/**
 * Lý do `finalChance` trả về (cho FE i18n + smoke assert). `OK` = đủ
 * điều kiện gate, có thể attempt; `NOT_AT_PEAK` / `INSUFFICIENT_EXP` =
 * gate fail, attempt sẽ throw 409.
 */
export type BreakthroughChanceReason =
  | 'NOT_AT_PEAK'
  | 'INSUFFICIENT_EXP'
  | 'OK';

/**
 * Breakdown từng layer — display cho FE tooltip "Tỷ lệ đột phá" + audit
 * log + smoke assertion. `rawChance` = sum 4 layer (chưa clamp);
 * `finalChance` = clamp `[MIN, MAX]` khi `OK`, else 0.
 */
export interface BreakthroughChanceBreakdown {
  readonly reason: BreakthroughChanceReason;
  readonly baseChance: number;
  readonly rootPurityBonus: number;
  readonly methodAffinityBonus: number;
  readonly itemBonus: number;
  readonly rawChance: number;
  readonly finalChance: number;
}

/**
 * Compute breakthrough chance breakdown — pure function, deterministic.
 * KHÔNG side-effect, KHÔNG RNG. Caller (service) decide roll.
 *
 * @example
 * ```ts
 * const breakdown = computeBreakthroughChance({
 *   realmStage: 9,
 *   expCurrent: 100000n,
 *   expCost: 23613n,
 *   rootPurity: 0.6,
 *   rootPrimaryElement: 'kim',
 *   methodElement: 'kim',
 *   itemBonus: 0.05,
 * });
 * // breakdown.finalChance ≈ 0.7 + 0.09 + 0.05 + 0.05 = 0.89
 * ```
 */
export function computeBreakthroughChance(
  input: BreakthroughChanceInput,
): BreakthroughChanceBreakdown {
  // Gate 1: realmStage < 9 → NOT_AT_PEAK (no chance to attempt).
  if (!Number.isInteger(input.realmStage) || input.realmStage < 9) {
    return zeroBreakdown('NOT_AT_PEAK');
  }
  // Gate 2: insufficient exp → INSUFFICIENT_EXP.
  if (input.expCurrent < input.expCost) {
    return zeroBreakdown('INSUFFICIENT_EXP');
  }

  // Layer 1 — base.
  const baseChance = BREAKTHROUGH_CHANCE_BASE;

  // Layer 2 — root purity (linear scaling).
  const purity = clampUnit(input.rootPurity ?? 0);
  const rootPurityBonus = purity * BREAKTHROUGH_ROOT_PURITY_BONUS_MAX;

  // Layer 3 — method element affinity (3 cases: primary / secondary / no-match).
  let methodAffinityBonus = 0;
  if (input.methodElement !== undefined) {
    if (
      input.rootPrimaryElement !== undefined &&
      input.methodElement === input.rootPrimaryElement
    ) {
      methodAffinityBonus = BREAKTHROUGH_METHOD_AFFINITY_BONUS;
    } else if (
      input.rootSecondaryElements !== undefined &&
      input.rootSecondaryElements.includes(input.methodElement)
    ) {
      // Secondary affinity = half primary.
      methodAffinityBonus = BREAKTHROUGH_METHOD_AFFINITY_BONUS / 2;
    }
  }

  // Layer 4 — items / pills (caller-aggregated, clamp defensive).
  const itemBonus = clampItemBonus(input.itemBonus ?? 0);

  const rawChance = baseChance + rootPurityBonus + methodAffinityBonus + itemBonus;
  const finalChance = clampChance(rawChance);

  return {
    reason: 'OK',
    baseChance,
    rootPurityBonus,
    methodAffinityBonus,
    itemBonus,
    rawChance,
    finalChance,
  };
}

function zeroBreakdown(reason: BreakthroughChanceReason): BreakthroughChanceBreakdown {
  return {
    reason,
    baseChance: 0,
    rootPurityBonus: 0,
    methodAffinityBonus: 0,
    itemBonus: 0,
    rawChance: 0,
    finalChance: 0,
  };
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampItemBonus(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > BREAKTHROUGH_ITEM_BONUS_MAX) return BREAKTHROUGH_ITEM_BONUS_MAX;
  return x;
}

function clampChance(x: number): number {
  if (!Number.isFinite(x)) return BREAKTHROUGH_CHANCE_MIN;
  if (x < BREAKTHROUGH_CHANCE_MIN) return BREAKTHROUGH_CHANCE_MIN;
  if (x > BREAKTHROUGH_CHANCE_MAX) return BREAKTHROUGH_CHANCE_MAX;
  return x;
}
