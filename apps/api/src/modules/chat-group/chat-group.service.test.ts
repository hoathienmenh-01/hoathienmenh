import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { ChatModerationService } from '../chat-moderation/chat-moderation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialService } from '../social/social.service';
import { ChatGroupError, ChatGroupService } from './chat-group.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let realtime: RealtimeService;
let social: SocialService;
let group: ChatGroupService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  realtime = new RealtimeService();
  social = new SocialService(prisma);
  // Phase 19.2 — ChatGroupService now requires ChatModerationService.
  const moderation = new ChatModerationService(prisma);
  group = new ChatGroupService(prisma, social, realtime, moderation);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

async function makePlayer() {
  return makeUserChar(prisma);
}

describe('Phase 19.1 — ChatGroupService createGroupChat', () => {
  it('Owner tạo group → trả về row + auto thêm owner làm member', async () => {
    const a = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'Test Group');
    expect(g.name).toBe('Test Group');
    expect(g.ownerUserId).toBe(a.userId);
    expect(g.memberCount).toBe(1);

    const members = await group.listGroupMembers(a.userId, g.id);
    expect(members.map((m) => m.userId)).toEqual([a.userId]);
  });

  it('Reject INVALID_INPUT nếu name empty / quá ngắn / quá dài', async () => {
    const a = await makePlayer();
    await expect(
      group.createGroupChat(a.userId, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      group.createGroupChat(a.userId, 'ab'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      group.createGroupChat(a.userId, 'x'.repeat(61)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('Trim group name', async () => {
    const a = await makePlayer();
    const g = await group.createGroupChat(a.userId, '  Trim Me  ');
    expect(g.name).toBe('Trim Me');
  });
});

describe('Phase 19.1 — ChatGroupService addGroupMember', () => {
  it('Chỉ owner add được — non-owner reject NOT_AUTHORIZED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await expect(
      group.addGroupMember(b.userId, g.id, c.userId),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('NOT_FOUND nếu groupId không tồn tại', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await expect(
      group.addGroupMember(a.userId, 'bad-id', b.userId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('DUPLICATE_MEMBER nếu user đã trong group HOẶC owner tự add', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await group.addGroupMember(a.userId, g.id, b.userId);
    await expect(
      group.addGroupMember(a.userId, g.id, b.userId),
    ).rejects.toMatchObject({ code: 'DUPLICATE_MEMBER' });
    await expect(
      group.addGroupMember(a.userId, g.id, a.userId),
    ).rejects.toMatchObject({ code: 'DUPLICATE_MEMBER' });
  });

  it('BLOCKED nếu owner & target đang block', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await expect(
      group.addGroupMember(a.userId, g.id, b.userId),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('Add hợp lệ → trả về row có displayName', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    const m = await group.addGroupMember(a.userId, g.id, b.userId);
    expect(m.groupId).toBe(g.id);
    expect(m.userId).toBe(b.userId);
    expect(m.displayName).toBe(b.name);
  });
});

describe('Phase 19.1 — ChatGroupService removeGroupMember', () => {
  it('Chỉ owner remove — non-owner NOT_AUTHORIZED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await group.addGroupMember(a.userId, g.id, b.userId);
    await expect(
      group.removeGroupMember(b.userId, g.id, c.userId),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('Owner KHÔNG remove chính mình → NOT_AUTHORIZED', async () => {
    const a = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await expect(
      group.removeGroupMember(a.userId, g.id, a.userId),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('Remove member rồi member không gửi được message → NOT_FOUND', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await group.addGroupMember(a.userId, g.id, b.userId);
    await group.sendGroupMessage(b.userId, g.id, 'hi');
    await group.removeGroupMember(a.userId, g.id, b.userId);
    await expect(
      group.sendGroupMessage(b.userId, g.id, 'after-removal'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      group.listGroupMessages(b.userId, g.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Remove user không phải member → removed=false (idempotent)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    const r = await group.removeGroupMember(a.userId, g.id, b.userId);
    expect(r.removed).toBe(false);
  });
});

describe('Phase 19.1 — ChatGroupService send/list message', () => {
  it('Non-member gửi → NOT_FOUND (mask)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await expect(
      group.sendGroupMessage(b.userId, g.id, 'hi'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Non-member list message → NOT_FOUND (mask)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await group.sendGroupMessage(a.userId, g.id, 'hi');
    await expect(
      group.listGroupMessages(b.userId, g.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Member list → trả desc theo createdAt', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await group.addGroupMember(a.userId, g.id, b.userId);
    await group.sendGroupMessage(a.userId, g.id, 'one');
    await new Promise((r) => setTimeout(r, 5));
    await group.sendGroupMessage(b.userId, g.id, 'two');
    const list = await group.listGroupMessages(a.userId, g.id);
    expect(list.map((m) => m.body)).toEqual(['two', 'one']);
  });

  it('Reject INVALID_INPUT nếu body empty / >500', async () => {
    const a = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    await expect(
      group.sendGroupMessage(a.userId, g.id, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      group.sendGroupMessage(a.userId, g.id, 'x'.repeat(501)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('NOT_FOUND nếu group không tồn tại (cả send và list)', async () => {
    const a = await makePlayer();
    await expect(
      group.sendGroupMessage(a.userId, 'bad-id', 'hi'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      group.listGroupMessages(a.userId, 'bad-id'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Phase 19.1 — ChatGroupService listGroups', () => {
  it('Chỉ trả về group caller là member', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const g1 = await group.createGroupChat(a.userId, 'Group1');
    const g2 = await group.createGroupChat(b.userId, 'Group2');
    await group.addGroupMember(a.userId, g1.id, c.userId);

    const listA = await group.listGroups(a.userId);
    expect(listA.map((x) => x.id)).toEqual([g1.id]);

    const listB = await group.listGroups(b.userId);
    expect(listB.map((x) => x.id)).toEqual([g2.id]);

    const listC = await group.listGroups(c.userId);
    expect(listC.map((x) => x.id)).toEqual([g1.id]);
  });

  it('memberCount đúng sau khi add/remove', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const g = await group.createGroupChat(a.userId, 'TGroup');
    let list = await group.listGroups(a.userId);
    expect(list[0].memberCount).toBe(1);

    await group.addGroupMember(a.userId, g.id, b.userId);
    await group.addGroupMember(a.userId, g.id, c.userId);
    list = await group.listGroups(a.userId);
    expect(list[0].memberCount).toBe(3);

    await group.removeGroupMember(a.userId, g.id, b.userId);
    list = await group.listGroups(a.userId);
    expect(list[0].memberCount).toBe(2);
  });
});

describe('Phase 19.1 — ChatGroupError class', () => {
  it('ChatGroupError carry code', () => {
    const e = new ChatGroupError('NOT_AUTHORIZED');
    expect(e.code).toBe('NOT_AUTHORIZED');
    expect(e.message).toBe('NOT_AUTHORIZED');
  });
});
