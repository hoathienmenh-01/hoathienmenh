import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TopupStatus } from '@prisma/client';
import { TOPUP_PACKAGES } from '@xuantoi/shared';
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
let topup: TopupService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — QuestService cần NpcAffinityService cho rewards.affinity.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const PKG = TOPUP_PACKAGES[0]; // lien_xuan_50, tienNgoc=50, bonus=0
const PKG_AMOUNT = PKG.tienNgoc + PKG.bonus;

describe('TopupService.createOrder', () => {
  it('tạo order PENDING với đúng amount + transferCode', async () => {
    const u = await makeUserChar(prisma);
    const view = await topup.createOrder(u.userId, PKG.key);
    expect(view.status).toBe('PENDING');
    expect(view.tienNgocAmount).toBe(PKG_AMOUNT);
    expect(view.transferCode).toMatch(/^TOPUP-[A-Z2-9]{6}$/);
  });

  it('package không tồn tại → INVALID_PACKAGE', async () => {
    const u = await makeUserChar(prisma);
    await expect(topup.createOrder(u.userId, 'no_such_pkg')).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
    });
  });

  it('quá 5 đơn PENDING → TOO_MANY_PENDING', async () => {
    const u = await makeUserChar(prisma);
    for (let i = 0; i < 5; i++) {
      await topup.createOrder(u.userId, PKG.key);
    }
    await expect(topup.createOrder(u.userId, PKG.key)).rejects.toMatchObject({
      code: 'TOO_MANY_PENDING',
    });
  });
});

describe('AdminService.approveTopup / rejectTopup', () => {
  it('approve: cộng tienNgoc + ghi ledger ADMIN_TOPUP_APPROVE + audit log', async () => {
    const u = await makeUserChar(prisma, { tienNgoc: 0 });
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    const order = await topup.createOrder(u.userId, PKG.key);

    await admin.approveTopup(adminUser.userId, order.id, 'ok');

    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.tienNgoc).toBe(PKG_AMOUNT);

    const finalOrder = await prisma.topupOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe(TopupStatus.APPROVED);
    expect(finalOrder.approvedById).toBe(adminUser.userId);

    const ledger = await prisma.currencyLedger.findFirstOrThrow({
      where: {
        characterId: u.characterId,
        reason: 'ADMIN_TOPUP_APPROVE',
        refId: order.id,
      },
    });
    expect(ledger.delta).toBe(BigInt(PKG_AMOUNT));
    expect(ledger.actorUserId).toBe(adminUser.userId);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminUser.userId, action: 'topup.approve' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.orderId).toBe(order.id);
  });

  it('approve: order đã APPROVED → ALREADY_PROCESSED, không cộng lần 2', async () => {
    const u = await makeUserChar(prisma, { tienNgoc: 0 });
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    const order = await topup.createOrder(u.userId, PKG.key);

    await admin.approveTopup(adminUser.userId, order.id, '');
    await expect(admin.approveTopup(adminUser.userId, order.id, '')).rejects.toMatchObject({
      code: 'ALREADY_PROCESSED',
    });
    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.tienNgoc).toBe(PKG_AMOUNT); // chỉ cộng 1 lần
  });

  it('approve: tự duyệt đơn của mình → CANNOT_TARGET_SELF', async () => {
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    const order = await topup.createOrder(adminUser.userId, PKG.key);
    await expect(admin.approveTopup(adminUser.userId, order.id, '')).rejects.toMatchObject({
      code: 'CANNOT_TARGET_SELF',
    });
  });

  it('reject: status REJECTED, KHÔNG cộng tienNgoc, KHÔNG ghi ledger', async () => {
    const u = await makeUserChar(prisma, { tienNgoc: 0 });
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    const order = await topup.createOrder(u.userId, PKG.key);

    await admin.rejectTopup(adminUser.userId, order.id, 'no transfer received');

    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.tienNgoc).toBe(0);
    const finalOrder = await prisma.topupOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe(TopupStatus.REJECTED);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId },
    });
    expect(ledger).toHaveLength(0);
  });
});

describe('AdminService.grant', () => {
  it('grant cùng lúc 2 đồng tiền → ghi 2 ledger, atomic 1 transaction', async () => {
    const target = await makeUserChar(prisma, { linhThach: 100n, tienNgoc: 5 });
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });

    await admin.grant(adminUser.userId, 'ADMIN', target.userId, 200n, 50, 'support');

    const c = await prisma.character.findUniqueOrThrow({ where: { id: target.characterId } });
    expect(c.linhThach).toBe(300n);
    expect(c.tienNgoc).toBe(55);

    const ledger = await prisma.currencyLedger.findMany({
      where: {
        characterId: target.characterId,
        reason: 'ADMIN_GRANT',
        refId: target.userId,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(2);
    const linh = ledger.find((r) => r.currency === 'LINH_THACH')!;
    const ngoc = ledger.find((r) => r.currency === 'TIEN_NGOC')!;
    expect(linh.delta).toBe(200n);
    expect(ngoc.delta).toBe(50n);
    expect(linh.actorUserId).toBe(adminUser.userId);
  });

  it('grant: tự cộng cho mình → CANNOT_TARGET_SELF', async () => {
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grant(adminUser.userId, 'ADMIN', adminUser.userId, 100n, 0, ''),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('setRole: tự đổi role chính mình → CANNOT_TARGET_SELF (chống self-demote lock-out)', async () => {
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.setRole(adminUser.userId, 'ADMIN', adminUser.userId, 'PLAYER'),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
    await expect(
      admin.setRole(adminUser.userId, 'ADMIN', adminUser.userId, 'MOD'),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
    // role hiện tại không đổi
    const u = await prisma.user.findUniqueOrThrow({ where: { id: adminUser.userId } });
    expect(u.role).toBe('ADMIN');
  });

  it('setBanned: tự ban chính mình → CANNOT_TARGET_SELF', async () => {
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.setBanned(adminUser.userId, 'ADMIN', adminUser.userId, true),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: adminUser.userId } });
    expect(u.banned).toBe(false);
  });

  it('grant: trừ quá số dư → INVALID_INPUT, atomic rollback', async () => {
    const target = await makeUserChar(prisma, { linhThach: 50n, tienNgoc: 5 });
    const adminUser = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      admin.grant(adminUser.userId, 'ADMIN', target.userId, -1000n, 0, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const c = await prisma.character.findUniqueOrThrow({ where: { id: target.characterId } });
    expect(c.linhThach).toBe(50n);
    expect(c.tienNgoc).toBe(5);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: target.characterId },
    });
    expect(ledger).toHaveLength(0);
  });
});
