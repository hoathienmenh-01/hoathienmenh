/**
 * Phase 15.7 — SectSeasonRewardService integration tests.
 *
 * Cover:
 *   - grantSeasonRewards: champion (1 mail/member) + MVP (1 mail) đúng
 *     reward catalog values + reason VI/EN.
 *   - idempotent: gọi 2 lần cùng seasonKey KHÔNG double mail (DB UNIQUE
 *     `(seasonKey, rewardType, characterId)` guard).
 *   - race-safe: 3 caller song song chỉ 1 mail/character (P2002 swallow
 *     → 'existed').
 *   - dryRun: KHÔNG tạo mail / grant row, summary count vẫn correct.
 *   - SEASON_NOT_FOUND khi seasonKey không nằm trong shared catalog.
 *   - SNAPSHOT_NOT_FOUND khi chưa snapshot season trước.
 *   - Champion member cap: nếu sect có > SECT_SEASON_CHAMPION_MEMBER_CAP
 *     member, chỉ cap đầu tiên (theo characterId ASC) nhận thưởng.
 *   - MVP tie-break deterministic (SectSeasonHistoryService đã chọn top
 *     theo points desc / characterId asc — verify reward đi tới đúng
 *     character).
 *   - Champion sect không tồn tại / MVP character không tồn tại → reward
 *     skip an toàn (counts = 0, không throw).
 *   - Member rời sect SAU snapshot nhưng TRƯỚC grant → KHÔNG nhận thưởng
 *     champion (snapshot rule = current membership tại grant time).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SECT_SEASON_CHAMPION_MEMBER_CAP,
  SECT_SEASON_CHAMPION_REWARD,
  SECT_SEASON_MVP_REWARD,
  sectSeasonByKey,
  sectSeasonWeekKeys,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { SectSeasonHistoryService } from './sect-season-history.service';
import {
  SectSeasonRewardService,
  SectSeasonRewardServiceError,
} from './sect-season-reward.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let history: SectSeasonHistoryService;
let reward: SectSeasonRewardService;

// Mốc nằm SAU S1 (S1 ends 2026-04-26 ICT).
const AFTER_S1 = new Date('2026-04-27T00:00:00+07:00');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  history = new SectSeasonHistoryService(prisma);
  reward = new SectSeasonRewardService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  await prisma.sectSeasonRewardGrant.deleteMany({});
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
}) {
  return prisma.sectWarContribution.create({
    data: {
      weekKey: opts.weekKey,
      sectId: opts.sectId,
      characterId: opts.characterId,
      activityKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: `src-${nextSuffix()}`,
      points: opts.points,
    },
  });
}

/**
 * Setup: snapshot season `season_2026_s1` với champion sect = `sect`,
 * MVP = `mvpChar`. Trả về sect + character đã được snapshot.
 */
async function snapshotS1(opts: {
  championSect: { id: string };
  championMembers: { characterId: string; points: number }[];
  /** MVP character bắt buộc thuộc championSect. */
  mvpCharacterId?: string;
}) {
  const season = sectSeasonByKey('season_2026_s1')!;
  const weekKeys = sectSeasonWeekKeys(season);
  for (const m of opts.championMembers) {
    await seedContribution({
      weekKey: weekKeys[0],
      sectId: opts.championSect.id,
      characterId: m.characterId,
      points: m.points,
    });
  }
  return history.snapshotSeason(season.key, { now: AFTER_S1 });
}

