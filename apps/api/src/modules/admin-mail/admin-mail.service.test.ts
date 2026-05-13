import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemGiftService } from '../system-gift/system-gift.service';
import { AdminMailError, AdminMailService } from './admin-mail.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: AdminMailService;
let mail: MailService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  mail = new MailService(prisma, currency, inventory, realtime);
  const systemGift = new SystemGiftService(prisma, mail);
  svc = new AdminMailService(prisma, mail, systemGift);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

const goodReward = () => ({
  linhThach: '1000',
  tienNgoc: 0,
  exp: '5000',
  items: [],
});

describe('AdminMailService — Phase 31.0', () => {
  it('sendOne: tạo mail + audit log row, mailCount=1', async () => {
    const u = await makeUserChar(prisma);
    const r = await svc.send('admin-1', {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      subject: 'Lễ phẩm cá nhân',
      body: 'Quà từ admin',
      reward: goodReward(),
      expiresAt: null,
      reason: 'compensation_for_bug',
      recipientCharacterId: u.characterId,
    });
    expect(r.mailCount).toBe(1);
    expect(r.targetCount).toBe(1);

    const log = await svc.getAuditLog(r.logId);
    expect(log).not.toBeNull();
    expect(log!.kind).toBe('SEND_ONE');
    expect(log!.reason).toBe('compensation_for_bug');
    expect(log!.recipientsSnapshot).toEqual([u.characterId]);
  });

  it('sendOne: INVALID_INPUT khi reason quá ngắn', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.send('admin-1', {
        kind: 'SEND_ONE',
        mailType: 'ADMIN',
        subject: 'x',
        body: 'y',
        reward: goodReward(),
        expiresAt: null,
        reason: 'no', // < 4 chars.
        recipientCharacterId: u.characterId,
      }),
    ).rejects.toBeInstanceOf(AdminMailError);
  });

  it('sendOne: TIEN_NGOC_CAP khi reward TN > 0', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.send('admin-1', {
        kind: 'SEND_ONE',
        mailType: 'ADMIN',
        subject: 'x',
        body: 'y',
        reward: { ...goodReward(), tienNgoc: 100 },
        expiresAt: null,
        reason: 'test_invalid',
        recipientCharacterId: u.characterId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('sendOne: INVALID_RECIPIENT khi character không tồn tại', async () => {
    await expect(
      svc.send('admin-1', {
        kind: 'SEND_ONE',
        mailType: 'ADMIN',
        subject: 'x',
        body: 'y',
        reward: goodReward(),
        expiresAt: null,
        reason: 'test_missing',
        recipientCharacterId: 'nonexistent-id',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECIPIENT' });
  });

  it('sendBulk: tạo N mail + audit, recipientsSnapshot trim 50', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    const r = await svc.send('admin-1', {
      kind: 'SEND_BULK',
      mailType: 'ADMIN',
      subject: 'Quà event',
      body: 'Compensation',
      reward: goodReward(),
      expiresAt: null,
      reason: 'bug_compensation_event_xx',
      recipientCharacterIds: [u1.characterId, u2.characterId],
    });
    expect(r.mailCount).toBe(2);
    expect(r.targetCount).toBe(2);

    const inbox1 = await mail.inbox(u1.userId);
    const inbox2 = await mail.inbox(u2.userId);
    expect(inbox1).toHaveLength(1);
    expect(inbox2).toHaveLength(1);

    const log = await svc.getAuditLog(r.logId);
    expect(log!.mailCount).toBe(2);
    expect(log!.recipientsSnapshot).toHaveLength(2);
  });

  it('sendGlobal preview: KHÔNG tạo mail, audit có previewOnly=true', async () => {
    await makeUserChar(prisma);
    await makeUserChar(prisma);
    const r = await svc.send('admin-1', {
      kind: 'SEND_GLOBAL',
      mailType: 'MAINTENANCE',
      subject: 'Bảo trì server',
      body: 'Server downtime notice',
      reward: goodReward(),
      expiresAt: null,
      reason: 'maintenance_2026_01_15',
      targetRule: { type: 'ALL_PLAYERS' },
      previewOnly: true,
    });
    expect(r.mailCount).toBe(0);
    expect(r.targetCount).toBe(2);
  });

  it('sendGlobal real send: tạo mail cho mỗi target + audit có targetRuleSnapshot', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    const r = await svc.send('admin-1', {
      kind: 'SEND_GLOBAL',
      mailType: 'EVENT',
      subject: 'Sự kiện kết thúc',
      body: 'Phần thưởng tổng kết',
      reward: goodReward(),
      expiresAt: null,
      reason: 'event_xx_end_reward',
      targetRule: { type: 'ALL_PLAYERS' },
    });
    expect(r.mailCount).toBe(2);

    const log = await svc.getAuditLog(r.logId);
    expect(log!.targetRuleSnapshot).toMatchObject({ type: 'ALL_PLAYERS' });

    const inbox1 = await mail.inbox(u1.userId);
    const inbox2 = await mail.inbox(u2.userId);
    expect(inbox1).toHaveLength(1);
    expect(inbox2).toHaveLength(1);
    expect(inbox1[0].mailType).toBe('EVENT');
  });

  it('listAuditLogs trả về theo thứ tự createdAt desc', async () => {
    const u = await makeUserChar(prisma);
    const r1 = await svc.send('admin-1', {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      subject: 'A',
      body: 'a',
      reward: goodReward(),
      expiresAt: null,
      reason: 'first_test_send',
      recipientCharacterId: u.characterId,
    });
    const r2 = await svc.send('admin-1', {
      kind: 'SEND_ONE',
      mailType: 'ADMIN',
      subject: 'B',
      body: 'b',
      reward: goodReward(),
      expiresAt: null,
      reason: 'second_test_send',
      recipientCharacterId: u.characterId,
    });
    const logs = await svc.listAuditLogs({ limit: 10 });
    expect(logs[0].id).toBe(r2.logId);
    expect(logs[1].id).toBe(r1.logId);
  });
});
