/**
 * Unit tests cho `computeBreakthroughChance` — Phase 11 nâng cao §5 PR1.
 *
 * Verify pure formula:
 * 1. Gate: NOT_AT_PEAK (realmStage<9) + INSUFFICIENT_EXP (exp<cost) → 0 chance.
 * 2. Base chance = `BREAKTHROUGH_CHANCE_BASE` khi không có bonus.
 * 3. Root purity bonus monotonic (purity 0 → 0.5 → 1.0).
 * 4. Method element affinity: primary > secondary > no-match.
 * 5. Item bonus clamp `[0, BREAKTHROUGH_ITEM_BONUS_MAX]`.
 * 6. Final chance clamp `[BREAKTHROUGH_CHANCE_MIN, BREAKTHROUGH_CHANCE_MAX]`.
 * 7. rawChance preserve sum trước clamp (audit transparency).
 * 8. Defensive: NaN/Infinity → fallback 0; secondaryElements thiếu → no bonus.
 */
import { describe, expect, it } from 'vitest';
import {
  BREAKTHROUGH_CHANCE_BASE,
  BREAKTHROUGH_CHANCE_MAX,
  BREAKTHROUGH_CHANCE_MIN,
  BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
  BREAKTHROUGH_ITEM_BONUS_MAX,
  BREAKTHROUGH_METHOD_AFFINITY_BONUS,
  BREAKTHROUGH_ROOT_PURITY_BONUS_MAX,
} from './balance-dials';
import {
  computeBreakthroughChance,
  evaluateBreakthroughOutcome,
  type BreakthroughChanceBreakdown,
} from './breakthrough-chance';

const PEAK = {
  realmStage: 9,
  expCurrent: 100_000n,
  expCost: 23_613n,
} as const;

