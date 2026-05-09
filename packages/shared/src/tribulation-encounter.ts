/**
 * Phase 14.3.D — Tribulation Encounter Catalog (shared).
 *
 * Pure helper layer trên top `tribulation.ts` (Phase 11.6.A catalog) +
 * `tribulation-foundation.ts` (Phase 14.3.A success chance / supports).
 * Module này KHÔNG runtime hook, KHÔNG migration — cung cấp catalog
 * "hệ kiếp → flavor encounter" cho gameplay layer:
 *
 *   - Hỏa Kiếp:  burst damage check        — `effectType: BURST`
 *   - Thủy Kiếp: sustain/resilience check  — `effectType: SUSTAIN`
 *   - Mộc Kiếp:  poison/recovery check     — `effectType: POISON_RECOVERY`
 *   - Kim Kiếp:  armor/crit check          — `effectType: ARMOR_CRIT`
 *   - Thổ Kiếp:  defense/endurance check   — `effectType: DEFENSE_ENDURANCE`
 *
 * **Quan trọng**: encounter KHÔNG phá deterministic simulation hiện có ở
 * `simulateTribulation()` — nó chỉ là **flavored view layer** trên cùng kiếp.
 * Server resolve dùng `simulateTribulation()` + element resist + supports
 * như Phase 11.6.B / 14.3.B / 14.3.C; encounter cung cấp:
 *
 *   - Element flavor mapping: từ {@link TribulationDef} dominant wave
 *     element → 1 trong 5 {@link TribulationEncounterDef}.
 *   - `successThreshold`: ngưỡng `successChance.final` đủ để FE hint UX
 *     (vd "khả năng cao thành công"). Server resolve vẫn theo
 *     `simulateTribulation` actual outcome.
 *   - `requiredPowerHint`: HP threshold goal cho UI hint, KHÔNG enforce.
 *   - `failPenaltyMultiplier` / `rewardHintMultiplier`: tham chiếu balance
 *     — Phase 14.3.D KHÔNG nhân thêm vào reward/penalty hiện có (sẽ phá
 *     `BALANCE_MODEL.md §11.6.A`); chỉ expose qua FE để hiển thị "kiếp
 *     này hung hơn 1.2× normal" (UX text).
 *
 * Catalog **deterministic** — không RNG, không IO. Test bằng cách
 * `getTribulationEncounterDef(...)` + cmp với expected snapshot.
 *
 * @module tribulation-encounter
 */

import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';
import type { TribulationDef, TribulationSeverity } from './tribulation';

/**
 * 5 effect type — tương ứng 5 element flavor encounter. Mỗi flavor define
 * gameplay rule khác nhau (FE hiển thị tooltip + badge khác nhau, server
 * resolve dùng cùng `simulateTribulation` deterministic).
 */
export type TribulationEncounterEffectType =
  | 'BURST'
  | 'SUSTAIN'
  | 'POISON_RECOVERY'
  | 'ARMOR_CRIT'
  | 'DEFENSE_ENDURANCE';

/**
 * 5 effect type theo element — re-export cho FE/i18n key-builder. Source-
 * of-truth ở {@link TRIBULATION_ENCOUNTER_DEFS}.
 */
export const TRIBULATION_ENCOUNTER_EFFECT_TYPES: readonly TribulationEncounterEffectType[] =
  ['BURST', 'SUSTAIN', 'POISON_RECOVERY', 'ARMOR_CRIT', 'DEFENSE_ENDURANCE'];

/**
 * Difficulty tier theo `TribulationSeverity` — pass-through từ
 * {@link TribulationDef.severity} cho UI consumer dễ render badge.
 */
export type TribulationEncounterDifficulty = TribulationSeverity;

/**
 * Phase count cap — KHÔNG phá deterministic 9-wave simulate hiện có. Đây
 * chỉ là **UI summary** cho FE: gom số wave thành "phase block" gameplay
 * (vd 1 phase = 3 wave). Server resolve vẫn full waves.
 *
 * Mapping intent (per severity):
 *   - minor 3 waves → 1 phase
 *   - major 5 waves → 2 phase
 *   - heavenly 7 waves → 3 phase
 *   - saint 9 waves → 3 phase
 */
export const TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 1,
  major: 2,
  heavenly: 3,
  saint: 3,
};

/**
 * Sàn `successThreshold` UI — tránh hint gây hiểu lầm "chắc chắn fail".
 * Phase 14.3.A đã có `TRIBULATION_SUCCESS_CHANCE_FLOOR=0.05` envelope.
 */
export const TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR = 0.1;

/**
 * Trần `successThreshold` UI — tránh hint gây hiểu lầm "chắc chắn pass".
 * Phase 14.3.A có `TRIBULATION_SUCCESS_CHANCE_CEIL=0.95` envelope.
 */
export const TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL = 0.9;

