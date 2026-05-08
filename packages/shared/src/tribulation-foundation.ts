/**
 * Phase 14.3.A — Breakthrough Tribulation Foundation.
 *
 * Pure helper layer trên top `tribulation.ts` (Phase 11.6.A catalog +
 * `TribulationDef`). Module này KHÔNG runtime hook, KHÔNG migration —
 * cung cấp:
 *
 *   1. {@link tribulationRequiredForBreakthrough} — predicate "transition
 *      có yêu cầu kiếp không" để gate `CharacterService.breakthrough()`
 *      khỏi bypass kiếp khi player click manual breakthrough.
 *   2. {@link computeTribulationSuccessChance} — ước tính deterministic
 *      success chance `[FLOOR..CEIL]` mà không chạy `simulateTribulation`
 *      thật. Dùng cho preview UI + tooltip "%kiếp" trước khi attempt.
 *   3. {@link composeTribulationSupports} — gom + clamp danh sách hỗ trợ
 *      (item/buff/talent/equipment/spirit_root) thành tổng additive bonus
 *      vào success chance.
 *   4. {@link summarizeTribulationRewardHint} +
 *      {@link summarizeTribulationPenaltyHint} — extract preview struct gọn
 *      cho FE / preview endpoint.
 *
 * Balance design intent:
 *   - **Foundation thin layer** — Phase 11.6.B `simulateTribulation` runtime
 *     vẫn deterministic. Helper này chỉ ước tính + tooltip, KHÔNG override
 *     simulation.
 *   - **Envelope hẹp** — `[FLOOR=0.05, CEIL=0.95]` để player end-game
 *     không 100% sure clear (giữ tension), early-game không 0% (player có
 *     thể grind).
 *   - **Per-entry cap + total cap** trên supports để chống stack
 *     full-build cùng buff/item.
 *
 * @module tribulation-foundation
 */

import type { ElementKey } from './combat';
import type { TribulationDef, TribulationSeverity } from './tribulation';
import { getTribulationForBreakthrough } from './tribulation';

/**
 * Base success chance theo `severity` — anchor cho
 * {@link computeTribulationSuccessChance}.
 *
 * Thang đo design:
 *   - `minor` (kim_dan→nguyen_anh, nguyen_anh→hoa_than): 75% — early-game
 *     friendly, casual player vẫn pass.
 *   - `major` (hoa_than..dai_thua): 55% — mid-game, cần build hỗ trợ.
 *   - `heavenly` (dai_thua→do_kiep, do_kiep→nhan_tien): 35% — high-stakes,
 *     gear check.
 *   - `saint` (chuan_thanh→thanh_nhan): 20% — endgame, cần full kit.
 */
export const TRIBULATION_BASE_SUCCESS_CHANCE_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 0.75,
  major: 0.55,
  heavenly: 0.35,
  saint: 0.2,
};

/** Sàn tổng success chance — guard chống full-debuff tới 0%. */
export const TRIBULATION_SUCCESS_CHANCE_FLOOR = 0.05;

/** Trần tổng success chance — guard chống full-buff tới 100%. */
export const TRIBULATION_SUCCESS_CHANCE_CEIL = 0.95;

/**
 * Trần per-entry hỗ trợ (1 item/buff/talent đơn lẻ). Chống outlier item
 * data đẩy 1 món lên +50%.
 */
export const TRIBULATION_SUPPORT_PER_ENTRY_CEIL = 0.1;

/**
 * Trần tổng hỗ trợ (additive sum sau clamp per-entry). Chống stack 6 món
 * × +0.10 = 0.60. Tổng cap 0.30 → tối đa +30% chance từ build.
 */
export const TRIBULATION_SUPPORT_TOTAL_CEIL = 0.3;

/**
 * Bonus khi character primary element **cùng hệ** với kiếp wave element —
 * đại diện linh căn "thấm" hệ kiếp, dễ vượt hơn.
 *
 * Thang nhỏ — combine với supports cap, không stack quá envelope.
 */
export const TRIBULATION_ELEMENT_AFFINITY_BONUS = 0.05;

/**
 * Penalty khi character primary element **bị khắc** bởi kiếp wave element.
 *
 * Cùng thang `TRIBULATION_ELEMENT_AFFINITY_BONUS` — symmetric advantage.
 */
