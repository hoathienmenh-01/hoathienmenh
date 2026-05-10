/**
 * Phase 14.1.A — Combat determinism integration tests.
 *
 * Verify rằng các helper combat critical path (`rollDamage`,
 * `rollDungeonLoot`, `rollMonsterLoot`) sau khi accept optional `rng`
 * → deterministic khi inject seeded RNG. Đồng thời verify backward
 * compat: gọi không pass `rng` vẫn dùng `Math.random` (no behavior
 * change cho legacy runtime).
 */

import { describe, expect, it } from 'vitest';
import { rollDamage } from './combat';
import { createSeededRng } from './combat-rng';
import { rollDungeonLoot, rollMonsterLoot } from './items';
import { elementMultiplier } from './spiritual-root';

describe('rollDamage — seeded RNG injection (Phase 14.1.A)', () => {
  it('cùng atk/def/scale + cùng seed → cùng damage', () => {
    const rngA = createSeededRng(2024).next;
    const rngB = createSeededRng(2024).next;
    for (let i = 0; i < 50; i += 1) {
      expect(rollDamage(30, 5, 1, rngA)).toBe(rollDamage(30, 5, 1, rngB));
    }
  });

  it('cùng atk/def/scale + seed khác → damage có thể khác (variance)', () => {
    const rng1 = createSeededRng(1).next;
    const rng2 = createSeededRng(2).next;
    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      seq1.push(rollDamage(30, 5, 1, rng1));
      seq2.push(rollDamage(30, 5, 1, rng2));
    }
    expect(seq1.join(',')).not.toBe(seq2.join(','));
  });

  it('damage luôn ≥ 1 (variance floor)', () => {
    const rng = createSeededRng(7).next;
    for (let i = 0; i < 100; i += 1) {
      const d = rollDamage(10, 0, 1, rng);
      expect(d).toBeGreaterThanOrEqual(1);
    }
  });

  it('không pass rng → fallback Math.random (backward compat)', () => {
    // Smoke test — chỉ verify không throw + output là number ≥ 1.
    const d = rollDamage(30, 5, 1);
    expect(typeof d).toBe('number');
    expect(d).toBeGreaterThanOrEqual(1);
  });

  it('atk/def vs scale — variance ∈ [0.85, 1.15] qua mulberry32', () => {
    const rng = createSeededRng(11).next;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 1000; i += 1) {
      const d = rollDamage(1000, 0, 1, rng);
      if (d < min) min = d;
      if (d > max) max = d;
    }
    // Math: base = 1000, variance ∈ [0.85, 1.15] → damage ∈ [850, 1150]
    expect(min).toBeGreaterThanOrEqual(850);
    expect(max).toBeLessThanOrEqual(1150);
  });
});

describe('rollDungeonLoot — seeded RNG injection (Phase 14.1.A)', () => {
  it('cùng dungeonKey + count + seed → cùng loot rolled', () => {
    const rngA = createSeededRng(42).next;
    const rngB = createSeededRng(42).next;
    const a = rollDungeonLoot('son_coc', 3, rngA);
    const b = rollDungeonLoot('son_coc', 3, rngB);
    expect(a).toEqual(b);
  });

  it('cùng dungeonKey + count + seed khác → loot có thể khác', () => {
    const a = rollDungeonLoot('son_coc', 5, createSeededRng(1).next);
    const b = rollDungeonLoot('son_coc', 5, createSeededRng(2).next);
    // Có thể giống cho seed nào đó nếu may, nhưng 2 sequence khác — verify
    // qua key sequence string (rare collision OK).
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('dungeonKey không tồn tại → empty array', () => {
    expect(rollDungeonLoot('not_exist', 3, createSeededRng(1).next)).toEqual([]);
  });

  it('không pass rng → fallback Math.random (backward compat)', () => {
    const out = rollDungeonLoot('son_coc', 1);
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('rollMonsterLoot — seeded RNG injection (Phase 14.1.A)', () => {
  it('cùng monsterKey + seed → cùng loot rolled (nếu monster có lootTable)', () => {
    // Monster với lootTable — pick từ shared catalog. Nếu monsterKey không
    // tồn tại, helper trả [] — test vẫn deterministic.
    const rngA = createSeededRng(7).next;
    const rngB = createSeededRng(7).next;
    const a = rollMonsterLoot('son_thu_lon', 3, rngA);
    const b = rollMonsterLoot('son_thu_lon', 3, rngB);
    expect(a).toEqual(b);
  });

  it('không pass rng → fallback Math.random (backward compat)', () => {
    const out = rollMonsterLoot('son_thu_lon', 1);
    expect(Array.isArray(out)).toBe(true);
  });
});

describe('elementMultiplier — pure deterministic (no RNG)', () => {
  it('cùng (attacker, defender) → cùng multiplier (idempotent)', () => {
    expect(elementMultiplier('kim', 'moc')).toBe(elementMultiplier('kim', 'moc'));
    expect(elementMultiplier('hoa', 'kim')).toBe(elementMultiplier('hoa', 'kim'));
  });

  it('vô hệ vs vô hệ → 1 (neutral)', () => {
    expect(elementMultiplier(null, null)).toBe(1);
    expect(elementMultiplier(null, 'kim')).toBe(1);
    expect(elementMultiplier('kim', null)).toBe(1);
  });

  it('relation tương khắc → multiplier > 1', () => {
    expect(elementMultiplier('kim', 'moc')).toBeGreaterThan(1);
    expect(elementMultiplier('hoa', 'kim')).toBeGreaterThan(1);
    expect(elementMultiplier('thuy', 'hoa')).toBeGreaterThan(1);
  });

  it('relation bị khắc → multiplier < 1', () => {
    expect(elementMultiplier('moc', 'kim')).toBeLessThan(1);
    expect(elementMultiplier('kim', 'hoa')).toBeLessThan(1);
    expect(elementMultiplier('hoa', 'thuy')).toBeLessThan(1);
  });
});
