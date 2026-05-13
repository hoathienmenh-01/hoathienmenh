import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { WorldCapError, WorldCapService } from './world-cap.service';

/**
 * Phase 26.5 — WorldCapService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB.
 *
 * Coverage:
 *   - consumeDailyTx: upsert + increment + cap enforce.
 *   - consumeWeeklyTx: upsert + increment + cap enforce.
 *   - getDailyUsage / getWeeklyUsage read-only.
 *   - Anti-P2W: cap KHÔNG phụ thuộc entitlement (service layer enforce).
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let cap: WorldCapService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  cap = new WorldCapService(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('Phase 26.5 — WorldCapService.consumeDailyTx', () => {
  it('upsert + increment count/qty', async () => {
    const c = await makeUserChar(prisma);
    const r1 = await prisma.$transaction((tx) =>
      cap.consumeDailyTx(tx, {
        characterId: c.characterId,
        capKey: 'test:foo',
        source: 'TEST',
        countDelta: 1,
        qtyDelta: 10,
      }),
    );
    expect(r1.usedCount).toBe(1);
    expect(r1.usedQty).toBe(10);

    const r2 = await prisma.$transaction((tx) =>
      cap.consumeDailyTx(tx, {
        characterId: c.characterId,
        capKey: 'test:foo',
        source: 'TEST',
        countDelta: 1,
        qtyDelta: 25,
      }),
    );
    expect(r2.usedCount).toBe(2);
    expect(r2.usedQty).toBe(35);
  });

  it('limitCount enforce throw WorldCapError + KHÔNG mutate', async () => {
    const c = await makeUserChar(prisma);
    await prisma.$transaction((tx) =>
      cap.consumeDailyTx(tx, {
        characterId: c.characterId,
        capKey: 'test:cap',
        source: 'TEST',
        limitCount: 2,
        countDelta: 1,
      }),
    );
    await prisma.$transaction((tx) =>
      cap.consumeDailyTx(tx, {
        characterId: c.characterId,
        capKey: 'test:cap',
        source: 'TEST',
        limitCount: 2,
        countDelta: 1,
      }),
    );

    // 3rd attempt exceeds limitCount=2.
    await expect(
      prisma.$transaction((tx) =>
        cap.consumeDailyTx(tx, {
          characterId: c.characterId,
          capKey: 'test:cap',
          source: 'TEST',
          limitCount: 2,
          countDelta: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(WorldCapError);

    const after = await cap.getDailyUsage(c.characterId, 'test:cap');
    expect(after.usedCount).toBe(2);
  });

  it('limitQty enforce throw WorldCapError', async () => {
    const c = await makeUserChar(prisma);
    await expect(
      prisma.$transaction((tx) =>
        cap.consumeDailyTx(tx, {
          characterId: c.characterId,
          capKey: 'test:qty',
          source: 'TEST',
          limitQty: 5,
          qtyDelta: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: 'DAILY_CAP_REACHED' });
  });
});

describe('Phase 26.5 — WorldCapService.consumeWeeklyTx', () => {
  it('upsert + increment count/qty', async () => {
    const c = await makeUserChar(prisma);
    const r = await prisma.$transaction((tx) =>
      cap.consumeWeeklyTx(tx, {
        characterId: c.characterId,
        capKey: 'wk:foo',
        source: 'TEST',
        countDelta: 1,
        qtyDelta: 7,
      }),
    );
    expect(r.usedCount).toBe(1);
    expect(r.usedQty).toBe(7);

    const usage = await cap.getWeeklyUsage(c.characterId, 'wk:foo');
    expect(usage.usedCount).toBe(1);
    expect(usage.usedQty).toBe(7);
  });

  it('limitQty enforce throw WorldCapError WEEKLY_CAP_REACHED', async () => {
    const c = await makeUserChar(prisma);
    await prisma.$transaction((tx) =>
      cap.consumeWeeklyTx(tx, {
        characterId: c.characterId,
        capKey: 'wk:cap',
        source: 'TEST',
        limitQty: 3,
        qtyDelta: 2,
      }),
    );
    await expect(
      prisma.$transaction((tx) =>
        cap.consumeWeeklyTx(tx, {
          characterId: c.characterId,
          capKey: 'wk:cap',
          source: 'TEST',
          limitQty: 3,
          qtyDelta: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'WEEKLY_CAP_REACHED' });
  });
});

describe('Phase 26.5 — WorldCapService.getDailyUsage / getWeeklyUsage', () => {
  it('read-only KHÔNG mutate, default 0 nếu chưa có row', async () => {
    const c = await makeUserChar(prisma);
    const daily = await cap.getDailyUsage(c.characterId, 'never:set');
    expect(daily.usedCount).toBe(0);
    expect(daily.usedQty).toBe(0);

    const weekly = await cap.getWeeklyUsage(c.characterId, 'never:set');
    expect(weekly.usedCount).toBe(0);
    expect(weekly.usedQty).toBe(0);

    const rows = await prisma.dailyContentCap.findMany({
      where: { characterId: c.characterId },
    });
    expect(rows.length).toBe(0);
  });
});
