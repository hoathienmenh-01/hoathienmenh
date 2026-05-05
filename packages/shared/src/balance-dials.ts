/**
 * Phase 11 nâng cao §6 — Balance Dials Registry.
 *
 * Tham chiếu: `docs/BALANCE_MODEL.md` §9 "BALANCE DIAL REGISTRY".
 *
 * Mục tiêu (per `docs/AI_WORKFLOW_RULES.md` BATCHING RULE + Test Fast Path):
 * 1. Tập trung magic numbers rải rác trong `*-balance.test.ts` thành một
 *    nơi duy nhất AI/dev đọc được trước khi thêm content.
 * 2. Re-export các dial **đã tồn tại** từ `combat.ts` / `ws-events.ts` /
 *    `realms.ts` để không break import path cũ — file này là **central
 *    hub** chứ không duplicate runtime constant.
 * 3. Thêm dial **mới** chuẩn hoá từ `*-balance.test.ts` (skill caps,
 *    item budget, mission reward budget) → migrate test sang import từ
 *    đây để dial dùng thật, không chỉ docs.
 * 4. Thêm dial **forward-compat** cho Phase 11 nâng cao §3 (Elemental
 *    Combat MVP) + §5 (Đột phá / Tâm Ma) — chưa wire vào runtime,
 *    nhưng có cap rõ ràng để khi service implement không vượt budget.
 *
 * NGUYÊN TẮC SỬ DỤNG (per `docs/BALANCE_MODEL.md` §9):
 * - **KHÔNG hard-code lại số** trong service / test mới. Import từ đây.
 * - **KHÔNG sửa giá trị** mà không update snapshot test +
 *   `BALANCE_MODEL.md` cùng PR.
 * - **KHÔNG thêm dial mới** mà thiếu invariant test trong
 *   `balance-dials.test.ts` (positivity / monotonic / cap min<max).
 *
 * `pnpm test:balance` (root script) chạy file này + tất cả
 * `*-balance.test.ts` để verify nhanh trước khi PR content scale.
 */

import { QUALITIES, type Quality } from './enums';
import { STAMINA_REGEN_PER_TICK } from './combat';
import {
  CULTIVATION_TICK_MS,
  CULTIVATION_TICK_BASE_EXP,
} from './ws-events';

// ---------------------------------------------------------------------------
// 1. CULTIVATION CURVE (re-export hub)
// ---------------------------------------------------------------------------

/** Period giữa 2 cultivation tick. Source: `ws-events.ts`. */
export { CULTIVATION_TICK_MS } from './ws-events';

/** EXP base mỗi tick trước multiplier. Source: `ws-events.ts`. */
export { CULTIVATION_TICK_BASE_EXP } from './ws-events';

/**
 * Realm rate exponent base — `rate(order) = base * 1.45^order` trong
 * `cultivationRateForRealm`. Source: `realms.ts`. Re-export cho
 * dashboard / balance test reference (hiện chỉ in trong realms.ts).
 */
export const CULTIVATION_RATE_REALM_MULT = 1.45;

/**
 * Multiplier cap khi stack buff/method/sect aura cultivation. Source:
 * `BALANCE_MODEL.md` §2.5. Wire điểm: aggregator dùng cap này khi compose.
 */
export const CULTIVATION_BUFF_CAP = 2.5;

// ---------------------------------------------------------------------------
// 2. REALM / EXP COST CURVE
// ---------------------------------------------------------------------------

/** Base EXP cost realm 0 (phamnhan). Source: `realms.ts` BASE_EXP. */
export const REALM_COST_BASE = 1000;

/** Realm cost scale exponent base — `cost(order) = base * 1.6^order`. */
export const REALM_COST_SCALE = 1.6;

/** Stage cost scale trong realm — mỗi stage × 1.4 stage trước. */
export const STAGE_COST_SCALE = 1.4;

// ---------------------------------------------------------------------------
// 3. STAMINA
// ---------------------------------------------------------------------------

/** Stamina regen mỗi cultivation tick. Source: `combat.ts`. */
export { STAMINA_REGEN_PER_TICK } from './combat';

/** Stamina max default cho character mới tạo. */
export const STAMINA_MAX_DEFAULT = 100;

// ---------------------------------------------------------------------------
// 4. COMBAT FORMULA CAPS
// ---------------------------------------------------------------------------

