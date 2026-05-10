/**
 * Phase 14.3.E.1 — Tribulation Mini-Battle (shared core).
 *
 * Pure deterministic helpers cho mini-battle Thiên Kiếp turn-based. Module này
 * KHÔNG runtime hook, KHÔNG IO, KHÔNG `Math.random`. Mọi RNG đều thông qua
 * `seed` + `mulberry32` deterministic — cùng `(state, action, seed, phase)` →
 * cùng output (replay-safe + test-stable).
 *
 * Mini-battle = layer mới trên top Phase 14.3.D Encounter (đã có `effectType`
 * BURST/SUSTAIN/POISON_RECOVERY/ARMOR_CRIT/DEFENSE_ENDURANCE). Trước đây 14.3.D
 * resolve = 1 lần `simulateTribulation` snapshot (RNG roll → outcome). Bây giờ
 * mini-battle thêm:
 *
 *   - State machine: PENDING → ACTIVE → RESOLVED | FAILED | EXPIRED.
 *   - Per-phase player chọn 1 trong 5 action: ATTACK / DEFEND / FOCUS /
 *     CLEANSE / CHANNEL.
 *   - Effect type quyết định mechanics của cả thiên kiếp lẫn player action.
 *   - Event log per phase (damage / shield / heal / dot / crit / messageKey)
 *     để FE replay + UX tooltip.
 *
 * **Quan trọng**: Mini-battle KHÔNG thay thế `simulateTribulation` — nó là
 * **alternative resolution path** khi `TRIBULATION_MINI_BATTLE_ENABLED=true`.
 * Khi flag disabled, flow cũ (Phase 14.3.D resolve = 1-shot) vẫn hoạt động
 * nguyên vẹn. Nếu mini-battle WIN → caller resolve cùng `runAttemptInTx` flow
 * với forced success path; LOSE → forced fail path. Reward/penalty vẫn theo
 * catalog hiện có (Phase 11.6.A) — KHÔNG nhân thêm.
 *
 * Caps (anti-cheat / data-drift guard):
 *   - phaseCount ∈ [1, 12].
 *   - playerHp / tribulationHp ∈ [0, 100000].
 *   - shield ∈ [0, 50000].
 *   - dotStacks ∈ [0, 20].
 *   - damage / heal per tick ∈ [0, 50000].
 *
 * @module tribulation-mini-battle
 */

import type { ElementKey } from './combat';
import type { TribulationSeverity } from './tribulation';
import type { TribulationEncounterEffectType } from './tribulation-encounter';

/* ---------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

/**
 * State machine cho mini-battle.
 *
 *   - `PENDING`: đã start nhưng chưa take action đầu tiên (FE đã render UI
 *     nhưng player chưa click). Cũng là state khi server tạo row mặc định.
 *   - `ACTIVE`: đã có ≥ 1 action processed, đang chạy phase.
 *   - `RESOLVED`: kết thúc thắng (player vượt qua đủ phase với HP > 0
 *     hoặc giết tribulation HP về 0).
 *   - `FAILED`: kết thúc thua (player HP <= 0).
 *   - `EXPIRED`: hết hạn (không action trong window — server cleanup;
 *     cũng coi là fail nhưng không apply penalty heavy).
 */
export type TribulationMiniBattleState =
  | 'PENDING'
  | 'ACTIVE'
  | 'RESOLVED'
  | 'FAILED'
  | 'EXPIRED';

export const TRIBULATION_MINI_BATTLE_STATES: readonly TribulationMiniBattleState[] =
  ['PENDING', 'ACTIVE', 'RESOLVED', 'FAILED', 'EXPIRED'];

/**
 * Re-export 5 effect type từ encounter catalog (Phase 14.3.D). Mini-battle
 * dùng cùng key — mỗi effect có mechanics khác nhau (xem
 * {@link applyTribulationEffectType}).
 */
export type TribulationMiniBattleEffectType = TribulationEncounterEffectType;

export const TRIBULATION_MINI_BATTLE_EFFECT_TYPES: readonly TribulationMiniBattleEffectType[] =
  ['BURST', 'SUSTAIN', 'POISON_RECOVERY', 'ARMOR_CRIT', 'DEFENSE_ENDURANCE'];

