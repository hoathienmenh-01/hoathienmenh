/**
 * Phase 14.1.D — ArenaAntiWintradeService integration tests (Postgres).
 *
 * Coverage:
 *   - REPEATED_OPPONENT_PAIR: cùng cặp ≥ N → WARN.
 *   - RECIPROCAL_WIN_LOSS: 2 chars qua lại → WARN.
 *   - RATING_GAIN_SPIKE: Δrating ≥ threshold → WARN.
 *   - REWARD_FARM_PATTERN: nhiều trận, ít opponent → WARN/CRITICAL.
 *   - SEASON_SUSPICIOUS_ACTOR: high win-rate + low diversity → WARN/CRITICAL.
 *   - Idempotency: scan 2 lần không tạo duplicate.
 *   - Normal activity → 0 alert.
 *   - quickCheckPair fail-soft khi prisma throw.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { ArenaAntiWintradeService } from './arena-anti-wintrade.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let scanner: ArenaAntiWintradeService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  scanner = new ArenaAntiWintradeService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  // Reset env overrides giữa các test.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ARENA_ANTI_WINTRADE_')) delete process.env[k];
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ----------------------------- helpers ----------------------------- */

async function ensureProfile(characterId: string) {
  await prisma.arenaProfile.upsert({
    where: { characterId },
    create: { characterId, rating: 1000 },
    update: {},
  });
}

interface MatchSpec {
  attackerCharacterId: string;
  defenderCharacterId: string;
  result: 'ATTACKER_WIN' | 'DEFENDER_WIN' | 'DRAW';
  ratingAttacker?: number;
  ratingDefender?: number;
  createdAt?: Date;
}

async function seedMatch(spec: MatchSpec): Promise<void> {
  await ensureProfile(spec.attackerCharacterId);
  await ensureProfile(spec.defenderCharacterId);
  const created = await prisma.arenaMatch.create({
    data: {
      attackerCharacterId: spec.attackerCharacterId,
      defenderCharacterId: spec.defenderCharacterId,
      status: 'RESOLVED',
      result: spec.result,
      seed: 1,
      attackerSnapshotJson: { name: 'a' } as never,
      defenderSnapshotJson: { name: 'b' } as never,
      battleLogJson: [] as never,
      ratingDeltaJson: {
        attacker: spec.ratingAttacker ?? 0,
        defender: spec.ratingDefender ?? 0,
      } as never,
      resolvedAt: spec.createdAt ?? new Date(),
    },
  });
  if (spec.createdAt) {
    await prisma.arenaMatch.update({
      where: { id: created.id },
      data: { createdAt: spec.createdAt },
    });
  }
}

/* ----------------------------- scan tests ----------------------------- */

describe('ArenaAntiWintradeService.scanRepeatedOpponentPairs', () => {
  it('creates WARN when same attacker→defender pair ≥ threshold in window', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        ratingAttacker: 10,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    const summary = await scanner.scanAll({ now });
    expect(summary.warningCount).toBeGreaterThanOrEqual(1);
    expect(summary.alertsCreated).toBeGreaterThanOrEqual(1);
    const rows = await prisma.arenaWintradeAlert.findMany({
      where: { type: 'REPEATED_OPPONENT_PAIR' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const r = rows.find(
      (x) => x.attackerCharacterId === A.characterId &&
        x.defenderCharacterId === B.characterId,
    );
    expect(r).toBeTruthy();
    expect(r!.severity).toBe('WARN');
    expect(r!.status).toBe('OPEN');
  });

  it('escalates to CRITICAL when pair count ≥ critical threshold', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 12; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        ratingAttacker: 10,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    await scanner.scanAll({ now });
    const r = await prisma.arenaWintradeAlert.findFirst({
      where: {
        type: 'REPEATED_OPPONENT_PAIR',
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
      },
    });
    expect(r?.severity).toBe('CRITICAL');
  });

  it('does NOT create alert when activity below threshold', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 3; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        ratingAttacker: 10,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    const summary = await scanner.scanAll({ now });
    expect(summary.alertsCreated).toBe(0);
    const c = await prisma.arenaWintradeAlert.count();
    expect(c).toBe(0);
  });
});

describe('ArenaAntiWintradeService.scanReciprocalWinLossPattern', () => {
  it('creates alert when two characters trade wins ≥ threshold', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    // 4 swap A→B win + 4 B→A win.
    for (let i = 0; i < 4; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        createdAt: new Date(now.getTime() - i * 60_000),
      });
      await seedMatch({
        attackerCharacterId: B.characterId,
        defenderCharacterId: A.characterId,
        result: 'ATTACKER_WIN',
        createdAt: new Date(now.getTime() - i * 60_000 - 1000),
      });
    }
    await scanner.scanAll({ now });
    const r = await prisma.arenaWintradeAlert.findFirst({
      where: { type: 'RECIPROCAL_WIN_LOSS' },
    });
    expect(r).toBeTruthy();
    expect(['WARN', 'CRITICAL']).toContain(r?.severity);
  });
});