/** RNG damage range low. `damage = base * uniform(LOW, HIGH)`. */
export const COMBAT_RNG_LOW = 0.85;

/** RNG damage range high. */
export const COMBAT_RNG_HIGH = 1.15;

/** Min damage floor (dù def quá cao vẫn ăn ≥ 1 sát thương). */
export const COMBAT_MIN_DAMAGE = 1;

/** Defense factor — `damage_after_def = atk - def * 0.5`. */
export const COMBAT_DEF_FACTOR = 0.5;

// ---------------------------------------------------------------------------
// 5. SKILL POWER BUDGET CAPS (BALANCE_MODEL §4)
// ---------------------------------------------------------------------------
//
// Migrated từ `skills-balance.test.ts` để dial dùng thật cross-test.

/** Atk scale cap — multi-target / nuke skill cao nhất hiện ~5×. */
export const SKILL_ATK_SCALE_HARD_CAP = 5;

/** Self-heal ratio cap — skill heal % máu max của caster. */
export const SKILL_SELF_HEAL_HARD_CAP = 0.5;

/** Self-blood (HP cost) ratio cap — skill mất % máu của caster max. */
export const SKILL_SELF_BLOOD_HARD_CAP = 0.3;

/** Cooldown turn cap — skill nặng nhất hiện ~6 turn. */
export const SKILL_COOLDOWN_HARD_CAP = 6;

/** MP cost cap — skill mạnh nhất hiện ~50, hard cap 80 phòng growth. */
export const SKILL_MP_COST_HARD_CAP = 80;

// ---------------------------------------------------------------------------
// 6. ITEM POWER BUDGET (BALANCE_MODEL §3.3)
// ---------------------------------------------------------------------------
//
// Migrated từ `items-balance.test.ts` để dial dùng thật cross-test.

export interface ItemStatBudget {
  readonly atk: number;
  readonly def: number;
  readonly hpMax: number;
  readonly mpMax: number;
  readonly spirit: number;
}

/**
 * Stat caps per quality (per single item). Multi-stat budget capped
 * softer ở `ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER` × atk cap.
 *
 * Monotonic invariant: PHAM < LINH < HUYEN < TIEN < THAN cho mỗi stat
 * (verify ở `balance-dials.test.ts`).
 */
export const ITEM_STAT_BUDGET_BY_QUALITY: Readonly<Record<Quality, ItemStatBudget>> = {
  PHAM: { atk: 10, def: 8, hpMax: 30, mpMax: 30, spirit: 5 },
  LINH: { atk: 25, def: 20, hpMax: 80, mpMax: 80, spirit: 12 },
  HUYEN: { atk: 60, def: 50, hpMax: 200, mpMax: 200, spirit: 30 },
  TIEN: { atk: 200, def: 160, hpMax: 800, mpMax: 800, spirit: 100 },
  THAN: { atk: 800, def: 600, hpMax: 3000, mpMax: 3000, spirit: 350 },
};

/**
 * Off-slot multi-stat soft cap — power-equiv (sum × weight) ≤
 * MULTIPLIER × atk cap của quality.
 */
export const ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER = 1.2;

/**
 * Power-equiv weights per stat. Source: `BALANCE_MODEL.md` §3.3
 * Multi-stat. Sum(stat × weight) ≤ ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER ×
 * atk cap.
 */
export interface PowerEquivWeights {
  readonly atk: number;
  readonly def: number;
  readonly hpMax: number;
  readonly mpMax: number;
  readonly spirit: number;
}

export const ITEM_POWER_EQUIV_WEIGHTS: PowerEquivWeights = {
  atk: 1.0,
  def: 0.8,
  hpMax: 0.05,
  mpMax: 0.05,
  spirit: 1.5,
};

// ---------------------------------------------------------------------------
// 7. MISSION REWARD BUDGET (BALANCE_MODEL §7.1)
// ---------------------------------------------------------------------------
//
// Migrated từ `missions-balance.test.ts` để dial dùng thật cross-test.

/**
 * Daily mission linhThach cap per realm tier. Source:
 * `BALANCE_MODEL.md` §7.1 với +50% buffer cho big quest cuối tier.
 *
 * Monotonic invariant: luyenkhi < truc_co < kim_dan < nguyen_anh.
 */