/**
 * Trần `failPenaltyMultiplier` — encounter system KHÔNG được nhân penalty
 * lên quá `1.5×` normal. "Penalty nhẹ, không phá nhân vật" (task spec).
 *
 * Hiện tại catalog luôn = 1.0 (không nhân thêm), nhưng cap được kiểm tra
 * trong {@link validateTribulationEncounterDef} để chặn data drift.
 */
export const TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL = 1.5;

/**
 * Trần `rewardHintMultiplier` — encounter UI KHÔNG được phóng đại reward
 * quá `1.5×` normal. Server reward grant không thay đổi (vẫn lấy từ
 * `TRIBULATION_REWARD` ledger).
 */
export const TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL = 1.5;

/**
 * 1 entry encounter catalog — flavor view của 1 hệ kiếp.
 *
 * **Quan trọng**: KHÔNG override deterministic simulate. Mọi field chỉ
 * cho UI/UX hint + audit:
 *   - `element`: 1 trong 5 ElementKey, key chính của catalog.
 *   - `effectType`: 1 trong 5 effect — dùng cho i18n + tooltip.
 *   - `phaseCount`: số phase UI (gom waves), không enforce.
 *   - `successThreshold`: ngưỡng `successChance.final` để FE label
 *     "khuyên thử" / "rủi ro cao". Default 0.5 = balance.
 *   - `requiredPowerHint`: HP threshold gợi ý — `severity.baseDamage × 3`
 *     (HP đủ cover ~3 wave đầu).
 *   - `failPenaltyMultiplier`: 1.0 mặc định — Phase 14.3.D KHÔNG nhân
 *     thêm penalty (giữ balance). Cap ở
 *     {@link TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL}.
 *   - `rewardHintMultiplier`: 1.0 mặc định — tương tự.
 */
export interface TribulationEncounterDef {
  /** Encounter key = `tribulation_encounter_<element>`. */
  key: string;
  /** ElementKey duy nhất per catalog entry. */
  element: ElementKey;
  /** Effect type (UI flavor). */
  effectType: TribulationEncounterEffectType;
  /** Tên hiển thị (Vietnamese). */
  name: string;
  /** Mô tả flavor 1-2 câu. */
  description: string;
  /** UI phase block (≤ severity wave count). */
  phaseCount: number;
  /** Ngưỡng UI label ∈ `[FLOOR, CEIL]` (Phase 14.3.A envelope). */
  successThreshold: number;
  /** UI hint multiplier — không enforce. */
  failPenaltyMultiplier: number;
  /** UI hint multiplier — không enforce. */
  rewardHintMultiplier: number;
}

/**
 * 5-entry catalog — 1 entry per ElementKey. Source-of-truth gameplay
 * flavor mapping. Test bằng `getTribulationEncounterDef(...)`.
 */
export const TRIBULATION_ENCOUNTER_DEFS: readonly TribulationEncounterDef[] = [
  {
    key: 'tribulation_encounter_hoa',
    element: 'hoa',
    effectType: 'BURST',
    name: 'Hỏa Kiếp',
    description:
      'Đại Hỏa giáng xuống — đợt sấm bùng nổ liên hoàn. Burst damage check, ' +
      'cần chỉ số máu/giáp đủ chịu spike đầu mỗi phase.',
    phaseCount: 2,
    successThreshold: 0.55,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
  },
  {
    key: 'tribulation_encounter_thuy',
    element: 'thuy',
    effectType: 'SUSTAIN',
    name: 'Thủy Kiếp',
    description:
      'Hàn băng vây quanh — tích lũy sát thương đều theo từng đợt. Sustain ' +
      'check, cần kháng băng + hồi phục liên tục để không gục.',
    phaseCount: 2,
    successThreshold: 0.55,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
  },
  {
    key: 'tribulation_encounter_moc',
    element: 'moc',
    effectType: 'POISON_RECOVERY',
    name: 'Mộc Kiếp',
    description:
      'Linh khí mộc tà nhiễm độc — DOT cộng dồn. Poison/recovery check, ' +
      'cần cleanse hoặc tốc độ hồi phục cao đủ ráo nhiễm độc.',
    phaseCount: 2,
    successThreshold: 0.5,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
  },
  {
    key: 'tribulation_encounter_kim',
    element: 'kim',
    effectType: 'ARMOR_CRIT',
    name: 'Kim Kiếp',
    description:
      'Phong Kim Lôi xé giáp — chí mạng cao, ưu tiên kháng giáp + né. ' +
      'Armor/crit check, dùng vật phẩm hỗ trợ tăng giáp tạm thời.',
    phaseCount: 2,
    successThreshold: 0.5,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
  },
  {
    key: 'tribulation_encounter_tho',
    element: 'tho',
    effectType: 'DEFENSE_ENDURANCE',
    name: 'Thổ Kiếp',
    description:
      'Đại địa rung chuyển — sát thương trải dài, đòi hỏi sức bền. ' +
      'Defense/endurance check, cần HP cao + buff giảm sát thương.',
    phaseCount: 2,
    successThreshold: 0.5,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
  },
];