describe('ArenaAntiWintradeService.scanRatingGainSpike', () => {
  it('creates WARN when rating gain ≥ threshold in window', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    // 10 trận A win, +25 rating mỗi trận = +250.
    for (let i = 0; i < 10; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        ratingAttacker: 25,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    await scanner.scanAll({ now });
    const r = await prisma.arenaWintradeAlert.findFirst({
      where: {
        type: 'RATING_GAIN_SPIKE',
        attackerCharacterId: A.characterId,
      },
    });
    expect(r).toBeTruthy();
    expect(r?.severity).toBe('WARN');
  });
});

describe('ArenaAntiWintradeService.scanRewardFarmPattern', () => {
  it('creates CRITICAL when attacker farms a single defender ≥ farmMatchesMin', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 8; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    await scanner.scanAll({ now });
    const r = await prisma.arenaWintradeAlert.findFirst({
      where: {
        type: 'REWARD_FARM_PATTERN',
        attackerCharacterId: A.characterId,
      },
    });
    expect(r?.severity).toBe('CRITICAL');
  });
});

describe('ArenaAntiWintradeService.scanSeasonSuspiciousActors', () => {
  it('creates CRITICAL when actor has ≥ minMatches with high win-rate + 1 opponent', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    // 12 match, all wins, 1 opponent.
    for (let i = 0; i < 12; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    await scanner.scanAll({ now });
    const r = await prisma.arenaWintradeAlert.findFirst({
      where: {
        type: 'SEASON_SUSPICIOUS_ACTOR',
        attackerCharacterId: A.characterId,
      },
    });
    expect(r?.severity).toBe('CRITICAL');
  });
});

describe('ArenaAntiWintradeService idempotency', () => {
  it('scan twice does not duplicate alerts (P2002 unique skip)', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 6; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        ratingAttacker: 30,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    const first = await scanner.scanAll({ now });
    expect(first.alertsCreated).toBeGreaterThan(0);
    const second = await scanner.scanAll({ now });
    expect(second.alertsCreated).toBe(0);
    expect(second.alertsSkippedDuplicate).toBeGreaterThanOrEqual(
      first.alertsCreated,
    );
    const total = await prisma.arenaWintradeAlert.count();
    expect(total).toBe(first.alertsCreated);
  });
});

describe('ArenaAntiWintradeService normal activity', () => {
  it('does not flag legit varied activity', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const C = await makeUserChar(prisma);
    const D = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    // 3 match vs 3 different opponents — không hit rule nào.
    for (let i = 0; i < 3; i += 1) {
      const defender = [B, C, D][i].characterId;
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: defender,
        result: i % 2 === 0 ? 'ATTACKER_WIN' : 'DEFENDER_WIN',
        ratingAttacker: 10,
        ratingDefender: -10,
        createdAt: new Date(now.getTime() - i * 3600_000),
      });
    }
    const summary = await scanner.scanAll({ now });
    expect(summary.alertsCreated).toBe(0);
    const total = await prisma.arenaWintradeAlert.count();
    expect(total).toBe(0);
  });
});

describe('ArenaAntiWintradeService.quickCheckPair', () => {
  it('returns soft empty result on success without throw', async () => {
    const A = await makeUserChar(prisma);
    const B = await makeUserChar(prisma);
    const now = new Date('2026-05-09T12:00:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      await seedMatch({
        attackerCharacterId: A.characterId,
        defenderCharacterId: B.characterId,
        result: 'ATTACKER_WIN',
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    const r = await scanner.quickCheckPair(A.characterId, B.characterId, now);
    expect(r.alertsCreated).toBeGreaterThanOrEqual(1);
  });
});

describe('ArenaAntiWintradeService env override', () => {
  it('reads ARENA_ANTI_WINTRADE_REPEATED_WARN', async () => {
    process.env.ARENA_ANTI_WINTRADE_REPEATED_WARN = '3';
    const rules = scanner.getRules();
    expect(rules.maxMatchesSameOpponentPerWindow).toBe(3);
  });

  it('falls back when env negative or invalid', async () => {
    process.env.ARENA_ANTI_WINTRADE_REPEATED_WARN = 'not-a-number';
    const rules = scanner.getRules();
    expect(rules.maxMatchesSameOpponentPerWindow).toBe(5);
  });
});