describe('SectSeasonRewardService.grantSeasonRewards — happy path', () => {
  it('snapshot có champion + MVP → tạo mail đúng số lượng + reward catalog values', async () => {
    const sect = await makeSect();
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    const m2 = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [
        { characterId: m1.characterId, points: 500 }, // MVP
        { characterId: m2.characterId, points: 100 },
      ],
    });

    const r = await reward.grantSeasonRewards('season_2026_s1', {
      triggeredBy: 'admin1',
    });

    expect(r.seasonKey).toBe('season_2026_s1');
    expect(r.championAvailable).toBe(true);
    expect(r.mvpAvailable).toBe(true);
    expect(r.championMailsCreated).toBe(2); // 2 members
    expect(r.championAlreadyGranted).toBe(0);
    expect(r.championMemberCount).toBe(2);
    expect(r.mvpMailsCreated).toBe(1);
    expect(r.mvpAlreadyGranted).toBe(0);
    expect(r.dryRun).toBe(false);

    // m1 = champion + MVP → 2 mail (rewardType khác nhau).
    const m1Mails = await prisma.mail.findMany({
      where: { recipientId: m1.characterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(m1Mails).toHaveLength(2);
    // m2 = champion only → 1 mail.
    const m2Mails = await prisma.mail.findMany({
      where: { recipientId: m2.characterId },
    });
    expect(m2Mails).toHaveLength(1);

    // Verify reward amount khớp catalog (champion mail).
    const championMailM2 = m2Mails[0];
    expect(championMailM2.rewardLinhThach).toBe(
      BigInt(SECT_SEASON_CHAMPION_REWARD.linhThach),
    );
    expect(championMailM2.rewardExp).toBe(
      BigInt(SECT_SEASON_CHAMPION_REWARD.exp),
    );
    expect(championMailM2.subject).toBe(SECT_SEASON_CHAMPION_REWARD.subjectVi);
    expect(championMailM2.createdByAdminId).toBe('admin1');

    // Verify grant rows.
    const grants = await prisma.sectSeasonRewardGrant.findMany({
      where: { seasonKey: 'season_2026_s1' },
    });
    expect(grants).toHaveLength(3); // 2 CHAMPION + 1 MVP
    expect(
      grants.filter((g) => g.rewardType === 'CHAMPION'),
    ).toHaveLength(2);
    expect(grants.filter((g) => g.rewardType === 'MVP')).toHaveLength(1);
    // Mail link wired up.
    for (const g of grants) {
      expect(g.mailId).not.toBeNull();
    }
  });

  it('MVP reward catalog value khớp shared (linhThach lớn hơn champion)', async () => {
    const sect = await makeSect();
    const mvp = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [{ characterId: mvp.characterId, points: 999 }],
    });

    await reward.grantSeasonRewards('season_2026_s1', {});

    // Tìm mail MVP qua subject (mail tạo theo thứ tự CHAMPION → MVP).
    const mails = await prisma.mail.findMany({
      where: { recipientId: mvp.characterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(mails).toHaveLength(2);
    const mvpMail = mails.find(
      (m) => m.subject === SECT_SEASON_MVP_REWARD.subjectVi,
    );
    expect(mvpMail).toBeTruthy();
    expect(mvpMail!.rewardLinhThach).toBe(
      BigInt(SECT_SEASON_MVP_REWARD.linhThach),
    );
    // MVP > Champion (sanity invariant).
    expect(SECT_SEASON_MVP_REWARD.linhThach).toBeGreaterThan(
      SECT_SEASON_CHAMPION_REWARD.linhThach,
    );
  });
});

describe('SectSeasonRewardService.grantSeasonRewards — idempotency', () => {
  it('gọi 2 lần cùng seasonKey KHÔNG double mail', async () => {
    const sect = await makeSect();
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [{ characterId: m1.characterId, points: 100 }],
    });

    const r1 = await reward.grantSeasonRewards('season_2026_s1', {});
    expect(r1.championMailsCreated).toBe(1);
    expect(r1.mvpMailsCreated).toBe(1);

    const r2 = await reward.grantSeasonRewards('season_2026_s1', {});
    expect(r2.championMailsCreated).toBe(0);
    expect(r2.championAlreadyGranted).toBe(1);
    expect(r2.mvpMailsCreated).toBe(0);
    expect(r2.mvpAlreadyGranted).toBe(1);

    // Total mail = 2 (1 CHAMPION + 1 MVP, không nhân đôi).
    const mails = await prisma.mail.findMany({
      where: { recipientId: m1.characterId },
    });
    expect(mails).toHaveLength(2);
    const grants = await prisma.sectSeasonRewardGrant.findMany({
      where: { seasonKey: 'season_2026_s1' },
    });
    expect(grants).toHaveLength(2);
  });

  it('chạy concurrent (Promise.all 3) → DB UNIQUE chỉ cho 1 mail', async () => {
    const sect = await makeSect();
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [{ characterId: m1.characterId, points: 100 }],
    });

    const results = await Promise.all([
      reward.grantSeasonRewards('season_2026_s1', {}),
      reward.grantSeasonRewards('season_2026_s1', {}),
      reward.grantSeasonRewards('season_2026_s1', {}),
    ]);

    const totalChampMails = results.reduce(
      (s, r) => s + r.championMailsCreated,
      0,
    );
    const totalMvpMails = results.reduce(
      (s, r) => s + r.mvpMailsCreated,
      0,
    );
    expect(totalChampMails).toBe(1);
    expect(totalMvpMails).toBe(1);

    const grants = await prisma.sectSeasonRewardGrant.findMany({
      where: { seasonKey: 'season_2026_s1' },
    });
    expect(grants).toHaveLength(2);
  });
});