/**
 * 5 action player có thể chọn mỗi phase. Không phải mọi action đều có
 * tác dụng cho mọi effect — `validateTribulationBattleAction` check
 * combination, `applyTribulationEffectType` resolve mechanic.
 *
 *   - `ATTACK`: gây damage trực tiếp lên tribulationHp. Bị ARMOR_CRIT
 *     giảm trừ giáp.
 *   - `DEFEND`: gain shield + giảm incoming damage tick này. Combo
 *     tốt với BURST/DEFENSE_ENDURANCE.
 *   - `FOCUS`: charge buff cho action kế tiếp (crit / pierce / heal).
 *     Combo tốt với ARMOR_CRIT/SUSTAIN.
 *   - `CLEANSE`: clear dotStacks. Chỉ thật sự useful trong
 *     POISON_RECOVERY; effect khác fallback nhẹ.
 *   - `CHANNEL`: skip phase hiện tại, charge thêm sức cho action
 *     kế. Combo tốt với DEFENSE_ENDURANCE (sustain check); rủi ro cao
 *     với BURST.
 */
export type TribulationBattleAction =
  | 'ATTACK'
  | 'DEFEND'
  | 'FOCUS'
  | 'CLEANSE'
  | 'CHANNEL';

export const TRIBULATION_BATTLE_ACTIONS: readonly TribulationBattleAction[] = [
  'ATTACK',
  'DEFEND',
  'FOCUS',
  'CLEANSE',
  'CHANNEL',
];

/**
 * Event log per-phase. Server append vào battle row sau mỗi action xử lý.
 * FE replay để render animation/effect (Phase 14.3.E.2).
 *
 *   - `phase`: 1-indexed phase number (1..phaseCount+1; battle có thể
 *     end ở phase = phaseCount+1 nếu giết được trib trước khi đủ phase).
 *   - `action`: action player chọn ở phase này.
 *   - `damage`: tổng damage thiên kiếp gây (≥ 0). Đã trừ shield + cap.
 *   - `shield`: shield gain/loss của player ở phase này (delta).
 *   - `heal`: heal player nhận được (≥ 0).
 *   - `dot`: damage-over-time tick hoặc dotStack delta (POISON_RECOVERY).
 *   - `crit`: true nếu phase này có crit (BURST tribulation crit hoặc
 *     player FOCUS+ATTACK pierce crit).
 *   - `result`: `'ongoing' | 'win' | 'lose'` — outcome sau phase.
 *   - `messageKey`: i18n key cho FE render flavor text.
 */
export interface TribulationBattleEvent {
  phase: number;
  action: TribulationBattleAction;
  damage: number;
  shield: number;
  heal: number;
  dot: number;
  crit: boolean;
  result: 'ongoing' | 'win' | 'lose';
  messageKey: string;
}

/**
 * Mini-battle runtime state — server-authoritative snapshot. Persist vào
 * Prisma `TribulationMiniBattle` qua serialize JSON; FE đọc qua
 * `GET /character/tribulation/battle/current`.
 *
 *   - `state`: state machine (see {@link TribulationMiniBattleState}).
 *   - `effectType`: derived từ encounter (immutable trong battle).
 *   - `currentPhase`: 1-indexed (battle bắt đầu phase 1 sau action đầu).
 *   - `phaseCount`: tổng phase cần vượt (cap MAX_BATTLE_PHASES).
 *   - `playerHp`/`playerHpMax`: hiện tại / max.
 *   - `tribulationHp`/`tribulationHpMax`: hiện tại / max — alternative
 *     win condition (giết trib trước khi đủ phase).
 *   - `shield`: shield buff hiện tại (defend gain, decay phase next).
 *   - `dotStacks`: poison stack (POISON_RECOVERY only — effect khác = 0).
 *   - `focusCharge`: 1 nếu player FOCUS xong, ATTACK kế tiếp pierce/crit.
 *     Cleared sau khi consume hoặc CHANNEL.
 *   - `seed`: deterministic RNG seed (1..2^31).
 *   - `actionLog`: ordered log per phase (append-only).
 *   - `result`: kết quả nếu đã terminal (`'win' | 'lose' | null`).
 */
export interface TribulationMiniBattleSnapshot {
  state: TribulationMiniBattleState;
  effectType: TribulationMiniBattleEffectType;
  element: ElementKey;
  difficulty: TribulationSeverity;
  currentPhase: number;
  phaseCount: number;
  playerHp: number;
  playerHpMax: number;
  tribulationHp: number;
  tribulationHpMax: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  seed: number;
  actionLog: readonly TribulationBattleEvent[];
  result: 'win' | 'lose' | null;
}

