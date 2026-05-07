/**
 * Phase 13.1.A — SectWarService integration tests.
 *
 * Cover: contribution idempotency, cap enforcement, leaderboard ordering,
 * claim race-safety, error mapping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { sectWarWeekKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { SectWarService, SectWarError } from './sect-war.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let currency: CurrencyService;
let sectWar: SectWarService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  sectWar = new SectWarService(prisma, currency);
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

describe('SectWarService.addContributionTx', () => {
  it('character không có sect → no-op (return null, không insert row)', async () => {
    const u = await makeUserChar(prisma);
    const res = await prisma.$transaction((tx) =>
      sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      }),
    );
    expect(res).toBeNull();
    const rows = await prisma.sectWarContribution.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('character có sect → ghi 1 row contribution', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const res = await prisma.$transaction((tx) =>
      sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      }),
    );
    expect(res).not.toBeNull();
    expect(res!.sectId).toBe(sect.id);
    const rows = await prisma.sectWarContribution.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].activityKey).toBe('dungeon_clear');
    expect(rows[0].sourceId).toBe('dr-1');
    expect(rows[0].points).toBeGreaterThan(0);
  });

  it('idempotency: cùng activity + sourceId 2 lần → chỉ 1 row, lần 2 trả null', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const a = await prisma.$transaction((tx) =>
      sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-x',
      }),
    );
    const b = await prisma.$transaction((tx) =>
      sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-x',
      }),
    );
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const rows = await prisma.sectWarContribution.findMany({});
    expect(rows).toHaveLength(1);
  });

  it('activity không tồn tại → no-op', async () => {
    const sect = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sect.id });
    const res = await prisma.$transaction((tx) =>
      // @ts-expect-error — intentional invalid activity key
      sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'invalid_activity_key',
        sourceId: 'x',
      }),
    );
    expect(res).toBeNull();
    const rows = await prisma.sectWarContribution.findMany({});
    expect(rows).toHaveLength(0);
  });
});

describe('SectWarService.getLeaderboard', () => {
  it('aggregate theo sectId, descending điểm, tie-break sectId asc', async () => {
    const sectA = await makeSect(prisma);
    const sectB = await makeSect(prisma);
    const uA1 = await makeUserChar(prisma, { sectId: sectA.id });
    const uA2 = await makeUserChar(prisma, { sectId: sectA.id });
    const uB1 = await makeUserChar(prisma, { sectId: sectB.id });

    await prisma.$transaction(async (tx) => {
      await sectWar.addContributionTx(tx, {
        characterId: uA1.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await sectWar.addContributionTx(tx, {
        characterId: uA2.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-2',
      });
      await sectWar.addContributionTx(tx, {
        characterId: uB1.characterId,
        activityKey: 'daily_login',
        sourceId: 'd-1',
      });
    });

    const lb = await sectWar.getLeaderboard();
    expect(lb.rows).toHaveLength(2);
    // SectA có 2 dungeon_clear contribs > SectB 1 daily_login
    expect(lb.rows[0].sectId).toBe(sectA.id);
    expect(lb.rows[0].rank).toBe(1);
    expect(lb.rows[0].contributors).toBe(2);
    expect(lb.rows[1].sectId).toBe(sectB.id);
    expect(lb.rows[1].rank).toBe(2);
    expect(lb.rows[1].contributors).toBe(1);
  });

  it('weekKey không có row → rows rỗng', async () => {
    const lb = await sectWar.getLeaderboard();
    expect(lb.rows).toHaveLength(0);
    expect(lb.weekKey).toBeTruthy();
  });
});

describe('SectWarService.getMyStatus', () => {
  it('không có character → throw NO_CHARACTER', async () => {
    await expect(sectWar.getMyStatus('non-existent-user-id')).rejects.toBeInstanceOf(
      SectWarError,
    );
  });

  it('character không có sect → hasSect=false, breakdown rỗng', async () => {
    const u = await makeUserChar(prisma);
    const status = await sectWar.getMyStatus(u.userId);
    expect(status.hasSect).toBe(false);
    expect(status.sectId).toBeNull();
    expect(status.breakdown).toHaveLength(0);
    expect(status.canClaim).toBe(false);
  });

  it('character có sect + contributions → breakdown + sectRank correct', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    await prisma.$transaction(async (tx) => {
      await sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
      await sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'daily_login',
        sourceId: 'd-1',
      });
    });

    const status = await sectWar.getMyStatus(u.userId);
    expect(status.hasSect).toBe(true);
    expect(status.sectId).toBe(sectA.id);
    expect(status.breakdown).toHaveLength(2);
    expect(status.personalPoints).toBeGreaterThan(0);
    expect(status.sectRank).toBe(1);
  });
});

describe('SectWarService.claimWeeklyReward', () => {
  it('character không có sect → SECT_REQUIRED', async () => {
    const u = await makeUserChar(prisma);
    await expect(sectWar.claimWeeklyReward(u.userId)).rejects.toMatchObject({
      code: 'SECT_REQUIRED',
    });
  });

  it('sect không có contribution tuần đó → SECT_WAR_NOT_CLAIMABLE', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    await expect(sectWar.claimWeeklyReward(u.userId)).rejects.toMatchObject({
      code: 'SECT_WAR_NOT_CLAIMABLE',
    });
  });

  it('eligible → grant currency + ghi claim row + ledger SECT_WAR_REWARD', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id, linhThach: 0n });
    // Bơm contribution để rank=1
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 5; i++) {
        await sectWar.addContributionTx(tx, {
          characterId: u.characterId,
          activityKey: 'dungeon_clear',
          sourceId: `dr-${i}`,
        });
      }
    });

    const res = await sectWar.claimWeeklyReward(u.userId);
    expect(res.sectRank).toBe(1);
    expect(res.granted.linhThach).toBeGreaterThan(0);
    expect(res.weekKey).toBe(sectWarWeekKey(new Date()));

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
    });
    expect(c.linhThach).toBeGreaterThan(0n);

    const claim = await prisma.sectWarWeeklyRewardClaim.findFirst({
      where: { characterId: u.characterId },
    });
    expect(claim).not.toBeNull();
    expect(claim!.rewardTierKey).toBe(res.rewardTierKey);

    if (res.granted.linhThach > 0) {
      const ledger = await prisma.currencyLedger.findFirst({
        where: {
          characterId: u.characterId,
          reason: 'SECT_WAR_REWARD',
          currency: CurrencyKind.LINH_THACH,
        },
      });
      expect(ledger).not.toBeNull();
      expect(ledger!.refType).toBe('SectWarWeeklyRewardClaim');
    }
  });

  it('claim 2 lần liên tiếp → SECT_WAR_ALREADY_CLAIMED', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    await prisma.$transaction(async (tx) => {
      await sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
    });
    await sectWar.claimWeeklyReward(u.userId);
    await expect(sectWar.claimWeeklyReward(u.userId)).rejects.toMatchObject({
      code: 'SECT_WAR_ALREADY_CLAIMED',
    });
  });

  it('concurrent claim race: 2 promise đồng thời → chỉ 1 success', async () => {
    const sectA = await makeSect(prisma);
    const u = await makeUserChar(prisma, { sectId: sectA.id });
    await prisma.$transaction(async (tx) => {
      await sectWar.addContributionTx(tx, {
        characterId: u.characterId,
        activityKey: 'dungeon_clear',
        sourceId: 'dr-1',
      });
    });

    const [a, b] = await Promise.allSettled([
      sectWar.claimWeeklyReward(u.userId),
      sectWar.claimWeeklyReward(u.userId),
    ]);
    const results = [a, b];
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const claims = await prisma.sectWarWeeklyRewardClaim.findMany({
      where: { characterId: u.characterId },
    });
    expect(claims).toHaveLength(1);
  });
});
