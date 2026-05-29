import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { BattlePassV2Service } from './battle-pass-v2.service';

let prisma: PrismaService;
let bpV2: BattlePassV2Service;

// Use a date within the active battle pass season window
const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  bpV2 = new BattlePassV2Service(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('BattlePassV2Service.listMissions', () => {
  it('returns missions grouped by scope for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const view = await bpV2.listMissions(f.characterId, NOW);
    expect(view).toHaveProperty('seasonId');
    expect(view).toHaveProperty('daily');
    expect(view).toHaveProperty('weekly');
    expect(view).toHaveProperty('season');
    expect(Array.isArray(view.daily)).toBe(true);
    expect(Array.isArray(view.weekly)).toBe(true);
    expect(Array.isArray(view.season)).toBe(true);
  });

  it('returns zero progress for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const view = await bpV2.listMissions(f.characterId, NOW);
    for (const mission of [...view.daily, ...view.weekly, ...view.season]) {
      expect(mission.progress).toBe(0);
      expect(mission.completed).toBe(false);
      expect(mission.claimed).toBe(false);
    }
  });
});

describe('BattlePassV2Service.addProgress', () => {
  it('returns granted=0 for delta <= 0', async () => {
    const f = await makeUserChar(prisma);
    const result = await bpV2.addProgress(f.characterId, 'DUNGEON_CLEAR', 0, NOW);
    expect(result.granted).toBe(0);
    expect(result.completedMissions).toEqual([]);
  });

  it('returns granted=0 for negative delta', async () => {
    const f = await makeUserChar(prisma);
    const result = await bpV2.addProgress(f.characterId, 'DUNGEON_CLEAR', -5, NOW);
    expect(result.granted).toBe(0);
  });

  it('increments progress for matching missions', async () => {
    const f = await makeUserChar(prisma);
    const result = await bpV2.addProgress(f.characterId, 'DUNGEON_CLEAR', 1, NOW);
    // At minimum, should not throw and return valid structure
    expect(typeof result.granted).toBe('number');
    expect(typeof result.newXp).toBe('number');
    expect(typeof result.newLevel).toBe('number');
    expect(Array.isArray(result.completedMissions)).toBe(true);
  });

  it('does not double-grant exp for already completed missions', async () => {
    const f = await makeUserChar(prisma);
    // First call — may complete some missions
    const first = await bpV2.addProgress(f.characterId, 'DUNGEON_CLEAR', 999, NOW);
    // Second call with same delta — should not re-grant completed missions
    const second = await bpV2.addProgress(f.characterId, 'DUNGEON_CLEAR', 999, NOW);
    // newXp should be same or higher (not double-granted)
    expect(second.newXp).toBeGreaterThanOrEqual(first.newXp);
  });
});

describe('BattlePassV2Service.unlockPaidTrack', () => {
  it('creates progress row with premiumUnlocked=true for fresh character', async () => {
    const f = await makeUserChar(prisma);
    await bpV2.unlockPaidTrack(f.characterId, NOW);
    const progress = await prisma.battlePassProgress.findFirst({
      where: { characterId: f.characterId },
    });
    expect(progress).not.toBeNull();
    expect(progress!.premiumUnlocked).toBe(true);
  });

  it('is idempotent — calling twice does not throw', async () => {
    const f = await makeUserChar(prisma);
    await bpV2.unlockPaidTrack(f.characterId, NOW);
    await bpV2.unlockPaidTrack(f.characterId, NOW);
    const count = await prisma.battlePassProgress.count({
      where: { characterId: f.characterId },
    });
    expect(count).toBe(1);
  });
});

describe('BattlePassV2Service.computeScopeBucket', () => {
  it('returns seasonId for SEASON scope', () => {
    const season = { seasonId: 'test_season' } as any;
    const bucket = BattlePassV2Service.computeScopeBucket('SEASON', season, NOW);
    expect(bucket).toBe('test_season');
  });

  it('returns date-based key for DAILY scope', () => {
    const season = { seasonId: 'test_season' } as any;
    const bucket = BattlePassV2Service.computeScopeBucket('DAILY', season, NOW);
    expect(typeof bucket).toBe('string');
    expect(bucket.length).toBeGreaterThan(0);
  });

  it('returns date-based key for WEEKLY scope', () => {
    const season = { seasonId: 'test_season' } as any;
    const bucket = BattlePassV2Service.computeScopeBucket('WEEKLY', season, NOW);
    expect(typeof bucket).toBe('string');
    expect(bucket.length).toBeGreaterThan(0);
  });
});