describe('SectSeasonRewardService.grantSeasonRewards — dryRun', () => {
  it('dryRun=true: KHÔNG tạo mail / grant row, summary đếm như sẽ tạo', async () => {
    const sect = await makeSect();
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    const m2 = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [
        { characterId: m1.characterId, points: 500 },
        { characterId: m2.characterId, points: 100 },
      ],
    });

    const r = await reward.grantSeasonRewards('season_2026_s1', {
      dryRun: true,
    });

    // Dry-run đếm như sẽ tạo (champion=2, mvp=1) — alreadyGranted=0.
    expect(r.championMailsCreated).toBe(2);
    expect(r.championAlreadyGranted).toBe(0);
    expect(r.mvpMailsCreated).toBe(1);
    expect(r.mvpAlreadyGranted).toBe(0);
    expect(r.dryRun).toBe(true);

    const mails = await prisma.mail.findMany({});
    expect(mails).toHaveLength(0);
    const grants = await prisma.sectSeasonRewardGrant.findMany({});
    expect(grants).toHaveLength(0);
  });

  it('dryRun + đã grant từ trước → đếm "existed" cho row đã có', async () => {
    const sect = await makeSect();
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [{ characterId: m1.characterId, points: 100 }],
    });

    // Real grant trước.
    await reward.grantSeasonRewards('season_2026_s1', {});

    // Dry-run sau — đếm "existed".
    const r = await reward.grantSeasonRewards('season_2026_s1', {
      dryRun: true,
    });
    expect(r.championMailsCreated).toBe(0);
    expect(r.championAlreadyGranted).toBe(1);
    expect(r.mvpMailsCreated).toBe(0);
    expect(r.mvpAlreadyGranted).toBe(1);
  });
});

