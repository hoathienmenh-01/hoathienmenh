/**
 * Phase 14.3.E.1 — Tribulation Mini-Battle shared helpers tests.
 *
 * Mục tiêu:
 *   - Helper deterministic cùng seed.
 *   - Mỗi effect type (BURST/SUSTAIN/POISON_RECOVERY/ARMOR_CRIT/
 *     DEFENSE_ENDURANCE) phải có tác dụng thật khác nhau.
 *   - Action validation (invalid action / terminal state) reject đúng.
 *   - Caps: damage / heal / shield / dotStacks không vượt cap.
 */
import { describe, expect, it } from 'vitest';
import {
  applyTribulationEffectType,
  capNonNeg,
  composeBattlePhaseSeed,
  computeTribulationBattlePower,
  computeTribulationPhaseResult,
  makeInitialMiniBattleSnapshot,
  mulberry32,
  summarizeTribulationBattleResult,
  TRIBULATION_BATTLE_ACTIONS,
  TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
  TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP,
  TRIBULATION_MINI_BATTLE_EFFECT_TYPES,
  TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
  TRIBULATION_MINI_BATTLE_HP_MAX_CAP,
  TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX,
  TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN,
  TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
  TRIBULATION_MINI_BATTLE_STATES,
  validateTribulationBattleAction,
  type TribulationBattleAction,
  type TribulationMiniBattleEffectType,
  type TribulationMiniBattleSnapshot,
} from './tribulation-mini-battle';

const baseInitial = (
  overrides: Partial<Parameters<typeof makeInitialMiniBattleSnapshot>[0]> = {},
) =>
  makeInitialMiniBattleSnapshot({
    effectType: 'BURST',
    element: 'hoa',
    difficulty: 'minor',
    playerHpMax: 500,
    seed: 42,
    ...overrides,
  });

describe('mini-battle constants & enums', () => {
  it('exports 5 states and 5 effect types and 5 actions', () => {
    expect(TRIBULATION_MINI_BATTLE_STATES).toEqual([
      'PENDING',
      'ACTIVE',
      'RESOLVED',
      'FAILED',
      'EXPIRED',
    ]);
    expect(TRIBULATION_MINI_BATTLE_EFFECT_TYPES).toHaveLength(5);
    expect(TRIBULATION_BATTLE_ACTIONS).toEqual([
      'ATTACK',
      'DEFEND',
      'FOCUS',
      'CLEANSE',
      'CHANNEL',
    ]);
  });

  it('caps are positive integers', () => {
    expect(TRIBULATION_MINI_BATTLE_HP_MAX_CAP).toBeGreaterThan(0);
    expect(TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP).toBeGreaterThan(0);
    expect(TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP).toBeGreaterThan(0);
    expect(TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP).toBeGreaterThan(0);
    expect(TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP).toBeGreaterThan(0);
    expect(TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX).toBeGreaterThanOrEqual(
      TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN,
    );
  });
});

describe('mulberry32 deterministic RNG', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i += 1) {
      expect(a()).toBeCloseTo(b(), 10);
    }
  });

  it('different seeds → different first value (statistically)', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('all values ∈ [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('composeBattlePhaseSeed deterministic', () => {
    const a = composeBattlePhaseSeed(42, 1);
    const b = composeBattlePhaseSeed(42, 1);
    expect(a).toBe(b);
    expect(composeBattlePhaseSeed(42, 1)).not.toBe(
      composeBattlePhaseSeed(42, 2),
    );
  });
});

describe('capNonNeg', () => {
  it('clamps negative to 0', () => {
    expect(capNonNeg(-10, 100)).toBe(0);
  });
  it('clamps above max', () => {
    expect(capNonNeg(150, 100)).toBe(100);
  });
  it('rounds non-integer', () => {
    expect(capNonNeg(3.7, 100)).toBe(4);
  });
  it('handles NaN as 0', () => {
    expect(capNonNeg(Number.NaN, 100)).toBe(0);
  });
});

