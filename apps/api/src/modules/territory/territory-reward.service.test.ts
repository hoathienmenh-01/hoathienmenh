/**
 * Phase 14.0.E — TerritoryRewardService integration tests.
 *
 * Cover:
 *   - grant success: winner sect có 2 member → 2 mail + 2 grant row;
 *     mail.rewardLinhThach/Exp/Items match catalog snapshot.
 *   - skip no winner: region không có settlement snapshot → counted in
 *     `skippedNoWinner`, không tạo mail.
 *   - skip no members: winner sect không còn member nào (đã rời) →
 *     `skippedNoMembers`, không tạo mail.
 *   - idempotent: gọi lại cùng `periodKey` → mailsCreated=0,
 *     skippedAlreadyGranted = số grant cũ; KHÔNG tạo mail trùng.
 *   - dryRun: KHÔNG mutate (count "would create" nhưng không insert
 *     grant row, không tạo mail).
 *   - PERIOD_INVALID throw cho periodKey malformed.
 *   - rewardJson snapshot khớp catalog (audit trail).
 *   - sect member join SAU settlement (trước grant) → vẫn nhận mail (rule
 *     "current member tại thời điểm grant").
 *   - race-safe: 2 grant call song song cùng period → mỗi member chỉ 1 mail
 *     (UNIQUE guard P2002).
 *
 * Reuse pattern từ `territory-settlement.service.test.ts` — sử dụng
 * `wipeAll` + `makeUserChar` helper.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  MAP_REGIONS,
  TERRITORY_OWNER_REWARDS,
  territoryOwnerRewardByRegion,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError } from './territory.service';
import { TerritoryRewardService } from './territory-reward.service';
import { TerritorySettlementService } from './territory-settlement.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let reward: TerritoryRewardService;
let settlement: TerritorySettlementService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  settlement = new TerritorySettlementService(prisma);
  reward = new TerritoryRewardService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(name?: string) {
  return prisma.sect.create({
    data: {
      name: name ?? `S-${nextSuffix()}`,
      description: 'Test sect',
    },
  });
}

async function settleRegionForSect(
  regionKey: string,
  periodKey: string,
  sect: { id: string; name: string },
) {
  // Tạo snapshot trực tiếp (skip qua settleRegion để test focus chỉ
  // reward grant — settlement đã có test riêng).
  return prisma.sectTerritorySettlementSnapshot.create({
    data: {
      regionKey,
      periodKey,
      winnerSectId: sect.id,
      winnerSectName: sect.name,
      winnerPoints: 100,
      runnerUpSectId: null,
      runnerUpSectName: null,
      runnerUpPoints: 0,
      totalSects: 1,
      totalPoints: 100,
      settledBy: null,
    },
  });
}

const PERIOD = '2026-W19';

describe('TerritoryRewardService.grantWeeklyOwnerRewardMail', () => {
  it('throws PERIOD_INVALID for malformed periodKey', async () => {
    await expect(
      reward.grantWeeklyOwnerRewardMail('not-a-period'),
    ).rejects.toBeInstanceOf(TerritoryError);
  });

  it('grants mail to all members of winner sect for 1 region', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    const m1 = await makeUserChar(prisma, { sectId: sect.id });
    const m2 = await makeUserChar(prisma, { sectId: sect.id });

    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);

    expect(res.periodKey).toBe(PERIOD);
    expect(res.regionsProcessed).toBe(MAP_REGIONS.length);
    expect(res.mailsCreated).toBe(2);
    expect(res.skippedAlreadyGranted).toBe(0);
    expect(res.skippedNoWinner).toBe(MAP_REGIONS.length - 1);
    expect(res.skippedNoMembers).toBe(0);
    expect(res.dryRun).toBe(false);

    // Verify per-region row
    const sonCocRow = res.regions.find((r) => r.regionKey === 'son_coc');
    expect(sonCocRow).toBeDefined();
    expect(sonCocRow!.mailsCreated).toBe(2);
    expect(sonCocRow!.alreadyGranted).toBe(0);
    expect(sonCocRow!.memberCount).toBe(2);
    expect(sonCocRow!.winnerSectId).toBe(sect.id);
    expect(sonCocRow!.skippedNoWinner).toBe(false);
    expect(sonCocRow!.skippedNoMembers).toBe(false);

    // Verify grant rows
    const grants = await prisma.territoryOwnerRewardGrant.findMany({
      where: { periodKey: PERIOD, regionKey: 'son_coc' },
      orderBy: { characterId: 'asc' },
    });
    expect(grants).toHaveLength(2);
    expect(grants[0].mailId).toBeTruthy();
    expect(grants[1].mailId).toBeTruthy();

    // Verify mail content matches catalog
    const def = territoryOwnerRewardByRegion('son_coc')!;
    const mails = await prisma.mail.findMany({
      where: { recipientId: { in: [m1.characterId, m2.characterId] } },
    });
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(Number(mail.rewardLinhThach)).toBe(def.linhThach);
      expect(Number(mail.rewardExp)).toBe(def.exp);
      const items = mail.rewardItems as Array<{ itemKey: string; qty: number }>;
      expect(items).toHaveLength(def.itemRewards.length);
      for (let i = 0; i < def.itemRewards.length; i++) {
        expect(items[i].itemKey).toBe(def.itemRewards[i].itemKey);
        expect(items[i].qty).toBe(def.itemRewards[i].qty);
      }
      expect(mail.subject).toBe(def.subjectVi);
      expect(mail.body).toBe(def.bodyVi);
    }
  });

  it('skips region with no winner snapshot (skippedNoWinner)', async () => {
    // No snapshot created → all 9 regions skip.
    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(res.mailsCreated).toBe(0);
    expect(res.skippedNoWinner).toBe(MAP_REGIONS.length);
    expect(res.skippedNoMembers).toBe(0);
    expect(res.skippedAlreadyGranted).toBe(0);
    const grants = await prisma.territoryOwnerRewardGrant.findMany();
    expect(grants).toHaveLength(0);
  });

  it('skips winner sect with 0 members (skippedNoMembers)', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    // No member with sectId === sect.id
    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(res.mailsCreated).toBe(0);
    expect(res.skippedNoMembers).toBe(1);
    const sonCocRow = res.regions.find((r) => r.regionKey === 'son_coc');
    expect(sonCocRow!.skippedNoMembers).toBe(true);
    expect(sonCocRow!.memberCount).toBe(0);
  });

  it('idempotent: calling twice with same periodKey does not duplicate mail', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    const m1 = await makeUserChar(prisma, { sectId: sect.id });

    const r1 = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(r1.mailsCreated).toBe(1);

    const r2 = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(r2.mailsCreated).toBe(0);
    expect(r2.skippedAlreadyGranted).toBe(1);

    const mails = await prisma.mail.findMany({
      where: { recipientId: m1.characterId },
    });
    expect(mails).toHaveLength(1);
    const grants = await prisma.territoryOwnerRewardGrant.findMany({
      where: { periodKey: PERIOD, regionKey: 'son_coc' },
    });
    expect(grants).toHaveLength(1);
  });

  it('dryRun does not mutate state', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    await makeUserChar(prisma, { sectId: sect.id });
    await makeUserChar(prisma, { sectId: sect.id });

    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD, {
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.mailsCreated).toBe(2);

    const grants = await prisma.territoryOwnerRewardGrant.findMany();
    expect(grants).toHaveLength(0);
    const mails = await prisma.mail.findMany();
    expect(mails).toHaveLength(0);
  });

  it('member who joined sect AFTER settlement still receives reward at grant time', async () => {
    const sect = await makeSect();
    await settleRegionForSect('hac_lam', PERIOD, sect);
    // Member joins AFTER settlement (snapshot exists, member added later).
    const newMember = await makeUserChar(prisma, { sectId: sect.id });

    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(res.mailsCreated).toBe(1);

    const mails = await prisma.mail.findMany({
      where: { recipientId: newMember.characterId },
    });
    expect(mails).toHaveLength(1);
  });

  it('member who left sect BEFORE grant does not receive reward', async () => {
    const sect = await makeSect();
    await settleRegionForSect('hac_lam', PERIOD, sect);
    const leaver = await makeUserChar(prisma, { sectId: sect.id });
    // Leaver leaves before grant trigger.
    await prisma.character.update({
      where: { id: leaver.characterId },
      data: { sectId: null },
    });

    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(res.skippedNoMembers).toBe(1);
    const mails = await prisma.mail.findMany({
      where: { recipientId: leaver.characterId },
    });
    expect(mails).toHaveLength(0);
  });

  it('rewardJson snapshot matches catalog (audit trail)', async () => {
    const sect = await makeSect();
    await settleRegionForSect('cuu_la_dien', PERIOD, sect);
    await makeUserChar(prisma, { sectId: sect.id });

    await reward.grantWeeklyOwnerRewardMail(PERIOD);

    const grant = await prisma.territoryOwnerRewardGrant.findFirstOrThrow({
      where: { periodKey: PERIOD, regionKey: 'cuu_la_dien' },
    });
    const def = territoryOwnerRewardByRegion('cuu_la_dien')!;
    const json = grant.rewardJson as {
      linhThach: number;
      exp: number;
      itemRewards: Array<{ itemKey: string; qty: number }>;
    };
    expect(json.linhThach).toBe(def.linhThach);
    expect(json.exp).toBe(def.exp);
    expect(json.itemRewards).toEqual(def.itemRewards.map((it) => ({ ...it })));
  });

  it('grants rewards across multiple regions in a single call', async () => {
    const sectA = await makeSect('Tông A');
    const sectB = await makeSect('Tông B');
    await settleRegionForSect('son_coc', PERIOD, sectA);
    await settleRegionForSect('hac_lam', PERIOD, sectB);
    await makeUserChar(prisma, { sectId: sectA.id });
    await makeUserChar(prisma, { sectId: sectB.id });

    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    expect(res.mailsCreated).toBe(2);
    expect(res.skippedNoWinner).toBe(MAP_REGIONS.length - 2);
  });

  it('race-safe: parallel grant calls produce only 1 grant row per (period,region,char)', async () => {
    const sect = await makeSect();
    await settleRegionForSect('son_coc', PERIOD, sect);
    await makeUserChar(prisma, { sectId: sect.id });
    await makeUserChar(prisma, { sectId: sect.id });

    // 3 concurrent calls cùng periodKey — chỉ 1 winner ghi grant per
    // (periodKey, regionKey, characterId). Loser P2002 → skip.
    const results = await Promise.all([
      reward.grantWeeklyOwnerRewardMail(PERIOD),
      reward.grantWeeklyOwnerRewardMail(PERIOD),
      reward.grantWeeklyOwnerRewardMail(PERIOD),
    ]);

    const totalCreated = results.reduce((sum, r) => sum + r.mailsCreated, 0);
    const totalAlreadyGranted = results.reduce(
      (sum, r) => sum + r.skippedAlreadyGranted,
      0,
    );
    expect(totalCreated).toBe(2); // 2 member, mỗi member 1 mail.
    expect(totalAlreadyGranted).toBe(4); // 2 còn lại × 2 call = 4.

    const grants = await prisma.territoryOwnerRewardGrant.findMany({
      where: { periodKey: PERIOD, regionKey: 'son_coc' },
    });
    expect(grants).toHaveLength(2); // unique guard.
    const mails = await prisma.mail.findMany();
    expect(mails).toHaveLength(2);
  });

  it('catalog parity: every MAP_REGIONS region appears in summary regions[]', async () => {
    const res = await reward.grantWeeklyOwnerRewardMail(PERIOD);
    const keys = new Set(res.regions.map((r) => r.regionKey));
    for (const r of MAP_REGIONS) expect(keys.has(r.key)).toBe(true);
    expect(res.regions).toHaveLength(MAP_REGIONS.length);
  });

  it('all 9 reward defs have positive linhThach (sanity)', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      expect(def.linhThach).toBeGreaterThan(0);
    }
    void settlement; // silence lint — settlement reused via beforeAll wiring.
  });
});