export const TRIBULATION_ELEMENT_AFFINITY_PENALTY = 0.05;

/**
 * Source enum cho 1 entry hỗ trợ. Dùng để FE phân loại tooltip + log.
 */
export type TribulationSupportSource =
  | 'spirit_root'
  | 'talent'
  | 'equipment'
  | 'buff'
  | 'item';

/**
 * 1 entry hỗ trợ — 1 nguồn additive bonus vào success chance.
 *
 * - `bonus` ∈ [0, 1] — server compose, FE chỉ render. Negative bonus
 *   (debuff) cũng valid (ví dụ Tâm Ma debuff trừ chance).
 * - `element` optional — chỉ điền khi entry là Ngũ Hành affinity, dùng
 *   để FE hiển thị badge.
 */
export interface TribulationSupportEntry {
  source: TribulationSupportSource;
  key: string;
  /** Tên hiển thị FE — i18n hoặc raw label. */
  label?: string;
  /** Additive bonus (có thể âm cho debuff). Pre-clamp value. */
  bonus: number;
  /** Hệ Ngũ Hành nếu entry là element resist/affinity. */
  element?: ElementKey | null;
}

/**
 * Composed result của {@link composeTribulationSupports} — list entry sau
 * khi clamp per-entry + tổng additive sau clamp tổng.
 */
export interface ComposedTribulationSupports {
  /** Original entries, unmodified — FE render full list. */
  entries: readonly TribulationSupportEntry[];
  /**
   * Tổng additive bonus (đã clamp per-entry + tổng). Cộng vào success
   * chance ở {@link computeTribulationSuccessChance}.
   */
  totalBonus: number;
  /**
   * Đã hit per-entry cap chưa (≥ 1 entry vượt
   * `TRIBULATION_SUPPORT_PER_ENTRY_CEIL`). Dùng warn UX.
   */
  perEntryCapHit: boolean;
  /**
   * Đã hit total cap chưa (sau clamp per-entry, sum vượt
   * `TRIBULATION_SUPPORT_TOTAL_CEIL`). Dùng warn UX.
   */
  totalCapHit: boolean;
}

/**
 * Predicate "realm transition này có yêu cầu kiếp không".
 *
 * Wrapper an toàn quanh {@link getTribulationForBreakthrough}:
 *   - Trả `false` nếu `toRealmKey` rỗng/null (đã ở đỉnh cảnh giới).
 *   - Trả `true` nếu catalog có `TribulationDef` cho transition.
 *
 * Dùng làm gate trong `CharacterService.breakthrough()` low-tier path:
 * nếu transition cần kiếp → throw `TRIBULATION_REQUIRED` redirect player
 * sang tribulation endpoint.
 *
 * @param fromRealmKey realm hiện tại của character.
 * @param toRealmKey realm tiếp theo (`nextRealm(from).key`). Optional —
 *   `null` / `undefined` → trả `false`.
 */
export function tribulationRequiredForBreakthrough(
  fromRealmKey: string,
  toRealmKey: string | null | undefined,
): boolean {
  if (!toRealmKey) return false;
  return getTribulationForBreakthrough(fromRealmKey, toRealmKey) !== undefined;
}

/**
 * Compose 1 mảng support entries thành tổng additive bonus, clamp per-entry
 * + tổng theo balance dial.
 *
 * Algorithm:
 *   1. Iterate entries, clamp `bonus` về `[-PER_ENTRY_CEIL, PER_ENTRY_CEIL]`.
 *      (negative debuff cũng clamp symmetric.)
 *   2. Sum clamped bonus.
 *   3. Clamp sum về `[-TOTAL_CEIL, TOTAL_CEIL]`.
 *
 * Idempotent + pure — input không mutate.
 *
 * @param entries danh sách entry — empty array trả `totalBonus=0`.
 */
