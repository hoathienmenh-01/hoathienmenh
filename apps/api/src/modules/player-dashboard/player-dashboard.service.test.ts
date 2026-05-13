import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import {
  DashboardError,
  PlayerDashboardService,
} from './player-dashboard.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: PlayerDashboardService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new PlayerDashboardService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('PlayerDashboardService — Phase 41.0', () => {
  it('returns dashboard with default counters when sub-modules are empty', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    expect(data.character.characterId).toBe(u.characterId);
    expect(data.counters.unreadMail).toBe(0);
    expect(data.counters.unreadNotification).toBe(0);
    expect(data.todayChecklist.length).toBeGreaterThan(0);
  });

  it('today checklist marks START_CULTIVATION DONE when cultivating', async () => {
    const u = await makeUserChar(prisma, { cultivating: true });
    const data = await svc.getDashboard(u.userId);
    const cult = data.todayChecklist.find((c) => c.key === 'START_CULTIVATION');
    expect(cult?.status).toBe('DONE');
  });

  it('counts unread mail correctly', async () => {
    const u = await makeUserChar(prisma);
    await prisma.mail.create({
      data: {
        recipientId: u.characterId,
        subject: 'Test',
        body: 'A piece of test mail content.',
        mailType: 'SYSTEM',
      },
    });
    const data = await svc.getDashboard(u.userId);
    expect(data.counters.unreadMail).toBe(1);
    const claimMail = data.todayChecklist.find((c) => c.key === 'CLAIM_MAIL');
    expect(claimMail?.status).toBe('TODO');
  });

  it('throws NO_CHARACTER when user has no character', async () => {
    const user = await prisma.user.create({
      data: { email: `noc-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    await expect(svc.getDashboard(user.id)).rejects.toBeInstanceOf(DashboardError);
  });
});