/**
 * Lookup theo element. Trả `undefined` nếu element không phải 1 trong 5
 * canonical key (defensive).
 */
export function getTribulationEncounterDefByElement(
  element: ElementKey,
): TribulationEncounterDef | undefined {
  return TRIBULATION_ENCOUNTER_DEFS.find((d) => d.element === element);
}

/**
 * Lookup theo encounter key (e.g. `tribulation_encounter_hoa`).
 */
export function getTribulationEncounterDefByKey(
  key: string,
): TribulationEncounterDef | undefined {
  return TRIBULATION_ENCOUNTER_DEFS.find((d) => d.key === key);
}

/**
 * Tính dominant wave element của 1 {@link TribulationDef}. Tie-break theo
 * thứ tự `ELEMENTS` (`kim, moc, thuy, hoa, tho`). Nếu kiếp `tam` (element=
 * null cho mọi wave) → fallback `tho` (Thổ = endurance, vững chắc tâm).
 *
 * Pure: deterministic, không RNG, không IO.
 */
export function dominantTribulationWaveElement(def: TribulationDef): ElementKey {
  const counts = new Map<ElementKey, number>();
  for (const w of def.waves) {
    if (w.element !== null) {
      counts.set(w.element, (counts.get(w.element) ?? 0) + 1);
    }
  }
  let best: ElementKey | null = null;
  let bestCount = 0;
  for (const e of ELEMENTS) {
    const c = counts.get(e) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      best = e;
    }
  }
  return best ?? 'tho';
}

/**
 * Resolve {@link TribulationEncounterDef} cho 1 kiếp def. Helper combine
 * {@link dominantTribulationWaveElement} + {@link getTribulationEncounterDefByElement}.
 *
 * Always trả về định nghĩa hợp lệ (5-entry catalog đảm bảo bao phủ
 * 5 ElementKey + tam fallback `tho`).
 */
export function resolveTribulationEncounterDef(
  def: TribulationDef,
): TribulationEncounterDef {
  const element = dominantTribulationWaveElement(def);
  const encounter = getTribulationEncounterDefByElement(element);
  if (!encounter) {
    // Catalog drift guard — should never happen vì catalog có 5 entry
    // cover toàn bộ ElementKey. Throw để CI catch.
    throw new Error(
      `[tribulation-encounter] no encounter def for element=${element}`,
    );
  }
  return encounter;
}

/**
 * Required-power hint cho 1 kiếp def. Heuristic:
 *   - `requiredPowerHint = wave[0].baseDamage × 3` — HP đủ cover 3 wave
 *     đầu (player có thể chịu spike ban đầu, sau đó dùng hồi phục).
 *
 * Test catch: hint phải > 0 cho mọi tribulation def hợp lệ.
 */
export function computeTribulationEncounterPowerHint(
  def: TribulationDef,
): number {
  if (def.waves.length === 0) return 0;
  return Math.max(0, Math.round(def.waves[0].baseDamage * 3));
}

/**
 * Phase count UI = `min(severity-block, actual waves)`. KHÔNG enforce
 * server simulate, chỉ render block UI.
 */
export function computeTribulationEncounterPhaseCount(
  def: TribulationDef,
): number {
  const cap = TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY[def.severity];
  return Math.max(1, Math.min(cap, def.waves.length));
}

/**
 * Element advantage relative cho encounter — primary character element vs
 * encounter element. Quy ước Five-Phases (Ngũ Hành):
 *
 *   - Tương sinh (generation cycle): kim → thuy → moc → hoa → tho → kim.
 *     "X generates Y" = X tăng cường / nuôi Y.
 *   - Tương khắc (counter cycle): kim → moc, moc → tho, tho → thuy,
 *     thuy → hoa, hoa → kim. "X counters Y" = X làm yếu Y.
 *
 * Phase 14.3.D dùng để FE hiển thị badge "khắc kiếp / bị khắc" + tooltip
 * gameplay-relevant ("dễ vượt hơn / khó vượt hơn").
 *
 * @returns Number ∈ {-2, -1, 0, +1, +2}:
 *   - `+2`: cùng hệ (same/affinity, dễ nhất).
 *   - `+1`: tương khắc encounter (player counters encounter, hoặc encounter
 *     sinh ra player) — player advantage.
 *   - `0`: trung tính / không có primary.
 *   - `-1`: player tương sinh encounter (player feeds encounter) — mild
 *     disadvantage.
 *   - `-2`: bị khắc bởi encounter (encounter counters player, khó nhất).
 */
