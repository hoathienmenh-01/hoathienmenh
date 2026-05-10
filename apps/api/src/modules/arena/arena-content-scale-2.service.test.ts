/**
 * Content Scale 2 — High-Realm Skills Pack Arena compatibility tests.
 *
 * Verify rằng việc thêm skill cảnh giới cao mới KHÔNG phá Arena flow:
 *   - Character ở realm cao (vinh_hang) có thể tham gia Arena.
 *   - Match tạo deterministic (cùng seed → cùng outcome).
 *   - High-realm character có thể đã learn skill mới (admin grant) mà
 *     Arena snapshot vẫn build được mà không crash.
 *   - resolveCombatWithSnapshot replay khớp với match outcome stored.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveCombatWithSnapshot,
  type CombatActorSnapshot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { ArenaService, buildArenaActorSnapshot } from './arena.service';
import { CharacterSkillService } from '../character/character-skill.service';
import { CurrencyService } from '../character/currency.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let arena: ArenaService;
let skillSvc: CharacterSkillService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  arena = new ArenaService(prisma);
  const currency = new CurrencyService(prisma);
  skillSvc = new CharacterSkillService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
  delete process.env.ARENA_DAILY_LIMIT_PER_DAY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Arena — high-realm character (Content Scale 2)', () => {
  it('character ở vinh_hang đã learn high-realm skill → tạo match deterministic', async () => {
    const a = await makeUserChar(prisma, {
      realmKey: 'vinh_hang',
      realmStage: 1,
      power: 80,
      hpMax: 200,
      hp: 200,
      primaryElement: 'kim',
    });
    const b = await makeUserChar(prisma, {
      realmKey: 'vinh_hang',
      realmStage: 1,
      power: 70,
      hpMax: 200,
      hp: 200,
      primaryElement: 'moc',
    });

    // Grant a high-realm skill to attacker (verify learn doesn't break
    // arena flow downstream).
    await skillSvc.learn(
      a.characterId,
      'kim_vinh_hang_thien_kiem_quy_tong',
      'admin_grant',
    );
    await skillSvc.learn(
      b.characterId,
      'moc_vinh_hang_van_co_sinh_chu',
      'admin_grant',
    );

    const r1 = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 555,
    });

    // Replay with stored snapshots — outcome must match exactly.
    const row = await prisma.arenaMatch.findUnique({
      where: { id: r1.matchId },
    });
    expect(row).not.toBeNull();
    const sim = resolveCombatWithSnapshot({
      attacker: row!.attackerSnapshotJson as unknown as CombatActorSnapshot,
      defender: row!.defenderSnapshotJson as unknown as CombatActorSnapshot,
      seed: row!.seed,
      context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
    });
    const expectedOutcome =
      sim.winner === 'attacker'
        ? 'ATTACKER_WIN'
        : sim.winner === 'defender'
          ? 'DEFENDER_WIN'
          : 'DRAW';
    expect(r1.outcome).toBe(expectedOutcome);
    expect(r1.totalAttackerDamage).toBe(sim.damageSummary.totalAttackerDamage);
    expect(r1.totalDefenderDamage).toBe(sim.damageSummary.totalDefenderDamage);
  });

  it('hai character vinh_hang khác linh căn — match không crash, có outcome', async () => {
    const a = await makeUserChar(prisma, {
      realmKey: 'vinh_hang',
      realmStage: 1,
      primaryElement: 'hoa',
      power: 80,
      hpMax: 200,
      hp: 200,
    });
    const b = await makeUserChar(prisma, {
      realmKey: 'vinh_hang',
      realmStage: 1,
      primaryElement: 'thuy',
      power: 80,
      hpMax: 200,
      hp: 200,
    });
    const r = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 12345,
    });
    expect(['ATTACKER_WIN', 'DEFENDER_WIN', 'DRAW']).toContain(r.outcome);
    expect(r.totalAttackerDamage).toBeGreaterThanOrEqual(0);
    expect(r.totalDefenderDamage).toBeGreaterThanOrEqual(0);
  });

  it('buildArenaActorSnapshot cho character đã learn high-realm skill → không crash, snapshot có atk_thuong (Phase 14.1 placeholder)', async () => {
    const a = await makeUserChar(prisma, {
      realmKey: 'thanh_nhan',
      realmStage: 1,
      primaryElement: 'kim',
    });
    await skillSvc.learn(
      a.characterId,
      'kim_hon_nguyen_kim_kiep_dao_thien',
      'admin_grant',
    );
    const character = (await prisma.character.findUnique({
      where: { id: a.characterId },
    }))!;
    const snap = buildArenaActorSnapshot(character);
    // Phase 14.1.B reference resolver vẫn dùng atk_thuong placeholder.
    // Skill catalog mở rộng (Phase 14.1.C wire equipped skill) là
    // future scope — known limitation document trong PR.
    expect(snap.skillKeys).toEqual(['atk_thuong']);
    expect(snap.realmKey).toBe('thanh_nhan');
    expect(snap.elementalAffinity).toBe('kim');
  });
});
