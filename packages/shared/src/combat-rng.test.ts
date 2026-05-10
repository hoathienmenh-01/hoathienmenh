/**
 * Phase 14.1.A — Combat Determinism RNG helper tests.
 *
 * Verify:
 *   - same seed → same sequence (stable cross-run).
 *   - different seed → different first value.
 *   - nextInt range invariants.
 *   - chance bias bounds.
 *   - pick from empty / non-empty array deterministic.
 *   - hashSeed stable cho fixed string.
 *   - composeSeed produce sub-seed khác nhau cho salt khác nhau.
 *   - cross-module agreement với mulberry32 ở tribulation-mini-battle (cùng
 *     algorithm → cùng output cho cùng seed).
 */

import { describe, expect, it } from 'vitest';
import {
  composeSeed,
  createSeededRng,
  hashSeed,
} from './combat-rng';
import { mulberry32 } from './tribulation-mini-battle';

describe('createSeededRng — deterministic mulberry32', () => {
  it('same numeric seed → same sequence (stable cross-run)', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    for (let i = 0; i < 16; i += 1) {
      expect(a.next()).toBeCloseTo(b.next(), 12);
    }
  });

  it('same string seed → same sequence', () => {
    const a = createSeededRng('arena_match_42');
    const b = createSeededRng('arena_match_42');
    for (let i = 0; i < 8; i += 1) {
      expect(a.next()).toBeCloseTo(b.next(), 12);
    }
  });

  it('different seeds → different first value', () => {
    expect(createSeededRng(1).next()).not.toBe(createSeededRng(2).next());
    expect(createSeededRng('a').next()).not.toBe(createSeededRng('b').next());
  });

  it('all values ∈ [0, 1)', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 200; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('non-finite numeric seed → fallback seed 0 (still deterministic)', () => {
    const a = createSeededRng(Number.NaN);
    const b = createSeededRng(0);
    expect(a.next()).toBeCloseTo(b.next(), 12);
  });

  it('nextFloat() = next() (alias)', () => {
    const a = createSeededRng(99);
    const b = createSeededRng(99);
    expect(a.nextFloat()).toBeCloseTo(b.next(), 12);
  });
});

describe('createSeededRng.nextInt', () => {
  it('values trong [min, max] inclusive', () => {
    const rng = createSeededRng(11);
    for (let i = 0; i < 200; i += 1) {
      const v = rng.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('min > max được swap (vẫn trả integer trong [min, max])', () => {
    const rng = createSeededRng(11);
    const v = rng.nextInt(10, 5);
    expect(v).toBeGreaterThanOrEqual(5);
    expect(v).toBeLessThanOrEqual(10);
  });

  it('non-finite min/max → throw', () => {
    const rng = createSeededRng(1);
    expect(() => rng.nextInt(Number.NaN, 5)).toThrow();
    expect(() => rng.nextInt(0, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('cùng seed → cùng dãy nextInt', () => {
    const a = createSeededRng(2024);
    const b = createSeededRng(2024);
    for (let i = 0; i < 32; i += 1) {
      expect(a.nextInt(1, 100)).toBe(b.nextInt(1, 100));
    }
  });
});

describe('createSeededRng.chance', () => {
  it('probability ≤ 0 → false (no roll, no state advance)', () => {
    const rng = createSeededRng(1);
    const before = rng.next();
    const reset = createSeededRng(1);
    reset.next(); // align after `before`
    expect(reset.chance(0)).toBe(false);
    expect(reset.chance(-1)).toBe(false);
    // Sau 0 roll, next() vẫn produce giá trị thứ 2 — verify state unchanged.
    const seq = createSeededRng(1);
    seq.next();
    seq.chance(0);
    expect(seq.next()).toBeCloseTo(reset.next(), 12);
    expect(before).toBeGreaterThan(0); // sanity
  });

  it('probability ≥ 1 → true (no roll, no state advance)', () => {
    const rng = createSeededRng(1);
    rng.next();
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(2)).toBe(true);
    const reset = createSeededRng(1);
    reset.next();
    expect(rng.next()).toBeCloseTo(reset.next(), 12);
  });

  it('probability=0.5 → bias hợp lý qua 1000 sample', () => {
    const rng = createSeededRng(42);
    let trues = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (rng.chance(0.5)) trues += 1;
    }
    expect(trues).toBeGreaterThan(400);
    expect(trues).toBeLessThan(600);
  });

  it('cùng seed → cùng dãy chance', () => {
    const a = createSeededRng(2024);
    const b = createSeededRng(2024);
    for (let i = 0; i < 100; i += 1) {
      expect(a.chance(0.3)).toBe(b.chance(0.3));
    }
  });
});

describe('createSeededRng.pick', () => {
  it('empty array → null', () => {
    const rng = createSeededRng(1);
    expect(rng.pick([])).toBeNull();
  });

  it('cùng seed → cùng pick từ cùng array', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const a = createSeededRng(7);
    const b = createSeededRng(7);
    for (let i = 0; i < 20; i += 1) {
      expect(a.pick(arr)).toBe(b.pick(arr));
    }
  });

  it('pick value luôn nằm trong array', () => {
    const arr = [10, 20, 30];
    const rng = createSeededRng(11);
    for (let i = 0; i < 50; i += 1) {
      const v = rng.pick(arr);
      expect(arr.includes(v as number)).toBe(true);
    }
  });
});

describe('hashSeed', () => {
  it('cùng input → cùng output (stable)', () => {
    expect(hashSeed('hello')).toBe(hashSeed('hello'));
    expect(hashSeed('arena_match_42')).toBe(hashSeed('arena_match_42'));
  });

  it('input khác → output khác (collision rare)', () => {
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('arena_1')).not.toBe(hashSeed('arena_2'));
  });

  it('empty string → FNV-1a offset basis cast (constant deterministic)', () => {
    expect(hashSeed('')).toBe(hashSeed(''));
  });

  it('output là int32 (signed)', () => {
    const v = hashSeed('xuantoi');
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(v).toBeLessThan(2 ** 31);
  });
});

describe('composeSeed', () => {
  it('cùng base + salt → cùng output', () => {
    expect(composeSeed(123, 'attacker')).toBe(composeSeed(123, 'attacker'));
    expect(composeSeed(123, 7)).toBe(composeSeed(123, 7));
  });

  it('salt khác → output khác', () => {
    expect(composeSeed(123, 'attacker')).not.toBe(
      composeSeed(123, 'defender'),
    );
    expect(composeSeed(123, 1)).not.toBe(composeSeed(123, 2));
  });

  it('output stable as numeric seed cho createSeededRng', () => {
    const baseSeed = hashSeed('match-uuid');
    const subSeedA = composeSeed(baseSeed, 'attacker');
    const subSeedB = composeSeed(baseSeed, 'attacker');
    expect(createSeededRng(subSeedA).next()).toBeCloseTo(
      createSeededRng(subSeedB).next(),
      12,
    );
  });
});

describe('cross-module agreement với tribulation-mini-battle.mulberry32', () => {
  it('cùng numeric seed → cùng sequence (cùng algorithm)', () => {
    const a = createSeededRng(2024).next;
    const b = mulberry32(2024);
    for (let i = 0; i < 8; i += 1) {
      expect(a()).toBeCloseTo(b(), 12);
    }
  });
});
