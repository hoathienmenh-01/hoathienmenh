/**
 * Test for AdminService.getEconomyReport() — top whales + circulation snapshot.
 *
 * Read-only endpoint, không mutate DB. Test focus:
 *   - DB rỗng → 0 totals + empty top arrays.
 *   - Top sorted DESC theo linhThach + tienNgoc.
 *   - Circulation total = sum tất cả character.
 *   - cultivatingCount đếm đúng cờ `cultivating=true`.
 *   - linhThach BigInt serialize thành string an toàn (đặc biệt số lớn > Number.MAX_SAFE_INTEGER).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TopupService } from '../topup/topup.service';
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

afterAll(async () => {
  await wipeAll(prisma);
  await prisma.$disconnect();
});

describe('AdminService.getEconomyReport', () => {
  it('DB rỗng → 0 totals + empty top arrays', async () => {
    const r = await admin.getEconomyReport();
    expect(r.circulation.linhThachTotal).toBe('0');
    expect(r.circulation.tienNgocTotal).toBe(0);
    expect(r.circulation.tienNgocKhoaTotal).toBe(0);
    expect(r.circulation.characterCount).toBe(0);
    expect(r.circulation.cultivatingCount).toBe(0);
    expect(r.topByLinhThach).toEqual([]);
    expect(r.topByTienNgoc).toEqual([]);
    expect(r.generatedAt).toBeTruthy();
  });

  it('top sorted DESC theo linhThach', async () => {
    await makeUserChar(prisma, { linhThach: 100n });
    await makeUserChar(prisma, { linhThach: 9000n });
    await makeUserChar(prisma, { linhThach: 500n });
    const r = await admin.getEconomyReport();
    expect(r.topByLinhThach).toHaveLength(3);
    expect(r.topByLinhThach[0].linhThach).toBe('9000');
    expect(r.topByLinhThach[1].linhThach).toBe('500');
    expect(r.topByLinhThach[2].linhThach).toBe('100');
  });

  it('top sorted DESC theo tienNgoc', async () => {
    await makeUserChar(prisma, { tienNgoc: 50 });
    await makeUserChar(prisma, { tienNgoc: 200 });
    await makeUserChar(prisma, { tienNgoc: 0 });
    const r = await admin.getEconomyReport();
    expect(r.topByTienNgoc).toHaveLength(3);
    expect(r.topByTienNgoc[0].tienNgoc).toBe(200);
    expect(r.topByTienNgoc[1].tienNgoc).toBe(50);
    expect(r.topByTienNgoc[2].tienNgoc).toBe(0);
  });

  it('circulation total = sum đúng + character / cultivating count', async () => {
    await makeUserChar(prisma, { linhThach: 1000n, tienNgoc: 100, cultivating: true });
    await makeUserChar(prisma, { linhThach: 500n, tienNgoc: 50, cultivating: false });
    await makeUserChar(prisma, { linhThach: 2500n, tienNgoc: 0, cultivating: true });
    const r = await admin.getEconomyReport();
    expect(r.circulation.linhThachTotal).toBe('4000');
    expect(r.circulation.tienNgocTotal).toBe(150);
    expect(r.circulation.characterCount).toBe(3);
    expect(r.circulation.cultivatingCount).toBe(2);
  });

  it('top giới hạn 10 dù DB > 10 character', async () => {
    for (let i = 0; i < 12; i += 1) {
      await makeUserChar(prisma, { linhThach: BigInt(i * 100) });
    }
    const r = await admin.getEconomyReport();
    expect(r.topByLinhThach).toHaveLength(10);
    // top đầu = max linhThach (1100 = i=11 * 100)
    expect(r.topByLinhThach[0].linhThach).toBe('1100');
  });

  it('linhThach BigInt > Number.MAX_SAFE_INTEGER serialize đúng (string)', async () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 999n; // 9007199254741990
    await makeUserChar(prisma, { linhThach: huge });
    const r = await admin.getEconomyReport();
    expect(r.topByLinhThach[0].linhThach).toBe(huge.toString());
    expect(r.circulation.linhThachTotal).toBe(huge.toString());
  });

  it('row payload có đầy đủ characterId, name, realmKey, realmStage, userEmail', async () => {
    const f = await makeUserChar(prisma, {
      linhThach: 5000n,
      realmKey: 'truclo',
      realmStage: 3,
    });
    const r = await admin.getEconomyReport();
    expect(r.topByLinhThach[0]).toMatchObject({
      characterId: f.characterId,
      name: f.name,
      realmKey: 'truclo',
      realmStage: 3,
      userEmail: f.email,
      linhThach: '5000',
    });
  });
});
