/**
 * Phase 14.1.A — Combat determinism integration tests (API-level).
 *
 * Smoke test: verify rằng các shared helper combat critical path đã
 * accept seeded RNG injection vẫn produce deterministic output khi
 * import từ API runtime context.
 *
 * KHÔNG bootstrap NestJS module — pure unit test (giống pattern
 * `combat.service.element-identity.test.ts` partial setup). Mục đích:
 *
 *   - Verify import path `@xuantoi/shared` resolve `rollDamage`,
 *     `rollDungeonLoot`, `rollMonsterLoot`, `createSeededRng` đúng.
 *   - Verify cùng seed → cùng combat critical RNG output ở API context.
 *   - Verify `resolveCombatWithSnapshot` reproducible từ API context.
 *
 * Tests này được include trong `pnpm --filter @xuantoi/api test --
 * --run combat` filter.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCombatActorSnapshot,
  composeSeed,
  createSeededRng,
  hashSeed,
  resolveCombatWithSnapshot,
  rollDamage,
  rollDungeonLoot,
  rollMonsterLoot,
} from '@xuantoi/shared';

describe('Phase 14.1.A — Combat determinism (API runtime context)', () => {
  it('rollDamage cùng seed → cùng damage', () => {
    const rng1 = createSeededRng(2024).next;
    const rng2 = createSeededRng(2024).next;
    for (let i = 0; i < 20; i += 1) {
      expect(rollDamage(50, 10, 1.2, rng1)).toBe(rollDamage(50, 10, 1.2, rng2));
    }
  });

  it('rollDungeonLoot cùng seed → cùng loot ở API runtime', () => {
    const rng1 = createSeededRng(7).next;
    const rng2 = createSeededRng(7).next;
    expect(rollDungeonLoot('son_coc', 5, rng1)).toEqual(
      rollDungeonLoot('son_coc', 5, rng2),
    );
  });

  it('rollMonsterLoot cùng seed → cùng loot ở API runtime', () => {
    const rng1 = createSeededRng(11).next;
    const rng2 = createSeededRng(11).next;
    expect(rollMonsterLoot('son_thu_lon', 3, rng1)).toEqual(
      rollMonsterLoot('son_thu_lon', 3, rng2),
    );
  });

  it('hashSeed string → numeric seed stable', () => {
    expect(hashSeed('arena-match-uuid-1')).toBe(hashSeed('arena-match-uuid-1'));
    expect(hashSeed('arena-match-uuid-1')).not.toBe(
      hashSeed('arena-match-uuid-2'),
    );
  });

  it('composeSeed cho sub-seed deterministic theo salt', () => {
    const base = hashSeed('match-1');
    const attackerSeed = composeSeed(base, 'attacker');
    const defenderSeed = composeSeed(base, 'defender');
    expect(attackerSeed).not.toBe(defenderSeed);
    // Re-derive: cùng input → cùng output
    expect(composeSeed(base, 'attacker')).toBe(attackerSeed);
  });

  it('resolveCombatWithSnapshot cùng seed → cùng result', () => {
    const attacker = buildCombatActorSnapshot({
      name: 'A',
      realmKey: 'truc_co',
      stage: 5,
      derivedStats: { atk: 30, def: 5, hpMax: 100, spirit: 10, speed: 8 },
      skillKeys: ['atk_thuong'],
      elementalAffinity: 'kim',
    });
    const defender = buildCombatActorSnapshot({
      name: 'B',
      realmKey: 'truc_co',
      stage: 5,
      derivedStats: { atk: 25, def: 5, hpMax: 100, spirit: 10, speed: 7 },
      skillKeys: ['atk_thuong'],
      elementalAffinity: 'moc',
    });
    const a = resolveCombatWithSnapshot({
      attacker,
      defender,
      seed: 42,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    const b = resolveCombatWithSnapshot({
      attacker,
      defender,
      seed: 42,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    expect(a.winner).toBe(b.winner);
    expect(a.damageSummary).toEqual(b.damageSummary);
    expect(a.rounds).toEqual(b.rounds);
  });

  it('different seed → result có thể khác (non-trivial variance)', () => {
    const attacker = buildCombatActorSnapshot({
      name: 'A',
      derivedStats: { atk: 30, def: 5, hpMax: 100, spirit: 10, speed: 5 },
      elementalAffinity: 'kim',
    });
    const defender = buildCombatActorSnapshot({
      name: 'B',
      derivedStats: { atk: 25, def: 5, hpMax: 100, spirit: 10, speed: 5 },
      elementalAffinity: 'kim',
    });
    const r1 = resolveCombatWithSnapshot({
      attacker,
      defender,
      seed: 1,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    const r2 = resolveCombatWithSnapshot({
      attacker,
      defender,
      seed: 2,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    const seq1 = r1.rounds.map((r) => r.finalDamage).join(',');
    const seq2 = r2.rounds.map((r) => r.finalDamage).join(',');
    expect(seq1).not.toBe(seq2);
  });
});
