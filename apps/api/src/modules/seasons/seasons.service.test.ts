import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind, SeasonLeaderboardKind, SeasonStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { WorldCapService } from '../world-content/world-cap.service';
import { SeasonsService, SeasonError } from './seasons.service';

let prisma: PrismaService;
let seasons: SeasonsService;

const pointConfig = {
  dailyCap: 100,
  weeklyCap: 160,
  sourcePoints: {
    ROGUELIKE: 30,
    BOSS: 20,
    DUNGEON: 10,
    CRAFT: 5,
    BREAKTHROUGH: 25,
    DAILY: 15,
    EVENT: 30,
  },
};

const rewardConfig = [
  {
    rewardKey: 'starter',
    minPoints: 50,
    titleVi: 'Mốc 50',
    titleEn: 'Tier 50',
    linhThach: 80,
    exp: 20,
    eventToken: 1,
    items: [],
  },
];

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DAILY_REWARD_CAP_TZ = 'UTC';
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, null as never, null as never);
  seasons = new SeasonsService(
    prisma,
    currency,
    inventory,
    new RewardCapService(prisma),
    new WorldCapService(prisma),
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSeason(status: SeasonStatus = SeasonStatus.ACTIVE) {
  return prisma.serverSeason.create({
    data: {
      seasonKey: `s-${status.toLowerCase()}-${Date.now()}`,
      name: `Season ${status}`,
      description: 'test',
      status,
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date('2026-12-31T00:00:00.000Z'),
      pointConfig,
      rewardConfig,
      milestoneConfig: [
        {
          milestoneKey: 'boss-2',
          metric: 'BOSS_DEFEATS',
          target: 2,
          titleVi: 'Hạ boss',
          titleEn: 'Defeat bosses',
          effectKey: 'minor_event',
          effectVi: 'Mở event nhỏ',
          effectEn: 'Unlock minor event',
        },
      ],
    },
  });
}

describe('SeasonsService seasons', () => {
  it('keeps only one active season', async () => {
    await createSeason(SeasonStatus.ACTIVE);
    await expect(
      seasons.createSeason({
        seasonKey: 'second-active',
        name: 'Second',
        description: '',
        status: SeasonStatus.ACTIVE,
        startAt: new Date('2026-01-01T00:00:00.000Z'),
        endAt: new Date('2026-12-31T00:00:00.000Z'),
      }),
    ).rejects.toThrow(new SeasonError('SEASON_ALREADY_ACTIVE'));
  });

  it('ended seasons do not accept new points', async () => {
    await createSeason(SeasonStatus.ENDED);
    const { characterId } = await makeUserChar(prisma);

    await expect(
      seasons.addPoints(
        characterId,
        'BOSS',
        20,
        {},
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).resolves.toBeNull();
  });
});

describe('SeasonsService points and leaderboard', () => {
  it('adds points, enforces caps, and updates leaderboards', async () => {
    await createSeason();
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);

    await seasons.addPoints(a.characterId, 'ROGUELIKE', 30, { floor: 8, score: 80 });
    await seasons.addPoints(a.characterId, 'BOSS', 20);
    await seasons.addPoints(b.characterId, 'BOSS', 20);

    const progress = await seasons.progress(a.userId);
    expect(progress.progress?.points).toBe(50);
    expect(progress.progress?.bestRoguelikeFloor).toBe(8);
    expect(progress.progress?.bossDefeats).toBe(1);

    const pointsBoard = await seasons.leaderboard(SeasonLeaderboardKind.POINTS);
    expect(pointsBoard.entries[0]?.characterId).toBe(a.characterId);
    expect(pointsBoard.entries[0]?.score).toBe(50);

    const floorBoard = await seasons.leaderboard(
      SeasonLeaderboardKind.ROGUELIKE_FLOOR,
    );
    expect(floorBoard.entries[0]?.score).toBe(8);

    const capped = await seasons.addPoints(a.characterId, 'EVENT', 120);
    expect(capped).toMatchObject({ granted: 0, points: 50, capped: true });
  });

  it('records server milestone progress', async () => {
    await createSeason();
    const { characterId } = await makeUserChar(prisma);

    await seasons.addPoints(characterId, 'BOSS', 20);
    await seasons.addPoints(characterId, 'BOSS', 20);

    const view = await seasons.serverMilestones();
    expect(view.milestones[0]?.progress).toBe(2);
    expect(view.milestones[0]?.unlockedAt).toEqual(expect.any(String));
  });
});

describe('SeasonsService rewards', () => {
  it('claims season reward once and avoids duplicate grants', async () => {
    await createSeason();
    const { userId, characterId } = await makeUserChar(prisma, { linhThach: 0n });
    await seasons.addPoints(characterId, 'EVENT', 50);

    const claim = await seasons.claimReward(userId, 'starter');
    expect(claim.granted.linhThach).toBe(80);

    await expect(seasons.claimReward(userId, 'starter')).rejects.toThrow(
      new SeasonError('REWARD_ALREADY_CLAIMED'),
    );
    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        reason: 'SEASON_REWARD',
      },
    });
    expect(ledger).toHaveLength(1);
  });
});
