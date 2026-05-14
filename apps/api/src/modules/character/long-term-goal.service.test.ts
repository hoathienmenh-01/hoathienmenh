import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { LongTermGoalService } from './long-term-goal.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: LongTermGoalService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new LongTermGoalService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('LongTermGoalService.incrementProgress', () => {
  it('increments progress and completes once capped at goalAmount', async () => {
    const ctx = await makeUserChar(prisma);
    const r1 = await svc.incrementProgress(
      ctx.characterId,
      'dao_path_ten_breakthroughs',
      4,
    );
    expect(r1.progress).toBe(4);
    expect(r1.completedAt).toBeNull();
    expect(r1.justCompleted).toBe(false);

    const r2 = await svc.incrementProgress(
      ctx.characterId,
      'dao_path_ten_breakthroughs',
      20,
    );
    expect(r2.progress).toBe(10);
    expect(r2.completedAt).toBeInstanceOf(Date);
    expect(r2.justCompleted).toBe(true);

    const r3 = await svc.incrementProgress(
      ctx.characterId,
      'dao_path_ten_breakthroughs',
      1,
    );
    expect(r3.progress).toBe(10);
    expect(r3.completedAt?.getTime()).toBe(r2.completedAt?.getTime());
    expect(r3.justCompleted).toBe(false);
  });

  it('trackEvent updates matching goals only', async () => {
    const ctx = await makeUserChar(prisma);
    const updated = await svc.trackEvent(ctx.characterId, 'CLEAR_DUNGEON', 1);
    expect(updated.map((r) => r.goalKey)).toEqual([
      'secret_realm_first_clear',
      'secret_realm_hundred_clears',
    ]);
    const rows = await svc.list(ctx.characterId);
    expect(rows.find((r) => r.goalKey === 'secret_realm_first_clear')?.progress).toBe(1);
    expect(rows.find((r) => r.goalKey === 'boss_hunter_foundation')?.progress).toBe(0);
  });

  it('rejects invalid key, invalid amount and missing character', async () => {
    const ctx = await makeUserChar(prisma);
    await expect(
      svc.incrementProgress(ctx.characterId, 'missing_goal', 1),
    ).rejects.toMatchObject({ code: 'GOAL_NOT_FOUND' });
    await expect(
      svc.incrementProgress(ctx.characterId, 'secret_realm_first_clear', 0),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(
      svc.incrementProgress('missing_character', 'secret_realm_first_clear', 1),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});