export const MISSION_DAILY_BUDGET_BY_REALM_TIER: Readonly<Record<string, number>> = {
  luyenkhi: 800,
  truc_co: 2300,
  kim_dan: 6000,
  nguyen_anh: 15000,
};

/** Weekly mission linhThach cap = MULTIPLIER × DAILY budget cùng tier. */
export const MISSION_WEEKLY_DAILY_MULTIPLIER = 5;

/** ONCE mission linhThach cap tuyệt đối (story / milestone). */
export const MISSION_ONCE_LINHTHACH_HARD_CAP = 200_000;

/** Tien ngọc reward hard cap per mission (chỉ weekly/once cao cấp). */
export const MISSION_TIENNGOC_HARD_CAP = 100;

// ---------------------------------------------------------------------------
// 8. ELEMENTAL COMBAT MVP (forward-compat — Phase 11 nâng cao §3)
// ---------------------------------------------------------------------------
//
// Hiện chưa wire vào CombatService. Cap đặt sẵn để Phase 11 nâng cao §3
// (Elemental Combat MVP PR 2 trong roadmap doc) implement không vượt
// budget. Reference: `XuanToi_Phase11_NangCao_Report.docx` §3.

/** Đa modifier neutral (hệ trung tính / không thuộc tương sinh khắc). */
export const ELEMENT_NEUTRAL_MODIFIER = 1.0;

/** Đa modifier khi attacker khắc defender — max bonus damage. */
export const ELEMENT_COUNTER_BONUS_MAX = 1.15;

/** Đa modifier khi attacker bị defender khắc — penalty damage. */
export const ELEMENT_COUNTER_PENALTY_MIN = 0.9;

/** Đa modifier khi attacker tương sinh defender (nhẹ hơn counter). */
export const ELEMENT_GENERATE_BONUS = 1.05;

/** Sàn tuyệt đối modifier — không ai dropout dưới 0.8. */
export const ELEMENT_MODIFIER_ABSOLUTE_MIN = 0.8;

/** Trần tuyệt đối modifier — không ai stack vượt 1.25 (tránh power creep). */
export const ELEMENT_MODIFIER_ABSOLUTE_MAX = 1.25;

// ---------------------------------------------------------------------------
// 9. BREAKTHROUGH / TRIBULATION (forward-compat — Phase 11 nâng cao §5)
// ---------------------------------------------------------------------------
//
// Hiện service đã có chế độ deterministic. Cap đặt sẵn để Phase 11 nâng
// cao §5 (Đột phá nâng cao + Tâm Ma) wire success chance + fail penalty
// không vượt cap. Reference: `XuanToi_Phase11_NangCao_Report.docx` §5.

/** Success chance floor — không bao giờ ép player <30% (frustration). */
export const BREAKTHROUGH_CHANCE_MIN = 0.3;

/** Success chance ceiling — luôn có rủi ro nhỏ (tu tiên flavor). */
export const BREAKTHROUGH_CHANCE_MAX = 0.99;

/** Tâm Ma debuff duration cap khi fail (giây). */
export const BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC = 300;

/** Tâm Ma debuff cultivation rate penalty cap (multiplier). */
export const BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY = 0.7;

// ---------------------------------------------------------------------------
// 10. ECONOMY DIALS
// ---------------------------------------------------------------------------

/** Phường Thị (Market) tax rate default — Phase 11 economy. */
export const MARKET_TAX_DEFAULT = 0.05;

/** Drop weight max ratio per dungeon — không 1 item dominate >80% drop. */
export const DROP_WEIGHT_MAX_RATIO = 0.8;

// ---------------------------------------------------------------------------
// 11. AGGREGATE SNAPSHOT — `BALANCE_DIALS` const for snapshot test
// ---------------------------------------------------------------------------

/**
 * Read-only aggregate snapshot. Cho phép:
 * - Snapshot test detect unintentional dial drift.
 * - Admin dashboard (future) đọc dials qua một export duy nhất.
 * - AI/dev grep `BALANCE_DIALS` để thấy toàn bộ surface area.
 *
 * **KHÔNG** thêm dial mới mà chỉ thêm vào aggregate này — phải định
 * nghĩa `export const` riêng + thêm vào snapshot.
 */