describe('computeBreakthroughChance — gate (NOT_AT_PEAK / INSUFFICIENT_EXP)', () => {
  it('realmStage=1 (fresh char) → NOT_AT_PEAK + finalChance=0', () => {
    const r = computeBreakthroughChance({
      realmStage: 1,
      expCurrent: 100_000n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('NOT_AT_PEAK');
    expect(r.finalChance).toBe(0);
    expect(r.rawChance).toBe(0);
    expect(r.baseChance).toBe(0);
  });

  it('realmStage=8 (peak-1) → NOT_AT_PEAK', () => {
    const r = computeBreakthroughChance({
      realmStage: 8,
      expCurrent: 100_000n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('NOT_AT_PEAK');
    expect(r.finalChance).toBe(0);
  });

  it('realmStage=9 + exp < cost → INSUFFICIENT_EXP', () => {
    const r = computeBreakthroughChance({
      realmStage: 9,
      expCurrent: 1_000n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('INSUFFICIENT_EXP');
    expect(r.finalChance).toBe(0);
    expect(r.rawChance).toBe(0);
  });

  it('realmStage=9 + exp === cost (edge) → OK (>= boundary)', () => {
    const r = computeBreakthroughChance({
      realmStage: 9,
      expCurrent: 23_613n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('OK');
    expect(r.finalChance).toBeGreaterThan(0);
  });

  it('realmStage=10 (out-of-range) → vẫn OK theo `>= 9` gate (flexible)', () => {
    const r = computeBreakthroughChance({
      realmStage: 10,
      expCurrent: 100_000n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('OK');
  });

  it('realmStage NaN/non-integer (defensive) → NOT_AT_PEAK', () => {
    const r = computeBreakthroughChance({
      realmStage: Number.NaN,
      expCurrent: 100_000n,
      expCost: 23_613n,
    });
    expect(r.reason).toBe('NOT_AT_PEAK');
  });
});

describe('computeBreakthroughChance — base chance (no bonus)', () => {
  it('peak + đủ exp + không có root/method/item → finalChance === BASE', () => {
    const r = computeBreakthroughChance(PEAK);
    expect(r.reason).toBe('OK');
    expect(r.baseChance).toBe(BREAKTHROUGH_CHANCE_BASE);
    expect(r.rootPurityBonus).toBe(0);
    expect(r.methodAffinityBonus).toBe(0);
    expect(r.itemBonus).toBe(0);
    expect(r.rawChance).toBe(BREAKTHROUGH_CHANCE_BASE);
    expect(r.finalChance).toBe(BREAKTHROUGH_CHANCE_BASE);
  });
});

describe('computeBreakthroughChance — root purity bonus (monotonic)', () => {
  it('rootPurity=0 → bonus=0', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: 0 });
    expect(r.rootPurityBonus).toBe(0);
  });

  it('rootPurity=0.5 → bonus = 0.5 * MAX', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: 0.5 });
    expect(r.rootPurityBonus).toBeCloseTo(0.5 * BREAKTHROUGH_ROOT_PURITY_BONUS_MAX, 10);
  });

  it('rootPurity=1.0 → bonus === MAX', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: 1.0 });
    expect(r.rootPurityBonus).toBe(BREAKTHROUGH_ROOT_PURITY_BONUS_MAX);
  });

  it('rootPurity > 1 (defensive clamp) → bonus === MAX', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: 5 });
    expect(r.rootPurityBonus).toBe(BREAKTHROUGH_ROOT_PURITY_BONUS_MAX);
  });

  it('rootPurity < 0 (defensive clamp) → bonus === 0', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: -0.5 });
    expect(r.rootPurityBonus).toBe(0);
  });

  it('rootPurity NaN (defensive) → bonus === 0', () => {
    const r = computeBreakthroughChance({ ...PEAK, rootPurity: Number.NaN });
    expect(r.rootPurityBonus).toBe(0);
  });

  it('monotonic: purity 0 < 0.3 < 0.7 < 1.0 → bonus tăng đều', () => {
    const a = computeBreakthroughChance({ ...PEAK, rootPurity: 0 });
    const b = computeBreakthroughChance({ ...PEAK, rootPurity: 0.3 });
    const c = computeBreakthroughChance({ ...PEAK, rootPurity: 0.7 });
    const d = computeBreakthroughChance({ ...PEAK, rootPurity: 1.0 });
    expect(a.rootPurityBonus).toBeLessThan(b.rootPurityBonus);
    expect(b.rootPurityBonus).toBeLessThan(c.rootPurityBonus);
    expect(c.rootPurityBonus).toBeLessThan(d.rootPurityBonus);
  });
});

describe('computeBreakthroughChance — method element affinity', () => {
  it('method.element === root.primary → full bonus', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
    });
    expect(r.methodAffinityBonus).toBe(BREAKTHROUGH_METHOD_AFFINITY_BONUS);
  });

  it('method.element ∈ root.secondary → half bonus', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
      rootSecondaryElements: ['moc', 'thuy'],
      methodElement: 'thuy',
    });
    expect(r.methodAffinityBonus).toBe(BREAKTHROUGH_METHOD_AFFINITY_BONUS / 2);
  });

  it('method.element không match primary/secondary → 0 bonus', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
      rootSecondaryElements: ['moc'],
      methodElement: 'hoa',
    });
    expect(r.methodAffinityBonus).toBe(0);
  });

  it('methodElement undefined → 0 bonus (no method equipped)', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
    });
    expect(r.methodAffinityBonus).toBe(0);
  });

  it('rootPrimaryElement undefined + methodElement set → 0 bonus (no root)', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      methodElement: 'kim',
    });
    expect(r.methodAffinityBonus).toBe(0);
  });

  it('primary takes precedence over secondary nếu trùng', () => {
    // Edge: methodElement match cả primary lẫn secondary (không hợp lệ
    // theo design nhưng test defensive — primary thắng).
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
      rootSecondaryElements: ['kim'],
      methodElement: 'kim',
    });
    expect(r.methodAffinityBonus).toBe(BREAKTHROUGH_METHOD_AFFINITY_BONUS);
  });
});