export function composeTribulationSupports(
  entries: readonly TribulationSupportEntry[],
): ComposedTribulationSupports {
  let total = 0;
  let perEntryCapHit = false;
  for (const e of entries) {
    const b = Number.isFinite(e.bonus) ? e.bonus : 0;
    const sign = b >= 0 ? 1 : -1;
    const mag = Math.min(Math.abs(b), TRIBULATION_SUPPORT_PER_ENTRY_CEIL);
    if (Math.abs(b) > TRIBULATION_SUPPORT_PER_ENTRY_CEIL) perEntryCapHit = true;
    total += sign * mag;
  }
  let totalCapHit = false;
  if (total > TRIBULATION_SUPPORT_TOTAL_CEIL) {
    total = TRIBULATION_SUPPORT_TOTAL_CEIL;
    totalCapHit = true;
  } else if (total < -TRIBULATION_SUPPORT_TOTAL_CEIL) {
    total = -TRIBULATION_SUPPORT_TOTAL_CEIL;
    totalCapHit = true;
  }
  return {
    entries,
    totalBonus: total,
    perEntryCapHit,
    totalCapHit,
  };
}

/**
 * Input cho {@link computeTribulationSuccessChance}.
 */
export interface TribulationSuccessChanceInput {
  /** Catalog def của kiếp sắp đối mặt. */
  def: TribulationDef;
  /** Character `primaryElement` — null nếu chưa onboard linh căn. */
  primaryElement?: ElementKey | null;
  /** Character `secondaryElements` — empty nếu chưa onboard. */
  secondaryElements?: readonly ElementKey[];
  /** Composed supports đã qua {@link composeTribulationSupports}. */
  supports?: ComposedTribulationSupports;
}

/**
 * Breakdown chi tiết của success chance — dùng cho FE tooltip + audit
 * log. Server gửi xuống FE qua preview endpoint.
 */
export interface TribulationSuccessChanceBreakdown {
  /** Base anchor theo severity. */
  base: number;
  /** Tổng additive supports bonus (sau clamp). */
  supportBonus: number;
  /**
   * Element affinity adjustment — `+TRIBULATION_ELEMENT_AFFINITY_BONUS`
   * nếu primary cùng hệ kiếp, `-TRIBULATION_ELEMENT_AFFINITY_PENALTY` nếu
   * primary bị khắc, 0 nếu trung tính / Tâm kiếp.
   */
  elementAdjustment: number;
  /** `base + supportBonus + elementAdjustment` (pre-clamp). */
  raw: number;
  /** Đã clamp về `[FLOOR, CEIL]`. */
  final: number;
  /** Có hit floor không (ux warning). */
  floorHit: boolean;
  /** Có hit ceil không (ux warning). */
  ceilHit: boolean;
}

/**
 * Element affinity matrix gọn giữa primary element và kiếp dominant
 * element. Match Phase 11.3.B Ngũ Hành cycle (`describeElementMatch`).
 *
 * - `primary` sinh ra `kiep`: bonus (hỗ trợ — primary "tan" trong kiếp).
 * - `kiep` khắc `primary`: penalty (kiếp khắc primary → khó vượt).
 * - `primary` cùng hệ với `kiep`: 0 (cùng hệ trung tính cho kiếp).
 * - `primary` khắc `kiep` hoặc `kiep` sinh ra `primary`: small bonus
 *   (defender thuận lợi).
 *
 * Để đơn giản foundation, ở đây chỉ phân biệt 2 nhánh advantage/disadvantage
 * (binary) — neutral cho mọi case khác.
 */
function elementAffinityAdjustment(
  primary: ElementKey | null | undefined,
  kiepElement: ElementKey | null,
): number {
  if (!primary || !kiepElement) return 0;
  // Tương khắc cycle: kim → moc → tho → thuy → hoa → kim
  // primary advantage: primary KHẮC kiep => bonus (primary thắng kiep)
  // primary disadvantage: kiep KHẮC primary => penalty
  const COUNTER: Record<ElementKey, ElementKey> = {
    kim: 'moc',
    moc: 'tho',
    tho: 'thuy',
    thuy: 'hoa',
    hoa: 'kim',
  };
  if (COUNTER[primary] === kiepElement) {
    return TRIBULATION_ELEMENT_AFFINITY_BONUS;
  }
  if (COUNTER[kiepElement] === primary) {
    return -TRIBULATION_ELEMENT_AFFINITY_PENALTY;
  }
  return 0;
}

/**
 * Lấy "dominant element" của 1 kiếp — element mà majority of waves dùng.
 * `tam` kiếp (inner demon) trả `null`. Mixed kiếp lấy element của wave
 * cuối (climax wave) làm dominant.
 */
