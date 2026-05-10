/**
 * Content Scale 2 — High-Realm Skills Pack combat / arena compatibility.
 *
 * Verify rằng skill cảnh giới cao mới không phá deterministic combat
 * snapshot resolver:
 *   - resolveCombatWithSnapshot vẫn produce result identical khi cùng
 *     seed, dù skillKeys[0] là một skill mới Vĩnh Hằng / Hỗn Nguyên.
 *   - Arena snapshot normalize giữ nguyên skill keys khi sort.
 *   - normalizeCombatSnapshot xử lý skill mới giống skill cũ (sort
 *     lexicographically).
 *   - Khi cả 2 side dùng skill mới → trận đấu không crash, có winner.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCombatActorSnapshot,
  type CombatSimulationSnapshot,
  normalizeCombatSnapshot,
  resolveCombatWithSnapshot,
} from './combat-snapshot';
import { hashSeed } from './combat-rng';

const HIGH_REALM_SAMPLE_SKILLS = [
  'kim_nhan_tien_pho_thien_kiep',
  'moc_tien_gioi_co_lam_thuong_truong',
  'thuy_hon_nguyen_van_thuy_quy_nguyen',
  'hoa_vinh_hang_kiep_diem_thieu_thien',
  'tho_vinh_hang_huyen_dia_kim_can_giap',
];

function makeHighRealmSnapshot(
  attackerSkill: string,
  defenderSkill: string,
  seed = 7777,
): CombatSimulationSnapshot {
  const attacker = buildCombatActorSnapshot({
    name: 'HR_A',
    realmKey: 'vinh_hang',
    stage: 9,
    baseStats: {
      hp: 200,
      hpMax: 200,
      mp: 80,
      mpMax: 80,
      power: 80,
      spirit: 40,
      speed: 25,
    },
    derivedStats: { atk: 80, def: 30, hpMax: 200, spirit: 40, speed: 25 },
    skillKeys: [attackerSkill],
    elementalAffinity: 'kim',
  });
  const defender = buildCombatActorSnapshot({
    name: 'HR_B',
    realmKey: 'vinh_hang',
    stage: 9,
    baseStats: {
      hp: 200,
      hpMax: 200,
      mp: 80,
      mpMax: 80,
      power: 75,
      spirit: 40,
      speed: 22,
    },
    derivedStats: { atk: 75, def: 30, hpMax: 200, spirit: 40, speed: 22 },
    skillKeys: [defenderSkill],
    elementalAffinity: 'moc',
  });
  return {
    attacker,
    defender,
    seed,
    context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
  };
}

describe('Content Scale 2 — combat snapshot deterministic with high-realm skills', () => {
  it('cùng seed → cùng winner / damage summary cho mọi cặp skill mới (sample)', () => {
    for (const atk of HIGH_REALM_SAMPLE_SKILLS) {
      for (const def of HIGH_REALM_SAMPLE_SKILLS) {
        const snap = makeHighRealmSnapshot(atk, def);
        const a = resolveCombatWithSnapshot(snap);
        const b = resolveCombatWithSnapshot(snap);
        expect(a.winner, `winner mismatch ${atk} vs ${def}`).toBe(b.winner);
        expect(a.rounds.length, `rounds mismatch ${atk} vs ${def}`).toBe(
          b.rounds.length,
        );
        expect(a.damageSummary.totalAttackerDamage).toBe(
          b.damageSummary.totalAttackerDamage,
        );
        expect(a.damageSummary.totalDefenderDamage).toBe(
          b.damageSummary.totalDefenderDamage,
        );
      }
    }
  });

  it('khác seed → kết quả có thể khác (variance kích hoạt) nhưng vẫn deterministic per-seed', () => {
    const s1 = makeHighRealmSnapshot(
      'hoa_vinh_hang_kiep_diem_thieu_thien',
      'tho_vinh_hang_huyen_dia_kim_can_giap',
      111,
    );
    const s2 = makeHighRealmSnapshot(
      'hoa_vinh_hang_kiep_diem_thieu_thien',
      'tho_vinh_hang_huyen_dia_kim_can_giap',
      222,
    );
    const r1a = resolveCombatWithSnapshot(s1);
    const r1b = resolveCombatWithSnapshot(s1);
    const r2 = resolveCombatWithSnapshot(s2);
    expect(r1a).toEqual(r1b);
    // Không assert r2 khác r1 — đôi khi seeds rớt cùng kết quả; chỉ
    // đảm bảo per-seed deterministic.
    expect(r2).toBeDefined();
  });

  it('hashSeed(string) → cùng numeric seed → deterministic combat', () => {
    const seed = hashSeed('arena-cs2-content-scale-2-content-test');
    const snap = makeHighRealmSnapshot(
      'kim_vinh_hang_thien_kiem_quy_tong',
      'moc_vinh_hang_van_co_sinh_chu',
      seed,
    );
    const a = resolveCombatWithSnapshot(snap);
    const b = resolveCombatWithSnapshot(snap);
    expect(a).toEqual(b);
  });

  it('normalize giữ skill key mới sau sort (sorted lexicographically)', () => {
    const skills = [
      'kim_vinh_hang_thien_kiem_quy_tong',
      'a_zzz_basic',
      'thuy_hon_nguyen_van_thuy_quy_nguyen',
    ];
    const attacker = buildCombatActorSnapshot({
      name: 'A',
      realmKey: 'vinh_hang',
      stage: 1,
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
      skillKeys: skills,
      elementalAffinity: 'kim',
    });
    const defender = buildCombatActorSnapshot({
      name: 'B',
      realmKey: 'vinh_hang',
      stage: 1,
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
    const normalized = normalizeCombatSnapshot({
      attacker,
      defender,
      seed: 42,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    expect(normalized.attacker.skillKeys).toEqual([
      'a_zzz_basic',
      'kim_vinh_hang_thien_kiem_quy_tong',
      'thuy_hon_nguyen_van_thuy_quy_nguyen',
    ]);
  });

  it('khi cả 2 side equip skill mới → trận đấu không crash, có winner xác định', () => {
    const snap = makeHighRealmSnapshot(
      'hoa_hon_nguyen_chu_tuoc_thien_phan',
      'thuy_vinh_hang_thien_ha_dao_lang',
      9001,
    );
    const r = resolveCombatWithSnapshot(snap);
    expect(['attacker', 'defender', 'draw']).toContain(r.winner);
    expect(r.rounds.length).toBeGreaterThan(0);
    expect(r.damageSummary.totalAttackerDamage).toBeGreaterThanOrEqual(0);
    expect(r.damageSummary.totalDefenderDamage).toBeGreaterThanOrEqual(0);
  });

  it('100 lần resolve liên tiếp với high-realm skill → state consistent (RNG isolation)', () => {
    const snap = makeHighRealmSnapshot(
      'kim_hon_nguyen_kim_kiep_dao_thien',
      'tho_hon_nguyen_dia_thien_son_quan',
      54321,
    );
    const baseline = resolveCombatWithSnapshot(snap);
    for (let i = 0; i < 100; i += 1) {
      const r = resolveCombatWithSnapshot(snap);
      expect(r.winner).toBe(baseline.winner);
      expect(r.damageSummary.totalAttackerDamage).toBe(
        baseline.damageSummary.totalAttackerDamage,
      );
      expect(r.damageSummary.totalDefenderDamage).toBe(
        baseline.damageSummary.totalDefenderDamage,
      );
    }
  });
});
