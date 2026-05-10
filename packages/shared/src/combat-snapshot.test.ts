/**
 * Phase 14.1.A — Combat Simulation Snapshot tests.
 *
 * Verify deterministic contract:
 *   - same attacker + defender snapshot + seed → same result.
 *   - same snapshot + different seed → result có thể khác (variance kích
 *     hoạt qua mulberry32 RNG sequence khác).
 *   - elemental multiplier deterministic across runs (qua
 *     `elementMultiplier`).
 *   - equipment elemental atk bonus deterministic.
 *   - resist deterministic.
 *   - normalizeCombatSnapshot sort skill/buff keys → cùng input set bất
 *     kể thứ tự gốc → cùng normalized snapshot → cùng result.
 *   - draw khi maxRounds reached.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCombatActorSnapshot,
  COMBAT_SIMULATION_DEFAULT_MAX_ROUNDS,
  type CombatSimulationSnapshot,
  normalizeCombatSnapshot,
  resolveCombatWithSnapshot,
} from './combat-snapshot';
import { hashSeed } from './combat-rng';

function makeSnapshot(
  overrides: Partial<CombatSimulationSnapshot> = {},
): CombatSimulationSnapshot {
  const attacker = buildCombatActorSnapshot({
    name: 'A',
    realmKey: 'truc_co',
    stage: 5,
    baseStats: {
      hp: 100,
      hpMax: 100,
      mp: 30,
      mpMax: 30,
      power: 30,
      spirit: 10,
      speed: 8,
    },
    derivedStats: { atk: 30, def: 5, hpMax: 100, spirit: 10, speed: 8 },
    skillKeys: ['atk_thuong'],
    elementalAffinity: 'kim',
  });
  const defender = buildCombatActorSnapshot({
    name: 'B',
    realmKey: 'truc_co',
    stage: 5,
    baseStats: {
      hp: 100,
      hpMax: 100,
      mp: 30,
      mpMax: 30,
      power: 25,
      spirit: 10,
      speed: 7,
    },
    derivedStats: { atk: 25, def: 5, hpMax: 100, spirit: 10, speed: 7 },
    skillKeys: ['atk_thuong'],
    elementalAffinity: 'moc',
  });
  return {
    attacker,
    defender,
    seed: 42,
    context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    ...overrides,
  };
}

describe('resolveCombatWithSnapshot — same snapshot + same seed → same result', () => {
  it('rounds, winner, damage summary identical across runs', () => {
    const s = makeSnapshot();
    const a = resolveCombatWithSnapshot(s);
    const b = resolveCombatWithSnapshot(s);
    expect(a.winner).toBe(b.winner);
    expect(a.rounds.length).toBe(b.rounds.length);
    expect(a.damageSummary.totalAttackerDamage).toBe(
      b.damageSummary.totalAttackerDamage,
    );
    expect(a.damageSummary.totalDefenderDamage).toBe(
      b.damageSummary.totalDefenderDamage,
    );
    a.rounds.forEach((r, i) => {
      expect(r).toEqual(b.rounds[i]);
    });
  });

  it('cùng seed string-derived (qua hashSeed) → cùng result', () => {
    const seed = hashSeed('arena-uuid-v1');
    const s = makeSnapshot({ seed });
    const a = resolveCombatWithSnapshot(s);
    const b = resolveCombatWithSnapshot(s);
    expect(a).toEqual(b);
  });

  it('skip RNG state pollution — gọi 100 lần liên tiếp vẫn ổn định', () => {
    const s = makeSnapshot();
    const baseline = resolveCombatWithSnapshot(s);
    for (let i = 0; i < 100; i += 1) {
      const r = resolveCombatWithSnapshot(s);
      expect(r.winner).toBe(baseline.winner);
      expect(r.damageSummary.totalAttackerDamage).toBe(
        baseline.damageSummary.totalAttackerDamage,
      );
    }
  });
});

describe('resolveCombatWithSnapshot — same snapshot + different seed', () => {
  it('rounds đầu damage có thể khác nhau (variance mulberry32)', () => {
    const s1 = makeSnapshot({ seed: 1 });
    const s2 = makeSnapshot({ seed: 2 });
    const r1 = resolveCombatWithSnapshot(s1);
    const r2 = resolveCombatWithSnapshot(s2);
    // Round 1 damage không phải lúc nào cũng khác — nhưng full rounds
    // sequence sẽ có ít nhất 1 round khác (variance accumulate).
    const seq1 = r1.rounds.map((r) => r.finalDamage).join(',');
    const seq2 = r2.rounds.map((r) => r.finalDamage).join(',');
    expect(seq1).not.toBe(seq2);
  });

  it('echo seed về kết quả — phục vụ replay verify', () => {
    const r = resolveCombatWithSnapshot(makeSnapshot({ seed: 999 }));
    expect(r.seed).toBe(999);
  });
});

describe('resolveCombatWithSnapshot — elemental multiplier deterministic', () => {
  it('attacker kim vs defender moc → multiplier > 1 (kim khắc moc)', () => {
    const r = resolveCombatWithSnapshot(makeSnapshot());
    expect(r.elementMultiplierSummary.attackerVsDefender).toBeGreaterThan(1);
  });

  it('attacker moc vs defender kim → multiplier < 1 (moc bị khắc)', () => {
    const s = makeSnapshot();
    const flipped: CombatSimulationSnapshot = {
      ...s,
      attacker: { ...s.attacker, elementalAffinity: 'moc' },
      defender: { ...s.defender, elementalAffinity: 'kim' },
    };
    const r = resolveCombatWithSnapshot(flipped);
    expect(r.elementMultiplierSummary.attackerVsDefender).toBeLessThan(1);
  });

  it('vô hệ vs vô hệ → multiplier = 1.0 (neutral)', () => {
    const s = makeSnapshot();
    const neutral: CombatSimulationSnapshot = {
      ...s,
      attacker: { ...s.attacker, elementalAffinity: null },
      defender: { ...s.defender, elementalAffinity: null },
    };
    const r = resolveCombatWithSnapshot(neutral);
    expect(r.elementMultiplierSummary.attackerVsDefender).toBe(1);
    expect(r.elementMultiplierSummary.defenderVsAttacker).toBe(1);
  });

  it('multiplier consistent across runs (cùng element pair → cùng số)', () => {
    const s1 = makeSnapshot({ seed: 1 });
    const s2 = makeSnapshot({ seed: 99999 });
    const r1 = resolveCombatWithSnapshot(s1);
    const r2 = resolveCombatWithSnapshot(s2);
    // Element multiplier phụ thuộc vào element pair, KHÔNG phụ thuộc seed.
    expect(r1.elementMultiplierSummary.attackerVsDefender).toBe(
      r2.elementMultiplierSummary.attackerVsDefender,
    );
  });
});

describe('resolveCombatWithSnapshot — equipment elemental atk bonus deterministic', () => {
  it('attacker có elementalAtkBonus.kim=0.1 → equipBonusMultiplier=1.1', () => {
    const s = makeSnapshot();
    const boosted: CombatSimulationSnapshot = {
      ...s,
      attacker: {
        ...s.attacker,
        equipmentStats: {
          ...s.attacker.equipmentStats,
          elementalAtkBonus: { kim: 0.1 },
        },
      },
    };
    const r = resolveCombatWithSnapshot(boosted);
    const firstAttackerRound = r.rounds.find(
      (round) => round.attackerSide === 'attacker',
    );
    expect(firstAttackerRound?.equipBonusMultiplier).toBeCloseTo(1.1, 5);
  });

  it('attacker không có bonus → equipBonusMultiplier=1.0', () => {
    const r = resolveCombatWithSnapshot(makeSnapshot());
    const firstAttackerRound = r.rounds.find(
      (round) => round.attackerSide === 'attacker',
    );
    expect(firstAttackerRound?.equipBonusMultiplier).toBe(1);
  });
});

describe('resolveCombatWithSnapshot — resist deterministic', () => {
  it('defender resist.kim=0.7 → first attacker round damage thấp hơn', () => {
    const s = makeSnapshot({ seed: 12345 });
    const noResist = resolveCombatWithSnapshot(s, { maxRounds: 1 });
    const resisted: CombatSimulationSnapshot = {
      ...s,
      defender: {
        ...s.defender,
        equipmentStats: {
          ...s.defender.equipmentStats,
          elementalResist: { kim: 0.7 },
        },
      },
    };
    const withResist = resolveCombatWithSnapshot(resisted, { maxRounds: 1 });
    expect(withResist.rounds[0]?.finalDamage).toBeLessThan(
      noResist.rounds[0]?.finalDamage ?? 0,
    );
    expect(withResist.rounds[0]?.resistMultiplier).toBeCloseTo(0.7, 5);
  });

  it('resist consistent across runs — cùng resist + cùng seed → cùng damage', () => {
    const s = makeSnapshot({ seed: 1 });
    const resisted: CombatSimulationSnapshot = {
      ...s,
      defender: {
        ...s.defender,
        equipmentStats: {
          ...s.defender.equipmentStats,
          elementalResist: { kim: 0.5 },
        },
      },
    };
    const a = resolveCombatWithSnapshot(resisted);
    const b = resolveCombatWithSnapshot(resisted);
    expect(a).toEqual(b);
  });
});

describe('resolveCombatWithSnapshot — buff/skill key effect deterministic', () => {
  it('skillKeys sorted khi normalize → cùng skill effect bất kể thứ tự gốc', () => {
    const s = makeSnapshot();
    const a: CombatSimulationSnapshot = {
      ...s,
      attacker: {
        ...s.attacker,
        skillKeys: ['skill_b', 'skill_a', 'skill_c'],
      },
    };
    const b: CombatSimulationSnapshot = {
      ...s,
      attacker: {
        ...s.attacker,
        skillKeys: ['skill_c', 'skill_a', 'skill_b'],
      },
    };
    const ra = resolveCombatWithSnapshot(a);
    const rb = resolveCombatWithSnapshot(b);
    expect(ra.appliedSkillSummary.attackerSkillKey).toBe('skill_a');
    expect(rb.appliedSkillSummary.attackerSkillKey).toBe('skill_a');
    expect(ra.damageSummary.totalAttackerDamage).toBe(
      rb.damageSummary.totalAttackerDamage,
    );
  });

  it('buffKeys khác nhau (sorted) → snapshot khác bằng .toEqual nếu set khác', () => {
    const s = makeSnapshot();
    const norm1 = normalizeCombatSnapshot({
      ...s,
      attacker: {
        ...s.attacker,
        buffKeys: ['buff_atk', 'buff_def'],
      },
    });
    const norm2 = normalizeCombatSnapshot({
      ...s,
      attacker: {
        ...s.attacker,
        buffKeys: ['buff_def', 'buff_atk'],
      },
    });
    // Cùng set, khác thứ tự → normalized identical.
    expect(norm1).toEqual(norm2);
  });
});

describe('resolveCombatWithSnapshot — chance / crit / dodge deterministic via RNG', () => {
  it('cùng seed → tie-break speed (speed equal) → cùng turn order', () => {
    const s = makeSnapshot({ seed: 7 });
    const equalSpeed: CombatSimulationSnapshot = {
      ...s,
      attacker: {
        ...s.attacker,
        derivedStats: { ...s.attacker.derivedStats, speed: 5 },
      },
      defender: {
        ...s.defender,
        derivedStats: { ...s.defender.derivedStats, speed: 5 },
      },
    };
    const a = resolveCombatWithSnapshot(equalSpeed);
    const b = resolveCombatWithSnapshot(equalSpeed);
    expect(a.rounds[0]?.attackerSide).toBe(b.rounds[0]?.attackerSide);
  });

  it('attacker speed cao hơn → luôn đi trước (KHÔNG dùng RNG tie-break)', () => {
    const s = makeSnapshot();
    const r = resolveCombatWithSnapshot(s);
    expect(r.rounds[0]?.attackerSide).toBe('attacker');
  });
});

describe('resolveCombatWithSnapshot — draw khi maxRounds reached', () => {
  it('cả 2 side hp cao + damage thấp → draw', () => {
    const s = makeSnapshot({
      attacker: {
        ...buildCombatActorSnapshot({
          name: 'A',
          baseStats: {
            hp: 10000,
            hpMax: 10000,
            mp: 0,
            mpMax: 0,
            power: 1,
            spirit: 1,
            speed: 1,
          },
          derivedStats: {
            atk: 1,
            def: 1,
            hpMax: 10000,
            spirit: 1,
            speed: 1,
          },
        }),
      },
      defender: {
        ...buildCombatActorSnapshot({
          name: 'B',
          baseStats: {
            hp: 10000,
            hpMax: 10000,
            mp: 0,
            mpMax: 0,
            power: 1,
            spirit: 1,
            speed: 1,
          },
          derivedStats: {
            atk: 1,
            def: 1,
            hpMax: 10000,
            spirit: 1,
            speed: 1,
          },
        }),
      },
    });
    const r = resolveCombatWithSnapshot(s, { maxRounds: 4 });
    expect(r.winner).toBe('draw');
    expect(r.rounds.length).toBeLessThanOrEqual(4);
  });

  it('default maxRounds = 30', () => {
    expect(COMBAT_SIMULATION_DEFAULT_MAX_ROUNDS).toBe(30);
  });
});

describe('buildCombatActorSnapshot — fill default', () => {
  it('không cung cấp gì → zero stats + null character', () => {
    const a = buildCombatActorSnapshot();
    expect(a.characterId).toBeNull();
    expect(a.skillKeys).toEqual([]);
    expect(a.buffKeys).toEqual([]);
    expect(a.elementalAffinity).toBeNull();
    expect(a.derivedStats.atk).toBe(0);
  });

  it('không cung cấp derivedStats → auto-compose từ base + equipment', () => {
    const a = buildCombatActorSnapshot({
      baseStats: { power: 20 } as Partial<typeof a.baseStats>,
      equipmentStats: {
        atkBonus: 5,
        defBonus: 3,
      },
    });
    expect(a.derivedStats.atk).toBe(25);
    expect(a.derivedStats.def).toBe(3);
  });
});

describe('normalizeCombatSnapshot — deterministic iteration', () => {
  it('skillKeys / buffKeys sorted', () => {
    const s = makeSnapshot();
    const n = normalizeCombatSnapshot({
      ...s,
      attacker: {
        ...s.attacker,
        skillKeys: ['z', 'a', 'm'],
        buffKeys: ['z_buff', 'a_buff'],
      },
    });
    expect(n.attacker.skillKeys).toEqual(['a', 'm', 'z']);
    expect(n.attacker.buffKeys).toEqual(['a_buff', 'z_buff']);
  });

  it('seed cast | 0 (32-bit signed)', () => {
    const s = makeSnapshot({ seed: 0xffffffff }); // = -1 sau | 0
    const n = normalizeCombatSnapshot(s);
    expect(n.seed).toBe(-1);
  });

  it('clone equipment objects (immutability guard)', () => {
    const s = makeSnapshot();
    const n = normalizeCombatSnapshot(s);
    expect(n.attacker.equipmentStats).not.toBe(s.attacker.equipmentStats);
    expect(n.attacker.equipmentStats.elementalAtkBonus).not.toBe(
      s.attacker.equipmentStats.elementalAtkBonus,
    );
  });
});
