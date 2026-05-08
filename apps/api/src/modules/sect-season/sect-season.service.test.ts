/**
 * Phase 13.2.A — SectSeasonService integration tests.
 *
 * Cover:
 *   - resolveSeason: lookup by key + fallback currentSectSeason(now).
 *   - getLeaderboard: aggregate qua weekKeys của season, ordering, contributors,
 *     weeksContributed.
 *   - getMyStatus: personalPoints + achieved/next milestone derivation,
 *     hasSect=false fallback, NO_CHARACTER throw.
 *   - getCurrent: full state cho user trong season hiện hành; out-of-season
 *     fallback (seasonKey=null).
 *   - listSeasons: catalog snapshot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SECT_SEASONS,
  sectSeasonByKey,
  sectSeasonWeekKeys,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { SectSeasonError, SectSeasonService } from './sect-season.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let sectSeason: SectSeasonService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  sectSeason = new SectSeasonService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(prisma: PrismaService, leaderId: string | null = null) {
  return prisma.sect.create({
    data: {
      name: `S-${nextSuffix()}`,
      description: 'Test sect',
      leaderId,
    },
  });
}

/**
 * Test fixture: tạo 1 row contribution thẳng vào DB cho season+sect+character.
 *
 * Phase 13.2.A đứng trên `SectWarContribution` — tránh phụ thuộc
 * SectWarService (đã có integration test riêng). Trực tiếp `prisma.create`
 * giúp test deterministic + explicit weekKey/createdAt.
 */
async function seedContribution(opts: {
  weekKey: string;
  sectId: string;
  characterId: string;
  activityKey: string;
  sourceType: string;
  sourceId: string | null;
  points: number;
  createdAt?: Date;
}) {
  return prisma.sectWarContribution.create({
    data: {
      weekKey: opts.weekKey,
      sectId: opts.sectId,
      characterId: opts.characterId,
      activityKey: opts.activityKey,
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      points: opts.points,
      createdAt: opts.createdAt,
    },
  });
}

describe('SectSeasonService — resolveSeason', () => {
  it('seasonKey hợp lệ → trả def', () => {
    const s = sectSeason.resolveSeason('season_2026_s2');
    expect(s).not.toBeNull();
    expect(s!.key).toBe('season_2026_s2');
  });

  it('seasonKey không tồn tại → null', () => {
    expect(sectSeason.resolveSeason('season_9999_s99')).toBeNull();
  });

  it('seasonKey rỗng → fallback currentSectSeason(now)', () => {
    // 2026-05-08 = giữa season_2026_s2.
    const s = sectSeason.resolveSeason(undefined, new Date('2026-05-08T05:00:00Z'));
    expect(s!.key).toBe('season_2026_s2');
  });

  it('now ngoài catalog → null', () => {
    expect(sectSeason.resolveSeason(undefined, new Date('2030-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('SectSeasonService.getLeaderboard', () => {
  it('season không có contribution → rows rỗng', async () => {
    const res = await sectSeason.getLeaderboard('season_2026_s2');
    expect(res.seasonKey).toBe('season_2026_s2');
    expect(res.rows).toHaveLength(0);
  });

  it('aggregate qua nhiều weekKey trong season window, sort points desc', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA1 = await makeUserChar(prisma, { sectId: sectA.id });
    const uA2 = await makeUserChar(prisma, { sectId: sectA.id });
    const uB1 = await makeUserChar(prisma, { sectId: sectB.id });

    const season = sectSeasonByKey('season_2026_s2')!;
    const weekKeys = sectSeasonWeekKeys(season);
    expect(weekKeys.length).toBe(4);

    // SectA: 100 pts ở W18 + 50 pts ở W19 + 50 pts ở W20 = 200 pts (2 contributors, 3 weeks).
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: uA1.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-1',
      points: 100,
    });
    await seedContribution({
      weekKey: weekKeys[1],
      sectId: sectA.id,
      characterId: uA1.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-2',
      points: 50,
    });
    await seedContribution({
      weekKey: weekKeys[2],
      sectId: sectA.id,
      characterId: uA2.characterId,
      activityKey: 'boss_participation',
      sourceType: 'WorldBoss',
      sourceId: 'b-1',
      points: 50,
    });

    // SectB: 80 pts ở W19 = 80 pts (1 contributor, 1 week).
    await seedContribution({
      weekKey: weekKeys[1],
      sectId: sectB.id,
      characterId: uB1.characterId,
      activityKey: 'daily_login',
      sourceType: 'DailyLoginClaim',
      sourceId: 'd-1',
      points: 80,
    });

    const res = await sectSeason.getLeaderboard('season_2026_s2');
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].sectId).toBe(sectA.id);
    expect(res.rows[0].points).toBe(200);
    expect(res.rows[0].rank).toBe(1);
    expect(res.rows[0].contributors).toBe(2);
    expect(res.rows[0].weeksContributed).toBe(3);

    expect(res.rows[1].sectId).toBe(sectB.id);
    expect(res.rows[1].points).toBe(80);
    expect(res.rows[1].rank).toBe(2);
    expect(res.rows[1].contributors).toBe(1);
    expect(res.rows[1].weeksContributed).toBe(1);
  });

  it('row ngoài season window không được tính', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const seasonS2 = sectSeasonByKey('season_2026_s2')!;
    const seasonS3 = sectSeasonByKey('season_2026_s3')!;

    // Row trong S3 (W22) — KHÔNG được aggregate khi query S2.
    const s3WeekKeys = sectSeasonWeekKeys(seasonS3);
    await seedContribution({
      weekKey: s3WeekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-s3',
      points: 999,
    });

    const res = await sectSeason.getLeaderboard(seasonS2.key);
    expect(res.rows).toHaveLength(0);
  });

  it('seasonKey rỗng + now ngoài catalog → rows rỗng (graceful)', async () => {
    const res = await sectSeason.getLeaderboard(undefined, new Date('2030-01-01T00:00:00Z'));
    expect(res.rows).toHaveLength(0);
  });
});

