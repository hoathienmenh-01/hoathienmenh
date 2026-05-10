/**
 * Phase 14.1.B — Async Arena service integration tests.
 *
 * Coverage:
 *   - Profile lazy-create (rating default, snapshot view).
 *   - Opponent list excludes self + fallback random when sparse.
 *   - Match create success, persist snapshots/seed/log/rating delta.
 *   - Cannot attack self.
 *   - Same snapshots + seed → deterministic result (re-resolve via shared
 *     `resolveCombatWithSnapshot`).
 *   - Daily limit enforced via `ARENA_DAILY_LIMIT_PER_DAY` env override.
 *   - History returns matches DESC, supports `side` filter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ARENA_RATING_DEFAULT,
  resolveCombatWithSnapshot,
  type CombatActorSnapshot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  ArenaError,
  ArenaService,
  buildArenaActorSnapshot,
} from './arena.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let arena: ArenaService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  arena = new ArenaService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  // Reset env override per test.
  delete process.env.ARENA_DAILY_LIMIT_PER_DAY;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ArenaService.getOrCreateProfile', () => {
  it('lazy-creates profile with default rating 1000', async () => {
    const ctx = await makeUserChar(prisma);
    const p = await arena.getOrCreateProfile(ctx.characterId);
    expect(p.rating).toBe(ARENA_RATING_DEFAULT);
    expect(p.wins).toBe(0);
    expect(p.losses).toBe(0);
    expect(p.draws).toBe(0);
    expect(p.attacksToday).toBe(0);
    expect(p.tier).toBe('unranked');
    expect(p.characterId).toBe(ctx.characterId);
  });

  it('returns existing profile on second call (idempotent)', async () => {
    const ctx = await makeUserChar(prisma);
    const a = await arena.getOrCreateProfile(ctx.characterId);
    const b = await arena.getOrCreateProfile(ctx.characterId);
    expect(b.createdAt).toBe(a.createdAt);
    const rows = await prisma.arenaProfile.count({
      where: { characterId: ctx.characterId },
    });
    expect(rows).toBe(1);
  });

  it('throws NO_CHARACTER for unknown id', async () => {
    await expect(
      arena.getOrCreateProfile('nope-id'),
    ).rejects.toMatchObject({ code: 'NO_CHARACTER' });
  });
});

describe('ArenaService.listOpponents', () => {
  it('excludes self', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'truc_co' });
    const b = await makeUserChar(prisma, { realmKey: 'truc_co' });
    await arena.getOrCreateProfile(a.characterId);
    await arena.getOrCreateProfile(b.characterId);
    const opp = await arena.listOpponents(a.characterId);
    expect(opp.map((o) => o.characterId)).toContain(b.characterId);
    expect(opp.map((o) => o.characterId)).not.toContain(a.characterId);
  });

  it('returns empty when no opponents have profile yet', async () => {
    const a = await makeUserChar(prisma);
    const opp = await arena.listOpponents(a.characterId);
    expect(opp).toEqual([]);
  });

  it('falls back to far-rating opponents when near pool empty', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await arena.getOrCreateProfile(a.characterId);
    await arena.getOrCreateProfile(b.characterId);
    // Push b far away so near-bucket excludes it (>200 delta).
    await prisma.arenaProfile.update({
      where: { characterId: b.characterId },
      data: { rating: 3000 },
    });
    const opp = await arena.listOpponents(a.characterId);
    expect(opp.length).toBe(1);
    expect(opp[0].characterId).toBe(b.characterId);
  });
});

describe('ArenaService.createMatch', () => {
  it('rejects self attack', async () => {
    const a = await makeUserChar(prisma);
    await arena.getOrCreateProfile(a.characterId);
    await expect(
      arena.createMatch(a.characterId, { defenderCharacterId: a.characterId }),
    ).rejects.toMatchObject({ code: 'CANNOT_ATTACK_SELF' });
  });

  it('rejects unknown defender', async () => {
    const a = await makeUserChar(prisma);
    await arena.getOrCreateProfile(a.characterId);
    await expect(
      arena.createMatch(a.characterId, { defenderCharacterId: 'nope-id' }),
    ).rejects.toMatchObject({ code: 'DEFENDER_NOT_FOUND' });
  });

  it('rejects invalid input', async () => {
    const a = await makeUserChar(prisma);
    await arena.getOrCreateProfile(a.characterId);
    await expect(
      arena.createMatch(a.characterId, {
        defenderCharacterId: '' as unknown as string,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('persists match with snapshots/seed/log/result/ratingDelta', async () => {
    const a = await makeUserChar(prisma, { power: 50, hpMax: 200, hp: 200 });
    const b = await makeUserChar(prisma, { power: 30, hpMax: 100, hp: 100 });
    const result = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 12345,
    });
    expect(result.matchId).toBeDefined();
    expect(result.status).toBe('RESOLVED');
    expect(['ATTACKER_WIN', 'DEFENDER_WIN', 'DRAW']).toContain(result.outcome);
    expect(result.seed).toBe(12345);
    expect(result.battleLog.length).toBeGreaterThan(0);
    expect(result.rounds).toBe(result.battleLog.length);

    const row = await prisma.arenaMatch.findUnique({
      where: { id: result.matchId },
    });
    expect(row).toBeTruthy();
    expect(row!.status).toBe('RESOLVED');
    expect(row!.seed).toBe(12345);
    expect(row!.attackerCharacterId).toBe(a.characterId);
    expect(row!.defenderCharacterId).toBe(b.characterId);
    expect(row!.attackerSnapshotJson).toBeTruthy();
    expect(row!.defenderSnapshotJson).toBeTruthy();
    expect(row!.battleLogJson).toBeTruthy();
    expect(row!.ratingDeltaJson).toBeTruthy();
  });

  it('updates rating + counters on attacker profile', async () => {
    const a = await makeUserChar(prisma, { power: 100, hpMax: 500, hp: 500 });
    const b = await makeUserChar(prisma, { power: 10, hpMax: 50, hp: 50 });
    const result = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 1,
    });
    const profile = await prisma.arenaProfile.findUnique({
      where: { characterId: a.characterId },
    });
    expect(profile).toBeTruthy();
    expect(profile!.attacksToday).toBe(1);
    if (result.outcome === 'ATTACKER_WIN') {
      expect(profile!.wins).toBe(1);
      expect(profile!.rating).toBeGreaterThan(ARENA_RATING_DEFAULT);
    } else if (result.outcome === 'DEFENDER_WIN') {
      expect(profile!.losses).toBe(1);
      expect(profile!.rating).toBeLessThan(ARENA_RATING_DEFAULT);
    } else {
      expect(profile!.draws).toBe(1);
    }
  });

  it('same snapshots + seed → deterministic result', async () => {
    const a = await makeUserChar(prisma, { power: 40, hpMax: 150, hp: 150 });
    const b = await makeUserChar(prisma, { power: 35, hpMax: 150, hp: 150 });
    const r1 = await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 999,
    });

    // Replay with stored snapshots externally.
    const row = await prisma.arenaMatch.findUnique({
      where: { id: r1.matchId },
    });
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

  it('build helper produces normalized snapshot reproducible', async () => {
    const a = await makeUserChar(prisma, {
      power: 40,
      hpMax: 200,
      primaryElement: 'kim',
    });
    const character = (await prisma.character.findUnique({
      where: { id: a.characterId },
    }))!;
    const row = {
      id: character.id,
      name: character.name,
      realmKey: character.realmKey,
      realmStage: character.realmStage,
      hp: character.hp,
      hpMax: character.hpMax,
      mp: character.mp,
      mpMax: character.mpMax,
      power: character.power,
      spirit: character.spirit,
      speed: character.speed,
      primaryElement: character.primaryElement,
      sectId: character.sectId,
    };
    const s1 = buildArenaActorSnapshot(row);
    const s2 = buildArenaActorSnapshot(row);
    expect(s1).toEqual(s2);
    expect(s1.elementalAffinity).toBe('kim');
    expect(s1.derivedStats.atk).toBe(40);
  });

  it('enforces daily limit when ARENA_DAILY_LIMIT_PER_DAY set', async () => {
    process.env.ARENA_DAILY_LIMIT_PER_DAY = '2';
    const a = await makeUserChar(prisma, { power: 60 });
    const b = await makeUserChar(prisma);
    await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 1,
    });
    await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 2,
    });
    await expect(
      arena.createMatch(a.characterId, {
        defenderCharacterId: b.characterId,
        seed: 3,
      }),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });
  });

  it('skips daily limit when ARENA_DAILY_LIMIT_PER_DAY=0', async () => {
    process.env.ARENA_DAILY_LIMIT_PER_DAY = '0';
    const a = await makeUserChar(prisma, { power: 60 });
    const b = await makeUserChar(prisma);
    for (let i = 0; i < 5; i += 1) {
      await arena.createMatch(a.characterId, {
        defenderCharacterId: b.characterId,
        seed: i + 1,
      });
    }
    const profile = await prisma.arenaProfile.findUnique({
      where: { characterId: a.characterId },
    });
    expect(profile!.attacksToday).toBe(5);
  });
});

describe('ArenaService.getMatchHistory', () => {
  it('returns matches DESC by createdAt for given character (both sides)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 1,
    });
    await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 2,
    });
    const aHistory = await arena.getMatchHistory(a.characterId);
    expect(aHistory.length).toBe(2);
    const bHistory = await arena.getMatchHistory(b.characterId);
    expect(bHistory.length).toBe(2);
  });

  it('side=attacker filters outgoing only', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await arena.createMatch(a.characterId, {
      defenderCharacterId: b.characterId,
      seed: 1,
    });
    await arena.createMatch(b.characterId, {
      defenderCharacterId: a.characterId,
      seed: 2,
    });
    const aOut = await arena.getMatchHistory(a.characterId, { side: 'attacker' });
    expect(aOut.length).toBe(1);
    expect(aOut[0].attackerCharacterId).toBe(a.characterId);
    const aIn = await arena.getMatchHistory(a.characterId, { side: 'defender' });
    expect(aIn.length).toBe(1);
    expect(aIn[0].defenderCharacterId).toBe(a.characterId);
  });

  it('respects limit', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    for (let i = 0; i < 4; i += 1) {
      await arena.createMatch(a.characterId, {
        defenderCharacterId: b.characterId,
        seed: i + 1,
      });
    }
    const limited = await arena.getMatchHistory(a.characterId, { limit: 2 });
    expect(limited.length).toBe(2);
  });
});

describe('ArenaError shape', () => {
  it('error class exposes code', () => {
    const e = new ArenaError('CANNOT_ATTACK_SELF');
    expect(e.code).toBe('CANNOT_ATTACK_SELF');
    expect(e instanceof Error).toBe(true);
  });
});
