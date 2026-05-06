import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
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

async function seed(): Promise<void> {
  // 3 PLAYER (1 banned), 1 MOD, 1 ADMIN.
  const [p1, p2, p3] = await Promise.all([
    makeUserChar(prisma, {}),
    makeUserChar(prisma, {}),
    makeUserChar(prisma, {}),
  ]);
  void p1; void p2; void p3;
  // Ban 1 user
  const allPlayers = await prisma.user.findMany({ where: { role: 'PLAYER' } });
  await prisma.user.update({ where: { id: allPlayers[0].id }, data: { banned: true } });
  // Promote 2 user
  await prisma.user.update({ where: { id: allPlayers[1].id }, data: { role: Role.MOD } });
  await prisma.user.update({ where: { id: allPlayers[2].id }, data: { role: Role.ADMIN } });
}

describe('AdminService.listUsers (G16 — filter by role/banned)', () => {
  it('không filter → trả về tất cả', async () => {
    await seed();
    const r = await admin.listUsers(undefined, 0);
    expect(r.total).toBe(3);
    expect(r.rows.length).toBe(3);
  });

  it('filter role=PLAYER → chỉ user role=PLAYER', async () => {
    await seed();
    // Sau seed: 1 PLAYER còn lại (đã bị ban), 1 MOD, 1 ADMIN.
    const r = await admin.listUsers(undefined, 0, { role: Role.PLAYER });
    expect(r.total).toBe(1);
    expect(r.rows.every((row) => row.role === Role.PLAYER)).toBe(true);
  });

  it('filter role=MOD → 1 row', async () => {
    await seed();
    const r = await admin.listUsers(undefined, 0, { role: Role.MOD });
    expect(r.total).toBe(1);
    expect(r.rows[0].role).toBe(Role.MOD);
  });

  it('filter role=ADMIN → 1 row', async () => {
    await seed();
    const r = await admin.listUsers(undefined, 0, { role: Role.ADMIN });
    expect(r.total).toBe(1);
    expect(r.rows[0].role).toBe(Role.ADMIN);
  });

  it('filter banned=true → chỉ user bị ban', async () => {
    await seed();
    const r = await admin.listUsers(undefined, 0, { banned: true });
    expect(r.total).toBe(1);
    expect(r.rows[0].banned).toBe(true);
  });

  it('filter banned=false → chỉ user không ban', async () => {
    await seed();
    const r = await admin.listUsers(undefined, 0, { banned: false });
    expect(r.total).toBe(2);
    expect(r.rows.every((row) => row.banned === false)).toBe(true);
  });

  it('combine q + role: search trong tập đã filter', async () => {
    await seed();
    const adminUser = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
    expect(adminUser).not.toBeNull();
    const r = await admin.listUsers(adminUser!.email, 0, { role: Role.ADMIN });
    expect(r.total).toBe(1);
    expect(r.rows[0].email).toBe(adminUser!.email);
    // Email khớp nhưng role không khớp → 0
    const r2 = await admin.listUsers(adminUser!.email, 0, { role: Role.PLAYER });
    expect(r2.total).toBe(0);
  });

  it('combine role=PLAYER + banned=true: AND chính xác', async () => {
    const u1 = await makeUserChar(prisma, {});
    await makeUserChar(prisma, {});
    await prisma.user.update({ where: { id: u1.userId }, data: { banned: true } });
    const r = await admin.listUsers(undefined, 0, { role: Role.PLAYER, banned: true });
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe(u1.userId);
  });
});

describe('AdminService.listUsers (9h-F — smart filter range/realm)', () => {
  it('linhThachMin filter chỉ trả character >= ngưỡng', async () => {
    await makeUserChar(prisma, { linhThach: 100n });
    await makeUserChar(prisma, { linhThach: 5000n });
    await makeUserChar(prisma, { linhThach: 99999n });
    const r = await admin.listUsers(undefined, 0, { linhThachMin: 1000n });
    expect(r.total).toBe(2);
    expect(r.rows.every((row) => BigInt(row.character?.linhThach ?? '0') >= 1000n)).toBe(true);
  });

  it('linhThachMax filter chỉ trả character <= ngưỡng', async () => {
    await makeUserChar(prisma, { linhThach: 100n });
    await makeUserChar(prisma, { linhThach: 5000n });
    await makeUserChar(prisma, { linhThach: 99999n });
    const r = await admin.listUsers(undefined, 0, { linhThachMax: 5000n });
    expect(r.total).toBe(2);
    expect(r.rows.every((row) => BigInt(row.character?.linhThach ?? '0') <= 5000n)).toBe(true);
  });

  it('linhThach min + max range', async () => {
    await makeUserChar(prisma, { linhThach: 100n });
    await makeUserChar(prisma, { linhThach: 5000n });
    await makeUserChar(prisma, { linhThach: 50000n });
    await makeUserChar(prisma, { linhThach: 99999n });
    const r = await admin.listUsers(undefined, 0, { linhThachMin: 1000n, linhThachMax: 60000n });
    expect(r.total).toBe(2);
  });

  it('tienNgocMin + tienNgocMax range', async () => {
    await makeUserChar(prisma, { tienNgoc: 0 });
    await makeUserChar(prisma, { tienNgoc: 100 });
    await makeUserChar(prisma, { tienNgoc: 5000 });
    const r = await admin.listUsers(undefined, 0, { tienNgocMin: 50, tienNgocMax: 1000 });
    expect(r.total).toBe(1);
    expect(r.rows[0].character?.tienNgoc).toBe(100);
  });

  it('realmKey filter chỉ trả character có realmKey khớp', async () => {
    await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await makeUserChar(prisma, { realmKey: 'truclo' });
    await makeUserChar(prisma, { realmKey: 'truclo' });
    const r = await admin.listUsers(undefined, 0, { realmKey: 'truclo' });
    expect(r.total).toBe(2);
    expect(r.rows.every((row) => row.character?.realmKey === 'truclo')).toBe(true);
  });

  it('combine linhThach range + realmKey + role', async () => {
    await makeUserChar(prisma, { linhThach: 5000n, realmKey: 'truclo' });
    await makeUserChar(prisma, { linhThach: 100n, realmKey: 'truclo' }); // dưới min
    await makeUserChar(prisma, { linhThach: 5000n, realmKey: 'luyenkhi' }); // realm khác
    const r = await admin.listUsers(undefined, 0, {
      linhThachMin: 1000n,
      realmKey: 'truclo',
      role: Role.PLAYER,
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].character?.linhThach).toBe('5000');
    expect(r.rows[0].character?.realmKey).toBe('truclo');
  });
});