/**
 * Validate result của {@link validateTribulationBattleAction}.
 */
export interface TribulationBattleActionValidation {
  ok: boolean;
  code:
    | 'OK'
    | 'INVALID_STATE'
    | 'INVALID_ACTION'
    | 'BATTLE_TERMINAL'
    | 'PHASE_OVERFLOW';
}

/**
 * Summary của 1 battle (terminal state) — mirror cho FE / metrics.
 */
export interface TribulationMiniBattleSummary {
  state: TribulationMiniBattleState;
  result: 'win' | 'lose' | null;
  phasesPlayed: number;
  totalDamageTaken: number;
  totalDamageDealt: number;
  totalHeal: number;
  totalShieldGained: number;
  finalPlayerHp: number;
  finalTribulationHp: number;
  effectType: TribulationMiniBattleEffectType;
}

/* ---------------------------------------------------------------------------
 * Caps & balance constants
 * ------------------------------------------------------------------------- */

export const TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN = 1;
export const TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX = 12;

export const TRIBULATION_MINI_BATTLE_HP_MAX_CAP = 100_000;
export const TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP = 50_000;
export const TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP = 50_000;
export const TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP = 50_000;
export const TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP = 20;

/**
 * Phase count theo severity. Mini-battle phase ≥ encounter phase (Phase
 * 14.3.D dùng cho UI block view) nhưng cap riêng để combat không quá dài.
 */
export const TRIBULATION_MINI_BATTLE_PHASE_COUNT_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 3,
  major: 4,
  heavenly: 5,
  saint: 6,
};

/**
 * Base tribulation HP theo severity. Player có thể giết trib trước phaseCount
 * nếu damage đủ (alternative win path).
 */
export const TRIBULATION_MINI_BATTLE_TRIBULATION_HP_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 240,
  major: 360,
  heavenly: 520,
  saint: 720,
};

/**
 * Base damage tick theo severity. Per-effect modifier ở
 * {@link applyTribulationEffectType}.
 */
export const TRIBULATION_MINI_BATTLE_BASE_DAMAGE_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 18,
  major: 26,
  heavenly: 36,
  saint: 48,
};

/**
 * Base attack damage player gây cho trib mỗi ATTACK action (trước
 * effectType modifier + crit).
 */
export const TRIBULATION_MINI_BATTLE_PLAYER_ATTACK_BY_SEVERITY: Readonly<
  Record<TribulationSeverity, number>
> = {
  minor: 60,
  major: 70,
  heavenly: 80,
  saint: 90,
};

/* ---------------------------------------------------------------------------
 * Deterministic RNG
 * ------------------------------------------------------------------------- */

/**
 * Mulberry32 — deterministic 32-bit PRNG. Pure: cùng seed → cùng sequence.
 * Tham khảo từ "An efficient PRNG for client-side simulation" (Tommy
 * Ettinger). Dùng cho mini-RNG trong mini-battle (crit roll, damage
 * variance ±10%). KHÔNG dùng cho cryptography.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compose seed cho 1 phase từ base seed + phase index. Đảm bảo cùng phase
 * → cùng RNG sequence (replay-safe). Phase = 1-indexed.
 */
export function composeBattlePhaseSeed(seed: number, phase: number): number {
  // Mix base seed với phase qua mulberry32 (1 step) để spread bit. Cap
  // 2^31 để giữ cho `| 0` cast không overflow sign.
  const next = mulberry32((seed ^ (phase * 0x9e3779b1)) | 0)();
  return Math.floor(next * 0x7fffffff) | 0;
}

/* ---------------------------------------------------------------------------
 * Caps helpers (pure)
 * ------------------------------------------------------------------------- */

/** Cap value vào `[0, max]` integer rounded. */
export function capNonNeg(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return Math.round(value);
}

/* ---------------------------------------------------------------------------
 * computeTribulationBattlePower
 * ------------------------------------------------------------------------- */