describe('computeBreakthroughChance — item bonus (clamp [0, MAX])', () => {
  it('itemBonus=0 → 0', () => {
    const r = computeBreakthroughChance({ ...PEAK, itemBonus: 0 });
    expect(r.itemBonus).toBe(0);
  });

  it('itemBonus trong cap (e.g. 0.05) → preserved', () => {
    const r = computeBreakthroughChance({ ...PEAK, itemBonus: 0.05 });
    expect(r.itemBonus).toBe(0.05);
  });

  it('itemBonus === MAX → preserved', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      itemBonus: BREAKTHROUGH_ITEM_BONUS_MAX,
    });
    expect(r.itemBonus).toBe(BREAKTHROUGH_ITEM_BONUS_MAX);
  });

  it('itemBonus > MAX → clamp xuống MAX', () => {
    const r = computeBreakthroughChance({ ...PEAK, itemBonus: 0.5 });
    expect(r.itemBonus).toBe(BREAKTHROUGH_ITEM_BONUS_MAX);
  });

  it('itemBonus < 0 (defensive) → clamp 0', () => {
    const r = computeBreakthroughChance({ ...PEAK, itemBonus: -0.1 });
    expect(r.itemBonus).toBe(0);
  });

  it('itemBonus NaN/Infinity (defensive) → 0 (treat invalid as 0, không escalate cap)', () => {
    const r1 = computeBreakthroughChance({ ...PEAK, itemBonus: Number.NaN });
    const r2 = computeBreakthroughChance({ ...PEAK, itemBonus: Number.POSITIVE_INFINITY });
    expect(r1.itemBonus).toBe(0);
    expect(r2.itemBonus).toBe(0);
  });
});

describe('computeBreakthroughChance — final clamp [MIN, MAX]', () => {
  it('all max bonus stack → finalChance clamp tới MAX (không 100%)', () => {
    // base 0.7 + root 0.15 + method 0.05 + item 0.10 = 1.0 → clamp 0.99.
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPurity: 1.0,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
      itemBonus: BREAKTHROUGH_ITEM_BONUS_MAX,
    });
    expect(r.rawChance).toBeCloseTo(
      BREAKTHROUGH_CHANCE_BASE +
        BREAKTHROUGH_ROOT_PURITY_BONUS_MAX +
        BREAKTHROUGH_METHOD_AFFINITY_BONUS +
        BREAKTHROUGH_ITEM_BONUS_MAX,
      10,
    );
    expect(r.finalChance).toBe(BREAKTHROUGH_CHANCE_MAX);
  });

  it('rawChance 1.5 (giả định out-of-spec base) clamp xuống MAX', () => {
    // Có thể xảy ra nếu future dial drift. Defensive — final luôn ≤ MAX.
    // Test này không thể tạo được với current dials, nhưng kiểm tra envelope.
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPurity: 1.0,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
      itemBonus: BREAKTHROUGH_ITEM_BONUS_MAX,
    });
    expect(r.finalChance).toBeLessThanOrEqual(BREAKTHROUGH_CHANCE_MAX);
  });

  it('finalChance luôn ≥ MIN khi reason=OK (không drop dưới floor)', () => {
    // Hiện base=0.7 > MIN=0.3 nên không chạm floor — test envelope guard.
    const r = computeBreakthroughChance(PEAK);
    expect(r.finalChance).toBeGreaterThanOrEqual(BREAKTHROUGH_CHANCE_MIN);
  });

  it('finalChance đúng khi raw nằm giữa MIN-MAX (no clamp triggered)', () => {
    // base 0.7 + 0.05 (method primary) = 0.75 ∈ (MIN, MAX).
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
    });
    expect(r.rawChance).toBeCloseTo(0.75, 10);
    expect(r.finalChance).toBeCloseTo(0.75, 10);
  });
});

