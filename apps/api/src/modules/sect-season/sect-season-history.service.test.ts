/**
 * Phase 13.2.C — SectSeasonHistoryService integration tests.
 *
 * Cover:
 *   - snapshotSeason: idempotent qua seasonKey UNIQUE, derive đúng từ
 *     SectWarContribution (top-N sect + top-N member, totals, denormalized
 *     champion/mvp), throws SEASON_NOT_FOUND/SEASON_NOT_ENDED.
 *   - listHistory: empty state + sort newest first, summary chỉ chứa
 *     champion/mvp denormalized.
 *   - getHistory: detail trả full sect + topMembers, throws
 *     SNAPSHOT_NOT_FOUND.
 *   - getHallOfFame: empty state + aggregate championships/mvps/podiums
 *     ordering qua nhiều season.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sectSeasonByKey, sectSeasonWeekKeys } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  SectSeasonHistoryError,
  SectSeasonHistoryService,
} from './sect-season-history.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let history: SectSeasonHistoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  history = new SectSeasonHistoryService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  // Phase 13.2.C — bảng snapshot không có FK xuống Sect/Character (audit-correct
  // naming) nên `wipeAll` không tự xoá. Wipe explicit.
  await prisma.sectSeasonTopMember.deleteMany({});
  await prisma.sectSeasonSectRank.deleteMany({});
  await prisma.sectSeasonSnapshot.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(name?: string) {
  return prisma.sect.create({
    data: {
      name: name ?? `S-${nextSuffix()}`,
      description: 'Test sect',
      leaderId: null,
    },
  });
}

async function seedContribution(opts: {
  weekKey: string;
  sectId: string;
  characterId: string;
  points: number;
  activityKey?: string;
  sourceType?: string;
  sourceId?: string | null;
}) {
  return prisma.sectWarContribution.create({
    data: {
      weekKey: opts.weekKey,
      sectId: opts.sectId,
      characterId: opts.characterId,
      activityKey: opts.activityKey ?? 'dungeon_clear',
      sourceType: opts.sourceType ?? 'DungeonRun',
      sourceId: opts.sourceId ?? `src-${nextSuffix()}`,
      points: opts.points,
    },
  });
}

// 2026-04-27 ICT = sau S1 (kết thúc 2026-04-26 ICT) → S1 đã ended.
const AFTER_S1 = new Date('2026-04-27T00:00:00+07:00');
// 2026-05-25 ICT = sau S2 (kết thúc 2026-05-24 ICT).
const AFTER_S2 = new Date('2026-05-25T00:00:00+07:00');
// 2026-06-22 ICT = sau S3 (kết thúc 2026-06-21 ICT).
const AFTER_S3 = new Date('2026-06-22T00:00:00+07:00');

describe('SectSeasonHistoryService.snapshotSeason', () => {
  it('seasonKey không tồn tại → throw SEASON_NOT_FOUND', async () => {
    await expect(
      history.snapshotSeason('season_9999_s99', { now: AFTER_S1 }),
    ).rejects.toBeInstanceOf(SectSeasonHistoryError);
  });

  it('season chưa ended (allowOngoing=false default) → throw SEASON_NOT_ENDED', async () => {
    // 2026-04-15 = đang trong S1 (S1: 2026-03-30 → 2026-04-26 ICT).
    const inSeason = new Date('2026-04-15T05:00:00Z');
    await expect(
      history.snapshotSeason('season_2026_s1', { now: inSeason }),
    ).rejects.toMatchObject({ code: 'SEASON_NOT_ENDED' });
  });

  it('season chưa ended + allowOngoing=true → snapshot OK', async () => {
    const inSeason = new Date('2026-04-15T05:00:00Z');
    const view = await history.snapshotSeason('season_2026_s1', {
      now: inSeason,
      allowOngoing: true,
    });
    expect(view.seasonKey).toBe('season_2026_s1');
    expect(view.totalSects).toBe(0);
    expect(view.sects).toHaveLength(0);
    expect(view.topMembers).toHaveLength(0);
  });

  it('season ended + không có contribution → snapshot empty totals', async () => {
    const view = await history.snapshotSeason('season_2026_s1', { now: AFTER_S1 });
    expect(view.seasonKey).toBe('season_2026_s1');
    expect(view.totalSects).toBe(0);
    expect(view.totalContributors).toBe(0);
    expect(view.totalPoints).toBe(0);
    expect(view.sects).toHaveLength(0);
    expect(view.topMembers).toHaveLength(0);

    const persisted = await prisma.sectSeasonSnapshot.findUnique({
      where: { seasonKey: 'season_2026_s1' },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.championSectId).toBeNull();
    expect(persisted!.mvpCharacterId).toBeNull();
  });

  it('idempotent: gọi 2 lần cùng seasonKey không tạo double snapshot', async () => {
    const sectA = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const season = sectSeasonByKey('season_2026_s1')!;
    const weekKeys = sectSeasonWeekKeys(season);
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 500,
    });

    const first = await history.snapshotSeason(season.key, { now: AFTER_S1 });
    expect(first.totalPoints).toBe(500);

    // Lần 2 — không re-aggregate, return existing.
    const second = await history.snapshotSeason(season.key, { now: AFTER_S1 });
    expect(second).toEqual(first);

    // Persistence check: chỉ 1 snapshot row + 1 sect rank + 1 member row.
    const snaps = await prisma.sectSeasonSnapshot.count();
    const ranks = await prisma.sectSeasonSectRank.count({
      where: { seasonKey: season.key },
    });
    const tops = await prisma.sectSeasonTopMember.count({
      where: { seasonKey: season.key },
    });
    expect(snaps).toBe(1);
    expect(ranks).toBe(1);
    expect(tops).toBe(1);
  });

  it('idempotent: bổ sung contribution sau snapshot không thay đổi snapshot (frozen final result)', async () => {
    const sectA = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const season = sectSeasonByKey('season_2026_s1')!;
    const weekKeys = sectSeasonWeekKeys(season);
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 200,
    });
    const first = await history.snapshotSeason(season.key, { now: AFTER_S1 });
    expect(first.totalPoints).toBe(200);

    // Tăng contribution sau khi snapshot — không nên ảnh hưởng.
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 9999,
    });
    const reread = await history.snapshotSeason(season.key, { now: AFTER_S1 });
    expect(reread.totalPoints).toBe(200);
    expect(reread.sects[0].points).toBe(200);
  });

  it('aggregate top-N sect và top-N member, denormalize champion + mvp', async () => {
    const sectA = await makeSect('SectA');
    const sectB = await makeSect('SectB');
    const uA1 = await makeUserChar(prisma, { sectId: sectA.id });
    const uA2 = await makeUserChar(prisma, { sectId: sectA.id });
    const uB1 = await makeUserChar(prisma, { sectId: sectB.id });
    const season = sectSeasonByKey('season_2026_s1')!;
    const weekKeys = sectSeasonWeekKeys(season);

    // SectA: 600 (uA1 400 + uA2 200), 2 contributors, 2 weeks.
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: uA1.characterId,
      points: 400,
    });
    await seedContribution({
      weekKey: weekKeys[1],
      sectId: sectA.id,
      characterId: uA2.characterId,
      points: 200,
    });
    // SectB: 300 (uB1), 1 contributor, 1 week.
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectB.id,
      characterId: uB1.characterId,
      points: 300,
    });

    const view = await history.snapshotSeason(season.key, { now: AFTER_S1 });
    expect(view.totalSects).toBe(2);
    expect(view.totalContributors).toBe(3);
    expect(view.totalPoints).toBe(900);

    expect(view.sects).toHaveLength(2);
    expect(view.sects[0].rank).toBe(1);
    expect(view.sects[0].sectId).toBe(sectA.id);
    expect(view.sects[0].sectName).toBe('SectA');
    expect(view.sects[0].points).toBe(600);
    expect(view.sects[0].contributors).toBe(2);
    expect(view.sects[0].weeksContributed).toBe(2);
    expect(view.sects[1].rank).toBe(2);
    expect(view.sects[1].sectId).toBe(sectB.id);

    expect(view.topMembers).toHaveLength(3);
    expect(view.topMembers[0].rank).toBe(1);
    expect(view.topMembers[0].characterId).toBe(uA1.characterId);
    expect(view.topMembers[0].points).toBe(400);
    expect(view.topMembers[0].sectId).toBe(sectA.id);
    expect(view.topMembers[0].sectName).toBe('SectA');
    expect(view.topMembers[1].characterId).toBe(uB1.characterId);
    expect(view.topMembers[1].points).toBe(300);

    // Denormalized champion + mvp persisted.
    const persisted = await prisma.sectSeasonSnapshot.findUnique({
      where: { seasonKey: season.key },
    });
    expect(persisted!.championSectId).toBe(sectA.id);
    expect(persisted!.championSectName).toBe('SectA');
    expect(persisted!.championPoints).toBe(600);
    expect(persisted!.mvpCharacterId).toBe(uA1.characterId);
    expect(persisted!.mvpPoints).toBe(400);
    expect(persisted!.mvpSectId).toBe(sectA.id);
  });

  it('contribution ngoài season window không ảnh hưởng snapshot', async () => {
    const sectA = await makeSect('SectA');
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const seasonS1 = sectSeasonByKey('season_2026_s1')!;
    const seasonS2 = sectSeasonByKey('season_2026_s2')!;
    const s2Weeks = sectSeasonWeekKeys(seasonS2);
    // Row trong S2 — KHÔNG được count khi snapshot S1.
    await seedContribution({
      weekKey: s2Weeks[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 9999,
    });

    const view = await history.snapshotSeason(seasonS1.key, { now: AFTER_S1 });
    expect(view.totalPoints).toBe(0);
    expect(view.sects).toHaveLength(0);
    expect(view.topMembers).toHaveLength(0);
  });
});

describe('SectSeasonHistoryService.listHistory', () => {
  it('chưa có snapshot → seasons=[]', async () => {
    const list = await history.listHistory();
    expect(list.seasons).toEqual([]);
  });

  it('nhiều season → newest first theo finalizedAt + summary có champion/mvp', async () => {
    const sectA = await makeSect('SectA');
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    const s1 = sectSeasonByKey('season_2026_s1')!;
    const s2 = sectSeasonByKey('season_2026_s2')!;
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s1)[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 100,
    });
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s2)[0],
      sectId: sectA.id,
      characterId: u.characterId,
      points: 250,
    });

    await history.snapshotSeason(s1.key, { now: AFTER_S1 });
    await history.snapshotSeason(s2.key, { now: AFTER_S2 });

    const list = await history.listHistory();
    expect(list.seasons).toHaveLength(2);
    // Newest first.
    expect(list.seasons[0].seasonKey).toBe(s2.key);
    expect(list.seasons[1].seasonKey).toBe(s1.key);

    expect(list.seasons[0].champion).not.toBeNull();
    expect(list.seasons[0].champion!.sectId).toBe(sectA.id);
    expect(list.seasons[0].champion!.points).toBe(250);
    expect(list.seasons[0].mvp).not.toBeNull();
    expect(list.seasons[0].mvp!.characterId).toBe(u.characterId);
    expect(list.seasons[0].mvp!.points).toBe(250);
    expect(list.seasons[0].totalContributors).toBe(1);
  });

  it('snapshot empty (không có contribution) → champion=null, mvp=null', async () => {
    await history.snapshotSeason('season_2026_s1', { now: AFTER_S1 });
    const list = await history.listHistory();
    expect(list.seasons).toHaveLength(1);
    expect(list.seasons[0].champion).toBeNull();
    expect(list.seasons[0].mvp).toBeNull();
  });
});

describe('SectSeasonHistoryService.getHistory', () => {
  it('chưa snapshot → throw SNAPSHOT_NOT_FOUND', async () => {
    await expect(history.getHistory('season_2026_s1')).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_FOUND',
    });
  });

  it('detail trả full sect + topMembers theo rank asc', async () => {
    const sectA = await makeSect('SectA');
    const sectB = await makeSect('SectB');
    const uA = await makeUserChar(prisma, { sectId: sectA.id });
    const uB = await makeUserChar(prisma, { sectId: sectB.id });
    const season = sectSeasonByKey('season_2026_s1')!;
    const weekKeys = sectSeasonWeekKeys(season);
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectA.id,
      characterId: uA.characterId,
      points: 500,
    });
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: sectB.id,
      characterId: uB.characterId,
      points: 300,
    });
    await history.snapshotSeason(season.key, { now: AFTER_S1 });

    const detail = await history.getHistory(season.key);
    expect(detail.seasonKey).toBe(season.key);
    expect(detail.totalSects).toBe(2);
    expect(detail.totalContributors).toBe(2);
    expect(detail.totalPoints).toBe(800);
    expect(detail.sects.map((r) => r.rank)).toEqual([1, 2]);
    expect(detail.sects[0].sectId).toBe(sectA.id);
    expect(detail.topMembers.map((m) => m.rank)).toEqual([1, 2]);
    expect(detail.topMembers[0].characterId).toBe(uA.characterId);
  });
});

describe('SectSeasonHistoryService.getHallOfFame', () => {
  it('chưa có snapshot → empty arrays', async () => {
    const hof = await history.getHallOfFame();
    expect(hof.sects).toEqual([]);
    expect(hof.members).toEqual([]);
    expect(hof.totalSeasonsFinalized).toBe(0);
  });

  it('aggregate qua nhiều season: championships/mvps/podiums + sort đúng', async () => {
    const sectA = await makeSect('SectA');
    const sectB = await makeSect('SectB');
    const sectC = await makeSect('SectC');
    const uA = await makeUserChar(prisma, { sectId: sectA.id });
    const uB = await makeUserChar(prisma, { sectId: sectB.id });
    const uC = await makeUserChar(prisma, { sectId: sectC.id });
    const s1 = sectSeasonByKey('season_2026_s1')!;
    const s2 = sectSeasonByKey('season_2026_s2')!;
    const s3 = sectSeasonByKey('season_2026_s3')!;

    // S1: SectA #1 (uA #1), SectB #2 (uB #2), SectC #3 (uC #3)
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s1)[0],
      sectId: sectA.id,
      characterId: uA.characterId,
      points: 500,
    });
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s1)[0],
      sectId: sectB.id,
      characterId: uB.characterId,
      points: 300,
    });
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s1)[0],
      sectId: sectC.id,
      characterId: uC.characterId,
      points: 100,
    });
    await history.snapshotSeason(s1.key, { now: AFTER_S1 });

    // S2: SectA #1 again (uA #1), SectC #2 (uC #2)
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s2)[0],
      sectId: sectA.id,
      characterId: uA.characterId,
      points: 800,
    });
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s2)[0],
      sectId: sectC.id,
      characterId: uC.characterId,
      points: 200,
    });
    await history.snapshotSeason(s2.key, { now: AFTER_S2 });

    // S3: SectB #1 (uB #1), SectA #2 (uA #2)
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s3)[0],
      sectId: sectB.id,
      characterId: uB.characterId,
      points: 700,
    });
    await seedContribution({
      weekKey: sectSeasonWeekKeys(s3)[0],
      sectId: sectA.id,
      characterId: uA.characterId,
      points: 400,
    });
    await history.snapshotSeason(s3.key, { now: AFTER_S3 });

    const hof = await history.getHallOfFame();
    expect(hof.totalSeasonsFinalized).toBe(3);

    // Sects: A 2 ch, B 1 ch, C 0 ch — sort by championships desc.
    expect(hof.sects.map((s) => s.sectId)).toEqual([sectA.id, sectB.id, sectC.id]);
    const a = hof.sects[0];
    expect(a.championships).toBe(2);
    expect(a.podiums).toBe(3); // appeared in S1#1, S2#1, S3#2 — all top3
    expect(a.appearances).toBe(3);
    expect(a.bestRank).toBe(1);
    expect(a.totalPoints).toBe(500 + 800 + 400);
    expect(a.latestSeasonKey).toBe(s3.key);

    const b = hof.sects[1];
    expect(b.championships).toBe(1);
    expect(b.podiums).toBe(2);
    expect(b.appearances).toBe(2);

    const c = hof.sects[2];
    expect(c.championships).toBe(0);
    expect(c.podiums).toBe(2); // S1#3, S2#2
    expect(c.appearances).toBe(2);

    // Members: uA 2 mvps, uB 1 mvp, uC 0 mvps.
    expect(hof.members.map((m) => m.characterId)).toEqual([
      uA.characterId,
      uB.characterId,
      uC.characterId,
    ]);
    const mA = hof.members[0];
    expect(mA.mvps).toBe(2);
    expect(mA.appearances).toBe(3);
    expect(mA.bestRank).toBe(1);
    expect(mA.latestSectName).toBe('SectA');
  });
});