export function describeTribulationEncounterAdvantage(
  primary: ElementKey | null,
  encounterElement: ElementKey,
): number {
  if (!primary) return 0;
  if (primary === encounterElement) return 2;
  // Generation cycle: X → generates[X].
  const generates: Record<ElementKey, ElementKey> = {
    kim: 'thuy',
    thuy: 'moc',
    moc: 'hoa',
    hoa: 'tho',
    tho: 'kim',
  };
  // Counter cycle: X → counters[X].
  const counters: Record<ElementKey, ElementKey> = {
    kim: 'moc',
    moc: 'tho',
    tho: 'thuy',
    thuy: 'hoa',
    hoa: 'kim',
  };
  // +1: player counters encounter (player advantage).
  if (counters[primary] === encounterElement) return 1;
  // +1: encounter generates player (encounter feeds player → advantage).
  if (generates[encounterElement] === primary) return 1;
  // -1: player generates encounter (player feeds encounter).
  if (generates[primary] === encounterElement) return -1;
  // -2: encounter counters player (worst).
  if (counters[encounterElement] === primary) return -2;
  return 0;
}

/**
 * Validate 1 catalog entry. Used by tests + dev-time invariant check.
 * Throw `Error` với message debug-friendly nếu vi phạm.
 *
 *   - `element` ∈ {kim, moc, thuy, hoa, tho}.
 *   - `effectType` ∈ TRIBULATION_ENCOUNTER_EFFECT_TYPES.
 *   - `phaseCount` ≥ 1.
 *   - `successThreshold` ∈ [FLOOR, CEIL].
 *   - `failPenaltyMultiplier` ∈ [0.1, CEIL].
 *   - `rewardHintMultiplier` ∈ [0.1, CEIL].
 */
export function validateTribulationEncounterDef(
  def: TribulationEncounterDef,
): void {
  if (!(ELEMENTS as readonly string[]).includes(def.element)) {
    throw new Error(
      `[tribulation-encounter] invalid element=${def.element} for key=${def.key}`,
    );
  }
  if (
    !(
      TRIBULATION_ENCOUNTER_EFFECT_TYPES as readonly string[]
    ).includes(def.effectType)
  ) {
    throw new Error(
      `[tribulation-encounter] invalid effectType=${def.effectType} for key=${def.key}`,
    );
  }
  if (!Number.isInteger(def.phaseCount) || def.phaseCount < 1) {
    throw new Error(
      `[tribulation-encounter] invalid phaseCount=${def.phaseCount} for key=${def.key}`,
    );
  }
  if (
    !Number.isFinite(def.successThreshold) ||
    def.successThreshold < TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR ||
    def.successThreshold > TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL
  ) {
    throw new Error(
      `[tribulation-encounter] successThreshold out of [${TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR}, ${TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL}] for key=${def.key}: ${def.successThreshold}`,
    );
  }
  if (
    !Number.isFinite(def.failPenaltyMultiplier) ||
    def.failPenaltyMultiplier < 0.1 ||
    def.failPenaltyMultiplier > TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL
  ) {
    throw new Error(
      `[tribulation-encounter] failPenaltyMultiplier out of [0.1, ${TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL}] for key=${def.key}: ${def.failPenaltyMultiplier}`,
    );
  }
  if (
    !Number.isFinite(def.rewardHintMultiplier) ||
    def.rewardHintMultiplier < 0.1 ||
    def.rewardHintMultiplier > TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL
  ) {
    throw new Error(
      `[tribulation-encounter] rewardHintMultiplier out of [0.1, ${TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL}] for key=${def.key}: ${def.rewardHintMultiplier}`,
    );
  }
}

/**
 * Validate full catalog (used in tests + dev-time invariant). Throw on
 * vi phạm bất kỳ entry hoặc thiếu cover ElementKey nào.
 */
export function validateTribulationEncounterCatalog(
  catalog: readonly TribulationEncounterDef[] = TRIBULATION_ENCOUNTER_DEFS,
): void {
  if (catalog.length !== ELEMENTS.length) {
    throw new Error(
      `[tribulation-encounter] catalog length ${catalog.length} != ELEMENTS ${ELEMENTS.length}`,
    );
  }
  const seenElements = new Set<ElementKey>();
  const seenKeys = new Set<string>();
  for (const def of catalog) {
    validateTribulationEncounterDef(def);
    if (seenElements.has(def.element)) {
      throw new Error(
        `[tribulation-encounter] duplicate element=${def.element}`,
      );
    }
    if (seenKeys.has(def.key)) {
      throw new Error(`[tribulation-encounter] duplicate key=${def.key}`);
    }
    seenElements.add(def.element);
    seenKeys.add(def.key);
  }
  for (const e of ELEMENTS) {
    if (!seenElements.has(e)) {
      throw new Error(
        `[tribulation-encounter] missing element=${e} in catalog`,
      );
    }
  }
}