describe('computeBreakthroughChance — composability + audit invariant', () => {
  it('rawChance === sum của 4 layer (audit transparency)', () => {
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPurity: 0.4,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
      itemBonus: 0.07,
    });
    expect(r.rawChance).toBeCloseTo(
      r.baseChance + r.rootPurityBonus + r.methodAffinityBonus + r.itemBonus,
      10,
    );
  });

  it('Gate (NOT_AT_PEAK) → mọi layer = 0 (no leak)', () => {
    const r = computeBreakthroughChance({
      realmStage: 1,
      expCurrent: 100n,
      expCost: 50n,
      rootPurity: 1.0,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
      itemBonus: BREAKTHROUGH_ITEM_BONUS_MAX,
    });
    expect(r.baseChance).toBe(0);
    expect(r.rootPurityBonus).toBe(0);
    expect(r.methodAffinityBonus).toBe(0);
    expect(r.itemBonus).toBe(0);
    expect(r.rawChance).toBe(0);
    expect(r.finalChance).toBe(0);
  });

  it('OK với 2 layer (root + method) cộng dồn đúng', () => {
    // base 0.7 + root 0.5*0.15 + method primary 0.05 = 0.825.
    const r = computeBreakthroughChance({
      ...PEAK,
      rootPurity: 0.5,
      rootPrimaryElement: 'hoa',
      methodElement: 'hoa',
    });
    expect(r.rawChance).toBeCloseTo(
      BREAKTHROUGH_CHANCE_BASE + 0.5 * BREAKTHROUGH_ROOT_PURITY_BONUS_MAX + BREAKTHROUGH_METHOD_AFFINITY_BONUS,
      10,
    );
    expect(r.finalChance).toBeCloseTo(r.rawChance, 10);
  });
});

// ===========================================================================
// evaluateBreakthroughOutcome — Phase 11 nâng cao §5 PR2 prep
// ===========================================================================

const NOW = new Date('2026-05-05T12:00:00Z');

function okBreakdown(finalChance: number): BreakthroughChanceBreakdown {
  return {
    reason: 'OK',
    baseChance: BREAKTHROUGH_CHANCE_BASE,
    rootPurityBonus: 0,
    methodAffinityBonus: 0,
    itemBonus: 0,
    rawChance: finalChance,
    finalChance,
  };
}

function gateBreakdown(
  reason: 'NOT_AT_PEAK' | 'INSUFFICIENT_EXP',
): BreakthroughChanceBreakdown {
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

describe('evaluateBreakthroughOutcome — gate fail (NOT_AT_PEAK / INSUFFICIENT_EXP)', () => {
  it('breakdown.reason=NOT_AT_PEAK → success=false, debuff=false', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: gateBreakdown('NOT_AT_PEAK'),
      rngRoll: 0,
      now: NOW,
    });
    expect(r.success).toBe(false);
    expect(r.debuffApplied).toBe(false);
    expect(r.debuffKey).toBeNull();
    expect(r.debuffDurationSec).toBe(0);
    expect(r.debuffExpiresAt).toBeNull();
  });

  it('breakdown.reason=INSUFFICIENT_EXP → success=false, debuff=false', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: gateBreakdown('INSUFFICIENT_EXP'),
      rngRoll: 0.999,
      now: NOW,
    });
    expect(r.success).toBe(false);
    expect(r.debuffApplied).toBe(false);
    expect(r.debuffKey).toBeNull();
  });
});

describe('evaluateBreakthroughOutcome — success path (rngRoll < finalChance)', () => {
  it('rngRoll=0 + chance=0.7 → success', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(0.7),
      rngRoll: 0,
      now: NOW,
    });
    expect(r.success).toBe(true);
    expect(r.debuffApplied).toBe(false);
    expect(r.debuffKey).toBeNull();
    expect(r.debuffExpiresAt).toBeNull();
  });

  it('rngRoll=0.69 + chance=0.7 → success (just under threshold)', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(0.7),
      rngRoll: 0.69,
      now: NOW,
    });
    expect(r.success).toBe(true);
  });

  it('rngRoll=0 + chance=BREAKTHROUGH_CHANCE_MAX (~0.99) → success', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(BREAKTHROUGH_CHANCE_MAX),
      rngRoll: 0,
      now: NOW,
    });
    expect(r.success).toBe(true);
  });
});

