import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BODY_CULTIVATION_STAMINA_PER_TICK,
  bodyRateForRealm,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { BodyCultivationProcessor } from './body-cultivation.processor';

let prisma: PrismaService;
let processor: BodyCultivationProcessor;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  processor = new BodyCultivationProcessor(
    prisma,
    new RealtimeService(),
    new RewardCapService(prisma),
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function bodyTickJob() {
  return {
    name: 'body-tick',
  } as Parameters<BodyCultivationProcessor['process']>[0];
}

describe('BodyCultivationProcessor.process', () => {
  it('grants bodyExp, spends stamina, and records BODY_CULTIVATION cap bucket', async () => {
    const f = await makeUserChar(prisma, {
      bodyCultivating: true,
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: 0n,
      stamina: 10,
    });

    await processor.process(bodyTickJob());

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const bucket = await prisma.characterDailyRewardBucket.findFirstOrThrow({
      where: { characterId: f.characterId, source: 'BODY_CULTIVATION' },
    });
    const expectedGain = BigInt(
      Math.max(1, Math.round(bodyRateForRealm('pham_than'))),
    );
    expect(c.bodyExp).toBe(expectedGain);
    expect(c.stamina).toBe(10 - BODY_CULTIVATION_STAMINA_PER_TICK);
    expect(bucket.expAccum).toBe(expectedGain);
    expect(bucket.linhThachAccum).toBe(0n);
  });

  it('does not tick or make stamina negative when stamina is insufficient', async () => {
    const f = await makeUserChar(prisma, {
      bodyCultivating: true,
      bodyExp: 0n,
      stamina: BODY_CULTIVATION_STAMINA_PER_TICK - 1,
    });

    await processor.process(bodyTickJob());

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const bucketCount = await prisma.characterDailyRewardBucket.count({
      where: { characterId: f.characterId, source: 'BODY_CULTIVATION' },
    });
    expect(c.bodyExp).toBe(0n);
    expect(c.stamina).toBe(BODY_CULTIVATION_STAMINA_PER_TICK - 1);
    expect(bucketCount).toBe(0);
  });

  it('does not exceed the BODY_CULTIVATION daily cap', async () => {
    const f = await makeUserChar(prisma, {
      bodyCultivating: true,
      bodyRealmKey: 'pham_than',
      bodyExp: 0n,
      stamina: 5000,
    });

    for (let i = 0; i < 1200; i += 1) {
      await processor.process(bodyTickJob());
    }

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const bucket = await prisma.characterDailyRewardBucket.findFirstOrThrow({
      where: { characterId: f.characterId, source: 'BODY_CULTIVATION' },
    });
    expect(bucket.expAccum).toBe(3300n);
    expect(c.bodyExp).toBeLessThanOrEqual(3300n);
  });
});
