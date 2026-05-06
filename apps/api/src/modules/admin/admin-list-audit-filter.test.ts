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

async function seed(): Promise<{ adminId: string; modId: string; targetId: string }> {
  const adminUser = await makeUserChar(prisma, { role: Role.ADMIN });
  const modUser = await makeUserChar(prisma, { role: Role.MOD });
  const target = await makeUserChar(prisma, {});
  // Tạo audit entries
  await prisma.adminAuditLog.createMany({
    data: [
      { actorUserId: adminUser.userId, action: 'user.ban', meta: {} },
      { actorUserId: adminUser.userId, action: 'user.setRole', meta: {} },
      { actorUserId: modUser.userId, action: 'user.ban', meta: {} },
      { actorUserId: adminUser.userId, action: 'inventory.revoke', meta: {} },
      { actorUserId: modUser.userId, action: 'topup.approve', meta: {} },
    ],
  });
  return {
    adminId: adminUser.userId,
    modId: modUser.userId,
    targetId: target.userId,
  };
}

describe('AdminService.listAudit (G18 — filter by action prefix / actor email)', () => {
  it('không filter → tất cả', async () => {
    await seed();
    const r = await admin.listAudit(0);
    expect(r.total).toBe(5);
    expect(r.rows.length).toBe(5);
  });

  it('filter actionPrefix="user." → chỉ entry "user.*"', async () => {
    await seed();
    const r = await admin.listAudit(0, { actionPrefix: 'user.' });
    expect(r.total).toBe(3);
    expect(r.rows.every((x) => x.action.startsWith('user.'))).toBe(true);
  });

  it('filter actionPrefix="user.ban" → 2 entry', async () => {
    await seed();
    const r = await admin.listAudit(0, { actionPrefix: 'user.ban' });
    expect(r.total).toBe(2);
    expect(r.rows.every((x) => x.action === 'user.ban')).toBe(true);
  });

  it('filter actionPrefix không match → 0', async () => {
    await seed();
    const r = await admin.listAudit(0, { actionPrefix: 'notexist.' });
    expect(r.total).toBe(0);
  });

  it('filter actorEmail (substring, case-insensitive) → đúng tập', async () => {
    const seeded = await seed();
    const adminUser = await prisma.user.findUnique({ where: { id: seeded.adminId } });
    expect(adminUser).not.toBeNull();
    // Lấy substring từ email admin để search.
    const sub = adminUser!.email.slice(0, 5);
    const r = await admin.listAudit(0, { actorEmail: sub });
    expect(r.total).toBeGreaterThanOrEqual(3); // adminUser có 3 entry; nếu modUser email cũng chứa sub (it-... prefix) sẽ thêm — nên ≥
    expect(r.rows.every((x) => x.actorEmail !== null)).toBe(true);
  });

  it('filter actorEmail không match → 0', async () => {
    await seed();
    const r = await admin.listAudit(0, { actorEmail: 'not-exist@nope.local' });
    expect(r.total).toBe(0);
  });

  it('combine actionPrefix + actorEmail: AND chính xác', async () => {
    const seeded = await seed();
    const adminUser = await prisma.user.findUnique({ where: { id: seeded.adminId } });
    expect(adminUser).not.toBeNull();
    const r = await admin.listAudit(0, {
      actionPrefix: 'user.',
      actorEmail: adminUser!.email,
    });
    expect(r.total).toBe(2); // adminUser + action "user.*" → 2 entry (ban + setRole)
    expect(r.rows.every((x) => x.action.startsWith('user.'))).toBe(true);
    expect(r.rows.every((x) => x.actorUserId === seeded.adminId)).toBe(true);
  });
});