/**
 * Tính "battle power" estimate cho character vs encounter — heuristic số
 * cho FE hint UX ("dễ" / "vừa" / "khó"). Server KHÔNG enforce — chỉ
 * preview. Pure: deterministic.
 *
 * Công thức:
 *   power = playerHpMax × (1 + supportBonus)
 *   threshold = baseDamage × phaseCount × 1.5
 *   ratio = power / threshold
 *
 * @returns ratio ∈ [0.1, 10] — clamp để FE render tooltip an toàn.
 */
export function computeTribulationBattlePower(args: {
  playerHpMax: number;
  supportBonus: number;
  difficulty: TribulationSeverity;
  phaseCount: number;
}): { power: number; threshold: number; ratio: number } {
  const baseDamage =
    TRIBULATION_MINI_BATTLE_BASE_DAMAGE_BY_SEVERITY[args.difficulty];
  const phaseCount = Math.max(
    TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN,
    Math.min(TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX, args.phaseCount),
  );
  const supportBonus =
    Number.isFinite(args.supportBonus) && args.supportBonus > -1
      ? Math.max(-0.5, Math.min(0.5, args.supportBonus))
      : 0;
  const power = Math.max(1, args.playerHpMax) * (1 + supportBonus);
  const threshold = Math.max(1, baseDamage * phaseCount * 1.5);
  const ratio = power / threshold;
  const clampedRatio = Math.max(0.1, Math.min(10, ratio));
  return {
    power: Math.round(power),
    threshold: Math.round(threshold),
    ratio: Number(clampedRatio.toFixed(3)),
  };
}

/* ---------------------------------------------------------------------------
 * validateTribulationBattleAction
 * ------------------------------------------------------------------------- */

/**
 * Pre-validate (state, action). Pure — không mutate. Return code dễ map ra
 * HTTP status ở controller.
 */
export function validateTribulationBattleAction(
  snapshot: Pick<
    TribulationMiniBattleSnapshot,
    'state' | 'currentPhase' | 'phaseCount'
  >,
  action: unknown,
): TribulationBattleActionValidation {
  if (
    snapshot.state === 'RESOLVED' ||
    snapshot.state === 'FAILED' ||
    snapshot.state === 'EXPIRED'
  ) {
    return { ok: false, code: 'BATTLE_TERMINAL' };
  }
  if (snapshot.state !== 'PENDING' && snapshot.state !== 'ACTIVE') {
    return { ok: false, code: 'INVALID_STATE' };
  }
  if (typeof action !== 'string') {
    return { ok: false, code: 'INVALID_ACTION' };
  }
  if (!(TRIBULATION_BATTLE_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: 'INVALID_ACTION' };
  }
  if (snapshot.currentPhase > snapshot.phaseCount) {
    return { ok: false, code: 'PHASE_OVERFLOW' };
  }
  return { ok: true, code: 'OK' };
}

/* ---------------------------------------------------------------------------
 * applyTribulationEffectType — core mechanics per effect.
 * ------------------------------------------------------------------------- */

interface PhaseStepInput {
  effectType: TribulationMiniBattleEffectType;
  difficulty: TribulationSeverity;
  phase: number; // 1-indexed
  phaseCount: number;
  action: TribulationBattleAction;
  playerHp: number;
  playerHpMax: number;
  tribulationHp: number;
  tribulationHpMax: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  seed: number;
}

interface PhaseStepOutput {
  playerHp: number;
  tribulationHp: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  damageDealtToTribulation: number;
  damageTakenByPlayer: number;
  shieldDelta: number;
  heal: number;
  dot: number;
  crit: boolean;
  messageKey: string;
}

/**
 * Resolve 1 phase step — pure deterministic. Không mutate input. Trả về
 * snapshot mới + mọi delta cần render event.
 *
 * Mechanics tóm tắt:
 *   - Tribulation always tick base damage scaled bởi effectType + phase
 *     index.
 *   - Player action modify state (shield/heal/dot/focus) hoặc gây damage
 *     trở lại trib.
 *   - Order: (1) apply player action lên player state hoặc trib; (2) trib
 *     tick damage minus shield; (3) decay shield (50%); (4) check terminal.
 *
 * Caps applied internally — caller không cần re-clamp.
 */
