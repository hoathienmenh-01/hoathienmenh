import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { ChatModerationService } from './chat-moderation.service';
import { ChatPrivateService } from '../chat-private/chat-private.service';
import { ChatGroupService } from '../chat-group/chat-group.service';
import { SocialService } from '../social/social.service';
import { RealtimeService } from '../realtime/realtime.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let mod: ChatModerationService;
let priv: ChatPrivateService;
let group: ChatGroupService;
let admin: Awaited<ReturnType<typeof makeUserChar>>;

async function ensureAdminUser() {
  // Promote first user to ADMIN role for AdminAuditLog actor FK.
  const u = await makeUserChar(prisma);
  await prisma.user.update({
    where: { id: u.userId },
    data: { role: 'ADMIN' },
  });
  return u;
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const social = new SocialService(prisma);
  mod = new ChatModerationService(prisma);
  priv = new ChatPrivateService(prisma, social, realtime, mod);
  group = new ChatGroupService(prisma, social, realtime, mod);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
  admin = await ensureAdminUser();
});

describe('Phase 19.2 — submitReport (private message)', () => {
  it('User report private message trong thread mình tham gia → OK', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'spam link');

    const report = await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: msg.id,
      reason: 'SPAM',
      detailsText: 'suspicious',
    });

    expect(report.reason).toBe('SPAM');
    expect(report.status).toBe('OPEN');
    expect(report.reporterUserId).toBe(a.userId);
    expect(report.targetUserId).toBe(b.userId);
    expect(report.privateMessageId).toBe(msg.id);
    expect(report.groupMessageId).toBeNull();
  });

  it('User ngoài thread không report được → NOT_FOUND mask', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const outsider = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'hi');

    await expect(
      mod.submitReport(outsider.userId, {
        messageType: 'PRIVATE',
        privateMessageId: msg.id,
        reason: 'SPAM',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Duplicate report cùng (reporter, message) → DUPLICATE_REPORT', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'hi');

    await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: msg.id,
      reason: 'SPAM',
    });

    await expect(
      mod.submitReport(a.userId, {
        messageType: 'PRIVATE',
        privateMessageId: msg.id,
        reason: 'HARASSMENT',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_REPORT' });
  });

  it('Reason invalid → INVALID_INPUT', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'hi');

    await expect(
      mod.submitReport(a.userId, {
        messageType: 'PRIVATE',
        privateMessageId: msg.id,
        reason: 'NOT_LIKED',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('Cấm self-report (reporter == sender)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(a.userId, thread.id, 'mine');

    await expect(
      mod.submitReport(a.userId, {
        messageType: 'PRIVATE',
        privateMessageId: msg.id,
        reason: 'SPAM',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('Message không tồn tại → NOT_FOUND', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      mod.submitReport(a.userId, {
        messageType: 'PRIVATE',
        privateMessageId: 'nonexistent-id',
        reason: 'SPAM',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Details quá dài bị truncate (không reject)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'hi');

    const long = 'x'.repeat(2000);
    const report = await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: msg.id,
      reason: 'SPAM',
      detailsText: long,
    });
    expect(report.detailsText?.length).toBe(500);
  });
});

describe('Phase 19.2 — submitReport (group message)', () => {
  it('User trong group report được message của member khác', async () => {
    const owner = await makeUserChar(prisma);
    const m1 = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'cult');
    await group.addGroupMember(owner.userId, grp.id, m1.userId);
    const msg = await group.sendGroupMessage(m1.userId, grp.id, 'spam');

    const report = await mod.submitReport(owner.userId, {
      messageType: 'GROUP',
      groupMessageId: msg.id,
      reason: 'SPAM',
    });
    expect(report.messageType).toBe('GROUP');
    expect(report.groupId).toBe(grp.id);
    expect(report.targetUserId).toBe(m1.userId);
  });

  it('Non-member không report được → NOT_FOUND mask', async () => {
    const owner = await makeUserChar(prisma);
    const m1 = await makeUserChar(prisma);
    const outsider = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'cult');
    await group.addGroupMember(owner.userId, grp.id, m1.userId);
    const msg = await group.sendGroupMessage(m1.userId, grp.id, 'hi');

    await expect(
      mod.submitReport(outsider.userId, {
        messageType: 'GROUP',
        groupMessageId: msg.id,
        reason: 'SPAM',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Phase 19.2 — Admin: ack / resolve report', () => {
  async function setupReport() {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'spam');
    const report = await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: msg.id,
      reason: 'SPAM',
    });
    return { reportId: report.id };
  }

  it('ack OPEN -> ACKNOWLEDGED', async () => {
    const { reportId } = await setupReport();
    const r = await mod.adminAckReport(admin.userId, reportId);
    expect(r.status).toBe('ACKNOWLEDGED');

    const audit = await prisma.adminAuditLog.findFirst({
      where: { action: 'ADMIN_CHAT_MODERATION_REPORT_ACK' },
    });
    expect(audit).not.toBeNull();
  });

  it('ack rejected khi đã ack (INVALID_TRANSITION)', async () => {
    const { reportId } = await setupReport();
    await mod.adminAckReport(admin.userId, reportId);
    await expect(
      mod.adminAckReport(admin.userId, reportId),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('resolve RESOLVED + note', async () => {
    const { reportId } = await setupReport();
    const r = await mod.adminResolveReport(
      admin.userId,
      reportId,
      'RESOLVED',
      'hidden message',
    );
    expect(r.status).toBe('RESOLVED');
    expect(r.resolutionNote).toBe('hidden message');
    expect(r.resolvedByAdminId).toBe(admin.userId);
  });

  it('resolve REJECTED khi không vi phạm', async () => {
    const { reportId } = await setupReport();
    const r = await mod.adminResolveReport(
      admin.userId,
      reportId,
      'REJECTED',
      'không vi phạm',
    );
    expect(r.status).toBe('REJECTED');
  });

  it('resolve fails when already resolved', async () => {
    const { reportId } = await setupReport();
    await mod.adminResolveReport(admin.userId, reportId, 'RESOLVED', 'done');
    await expect(
      mod.adminResolveReport(admin.userId, reportId, 'RESOLVED', 'x'),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('resolve with invalid status -> INVALID_INPUT', async () => {
    const { reportId } = await setupReport();
    await expect(
      mod.adminResolveReport(
        admin.userId,
        reportId,
        'OPEN' as 'RESOLVED',
        null,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('Phase 19.2 — Admin: mute lifecycle', () => {
  it('Create mute PRIVATE_CHAT → muted user không gửi PM', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);

    await mod.adminCreateMute(admin.userId, {
      userId: a.userId,
      scope: 'PRIVATE_CHAT',
      reason: 'spam test',
      expiresAt: null,
    });

    await expect(
      priv.sendPrivateMessage(a.userId, thread.id, 'hi'),
    ).rejects.toMatchObject({ code: 'MUTED' });

    // b vẫn gửi được — mute là per-user.
    await expect(
      priv.sendPrivateMessage(b.userId, thread.id, 'hi'),
    ).resolves.toMatchObject({ body: 'hi' });
  });

  it('ALL_CHAT mute chặn cả private và group', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const grp = await group.createGroupChat(a.userId, 'cult');

    await mod.adminCreateMute(admin.userId, {
      userId: a.userId,
      scope: 'ALL_CHAT',
      reason: 'flood',
      expiresAt: null,
    });

    await expect(
      priv.sendPrivateMessage(a.userId, thread.id, 'hi'),
    ).rejects.toMatchObject({ code: 'MUTED' });
    await expect(
      group.sendGroupMessage(a.userId, grp.id, 'hi'),
    ).rejects.toMatchObject({ code: 'MUTED' });
  });

  it('GROUP_CHAT mute không chặn private', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const grp = await group.createGroupChat(a.userId, 'cult');

    await mod.adminCreateMute(admin.userId, {
      userId: a.userId,
      scope: 'GROUP_CHAT',
      reason: 'spam',
      expiresAt: null,
    });

    await expect(
      priv.sendPrivateMessage(a.userId, thread.id, 'hi'),
    ).resolves.toMatchObject({ body: 'hi' });
    await expect(
      group.sendGroupMessage(a.userId, grp.id, 'hi'),
    ).rejects.toMatchObject({ code: 'MUTED' });
  });

  it('Mute expired (expiresAt < now) tự hết hiệu lực', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);

    // Tạo mute đã hết hạn (insert raw, bypass validator past-check).
    await prisma.chatMute.create({
      data: {
        userId: a.userId,
        mutedByAdminId: admin.userId,
        scope: 'PRIVATE_CHAT',
        reason: 'old mute',
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await expect(
      priv.sendPrivateMessage(a.userId, thread.id, 'hi'),
    ).resolves.toMatchObject({ body: 'hi' });
  });

  it('Revoke mute → user gửi lại được', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);

    const mute = await mod.adminCreateMute(admin.userId, {
      userId: a.userId,
      scope: 'PRIVATE_CHAT',
      reason: 'spam',
      expiresAt: null,
    });

    await mod.adminRevokeMute(admin.userId, mute.id);
    await expect(
      priv.sendPrivateMessage(a.userId, thread.id, 'hi'),
    ).resolves.toMatchObject({ body: 'hi' });
  });
});

describe('Phase 19.2 — Admin: hide / unhide message', () => {
  it('Hide private message → list trả placeholder + isHidden=true', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'bad words');

    await mod.adminHideMessage(admin.userId, 'PRIVATE', msg.id, 'offensive');

    const rows = await priv.listPrivateMessages(a.userId, thread.id);
    const target = rows.find((r) => r.id === msg.id);
    expect(target?.isHidden).toBe(true);
    expect(target?.body).toBe('[hidden by moderator]');
    expect(target?.body).not.toContain('bad words');
  });

  it('Hide group message → soft-hide', async () => {
    const owner = await makeUserChar(prisma);
    const m1 = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'grp');
    await group.addGroupMember(owner.userId, grp.id, m1.userId);
    const msg = await group.sendGroupMessage(m1.userId, grp.id, 'leak password');

    await mod.adminHideMessage(admin.userId, 'GROUP', msg.id, 'security');

    const rows = await group.listGroupMessages(owner.userId, grp.id);
    const target = rows.find((r) => r.id === msg.id);
    expect(target?.isHidden).toBe(true);
    expect(target?.body).not.toContain('leak');
  });

  it('Unhide khôi phục body', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'original');

    await mod.adminHideMessage(admin.userId, 'PRIVATE', msg.id, 'mistake');
    await mod.adminUnhideMessage(admin.userId, 'PRIVATE', msg.id);

    const rows = await priv.listPrivateMessages(a.userId, thread.id);
    const target = rows.find((r) => r.id === msg.id);
    expect(target?.isHidden).toBe(false);
    expect(target?.body).toBe('original');
  });

  it('Hide rồi hide lần 2 → INVALID_TRANSITION', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const msg = await priv.sendPrivateMessage(b.userId, thread.id, 'x');
    await mod.adminHideMessage(admin.userId, 'PRIVATE', msg.id, null);
    await expect(
      mod.adminHideMessage(admin.userId, 'PRIVATE', msg.id, null),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('Phase 19.2 — Admin: lock / dissolve group', () => {
  it('Lock group → member không gửi được message (GROUP_LOCKED)', async () => {
    const owner = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'grp');
    await mod.adminLockGroup(admin.userId, grp.id, 'spam war');

    await expect(
      group.sendGroupMessage(owner.userId, grp.id, 'hi'),
    ).rejects.toMatchObject({ code: 'GROUP_LOCKED' });
  });

  it('Unlock group → gửi lại được', async () => {
    const owner = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'grp');
    await mod.adminLockGroup(admin.userId, grp.id, 'x');
    await mod.adminUnlockGroup(admin.userId, grp.id);
    await expect(
      group.sendGroupMessage(owner.userId, grp.id, 'hi'),
    ).resolves.toMatchObject({ body: 'hi' });
  });

  it('Dissolve group → mask NOT_FOUND khi gửi', async () => {
    const owner = await makeUserChar(prisma);
    const grp = await group.createGroupChat(owner.userId, 'grp');
    await mod.adminDissolveGroup(admin.userId, grp.id, 'criminal');
    await expect(
      group.sendGroupMessage(owner.userId, grp.id, 'hi'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Phase 19.2 — Admin: list + summary', () => {
  it('Summary đếm open/ack/resolvedToday/mutedUsers/hiddenMessages/lockedGroups', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const m1 = await priv.sendPrivateMessage(b.userId, thread.id, 'x');
    const m2 = await priv.sendPrivateMessage(b.userId, thread.id, 'y');

    const r1 = await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: m1.id,
      reason: 'SPAM',
    });
    await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: m2.id,
      reason: 'SPAM',
    });

    await mod.adminAckReport(admin.userId, r1.id);
    await mod.adminCreateMute(admin.userId, {
      userId: a.userId,
      scope: 'PRIVATE_CHAT',
      reason: 'spam',
      expiresAt: null,
    });
    await mod.adminHideMessage(admin.userId, 'PRIVATE', m2.id, null);

    const grp = await group.createGroupChat(b.userId, 'grp');
    await mod.adminLockGroup(admin.userId, grp.id, 'flood');

    const s = await mod.adminSummary();
    expect(s.openReports).toBe(1);
    expect(s.acknowledgedReports).toBe(1);
    expect(s.mutedUsers).toBeGreaterThanOrEqual(1);
    expect(s.hiddenMessages).toBeGreaterThanOrEqual(1);
    expect(s.lockedGroups).toBe(1);
  });

  it('listReports filter by status + reason', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const thread = await priv.getOrCreatePrivateThread(a.userId, b.userId);
    const m1 = await priv.sendPrivateMessage(b.userId, thread.id, 'x');
    const m2 = await priv.sendPrivateMessage(b.userId, thread.id, 'y');
    await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: m1.id,
      reason: 'SPAM',
    });
    await mod.submitReport(a.userId, {
      messageType: 'PRIVATE',
      privateMessageId: m2.id,
      reason: 'HARASSMENT',
    });

    const spamOnly = await mod.adminListReports({ reason: 'SPAM' });
    expect(spamOnly.items.length).toBe(1);
    expect(spamOnly.items[0].reason).toBe('SPAM');
    expect(spamOnly.total).toBe(1);

    const all = await mod.adminListReports({});
    expect(all.items.length).toBe(2);
    expect(all.total).toBe(2);
  });
});

describe('Phase 19.2 — assertNotMuted / findActiveMuteForSend', () => {
  it('No mute → null', async () => {
    const u = await makeUserChar(prisma);
    const r = await mod.findActiveMuteForSend(u.userId, 'PRIVATE_CHAT');
    expect(r).toBeNull();
  });

  it('Revoked mute không count', async () => {
    const u = await makeUserChar(prisma);
    const mute = await mod.adminCreateMute(admin.userId, {
      userId: u.userId,
      scope: 'PRIVATE_CHAT',
      reason: 'x',
      expiresAt: null,
    });
    await mod.adminRevokeMute(admin.userId, mute.id);
    const r = await mod.findActiveMuteForSend(u.userId, 'PRIVATE_CHAT');
    expect(r).toBeNull();
  });
});
