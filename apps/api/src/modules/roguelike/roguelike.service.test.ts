import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind, RoguelikeRunStatus } from '@prisma/client';
import { ROGUELIKE_REALMS, getRoguelikeChoicesForFloor } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeRoguelikeService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { RoguelikeError, RoguelikeService } from './roguelike.service';

let prisma: PrismaService;
let roguelike: RoguelikeService;

const REALM = ROGUELIKE_REALMS[0]!.key;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  ({ roguelike } = makeRoguelikeService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RoguelikeService.start', () => {
  it('creates a seeded active run and blocks parallel active runs', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const run = await roguelike.start(userId, REALM);

    expect(run.status).toBe('ACTIVE');
    expect(run.realmKey).toBe(REALM);
    expect(run.seed).toContain(REALM);
    expect(run.choices.length).toBeGreaterThanOrEqual(1);
    await expect(roguelike.start(userId, REALM)).rejects.toThrow(
      new RoguelikeError('ALREADY_IN_RUN'),
    );
  });

  it('enforces daily entry limit', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    for (let i = 0; i < 3; i += 1) {
      const run = await roguelike.start(userId, REALM);
      await roguelike.abandon(userId, run.id);
    }

    await expect(roguelike.start(userId, REALM)).rejects.toThrow(
      new RoguelikeError('DAILY_LIMIT_REACHED'),
    );
  });
});

describe('RoguelikeService.choose', () => {
  it('advances floors, records history, and keeps buffs scoped to run JSON', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const start = await roguelike.start(userId, REALM);
    const choice = start.choices[0]!;
    const next = await roguelike.choose(userId, start.id, choice.key);

    expect(next.currentFloor).toBe(1);
    expect(next.floorHistory).toHaveLength(1);
    expect(next.floorHistory[0]?.choiceKey).toBe(choice.key);
    const row = await prisma.roguelikeRun.findUniqueOrThrow({
      where: { id: start.id },
      select: { activeBuffs: true },
    });
    expect(row.activeBuffs).toEqual(expect.any(Array));
  });

  it('updates leaderboard when a run reaches completion floor', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
    });
    const started = await roguelike.start(userId, REALM);
    await prisma.roguelikeRun.update({
      where: { id: started.id },
      data: { currentFloor: 9, hp: 100, hpMax: 100 },
    });
    const choice = getRoguelikeChoicesForFloor(10, started.seed)[0]!;
    const run = await roguelike.choose(userId, started.id, choice.key);

    expect(run.status).toBe('COMPLETED');
    const board = await prisma.roguelikeLeaderboard.findUnique({
      where: { characterId },
    });
    expect(board?.bestFloor).toBe(run.currentFloor);
    expect(board?.bestScore).toBe(run.score);
  });
});

describe('RoguelikeService.claim', () => {
  async function completedRun(userId: string) {
    const started = await roguelike.start(userId, REALM);
    await prisma.roguelikeRun.update({
      where: { id: started.id },
      data: { currentFloor: 9, hp: 100, hpMax: 100 },
    });
    const choice = getRoguelikeChoicesForFloor(10, started.seed)[0]!;
    const run = await roguelike.choose(userId, started.id, choice.key);
    return run;
  }

  it('claims once via CAS and grants only one currency ledger row', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
    });
    const run = await completedRun(userId);
    const result = await roguelike.claim(userId, run.id);

    expect(result.granted.linhThach).toBeGreaterThan(0);
    await expect(roguelike.claim(userId, run.id)).rejects.toThrow(
      new RoguelikeError('RUN_ALREADY_CLAIMED'),
    );
    const ledgers = await prisma.currencyLedger.findMany({
      where: {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        refType: 'RoguelikeRun',
        refId: run.id,
      },
    });
    expect(ledgers).toHaveLength(1);
    const stored = await prisma.roguelikeRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(stored.status).toBe(RoguelikeRunStatus.CLAIMED);
  });

  it('enforces weekly claim cap', async () => {
    const { userId, characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
    });
    for (let i = 0; i < 14; i += 1) {
      await prisma.roguelikeRun.create({
        data: {
          characterId,
          realmKey: REALM,
          status: RoguelikeRunStatus.COMPLETED,
          seed: `seed-${i}`,
          currentFloor: 10,
          hp: 1,
          hpMax: 100,
          score: 100 + i,
          rewardPreview: { linhThach: 1, exp: 1, items: [], milestoneFloors: [10] },
          completedAt: new Date(),
        },
      });
    }
    const runs = await prisma.roguelikeRun.findMany({
      where: { characterId },
      orderBy: { seed: 'asc' },
    });
    for (const run of runs) {
      await roguelike.claim(userId, run.id);
    }
    const blocked = await prisma.roguelikeRun.create({
      data: {
        characterId,
        realmKey: REALM,
        status: RoguelikeRunStatus.COMPLETED,
        seed: 'seed-over-cap',
        currentFloor: 10,
        hp: 1,
        hpMax: 100,
        score: 999,
        rewardPreview: { linhThach: 1, exp: 1, items: [], milestoneFloors: [10] },
        completedAt: new Date(),
      },
    });

    await expect(roguelike.claim(userId, blocked.id)).rejects.toThrow(
      new RoguelikeError('WEEKLY_CAP_REACHED'),
    );
  });
});
