import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { AdminOverviewService } from './admin-overview.service';

let prisma: PrismaService;
let overview: AdminOverviewService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  overview = new AdminOverviewService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AdminOverviewService.getSnapshot', () => {
  it('returns snapshot with all required fields', async () => {
    const snap = await overview.getSnapshot();
    expect(snap).toHaveProperty('totalUsers');
    expect(snap).toHaveProperty('activeUsersToday');
    expect(snap).toHaveProperty('activeCharacters');
    expect(snap).toHaveProperty('newUsersToday');
    expect(snap).toHaveProperty('currencyMintedTodayLinhThach');
    expect(snap).toHaveProperty('currencySpentTodayLinhThach');
    expect(snap).toHaveProperty('rareDropsToday');
    expect(snap).toHaveProperty('farmSessionsToday');
    expect(snap).toHaveProperty('dungeonRunsToday');
    expect(snap).toHaveProperty('bossKillsToday');
    expect(snap).toHaveProperty('towerAttemptsToday');
    expect(snap).toHaveProperty('battlePassActiveSeason');
    expect(snap).toHaveProperty('monthlyCardActiveCount');
    expect(snap).toHaveProperty('suspiciousEventsCount');
    expect(snap).toHaveProperty('pendingTopupsCount');
    expect(snap).toHaveProperty('activeFeatureFlags');
    expect(snap).toHaveProperty('activeEvents');
    expect(snap).toHaveProperty('maintenanceStatus');
    expect(snap).toHaveProperty('generatedAt');
  });

  it('returns zero counts for empty database', async () => {
    const snap = await overview.getSnapshot();
    expect(snap.totalUsers).toBe(0);
    expect(snap.activeCharacters).toBe(0);
    expect(snap.activeUsersToday).toBe(0);
    expect(snap.newUsersToday).toBe(0);
  });

  it('counts users after creation', async () => {
    await makeUserChar(prisma);
    await makeUserChar(prisma);
    const snap = await overview.getSnapshot();
    expect(snap.totalUsers).toBe(2);
    expect(snap.activeCharacters).toBe(2);
  });

  it('returns valid maintenanceStatus', async () => {
    const snap = await overview.getSnapshot();
    expect(['ACTIVE', 'SCHEDULED', 'NONE']).toContain(snap.maintenanceStatus);
  });

  it('returns valid generatedAt ISO string', async () => {
    const snap = await overview.getSnapshot();
    expect(() => new Date(snap.generatedAt)).not.toThrow();
    expect(new Date(snap.generatedAt).getTime()).toBeGreaterThan(0);
  });
});
