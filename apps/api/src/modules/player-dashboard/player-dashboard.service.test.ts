import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import {
  DashboardError,
  PlayerDashboardService,
} from './player-dashboard.service';
import { TEST_DATABASE_URL, makeUserChar, nextSuffix, wipeAll } from '../../test-helpers';

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

describe('PlayerDashboardService — Phase 44.2 dynamic checklist', () => {
  it('RUN_FARM is DONE when active farm session exists', async () => {
    const u = await makeUserChar(prisma);
    await prisma.farmSession.create({
      data: {
        characterId: u.characterId,
        farmMapKey: 'khu_1_linh_mach',
        status: 'ACTIVE',
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'RUN_FARM');
    expect(item?.status).toBe('DONE');
    expect(item?.priority).toBe('LOW');
  });

  it('RUN_FARM is TODO when no active farm session', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'RUN_FARM');
    expect(item?.status).toBe('TODO');
  });

  it('CLEAR_DUNGEON is DONE when active dungeon run exists', async () => {
    const u = await makeUserChar(prisma);
    await prisma.dungeonRun.create({
      data: {
        characterId: u.characterId,
        templateKey: 'son_coc',
        status: 'ACTIVE',
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CLEAR_DUNGEON');
    expect(item?.status).toBe('DONE');
  });

  it('CLEAR_DUNGEON is TODO when no active dungeon run', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CLEAR_DUNGEON');
    expect(item?.status).toBe('TODO');
  });

  it('CLIMB_TOWER is DONE when tower attempt exists today', async () => {
    const u = await makeUserChar(prisma);
    await prisma.trialTowerAttemptLog.create({
      data: {
        characterId: u.characterId,
        towerKey: 'dang_tien_thap',
        floor: 1,
        success: true,
        battlePowerSnapshot: 100,
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CLIMB_TOWER');
    expect(item?.status).toBe('DONE');
  });

  it('CLIMB_TOWER is TODO when no tower attempt today', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CLIMB_TOWER');
    expect(item?.status).toBe('TODO');
  });

  it('CHECK_MARKET is DONE when active auction exists', async () => {
    const u = await makeUserChar(prisma);
    const now = new Date();
    const future = new Date(now.getTime() + 86400000);
    await prisma.marketAuction.create({
      data: {
        sellerCharacterId: u.characterId,
        itemKey: 'linh_thach',
        quantity: 10,
        currency: 'LINH_THACH',
        startPrice: BigInt(100),
        minBidStep: BigInt(10),
        status: 'ACTIVE',
        startsAt: now,
        endsAt: future,
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CHECK_MARKET');
    expect(item?.status).toBe('DONE');
  });

  it('CHECK_MARKET is TODO when no active auction', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'CHECK_MARKET');
    expect(item?.status).toBe('TODO');
  });

  it('JOIN_SECT_ACTIVITY is DONE when sect contribution exists today', async () => {
    const u = await makeUserChar(prisma);
    const sect = await prisma.sect.create({
      data: { name: `S-${nextSuffix()}`, description: '', level: 1, leaderId: u.characterId },
    });
    await prisma.character.update({ where: { id: u.characterId }, data: { sectId: sect.id } });
    await prisma.sectWarContribution.create({
      data: {
        characterId: u.characterId,
        sectId: sect.id,
        weekKey: '2026-W21',
        activityKey: 'BOSS_KILL',
        sourceType: 'SectBoss',
        points: 20,
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'JOIN_SECT_ACTIVITY');
    expect(item?.status).toBe('DONE');
  });

  it('JOIN_SECT_ACTIVITY is TODO when no contribution today', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'JOIN_SECT_ACTIVITY');
    expect(item?.status).toBe('TODO');
  });

  it('READ_MENTOR_REQUEST is TODO when pending mentor request exists', async () => {
    const u = await makeUserChar(prisma);
    const student = await makeUserChar(prisma);
    await prisma.mentorRelation.create({
      data: {
        mentorUserId: u.userId,
        studentUserId: student.userId,
        status: 'PENDING',
      },
    });
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'READ_MENTOR_REQUEST');
    expect(item?.status).toBe('TODO');
    expect(item?.priority).toBe('MEDIUM');
  });

  it('READ_MENTOR_REQUEST is DONE when no pending mentor requests', async () => {
    const u = await makeUserChar(prisma);
    const data = await svc.getDashboard(u.userId);
    const item = data.todayChecklist.find((c) => c.key === 'READ_MENTOR_REQUEST');
    expect(item?.status).toBe('DONE');
  });
});