export function applyTribulationEffectType(
  input: PhaseStepInput,
): PhaseStepOutput {
  const rng = mulberry32(composeBattlePhaseSeed(input.seed, input.phase));
  const baseDamage =
    TRIBULATION_MINI_BATTLE_BASE_DAMAGE_BY_SEVERITY[input.difficulty];
  const baseAttack =
    TRIBULATION_MINI_BATTLE_PLAYER_ATTACK_BY_SEVERITY[input.difficulty];

  // Variance ±10% deterministic per phase.
  const variance = 0.9 + rng() * 0.2;

  let damageDealtToTribulation = 0;
  let damageTakenByPlayer = 0;
  let shieldDelta = 0;
  let heal = 0;
  let dot = 0;
  let crit = false;
  let messageKey = `tribulation.battle.${input.effectType}.${input.action}`.toLowerCase();

  // Working copy.
  let playerHp = input.playerHp;
  let tribulationHp = input.tribulationHp;
  let shield = input.shield;
  let dotStacks = input.dotStacks;
  let focusCharge = input.focusCharge;

  // ============== 1) Apply player action (effectType-specific) ==============
  switch (input.effectType) {
    case 'BURST': {
      // Strong burst from trib; FOCUS+ATTACK = pierce crit; DEFEND halves.
      if (input.action === 'ATTACK') {
        let dmg = baseAttack * variance;
        if (focusCharge > 0) {
          dmg *= 1.5;
          crit = true;
          focusCharge = 0;
        }
        damageDealtToTribulation = capNonNeg(
          dmg,
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        tribulationHp = Math.max(0, tribulationHp - damageDealtToTribulation);
      } else if (input.action === 'DEFEND') {
        const gain = baseDamage * 1.2;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      } else if (input.action === 'FOCUS') {
        focusCharge = 1;
      } else if (input.action === 'CHANNEL') {
        // High-risk: skip damage mitigation, charge for next phase.
        focusCharge = 1;
      }
      break;
    }
    case 'SUSTAIN': {
      // Constant tick from trib; player heal via FOCUS; small DEFEND shield.
      if (input.action === 'ATTACK') {
        let dmg = baseAttack * 0.85 * variance;
        if (focusCharge > 0) {
          dmg *= 1.4;
          crit = true;
          focusCharge = 0;
        }
        damageDealtToTribulation = capNonNeg(
          dmg,
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        tribulationHp = Math.max(0, tribulationHp - damageDealtToTribulation);
      } else if (input.action === 'DEFEND') {
        const gain = baseDamage * 0.8;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      } else if (input.action === 'FOCUS') {
        heal = capNonNeg(
          input.playerHpMax * 0.12,
          TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
        );
        playerHp = Math.min(input.playerHpMax, playerHp + heal);
        focusCharge = 1;
      } else if (input.action === 'CHANNEL') {
        heal = capNonNeg(
          input.playerHpMax * 0.06,
          TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
        );
        playerHp = Math.min(input.playerHpMax, playerHp + heal);
      }
      break;
    }
    case 'POISON_RECOVERY': {
      // Trib adds DOT each phase. CLEANSE removes stacks. DEFEND mitigates.
      if (input.action === 'ATTACK') {
        let dmg = baseAttack * 0.9 * variance;
        if (focusCharge > 0) {
          dmg *= 1.4;
          crit = true;
          focusCharge = 0;
        }
        damageDealtToTribulation = capNonNeg(
          dmg,
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        tribulationHp = Math.max(0, tribulationHp - damageDealtToTribulation);
      } else if (input.action === 'DEFEND') {
        const gain = baseDamage * 0.6;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      } else if (input.action === 'FOCUS') {
        focusCharge = 1;
      } else if (input.action === 'CLEANSE') {
        const cleared = dotStacks;
        dot = -cleared; // negative = removed
        dotStacks = 0;
        const small = capNonNeg(
          input.playerHpMax * 0.04,
          TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
        );
        heal = small;
        playerHp = Math.min(input.playerHpMax, playerHp + small);
      } else if (input.action === 'CHANNEL') {
        focusCharge = 1;
      }
      break;
    }
    case 'ARMOR_CRIT': {
      // Trib has armor reducing player ATTACK; FOCUS lets next ATTACK pierce.
      const armor = baseDamage * 0.6;
      if (input.action === 'ATTACK') {
        let dmg = baseAttack * variance;
        if (focusCharge > 0) {
          // Pierce + crit: ignore armor, +50%.
          dmg *= 1.5;
          crit = true;
          focusCharge = 0;
        } else {
          dmg = Math.max(0, dmg - armor);
        }
        damageDealtToTribulation = capNonNeg(
          dmg,
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        tribulationHp = Math.max(0, tribulationHp - damageDealtToTribulation);
      } else if (input.action === 'DEFEND') {
        const gain = baseDamage * 0.9;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      } else if (input.action === 'FOCUS') {
        focusCharge = 1;
      } else if (input.action === 'CHANNEL') {
        focusCharge = 1;
      }
      break;
    }
    case 'DEFENSE_ENDURANCE': {
      // Trib hits hard but reduced; player must survive long. DEFEND gives
      // both shield + small heal (sustain build).
      if (input.action === 'ATTACK') {
        let dmg = baseAttack * 0.7 * variance;
        if (focusCharge > 0) {
          dmg *= 1.3;
          crit = true;
          focusCharge = 0;
        }
        damageDealtToTribulation = capNonNeg(
          dmg,
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        tribulationHp = Math.max(0, tribulationHp - damageDealtToTribulation);
      } else if (input.action === 'DEFEND') {
        const gain = baseDamage * 1.0;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
        const sustainHeal = capNonNeg(
          input.playerHpMax * 0.05,
          TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
        );
        heal = sustainHeal;
        playerHp = Math.min(input.playerHpMax, playerHp + sustainHeal);
      } else if (input.action === 'FOCUS') {
        focusCharge = 1;
        // Endurance flavor: small shield bonus.
        const small = capNonNeg(
          baseDamage * 0.3,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
        shieldDelta += small;
        shield = capNonNeg(
          shield + small,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      } else if (input.action === 'CHANNEL') {
        // Channel pays off — large shield gain next phase.
        const gain = baseDamage * 0.7;
        shieldDelta = capNonNeg(gain, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
        shield = capNonNeg(
          shield + shieldDelta,
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
      }
      break;
    }
    default: {
      // Exhaustive guard — TS will warn if new effect type added.
      const _exhaustive: never = input.effectType;
      throw new Error(`unhandled effect type ${String(_exhaustive)}`);
    }
  }

  // ============== 2) Tribulation tick damage (effect-modulated) =============
  let incoming = baseDamage * variance;
  switch (input.effectType) {
    case 'BURST': {
      // Spike scales with phase index (later = harder).
      incoming *= 1 + 0.25 * (input.phase - 1);
      // BURST also has a deterministic crit chance scaling with phase.
      if (rng() < 0.15 + 0.05 * (input.phase - 1)) {
        incoming *= 1.4;
        crit = crit || true;
      }
      // Player DEFEND reduces incoming by extra 30% on top of shield.
      if (input.action === 'DEFEND') incoming *= 0.7;
      break;
    }
    case 'SUSTAIN': {
      incoming *= 1.0; // constant
      // CHANNEL exposes player slightly more.
      if (input.action === 'CHANNEL') incoming *= 1.15;
      break;
    }
    case 'POISON_RECOVERY': {
      // Add dot stack each phase (cap), then deal: base + dotStacks * 4.
      if (input.action !== 'CLEANSE') {
        dotStacks = capNonNeg(
          dotStacks + 1,
          TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP,
        );
        // dot delta represents add (positive); preserve negative cleanse delta
        // computed earlier above (action===CLEANSE branch can't reach here).
        if (dot >= 0) dot = dot + 1;
      }
      const dotComponent = dotStacks * 4;
      incoming = baseDamage * 0.5 * variance + dotComponent;
      if (input.action === 'DEFEND') incoming *= 0.75;
      break;
    }
    case 'ARMOR_CRIT': {
      incoming *= 1.0;
      // Has chance to crit through player armor.
      if (rng() < 0.18) {
        incoming *= 1.35;
        crit = crit || true;
      }
      if (input.action === 'DEFEND') incoming *= 0.65;
      break;
    }
    case 'DEFENSE_ENDURANCE': {
      // Constant grind, slow but unavoidable.
      incoming *= 0.9;
      if (input.action === 'DEFEND') incoming *= 0.6;
      if (input.action === 'CHANNEL') incoming *= 0.8;
      break;
    }
    default: {
      const _exhaustive: never = input.effectType;
      throw new Error(`unhandled effect type ${String(_exhaustive)}`);
    }
  }

  let absorbed = 0;
  if (shield > 0) {
    absorbed = Math.min(shield, incoming);
    shield -= absorbed;
    incoming -= absorbed;
  }

  damageTakenByPlayer = capNonNeg(
    incoming,
    TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
  );
  playerHp = Math.max(0, playerHp - damageTakenByPlayer);

  // Shield decays 50% at end of phase (bounded).
  shield = Math.max(0, Math.floor(shield * 0.5));

  // DOT stacks decay 1 per phase if not POISON_RECOVERY.
  if (input.effectType !== 'POISON_RECOVERY' && dotStacks > 0) {
    dotStacks = Math.max(0, dotStacks - 1);
  }

  // Final caps.
  playerHp = capNonNeg(playerHp, TRIBULATION_MINI_BATTLE_HP_MAX_CAP);
  tribulationHp = capNonNeg(tribulationHp, TRIBULATION_MINI_BATTLE_HP_MAX_CAP);
  shield = capNonNeg(shield, TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP);
  dotStacks = capNonNeg(dotStacks, TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP);

  return {
    playerHp,
    tribulationHp,
    shield,
    dotStacks,
    focusCharge,
    damageDealtToTribulation,
    damageTakenByPlayer,
    shieldDelta,
    heal,
    dot,
    crit,
    messageKey,
  };
}

/* ---------------------------------------------------------------------------
 * computeTribulationPhaseResult — apply 1 player action → new snapshot + event
 * ------------------------------------------------------------------------- */

/**
 * High-level pure step: take a snapshot + an action, return the new snapshot
 * and the {@link TribulationBattleEvent} appended to `actionLog`. Idempotent
 * KHÔNG có — caller phải dedupe theo `clientNonce` ở service layer.
 *
 * Terminal conditions (in order):
 *   - playerHp <= 0 → state='FAILED', result='lose'.
 *   - tribulationHp <= 0 → state='RESOLVED', result='win' (early kill).
 *   - currentPhase >= phaseCount AND playerHp > 0 → state='RESOLVED',
 *     result='win' (survival).
 *
 * Otherwise → state='ACTIVE', currentPhase += 1, result=null.
 */
export function computeTribulationPhaseResult(
  snapshot: TribulationMiniBattleSnapshot,
  action: TribulationBattleAction,
): {
  snapshot: TribulationMiniBattleSnapshot;
  event: TribulationBattleEvent;
} {
  if (snapshot.state === 'RESOLVED' || snapshot.state === 'FAILED' || snapshot.state === 'EXPIRED') {
    // Defensive — caller should validate first; return event reflecting
    // terminal so log not corrupted.
    const terminalEvent: TribulationBattleEvent = {
      phase: snapshot.currentPhase,
      action,
      damage: 0,
      shield: 0,
      heal: 0,
      dot: 0,
      crit: false,
      result: snapshot.result === 'win' ? 'win' : 'lose',
      messageKey: 'tribulation.battle.terminal',
    };
    return { snapshot, event: terminalEvent };
  }

  const phase = snapshot.currentPhase;
  const step = applyTribulationEffectType({
    effectType: snapshot.effectType,
    difficulty: snapshot.difficulty,
    phase,
    phaseCount: snapshot.phaseCount,
    action,
    playerHp: snapshot.playerHp,
    playerHpMax: snapshot.playerHpMax,
    tribulationHp: snapshot.tribulationHp,
    tribulationHpMax: snapshot.tribulationHpMax,
    shield: snapshot.shield,
    dotStacks: snapshot.dotStacks,
    focusCharge: snapshot.focusCharge,
    seed: snapshot.seed,
  });

  let newState: TribulationMiniBattleState = 'ACTIVE';
  let result: 'win' | 'lose' | null = null;
  let eventResult: 'ongoing' | 'win' | 'lose' = 'ongoing';

  if (step.playerHp <= 0) {
    newState = 'FAILED';
    result = 'lose';
    eventResult = 'lose';
  } else if (step.tribulationHp <= 0) {
    newState = 'RESOLVED';
    result = 'win';
    eventResult = 'win';
  } else if (phase >= snapshot.phaseCount) {
    newState = 'RESOLVED';
    result = 'win';
    eventResult = 'win';
  }

  const event: TribulationBattleEvent = {
    phase,
    action,
    damage: step.damageTakenByPlayer,
    shield: step.shieldDelta,
    heal: step.heal,
    dot: step.dot,
    crit: step.crit,
    result: eventResult,
    messageKey: step.messageKey,
  };

  const nextSnapshot: TribulationMiniBattleSnapshot = {
    state: newState,
    effectType: snapshot.effectType,
    element: snapshot.element,
    difficulty: snapshot.difficulty,
    currentPhase:
      newState === 'ACTIVE' ? Math.min(snapshot.phaseCount, phase + 1) : phase,
    phaseCount: snapshot.phaseCount,
    playerHp: step.playerHp,
    playerHpMax: snapshot.playerHpMax,
    tribulationHp: step.tribulationHp,
    tribulationHpMax: snapshot.tribulationHpMax,
    shield: step.shield,
    dotStacks: step.dotStacks,
    focusCharge: step.focusCharge,
    seed: snapshot.seed,
    actionLog: [...snapshot.actionLog, event],
    result,
  };

  return { snapshot: nextSnapshot, event };
}

/* ---------------------------------------------------------------------------
 * summarizeTribulationBattleResult
 * ------------------------------------------------------------------------- */

/**
 * Tổng hợp 1 battle (terminal hoặc đang chạy) → summary cho FE / metrics.
 * Pure: deterministic.
 */
export function summarizeTribulationBattleResult(
  snapshot: TribulationMiniBattleSnapshot,
): TribulationMiniBattleSummary {
  let totalDamageTaken = 0;
  let totalDamageDealt = 0;
  let totalHeal = 0;
  let totalShieldGained = 0;
  for (const e of snapshot.actionLog) {
    totalDamageTaken += Math.max(0, e.damage);
    totalHeal += Math.max(0, e.heal);
    if (e.shield > 0) totalShieldGained += e.shield;
    if (e.crit) {
      // accumulate per-event damage dealt is implicit via state delta;
      // we don't track separately in event, so compute via final HP delta.
    }
  }
  totalDamageDealt = Math.max(
    0,
    snapshot.tribulationHpMax - snapshot.tribulationHp,
  );
  return {
    state: snapshot.state,
    result: snapshot.result,
    phasesPlayed: snapshot.actionLog.length,
    totalDamageTaken,
    totalDamageDealt,
    totalHeal,
    totalShieldGained,
    finalPlayerHp: snapshot.playerHp,
    finalTribulationHp: snapshot.tribulationHp,
    effectType: snapshot.effectType,
  };
}

/* ---------------------------------------------------------------------------
 * Initial snapshot factory
 * ------------------------------------------------------------------------- */

/**
 * Tạo snapshot ban đầu — pure factory. Caller persist kết quả ngay sau khi
 * tạo battle row.
 *
 * Caps applied: phaseCount clamp, hp/trib hp clamp, seed normalize.
 */
export function makeInitialMiniBattleSnapshot(args: {
  effectType: TribulationMiniBattleEffectType;
  element: ElementKey;
  difficulty: TribulationSeverity;
  phaseCount?: number;
  playerHpMax: number;
  tribulationHpMax?: number;
  seed: number;
}): TribulationMiniBattleSnapshot {
  const phaseCount = Math.max(
    TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN,
    Math.min(
      TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX,
      args.phaseCount ??
        TRIBULATION_MINI_BATTLE_PHASE_COUNT_BY_SEVERITY[args.difficulty],
    ),
  );
  const tribHp = capNonNeg(
    args.tribulationHpMax ??
      TRIBULATION_MINI_BATTLE_TRIBULATION_HP_BY_SEVERITY[args.difficulty],
    TRIBULATION_MINI_BATTLE_HP_MAX_CAP,
  );
  const playerHpMax = capNonNeg(
    args.playerHpMax,
    TRIBULATION_MINI_BATTLE_HP_MAX_CAP,
  );
  // Normalize seed to a positive 31-bit int to avoid `| 0` sign issues.
  const seed = Math.abs(Math.floor(args.seed)) | 0 || 1;
  return {
    state: 'PENDING',
    effectType: args.effectType,
    element: args.element,
    difficulty: args.difficulty,
    currentPhase: 1,
    phaseCount,
    playerHp: playerHpMax,
    playerHpMax,
    tribulationHp: tribHp,
    tribulationHpMax: tribHp,
    shield: 0,
    dotStacks: 0,
    focusCharge: 0,
    seed,
    actionLog: [],
    result: null,
  };
}