describe('evaluateBreakthroughOutcome — fail path (rngRoll >= finalChance) → tam_ma_light', () => {
  it('rngRoll=0.7 + chance=0.7 → fail (rngRoll == chance, NOT strict <)', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(0.7),
      rngRoll: 0.7,
      now: NOW,
    });
    expect(r.success).toBe(false);
    expect(r.debuffApplied).toBe(true);
    expect(r.debuffKey).toBe('tam_ma_light');
  });

  it('rngRoll=0.99 + chance=0.7 → fail + debuff applied', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(0.7),
      rngRoll: 0.99,
      now: NOW,
    });
    expect(r.success).toBe(false);
    expect(r.debuffApplied).toBe(true);
    expect(r.debuffKey).toBe('tam_ma_light');
    expect(r.debuffDurationSec).toBe(BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC);
    expect(r.debuffExpiresAt).not.toBeNull();
  });

  it('debuffExpiresAt === now + BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC × 1000ms', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(0.7),
      rngRoll: 0.99,
      now: NOW,
    });
    expect(r.debuffExpiresAt?.getTime()).toBe(
      NOW.getTime() + BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC * 1000,
    );
  });

  it('rngRoll=0.99 + chance=BREAKTHROUGH_CHANCE_MIN (~0.3) → fail', () => {
    const r = evaluateBreakthroughOutcome({
      breakdown: okBreakdown(BREAKTHROUGH_CHANCE_MIN),
      rngRoll: 0.99,
      now: NOW,
    });
    expect(r.success).toBe(false);
    expect(r.debuffApplied).toBe(true);
  });
});

describe('evaluateBreakthroughOutcome — defensive (rngRoll out-of-range)', () => {
  it('throw nếu rngRoll < 0', () => {
    expect(() =>
      evaluateBreakthroughOutcome({
        breakdown: okBreakdown(0.7),
        rngRoll: -0.001,
        now: NOW,
      }),
    ).toThrow();
  });

  it('throw nếu rngRoll === 1 (exclusive upper)', () => {
    expect(() =>
      evaluateBreakthroughOutcome({
        breakdown: okBreakdown(0.7),
        rngRoll: 1,
        now: NOW,
      }),
    ).toThrow();
  });

  it('throw nếu rngRoll = NaN', () => {
    expect(() =>
      evaluateBreakthroughOutcome({
        breakdown: okBreakdown(0.7),
        rngRoll: NaN,
        now: NOW,
      }),
    ).toThrow();
  });

  it('throw nếu rngRoll = Infinity', () => {
    expect(() =>
      evaluateBreakthroughOutcome({
        breakdown: okBreakdown(0.7),
        rngRoll: Infinity,
        now: NOW,
      }),
    ).toThrow();
  });
});

describe('evaluateBreakthroughOutcome — determinism (same input → same output)', () => {
  it('cùng rngRoll + cùng breakdown → cùng result', () => {
    const breakdown = okBreakdown(0.85);
    const r1 = evaluateBreakthroughOutcome({
      breakdown,
      rngRoll: 0.5,
      now: NOW,
    });
    const r2 = evaluateBreakthroughOutcome({
      breakdown,
      rngRoll: 0.5,
      now: NOW,
    });
    expect(r1).toEqual(r2);
  });

  it('integration với computeBreakthroughChance — peak + đủ exp + rngRoll < finalChance → success', () => {
    const breakdown = computeBreakthroughChance({
      realmStage: 9,
      expCurrent: 100_000n,
      expCost: 23_613n,
      rootPurity: 0.6,
      rootPrimaryElement: 'kim',
      methodElement: 'kim',
      itemBonus: 0.05,
    });
    expect(breakdown.reason).toBe('OK');
    // finalChance ~= 0.7 + 0.6*0.15 + 0.05 + 0.05 = 0.89
    const success = evaluateBreakthroughOutcome({
      breakdown,
      rngRoll: 0.5,
      now: NOW,
    });
    expect(success.success).toBe(true);
    const fail = evaluateBreakthroughOutcome({
      breakdown,
      rngRoll: 0.95,
      now: NOW,
    });
    expect(fail.success).toBe(false);
    expect(fail.debuffKey).toBe('tam_ma_light');
  });
});