describe('makeInitialMiniBattleSnapshot', () => {
  it('default state PENDING with phaseCount 1-indexed', () => {
    const s = baseInitial();
    expect(s.state).toBe('PENDING');
    expect(s.currentPhase).toBe(1);
    expect(s.phaseCount).toBeGreaterThanOrEqual(1);
    expect(s.playerHp).toBe(s.playerHpMax);
    expect(s.tribulationHp).toBe(s.tribulationHpMax);
    expect(s.shield).toBe(0);
    expect(s.dotStacks).toBe(0);
    expect(s.actionLog).toEqual([]);
    expect(s.result).toBeNull();
  });

  it('clamps phaseCount within [MIN, MAX]', () => {
    const tooHigh = baseInitial({ phaseCount: 999 });
    expect(tooHigh.phaseCount).toBeLessThanOrEqual(
      TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX,
    );
    const tooLow = baseInitial({ phaseCount: -1 });
    expect(tooLow.phaseCount).toBeGreaterThanOrEqual(
      TRIBULATION_MINI_BATTLE_PHASE_COUNT_MIN,
    );
  });

  it('clamps playerHpMax to HP_MAX_CAP', () => {
    const s = baseInitial({ playerHpMax: TRIBULATION_MINI_BATTLE_HP_MAX_CAP * 5 });
    expect(s.playerHpMax).toBe(TRIBULATION_MINI_BATTLE_HP_MAX_CAP);
  });

  it('seed normalized to positive integer', () => {
    const s = baseInitial({ seed: 0 });
    expect(s.seed).toBeGreaterThan(0);
    const s2 = baseInitial({ seed: -123 });
    expect(s2.seed).toBe(123);
  });
});

describe('validateTribulationBattleAction', () => {
  const active: TribulationMiniBattleSnapshot = {
    ...baseInitial(),
    state: 'ACTIVE',
  };

  it('accepts valid action on ACTIVE', () => {
    expect(validateTribulationBattleAction(active, 'ATTACK')).toEqual({
      ok: true,
      code: 'OK',
    });
  });

  it('accepts valid action on PENDING', () => {
    expect(
      validateTribulationBattleAction({ ...active, state: 'PENDING' }, 'DEFEND'),
    ).toEqual({ ok: true, code: 'OK' });
  });

  it('rejects unknown action', () => {
    expect(validateTribulationBattleAction(active, 'NUKE' as unknown)).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
    });
  });

  it('rejects on terminal RESOLVED', () => {
    expect(
      validateTribulationBattleAction({ ...active, state: 'RESOLVED' }, 'ATTACK'),
    ).toEqual({ ok: false, code: 'BATTLE_TERMINAL' });
  });

  it('rejects on terminal FAILED', () => {
    expect(
      validateTribulationBattleAction({ ...active, state: 'FAILED' }, 'ATTACK'),
    ).toEqual({ ok: false, code: 'BATTLE_TERMINAL' });
  });

  it('rejects on terminal EXPIRED', () => {
    expect(
      validateTribulationBattleAction({ ...active, state: 'EXPIRED' }, 'ATTACK'),
    ).toEqual({ ok: false, code: 'BATTLE_TERMINAL' });
  });

  it('rejects when currentPhase > phaseCount', () => {
    expect(
      validateTribulationBattleAction(
        { ...active, currentPhase: 99, phaseCount: 3 },
        'ATTACK',
      ),
    ).toEqual({ ok: false, code: 'PHASE_OVERFLOW' });
  });

  it('rejects non-string action', () => {
    expect(validateTribulationBattleAction(active, 42 as unknown)).toEqual({
      ok: false,
      code: 'INVALID_ACTION',
    });
  });
});