export const BALANCE_DIALS = {
  // Cultivation
  CULTIVATION_TICK_MS,
  CULTIVATION_TICK_BASE_EXP,
  CULTIVATION_RATE_REALM_MULT,
  CULTIVATION_BUFF_CAP,

  // Realm cost
  REALM_COST_BASE,
  REALM_COST_SCALE,
  STAGE_COST_SCALE,

  // Stamina
  STAMINA_REGEN_PER_TICK,
  STAMINA_MAX_DEFAULT,

  // Combat
  COMBAT_RNG_LOW,
  COMBAT_RNG_HIGH,
  COMBAT_MIN_DAMAGE,
  COMBAT_DEF_FACTOR,

  // Skill caps
  SKILL_ATK_SCALE_HARD_CAP,
  SKILL_SELF_HEAL_HARD_CAP,
  SKILL_SELF_BLOOD_HARD_CAP,
  SKILL_COOLDOWN_HARD_CAP,
  SKILL_MP_COST_HARD_CAP,

  // Item budget
  ITEM_STAT_BUDGET_BY_QUALITY,
  ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER,
  ITEM_POWER_EQUIV_WEIGHTS,

  // Mission reward budget
  MISSION_DAILY_BUDGET_BY_REALM_TIER,
  MISSION_WEEKLY_DAILY_MULTIPLIER,
  MISSION_ONCE_LINHTHACH_HARD_CAP,
  MISSION_TIENNGOC_HARD_CAP,

  // Elemental combat (forward-compat)
  ELEMENT_NEUTRAL_MODIFIER,
  ELEMENT_COUNTER_BONUS_MAX,
  ELEMENT_COUNTER_PENALTY_MIN,
  ELEMENT_GENERATE_BONUS,
  ELEMENT_MODIFIER_ABSOLUTE_MIN,
  ELEMENT_MODIFIER_ABSOLUTE_MAX,

  // Breakthrough (forward-compat)
  BREAKTHROUGH_CHANCE_MIN,
  BREAKTHROUGH_CHANCE_MAX,
  BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
  BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,

  // Economy
  MARKET_TAX_DEFAULT,
  DROP_WEIGHT_MAX_RATIO,
} as const;

export type BalanceDials = typeof BALANCE_DIALS;

// ---------------------------------------------------------------------------
// 12. VALIDATORS — guard hàm cho catalog content authoring
// ---------------------------------------------------------------------------

export interface SkillBudgetInput {
  readonly key: string;
  readonly atkScale: number;
  readonly mpCost: number;
  readonly selfHealRatio: number;
  readonly selfBloodCost: number;
  readonly cooldownTurns?: number;
}

/**
 * Verify skill input không vượt budget. Trả về list error string (rỗng
 * nếu pass). Caller assert `errors.length === 0`.
 */
export function validateSkillBudget(input: SkillBudgetInput): string[] {
  const errs: string[] = [];
  if (input.atkScale < 0 || input.atkScale > SKILL_ATK_SCALE_HARD_CAP) {
    errs.push(
      `skill ${input.key} atkScale=${input.atkScale} ngoài [0..${SKILL_ATK_SCALE_HARD_CAP}]`,
    );
  }
  if (input.mpCost < 0 || input.mpCost > SKILL_MP_COST_HARD_CAP) {
    errs.push(
      `skill ${input.key} mpCost=${input.mpCost} ngoài [0..${SKILL_MP_COST_HARD_CAP}]`,
    );
  }
  if (input.selfHealRatio < 0 || input.selfHealRatio > SKILL_SELF_HEAL_HARD_CAP) {
    errs.push(
      `skill ${input.key} selfHealRatio=${input.selfHealRatio} ngoài [0..${SKILL_SELF_HEAL_HARD_CAP}]`,
    );
  }
  if (input.selfBloodCost < 0 || input.selfBloodCost > SKILL_SELF_BLOOD_HARD_CAP) {
    errs.push(
      `skill ${input.key} selfBloodCost=${input.selfBloodCost} ngoài [0..${SKILL_SELF_BLOOD_HARD_CAP}]`,
    );
  }
  const cd = input.cooldownTurns ?? 0;
  if (cd < 0 || cd > SKILL_COOLDOWN_HARD_CAP) {
    errs.push(
      `skill ${input.key} cooldownTurns=${cd} ngoài [0..${SKILL_COOLDOWN_HARD_CAP}]`,
    );
  }
  return errs;
}