describe('SectSeasonService.getMyStatus', () => {
  it('không có character → throw NO_CHARACTER', async () => {
    await expect(
      sectSeason.getMyStatus('non-existent-user-id', 'season_2026_s2'),
    ).rejects.toBeInstanceOf(SectSeasonError);
  });

  it('character không có sect → hasSect=false, points=0, milestone next=bronze', async () => {
    const u = await makeUserChar(prisma);
    const res = await sectSeason.getMyStatus(u.userId, 'season_2026_s2');
    expect(res).not.toBeNull();
    expect(res!.hasSect).toBe(false);
    expect(res!.sectId).toBeNull();
    expect(res!.personalPoints).toBe(0);
    expect(res!.weeksContributed).toBe(0);
    expect(res!.achievedMilestoneKeys).toEqual([]);
    expect(res!.nextMilestoneKey).toBe('milestone_bronze');
  });

  it('character có sect + contribution 600 pts qua 2 tuần → silver achieved, next=gold', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const season = sectSeasonByKey('season_2026_s2')!;
    const weekKeys = sectSeasonWeekKeys(season);

    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-1',
      points: 300,
    });
    await seedContribution({
      weekKey: weekKeys[1],
      sectId: sectA.id,
      characterId: u.characterId,
      activityKey: 'boss_participation',
      sourceType: 'WorldBoss',
      sourceId: 'b-1',
      points: 300,
    });

    const res = await sectSeason.getMyStatus(u.userId, season.key);
    expect(res!.hasSect).toBe(true);
    expect(res!.sectId).toBe(sectA.id);
    expect(res!.sectName).toMatch(/^S-/);
    expect(res!.personalPoints).toBe(600);
    expect(res!.weeksContributed).toBe(2);
    expect(res!.achievedMilestoneKeys).toEqual(['milestone_bronze', 'milestone_silver']);
    expect(res!.nextMilestoneKey).toBe('milestone_gold');
  });

  it('points 7500+ → achieved tất cả 5, nextMilestoneKey=null', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const season = sectSeasonByKey('season_2026_s2')!;
    const weekKeys = sectSeasonWeekKeys(season);

    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-big',
      points: 8000,
    });

    const res = await sectSeason.getMyStatus(u.userId, season.key);
    expect(res!.personalPoints).toBe(8000);
    expect(res!.achievedMilestoneKeys).toHaveLength(5);
    expect(res!.nextMilestoneKey).toBeNull();
  });

  it('seasonKey rỗng + now ngoài catalog → null', async () => {
    const u = await makeUserChar(prisma);
    const res = await sectSeason.getMyStatus(
      u.userId,
      undefined,
      new Date('2030-01-01T00:00:00Z'),
    );
    expect(res).toBeNull();
  });
});

describe('SectSeasonService.getCurrent', () => {
  it('now trong season → trả full state', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const season = sectSeasonByKey('season_2026_s2')!;
    const weekKeys = sectSeasonWeekKeys(season);

    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: 'dr-1',
      points: 150,
    });

    // 2026-05-08 ICT = giữa season_2026_s2.
    const now = new Date('2026-05-08T05:00:00Z');
    const res = await sectSeason.getCurrent(u.userId, now);
    expect(res.seasonKey).toBe(season.key);
    expect(res.season).not.toBeNull();
    expect(res.season!.key).toBe(season.key);
    expect(res.milestones.length).toBe(5);
    expect(res.leaderboard.length).toBe(1);
    expect(res.leaderboard[0].points).toBe(150);
    expect(res.me).not.toBeNull();
    expect(res.me!.personalPoints).toBe(150);
    expect(res.me!.achievedMilestoneKeys).toEqual(['milestone_bronze']);
  });

  it('now ngoài catalog → seasonKey=null + leaderboard rỗng + me=null + milestones vẫn snapshot', async () => {
    const u = await makeUserChar(prisma);
    const now = new Date('2030-01-01T00:00:00Z');
    const res = await sectSeason.getCurrent(u.userId, now);
    expect(res.seasonKey).toBeNull();
    expect(res.season).toBeNull();
    expect(res.leaderboard).toHaveLength(0);
    expect(res.me).toBeNull();
    expect(res.milestones.length).toBe(5);
  });
});

describe('SectSeasonService.listSeasons', () => {
  it('trả full catalog snapshot', () => {
    const list = sectSeason.listSeasons();
    expect(list.length).toBe(SECT_SEASONS.length);
    expect(list[0].key).toBe('season_2026_s1');
  });
});