describe('applyTribulationEffectType: deterministic', () => {
  it('same input → same output', () => {
    const args = {
      effectType: 'BURST' as const,
      difficulty: 'minor' as const,
      phase: 1,
      phaseCount: 3,
      action: 'ATTACK' as const,
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 42,
    };
    const a = applyTribulationEffectType(args);
    const b = applyTribulationEffectType(args);
    expect(a).toEqual(b);
  });

  it('damage / heal / shield never exceed cap', () => {
    for (const effectType of TRIBULATION_MINI_BATTLE_EFFECT_TYPES) {
      for (const action of TRIBULATION_BATTLE_ACTIONS) {
        const out = applyTribulationEffectType({
          effectType,
          difficulty: 'saint',
          phase: 6,
          phaseCount: 6,
          action,
          playerHp: 9999,
          playerHpMax: 9999,
          tribulationHp: 9999,
          tribulationHpMax: 9999,
          shield: 0,
          dotStacks: 0,
          focusCharge: 0,
          seed: 1,
        });
        expect(out.damageDealtToTribulation).toBeLessThanOrEqual(
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        expect(out.damageTakenByPlayer).toBeLessThanOrEqual(
          TRIBULATION_MINI_BATTLE_DAMAGE_MAX_CAP,
        );
        expect(out.heal).toBeLessThanOrEqual(
          TRIBULATION_MINI_BATTLE_HEAL_MAX_CAP,
        );
        expect(out.shield).toBeLessThanOrEqual(
          TRIBULATION_MINI_BATTLE_SHIELD_MAX_CAP,
        );
        expect(out.dotStacks).toBeLessThanOrEqual(
          TRIBULATION_MINI_BATTLE_DOT_STACKS_MAX_CAP,
        );
        expect(out.playerHp).toBeGreaterThanOrEqual(0);
        expect(out.tribulationHp).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('effect mechanics: BURST', () => {
  it('ATTACK with FOCUS charge crits and ignores armor', () => {
    const noCharge = applyTribulationEffectType({
      effectType: 'BURST',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'ATTACK',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 42,
    });
    const charged = applyTribulationEffectType({
      effectType: 'BURST',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'ATTACK',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 1,
      seed: 42,
    });
    expect(charged.damageDealtToTribulation).toBeGreaterThan(
      noCharge.damageDealtToTribulation,
    );
    expect(charged.crit).toBe(true);
    expect(charged.focusCharge).toBe(0); // consumed
  });

  it('DEFEND adds shield', () => {
    const out = applyTribulationEffectType({
      effectType: 'BURST',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'DEFEND',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 42,
    });
    expect(out.shieldDelta).toBeGreaterThan(0);
  });
});

describe('effect mechanics: SUSTAIN', () => {
  it('FOCUS heals player', () => {
    const out = applyTribulationEffectType({
      effectType: 'SUSTAIN',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'FOCUS',
      playerHp: 100,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 7,
    });
    expect(out.heal).toBeGreaterThan(0);
    expect(out.playerHp).toBeGreaterThan(100);
  });
});

describe('effect mechanics: POISON_RECOVERY', () => {
  it('ATTACK accumulates dotStacks each phase (not CLEANSE)', () => {
    const out = applyTribulationEffectType({
      effectType: 'POISON_RECOVERY',
      difficulty: 'minor',
      phase: 2,
      phaseCount: 3,
      action: 'ATTACK',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 1,
      focusCharge: 0,
      seed: 7,
    });
    expect(out.dotStacks).toBe(2);
  });

  it('CLEANSE removes all dotStacks and heals small', () => {
    const out = applyTribulationEffectType({
      effectType: 'POISON_RECOVERY',
      difficulty: 'minor',
      phase: 2,
      phaseCount: 3,
      action: 'CLEANSE',
      playerHp: 200,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 5,
      focusCharge: 0,
      seed: 7,
    });
    expect(out.dotStacks).toBe(0);
    expect(out.heal).toBeGreaterThan(0);
  });
});

describe('effect mechanics: ARMOR_CRIT', () => {
  it('ATTACK without FOCUS reduced by armor', () => {
    const noFocus = applyTribulationEffectType({
      effectType: 'ARMOR_CRIT',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'ATTACK',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 42,
    });
    const focusedAttack = applyTribulationEffectType({
      effectType: 'ARMOR_CRIT',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'ATTACK',
      playerHp: 500,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 1,
      seed: 42,
    });
    expect(focusedAttack.damageDealtToTribulation).toBeGreaterThan(
      noFocus.damageDealtToTribulation,
    );
  });
});

describe('effect mechanics: DEFENSE_ENDURANCE', () => {
  it('DEFEND adds both shield and small heal', () => {
    const out = applyTribulationEffectType({
      effectType: 'DEFENSE_ENDURANCE',
      difficulty: 'minor',
      phase: 1,
      phaseCount: 3,
      action: 'DEFEND',
      playerHp: 100,
      playerHpMax: 500,
      tribulationHp: 240,
      tribulationHpMax: 240,
      shield: 0,
      dotStacks: 0,
      focusCharge: 0,
      seed: 1,
    });
    expect(out.shieldDelta).toBeGreaterThan(0);
    expect(out.heal).toBeGreaterThan(0);
  });
});

describe('computeTribulationPhaseResult', () => {
  it('appends event and increments phase on ACTIVE result', () => {
    const initial: TribulationMiniBattleSnapshot = {
      ...baseInitial({ playerHpMax: 5000 }),
      state: 'ACTIVE',
      tribulationHp: 5000,
      tribulationHpMax: 5000,
    };
    const { snapshot, event } = computeTribulationPhaseResult(initial, 'ATTACK');
    expect(event.phase).toBe(1);
    expect(snapshot.actionLog).toHaveLength(1);
    expect(snapshot.currentPhase).toBeGreaterThanOrEqual(1);
  });

  it('finishes RESOLVED when player kills tribulation', () => {
    const lowTribInitial: TribulationMiniBattleSnapshot = {
      ...baseInitial({ playerHpMax: 5000 }),
      state: 'ACTIVE',
      tribulationHp: 1,
      tribulationHpMax: 240,
    };
    const { snapshot, event } = computeTribulationPhaseResult(
      lowTribInitial,
      'ATTACK',
    );
    expect(snapshot.state).toBe('RESOLVED');
    expect(snapshot.result).toBe('win');
    expect(event.result).toBe('win');
  });

  it('finishes FAILED when player HP drops to 0', () => {
    const lowHpInitial: TribulationMiniBattleSnapshot = {
      ...baseInitial({ playerHpMax: 1, difficulty: 'saint' }),
      state: 'ACTIVE',
      playerHp: 1,
    };
    const { snapshot, event } = computeTribulationPhaseResult(
      lowHpInitial,
      'CHANNEL',
    );
    expect(snapshot.state).toBe('FAILED');
    expect(snapshot.result).toBe('lose');
    expect(event.result).toBe('lose');
  });

  it('survival win when reaching final phase with hp > 0', () => {
    const finalPhaseInitial: TribulationMiniBattleSnapshot = {
      ...baseInitial({ playerHpMax: 5000 }),
      state: 'ACTIVE',
      currentPhase: 3,
      phaseCount: 3,
      tribulationHp: 5000,
      tribulationHpMax: 5000,
    };
    const { snapshot } = computeTribulationPhaseResult(
      finalPhaseInitial,
      'DEFEND',
    );
    expect(snapshot.state).toBe('RESOLVED');
    expect(snapshot.result).toBe('win');
  });

  it('idempotent on terminal: returns terminal event without mutation', () => {
    const terminal: TribulationMiniBattleSnapshot = {
      ...baseInitial(),
      state: 'RESOLVED',
      result: 'win',
    };
    const { snapshot, event } = computeTribulationPhaseResult(
      terminal,
      'ATTACK',
    );
    expect(snapshot).toBe(terminal); // same reference
    expect(event.result).toBe('win');
  });
});

describe('summarizeTribulationBattleResult', () => {
  it('summarizes after a few actions', () => {
    let snap: TribulationMiniBattleSnapshot = {
      ...baseInitial({ playerHpMax: 5000 }),
      state: 'ACTIVE',
      tribulationHp: 5000,
      tribulationHpMax: 5000,
    };
    const actions: TribulationBattleAction[] = ['DEFEND', 'FOCUS', 'ATTACK'];
    for (const a of actions) {
      const next = computeTribulationPhaseResult(snap, a);
      snap = next.snapshot;
    }
    const summary = summarizeTribulationBattleResult(snap);
    expect(summary.phasesPlayed).toBe(3);
    expect(summary.totalDamageTaken).toBeGreaterThanOrEqual(0);
    expect(summary.totalDamageDealt).toBeGreaterThanOrEqual(0);
    expect(summary.effectType).toBe(snap.effectType);
  });
});

describe('computeTribulationBattlePower', () => {
  it('returns power, threshold, ratio with positive numbers', () => {
    const out = computeTribulationBattlePower({
      playerHpMax: 1000,
      supportBonus: 0.2,
      difficulty: 'minor',
      phaseCount: 3,
    });
    expect(out.power).toBeGreaterThan(0);
    expect(out.threshold).toBeGreaterThan(0);
    expect(out.ratio).toBeGreaterThan(0);
  });

  it('clamps ratio to [0.1, 10]', () => {
    const high = computeTribulationBattlePower({
      playerHpMax: TRIBULATION_MINI_BATTLE_HP_MAX_CAP,
      supportBonus: 1.0,
      difficulty: 'minor',
      phaseCount: 1,
    });
    expect(high.ratio).toBeLessThanOrEqual(10);
    const low = computeTribulationBattlePower({
      playerHpMax: 1,
      supportBonus: -1.0,
      difficulty: 'saint',
      phaseCount: TRIBULATION_MINI_BATTLE_PHASE_COUNT_MAX,
    });
    expect(low.ratio).toBeGreaterThanOrEqual(0.1);
  });
});

describe('all 5 effect types produce distinct mechanics on same action', () => {
  it('ATTACK damage profile differs between effects (not all equal)', () => {
    const damages = TRIBULATION_MINI_BATTLE_EFFECT_TYPES.map(
      (effectType: TribulationMiniBattleEffectType) =>
        applyTribulationEffectType({
          effectType,
          difficulty: 'major',
          phase: 1,
          phaseCount: 4,
          action: 'ATTACK',
          playerHp: 1000,
          playerHpMax: 1000,
          tribulationHp: 1000,
          tribulationHpMax: 1000,
          shield: 0,
          dotStacks: 0,
          focusCharge: 0,
          seed: 12345,
        }).damageDealtToTribulation,
    );
    // At least 2 distinct values across effect types.
    const unique = new Set(damages);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('DEFEND shield gain profile differs', () => {
    const shields = TRIBULATION_MINI_BATTLE_EFFECT_TYPES.map(
      (effectType: TribulationMiniBattleEffectType) =>
        applyTribulationEffectType({
          effectType,
          difficulty: 'major',
          phase: 1,
          phaseCount: 4,
          action: 'DEFEND',
          playerHp: 1000,
          playerHpMax: 1000,
          tribulationHp: 1000,
          tribulationHpMax: 1000,
          shield: 0,
          dotStacks: 0,
          focusCharge: 0,
          seed: 12345,
        }).shieldDelta,
    );
    const unique = new Set(shields);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
