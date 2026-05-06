import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TopupStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const quests = new QuestService(prisma, currency, inventory);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

async function seedOrders(): Promise<{ uA: string; uB: string }> {
  const a = await makeUserChar(prisma);
  const b = await makeUserChar(prisma);
  // Topup ngày 1/4: a 30K + b 10K (PENDING)
  await prisma.topupOrder.create({
    data: {
      userId: a.userId,
      packageKey: 'P30',
      tienNgocAmount: 30,
      priceVND: 30_000,
      transferCode: 'T-A1',
      status: TopupStatus.PENDING,
      createdAt: new Date('2026-04-01T10:00:00Z'),
    },
  });
  await prisma.topupOrder.create({
    data: {
      userId: b.userId,
      packageKey: 'P10',
      tienNgocAmount: 10,
      priceVND: 10_000,
      transferCode: 'T-B1',
      status: TopupStatus.PENDING,
      createdAt: new Date('2026-04-01T11:00:00Z'),
    },
  });
  // Topup ngày 15/4: a 50K APPROVED
  await prisma.topupOrder.create({
    data: {
      userId: a.userId,
      packageKey: 'P50',
      tienNgocAmount: 50,
      priceVND: 50_000,
      transferCode: 'T-A2',
      status: TopupStatus.APPROVED,
      createdAt: new Date('2026-04-15T08:00:00Z'),
      approvedAt: new Date('2026-04-15T09:00:00Z'),
    },
  });
  // Topup ngày 28/4: b 100K REJECTED
  await prisma.topupOrder.create({
    data: {
      userId: b.userId,
      packageKey: 'P100',
      tienNgocAmount: 100,
      priceVND: 100_000,
      transferCode: 'T-B2',
      status: TopupStatus.REJECTED,
      createdAt: new Date('2026-04-28T20:00:00Z'),
    },
  });
  return { uA: a.userId, uB: b.userId };
}

describe('AdminService.listTopups (G19 — filter status / dateRange / userEmail)', () => {
  it('không filter → 4 đơn', async () => {
    await seedOrders();
    const r = await admin.listTopups(null, 0);
    expect(r.total).toBe(4);
  });

  it('status=PENDING → 2 đơn', async () => {
    await seedOrders();
    const r = await admin.listTopups(TopupStatus.PENDING, 0);
    expect(r.total).toBe(2);
  });

  it('fromDate=2026-04-10 → 2 đơn (15/4 + 28/4)', async () => {
    await seedOrders();
    const r = await admin.listTopups(null, 0, {
      fromDate: new Date('2026-04-10T00:00:00Z'),
    });
    expect(r.total).toBe(2);
  });

  it('toDate=2026-04-10 → 2 đơn (cả 2 ngày 1/4)', async () => {
    await seedOrders();
    const r = await admin.listTopups(null, 0, {
      toDate: new Date('2026-04-10T00:00:00Z'),
    });
    expect(r.total).toBe(2);
  });

  it('range 2026-04-10 → 2026-04-20 → 1 đơn (15/4)', async () => {
    await seedOrders();
    const r = await admin.listTopups(null, 0, {
      fromDate: new Date('2026-04-10T00:00:00Z'),
      toDate: new Date('2026-04-20T00:00:00Z'),
    });
    expect(r.total).toBe(1);
  });

  it('userEmail substring → đúng user', async () => {
    const seeded = await seedOrders();
    const userA = await prisma.user.findUnique({ where: { id: seeded.uA } });
    expect(userA).not.toBeNull();
    const r = await admin.listTopups(null, 0, { userEmail: userA!.email });
    expect(r.total).toBe(2); // 30K PENDING + 50K APPROVED của A
    expect(r.rows.every((x) => x.userEmail === userA!.email)).toBe(true);
  });

  it('combine status=PENDING + dateRange + email', async () => {
    const seeded = await seedOrders();
    const userA = await prisma.user.findUnique({ where: { id: seeded.uA } });
    expect(userA).not.toBeNull();
    const r = await admin.listTopups(TopupStatus.PENDING, 0, {
      fromDate: new Date('2026-03-01T00:00:00Z'),
      toDate: new Date('2026-04-10T00:00:00Z'),
      userEmail: userA!.email,
    });
    expect(r.total).toBe(1); // chỉ 30K PENDING ngày 1/4 của A
    expect(r.rows[0].userEmail).toBe(userA!.email);
  });

  it('userEmail không match → 0', async () => {
    await seedOrders();
    const r = await admin.listTopups(null, 0, { userEmail: 'nope@nope.local' });
    expect(r.total).toBe(0);
  });
});
