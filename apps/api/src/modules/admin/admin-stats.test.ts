import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role, TopupStatus } from '@prisma/client';
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

describe('AdminService.stats', () => {
  it('trả count 0 khi DB trống', async () => {
    const s = await admin.stats();
    expect(s.users.total).toBe(0);
    expect(s.characters.total).toBe(0);
    expect(s.economy.linhThachCirculating).toBe('0');
    expect(s.economy.tienNgocCirculating).toBe('0');
  });

  it('đếm users + characters + cultivating + bySect + circulating', async () => {
    const sectA = await prisma.sect.upsert({
      where: { name: 'Thanh Vân Môn' },
      create: { name: 'Thanh Vân Môn' },
      update: {},
    });
    const sectB = await prisma.sect.upsert({
      where: { name: 'Huyền Thuỷ Cung' },
      create: { name: 'Huyền Thuỷ Cung' },
      update: {},
    });
    const a = await makeUserChar(prisma, {
      linhThach: 100n,
      tienNgoc: 20,
      sectId: sectA.id,
      cultivating: true,
    });
    const b = await makeUserChar(prisma, {
      linhThach: 200n,
      tienNgoc: 30,
      sectId: sectA.id,
    });
    await makeUserChar(prisma, {
      linhThach: 300n,
      tienNgoc: 0,
      sectId: sectB.id,
    });
    await prisma.user.update({
      where: { id: a.userId },
      data: { role: Role.ADMIN },
    });
    await prisma.user.update({
      where: { id: b.userId },
      data: { banned: true },
    });

    const s = await admin.stats();
    expect(s.users.total).toBe(3);
    expect(s.users.admins).toBe(1);
    expect(s.users.banned).toBe(1);
    expect(s.characters.total).toBe(3);
    expect(s.characters.cultivating).toBe(1);
    expect(s.economy.linhThachCirculating).toBe('600');
    expect(s.economy.tienNgocCirculating).toBe('50');
    expect(s.characters.bySect).toEqual(
      expect.arrayContaining([
        { sectId: sectA.id, name: 'Thanh Vân Môn', count: 2 },
        { sectId: sectB.id, name: 'Huyền Thuỷ Cung', count: 1 },
      ]),
    );
  });

  it('đếm topup theo status', async () => {
    const u = await makeUserChar(prisma);
    const suffix = Date.now().toString(36);
    await prisma.topupOrder.createMany({
      data: [
        {
          userId: u.userId,
          packageKey: 'BASIC_100',
          tienNgocAmount: 100,
          priceVND: 25000,
          transferCode: `T1-${suffix}`,
          status: TopupStatus.PENDING,
        },
        {
          userId: u.userId,
          packageKey: 'BASIC_100',
          tienNgocAmount: 100,
          priceVND: 25000,
          transferCode: `T2-${suffix}`,
          status: TopupStatus.APPROVED,
        },
        {
          userId: u.userId,
          packageKey: 'BASIC_100',
          tienNgocAmount: 100,
          priceVND: 25000,
          transferCode: `T3-${suffix}`,
          status: TopupStatus.REJECTED,
        },
      ],
    });
    const s = await admin.stats();
    expect(s.economy.topupPending).toBe(1);
    expect(s.economy.topupApproved).toBe(1);
    expect(s.economy.topupRejected).toBe(1);
  });
});