function dominantKiepElement(def: TribulationDef): ElementKey | null {
  if (def.type === 'tam') return null;
  if (def.waves.length === 0) return null;
  // Climax wave (last) thường là wave nguy hiểm nhất → đại diện kiếp.
  const last = def.waves[def.waves.length - 1];
  return last.element ?? null;
}

/**
 * Ước tính success chance deterministic (không roll RNG, không chạy
 * simulation) cho 1 character đối mặt 1 `TribulationDef`.
 *
 * Compose:
 *   `final = clamp(base[severity] + supportBonus + elementAdjustment, FLOOR, CEIL)`
 *
 * Dùng cho:
 *   - Preview endpoint `GET /character/tribulation/preview`.
 *   - Tooltip "%kiếp" trên FE TribulationView trước khi attempt.
 *   - Test invariant (ví dụ: full-build vẫn không > 0.95, no-build vẫn
 *     không < 0.05).
 *
 * KHÔNG thay thế `simulateTribulation` runtime (Phase 11.6.B vẫn deterministic
 * theo HP + waves + element resist) — runtime sẽ pass/fail dựa trên simulation
 * không phải chance này. Helper này chỉ là **estimate UX**.
 *
 * @returns breakdown chi tiết — FE/server đều dùng được.
 */
export function computeTribulationSuccessChance(
  input: TribulationSuccessChanceInput,
): TribulationSuccessChanceBreakdown {
  const { def, primaryElement, supports } = input;
  const base = TRIBULATION_BASE_SUCCESS_CHANCE_BY_SEVERITY[def.severity] ?? 0.5;
  const supportBonus = supports?.totalBonus ?? 0;
  const kiepElement = dominantKiepElement(def);
  const elementAdjustment = elementAffinityAdjustment(
    primaryElement ?? null,
    kiepElement,
  );
  const raw = base + supportBonus + elementAdjustment;
  let final = raw;
  let floorHit = false;
  let ceilHit = false;
  if (final < TRIBULATION_SUCCESS_CHANCE_FLOOR) {
    final = TRIBULATION_SUCCESS_CHANCE_FLOOR;
    floorHit = true;
  } else if (final > TRIBULATION_SUCCESS_CHANCE_CEIL) {
    final = TRIBULATION_SUCCESS_CHANCE_CEIL;
    ceilHit = true;
  }
  return {
    base,
    supportBonus,
    elementAdjustment,
    raw,
    final,
    floorHit,
    ceilHit,
  };
}

/**
 * Preview-friendly reward hint shape. Mirror `TribulationReward` nhưng
 * BigInt cast → string để FE serialize an toàn (Phase 11.6.B pattern).
 */
export interface TribulationRewardHint {
  linhThach: number;
  /** BigInt as string. */
  expBonus: string;
  titleKey: string | null;
  uniqueDropChance: number;
  uniqueDropItemKey: string | null;
}

/**
 * Extract reward hint từ `TribulationDef` — ready cho preview endpoint
 * JSON serialize.
 */
export function summarizeTribulationRewardHint(
  def: TribulationDef,
): TribulationRewardHint {
  return {
    linhThach: def.reward.linhThach,
    expBonus: def.reward.expBonus.toString(),
    titleKey: def.reward.titleKey,
    uniqueDropChance: def.reward.uniqueDropChance,
    uniqueDropItemKey: def.reward.uniqueDropItemKey,
  };
}

/**
 * Preview-friendly penalty hint shape — mirror `TribulationFailurePenalty`
 * 1:1.
 */
export interface TribulationPenaltyHint {
  expLossRatio: number;
  cooldownMinutes: number;
  taoMaDebuffChance: number;
  taoMaDebuffDurationMinutes: number;
}

/**
 * Extract penalty hint từ `TribulationDef`.
 */
export function summarizeTribulationPenaltyHint(
  def: TribulationDef,
): TribulationPenaltyHint {
  return {
    expLossRatio: def.failurePenalty.expLossRatio,
    cooldownMinutes: def.failurePenalty.cooldownMinutes,
    taoMaDebuffChance: def.failurePenalty.taoMaDebuffChance,
    taoMaDebuffDurationMinutes: def.failurePenalty.taoMaDebuffDurationMinutes,
  };
}
