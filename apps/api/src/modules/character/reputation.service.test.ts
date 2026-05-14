import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { ReputationService } from './reputation.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: ReputationService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new ReputationService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ReputationService.addReputation', () => {
  it('adds score and returns catalog-backed row', async () => {
    const ctx = await makeUserChar(prisma);
    const row = await svc.addReputation(ctx.characterId, 'TIEN_DAO', 40);
    expect(row.group).toBe('TIEN_DAO');
    expect(row.score).toBe(40);
    expect(row.dailyGain).toBe(40);
    expect(row.dailyCap).toBe(300);
    expect(row.appliedAmount).toBe(40);
    expect(row.capped).toBe(false);
    expect(row.def.nameVi).toBe('Tiên Đạo');
  });

  it('caps same-day reputation at group dailyCap', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.addReputation(ctx.characterId, 'TIEN_DAO', 250);
    const capped = await svc.addReputation(ctx.characterId, 'TIEN_DAO', 100);
    expect(capped.score).toBe(300);
    expect(capped.dailyGain).toBe(300);
    expect(capped.appliedAmount).toBe(50);
    expect(capped.capped).toBe(true);
  });

  it('list returns all groups with zero defaults', async () => {
    const ctx = await makeUserChar(prisma);
    await svc.addReputation(ctx.characterId, 'DAN_DAO', 25);
    const rows = await svc.list(ctx.characterId);
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.group === 'DAN_DAO')?.score).toBe(25);
    expect(rows.find((r) => r.group === 'CHIEN_DAU')?.score).toBe(0);
  });

  it('rejects invalid amount and missing character', async () => {
    const ctx = await makeUserChar(prisma);
    await expect(
      svc.addReputation(ctx.characterId, 'TIEN_DAO', 0),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(
      svc.addReputation('missing_character', 'TIEN_DAO', 1),
    ).rejects.toMatchObject({ code: 'CHARACTER_NOT_FOUND' });
  });
});