export interface ItemBudgetInput {
  readonly key: string;
  readonly quality: Quality;
  readonly bonuses?: {
    readonly atk?: number;
    readonly def?: number;
    readonly hpMax?: number;
    readonly mpMax?: number;
    readonly spirit?: number;
  };
}

/**
 * Verify item bonuses không vượt budget per quality + multi-stat power
 * equiv không vượt soft cap. Trả về list error string.
 */
export function validateItemBudget(input: ItemBudgetInput): string[] {
  const errs: string[] = [];
  if (!QUALITIES.includes(input.quality)) {
    errs.push(`item ${input.key} quality=${input.quality} không hợp lệ`);
    return errs;
  }
  const cap = ITEM_STAT_BUDGET_BY_QUALITY[input.quality];
  const b = input.bonuses ?? {};
  const stats = ['atk', 'def', 'hpMax', 'mpMax', 'spirit'] as const;
  for (const k of stats) {
    const v = b[k] ?? 0;
    if (v < 0) {
      errs.push(`item ${input.key}.${k}=${v} âm`);
    }
    if (v > cap[k]) {
      errs.push(`item ${input.key}.${k}=${v} vượt cap ${cap[k]} (${input.quality})`);
    }
  }
  const w = ITEM_POWER_EQUIV_WEIGHTS;
  const equiv =
    (b.atk ?? 0) * w.atk +
    (b.def ?? 0) * w.def +
    (b.hpMax ?? 0) * w.hpMax +
    (b.mpMax ?? 0) * w.mpMax +
    (b.spirit ?? 0) * w.spirit;
  const softCap = cap.atk * ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER;
  if (equiv > softCap) {
    errs.push(
      `item ${input.key} power-equiv ${equiv.toFixed(2)} vượt soft cap ${softCap.toFixed(2)} (${input.quality})`,
    );
  }
  return errs;
}

export interface MissionRewardInput {
  readonly key: string;
  readonly period: 'DAILY' | 'WEEKLY' | 'ONCE';
  readonly realmTier?: string | null;
  readonly rewards: {
    readonly linhThach?: number;
    readonly tienNgoc?: number;
  };
}

/**
 * Verify mission reward không vượt budget per period × realm tier. Trả
 * về list error string.
 */
export function validateMissionRewardBudget(input: MissionRewardInput): string[] {
  const errs: string[] = [];
  const lt = input.rewards.linhThach ?? 0;
  const tn = input.rewards.tienNgoc ?? 0;
  if (lt < 0) errs.push(`mission ${input.key} linhThach=${lt} âm`);
  if (tn < 0) errs.push(`mission ${input.key} tienNgoc=${tn} âm`);
  if (tn > MISSION_TIENNGOC_HARD_CAP) {
    errs.push(
      `mission ${input.key} tienNgoc=${tn} vượt cap ${MISSION_TIENNGOC_HARD_CAP}`,
    );
  }
  if (input.period === 'DAILY' && input.realmTier) {
    const cap = MISSION_DAILY_BUDGET_BY_REALM_TIER[input.realmTier];
    if (cap !== undefined && lt > cap) {
      errs.push(
        `daily mission ${input.key} (${input.realmTier}) linhThach=${lt} vượt cap ${cap}`,
      );
    }
  } else if (input.period === 'WEEKLY' && input.realmTier) {
    const dailyCap = MISSION_DAILY_BUDGET_BY_REALM_TIER[input.realmTier];
    if (dailyCap !== undefined) {
      const weeklyCap = dailyCap * MISSION_WEEKLY_DAILY_MULTIPLIER;
      if (lt > weeklyCap) {
        errs.push(
          `weekly mission ${input.key} (${input.realmTier}) linhThach=${lt} vượt cap ${weeklyCap}`,
        );
      }
    }
  } else if (input.period === 'ONCE') {
    if (lt > MISSION_ONCE_LINHTHACH_HARD_CAP) {
      errs.push(
        `once mission ${input.key} linhThach=${lt} vượt cap ${MISSION_ONCE_LINHTHACH_HARD_CAP}`,
      );
    }
  }
  return errs;
}
