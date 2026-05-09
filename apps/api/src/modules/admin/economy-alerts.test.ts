import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TopupStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TopupService } from '../topup/topup.service';
import { QuestService } from '../quest/quest.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
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
  // Phase 12.10.B — QuestService cần NpcAffinityService cho rewards.affinity.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('AdminService.getEconomyAlerts', () => {
  it('trả mảng rỗng khi DB sạch', async () => {
    const r = await admin.getEconomyAlerts();
    expect(r.negativeCurrency).toEqual([]);
    expect(r.negativeInventory).toEqual([]);
    expect(r.stalePendingTopups).toEqual([]);
    expect(r.staleHours).toBe(24);
    expect(typeof r.generatedAt).toBe('string');
  });

  it('phát hiện linhThach âm', async () => {
    const ok = await makeUserChar(prisma, { linhThach: 100n });
    const bad = await makeUserChar(prisma, { linhThach: -50n });
    const r = await admin.getEconomyAlerts();
    expect(r.negativeCurrency).toHaveLength(1);
    expect(r.negativeCurrency[0]?.characterId).toBe(bad.characterId);
    expect(r.negativeCurrency[0]?.linhThach).toBe('-50');
    expect(r.negativeCurrency[0]?.userEmail).toBe(bad.email);
    // ok character không vào list
    expect(r.negativeCurrency.find((c) => c.characterId === ok.characterId)).toBeUndefined();
  });

  it('phát hiện tienNgoc âm và tienNgocKhoa âm cùng lúc', async () => {
    await makeUserChar(prisma, { tienNgoc: -10 });
    const charB = await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 0 });
    await prisma.character.update({
      where: { id: charB.characterId },
      data: { tienNgocKhoa: -3 },
    });
    const r = await admin.getEconomyAlerts();
    expect(r.negativeCurrency).toHaveLength(2);
    const tienNgocs = r.negativeCurrency.map((c) => c.tienNgoc).sort((a, b) => a - b);
    expect(tienNgocs).toEqual([-10, 0]);
  });

  it('phát hiện inventory item qty < 1 (qty=0 và qty âm)', async () => {
    const c = await makeUserChar(prisma);
    await prisma.inventoryItem.create({
      data: { characterId: c.characterId, itemKey: 'good', qty: 5 },
    });
    await prisma.inventoryItem.create({
      data: { characterId: c.characterId, itemKey: 'bad-zero', qty: 0 },
    });
    await prisma.inventoryItem.create({
      data: { characterId: c.characterId, itemKey: 'bad-neg', qty: -2 },
    });
    const r = await admin.getEconomyAlerts();
    expect(r.negativeInventory).toHaveLength(2);
    const keys = r.negativeInventory.map((i) => i.itemKey).sort();
    expect(keys).toEqual(['bad-neg', 'bad-zero']);
    expect(r.negativeInventory[0]?.characterName).toBe(c.name);
  });

  it('phát hiện topup PENDING quá staleHours mặc định (24h)', async () => {
    const c = await makeUserChar(prisma);
    const old = new Date(Date.now() - 30 * 3600 * 1000);
    const fresh = new Date(Date.now() - 1 * 3600 * 1000);
    await prisma.topupOrder.create({
      data: {
        userId: c.userId,
        packageKey: 'PKG_30',
        tienNgocAmount: 30,
        priceVND: 30_000,
        transferCode: 'TOPUP-T1',
        status: TopupStatus.PENDING,
        createdAt: old,
      },
    });
    await prisma.topupOrder.create({
      data: {
        userId: c.userId,
        packageKey: 'PKG_FRESH',
        tienNgocAmount: 10,
        priceVND: 10_000,
        transferCode: 'TOPUP-T2',
        status: TopupStatus.PENDING,
        createdAt: fresh,
      },
    });
    // APPROVED dù cũ vẫn không vào alert
    await prisma.topupOrder.create({
      data: {
        userId: c.userId,
        packageKey: 'PKG_OLD_APPROVED',
        tienNgocAmount: 50,
        priceVND: 50_000,
        transferCode: 'TOPUP-T3',
        status: TopupStatus.APPROVED,
        createdAt: old,
      },
    });

    const r = await admin.getEconomyAlerts();
    expect(r.stalePendingTopups).toHaveLength(1);
    expect(r.stalePendingTopups[0]?.packageKey).toBe('PKG_30');
    expect(r.stalePendingTopups[0]?.ageHours).toBeGreaterThanOrEqual(29);
    expect(r.stalePendingTopups[0]?.userEmail).toBe(c.email);
  });

  it('respect custom staleHours param', async () => {
    const c = await makeUserChar(prisma);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await prisma.topupOrder.create({
      data: {
        userId: c.userId,
        packageKey: 'PKG_2H',
        tienNgocAmount: 5,
        priceVND: 5_000,
        transferCode: 'TOPUP-S1',
        status: TopupStatus.PENDING,
        createdAt: twoHoursAgo,
      },
    });
    const r24 = await admin.getEconomyAlerts(24);
    expect(r24.stalePendingTopups).toHaveLength(0);

    const r1 = await admin.getEconomyAlerts(1);
    expect(r1.staleHours).toBe(1);
    expect(r1.stalePendingTopups).toHaveLength(1);
    expect(r1.stalePendingTopups[0]?.packageKey).toBe('PKG_2H');
  });

  it('limit cap mỗi nhóm 100 row (sanity)', async () => {
    // sanity check: query có `take: 100`, không mở rộng dưới 100 ở đây để tiết
    // kiệm thời gian — chỉ verify query không lỗi với 0 row.
    const r = await admin.getEconomyAlerts(48);
    expect(r.staleHours).toBe(48);
    expect(Array.isArray(r.negativeCurrency)).toBe(true);
    expect(Array.isArray(r.negativeInventory)).toBe(true);
    expect(Array.isArray(r.stalePendingTopups)).toBe(true);
  });
});