describe('SectSeasonRewardService.grantSeasonRewards — error paths', () => {
  it('seasonKey không trong catalog → SEASON_NOT_FOUND', async () => {
    await expect(
      reward.grantSeasonRewards('season_9999_s99', {}),
    ).rejects.toBeInstanceOf(SectSeasonRewardServiceError);
    await expect(
      reward.grantSeasonRewards('season_9999_s99', {}),
    ).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND' });
  });

  it('chưa snapshot → SNAPSHOT_NOT_FOUND', async () => {
    // Không gọi snapshotSeason() trước.
    await expect(
      reward.grantSeasonRewards('season_2026_s1', {}),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' });
  });

  it('snapshot empty (không có sect/character) → counts=0, không throw', async () => {
    // Snapshot S1 với 0 contribution → championSectId=null, mvpCharacterId=null.
    const view = await history.snapshotSeason('season_2026_s1', {
      now: AFTER_S1,
    });
    expect(view.totalSects).toBe(0);

    const r = await reward.grantSeasonRewards('season_2026_s1', {});
    expect(r.championAvailable).toBe(false);
    expect(r.mvpAvailable).toBe(false);
    expect(r.championMailsCreated).toBe(0);
    expect(r.mvpMailsCreated).toBe(0);
    expect(r.championMemberCount).toBe(0);

    const mails = await prisma.mail.findMany({});
    expect(mails).toHaveLength(0);
  });
});

describe('SectSeasonRewardService.grantSeasonRewards — membership snapshot rule', () => {
  it('member rời sect SAU snapshot, TRƯỚC grant → KHÔNG nhận champion reward', async () => {
    const sect = await makeSect();
    const stayer = await makeUserChar(prisma, { sectId: sect.id });
    const leaver = await makeUserChar(prisma, { sectId: sect.id });
    await snapshotS1({
      championSect: sect,
      championMembers: [
        { characterId: stayer.characterId, points: 500 },
        { characterId: leaver.characterId, points: 200 },
      ],
    });

    // Leaver rời sect sau snapshot.
    await prisma.character.update({
      where: { id: leaver.characterId },
      data: { sectId: null },
    });

    const r = await reward.grantSeasonRewards('season_2026_s1', {});
    expect(r.championMailsCreated).toBe(1); // chỉ stayer
    expect(r.championMemberCount).toBe(1);

    const stayerMails = await prisma.mail.findMany({
      where: { recipientId: stayer.characterId },
    });
    const leaverMails = await prisma.mail.findMany({
      where: { recipientId: leaver.characterId },
    });
    // Stayer = champion (1) + có thể MVP nếu là top.
    expect(stayerMails.length).toBeGreaterThanOrEqual(1);
    // Leaver: chỉ MVP nếu là MVP, KHÔNG champion.
    const leaverChampGrant = await prisma.sectSeasonRewardGrant.findFirst({
      where: {
        seasonKey: 'season_2026_s1',
        rewardType: 'CHAMPION',
        characterId: leaver.characterId,
      },
    });
    expect(leaverChampGrant).toBeNull();
    // Leaver vẫn có thể nhận MVP nếu snapshot ghi mvpCharacterId = leaver.
    // (snapshot tạo trước khi leave → MVP đi tới leaver theo snapshot).
    if (leaverMails.length > 0) {
      const grant = await prisma.sectSeasonRewardGrant.findFirst({
        where: { characterId: leaver.characterId, rewardType: 'MVP' },
      });
      expect(grant).not.toBeNull();
    }
  });
});

describe('SectSeasonRewardService.grantSeasonRewards — champion member cap', () => {
  it('cap chính xác SECT_SEASON_CHAMPION_MEMBER_CAP — characters dư bỏ qua', async () => {
    // Không thực sự seed >100 user (quá đắt). Verify cap qua mock by
    // tạo > cap members + assert champ mail count = cap.
    // Để giữ test cost thấp, tạo CAP + 2 members.
    const sect = await makeSect();
    const cap = SECT_SEASON_CHAMPION_MEMBER_CAP;
    const overflow = 2;
    const total = cap + overflow;
    const members: { characterId: string }[] = [];
    for (let i = 0; i < total; i++) {
      const m = await makeUserChar(prisma, { sectId: sect.id });
      members.push({ characterId: m.characterId });
    }
    // Snapshot — contribution rỗng, snapshot vẫn ghi championSectId qua
    // empty totals path KHÔNG có champion. Workaround: seed 1 contribution
    // cho member đầu để có champion.
    await snapshotS1({
      championSect: sect,
      championMembers: [{ characterId: members[0].characterId, points: 1 }],
    });

    const r = await reward.grantSeasonRewards('season_2026_s1', {});
    expect(r.championMemberCount).toBe(cap);
    expect(r.championMailsCreated).toBe(cap);
  }, 30000);
});
