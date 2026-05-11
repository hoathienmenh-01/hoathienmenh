import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FriendRequestStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { SocialError, SocialService } from './social.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let social: SocialService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  social = new SocialService(prisma);
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

describe('Phase 19.1 — SocialService friend request', () => {
  it('Không cho self friend request', async () => {
    const u = await makePlayer();
    await expect(
      social.sendFriendRequest(u.userId, u.userId, null),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('Tạo PENDING friendRequest hợp lệ', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, 'hi');
    expect(req.status).toBe('PENDING');
    expect(req.senderUserId).toBe(a.userId);
    expect(req.receiverUserId).toBe(b.userId);
    expect(req.message).toBe('hi');
  });

  it('Duplicate PENDING reject ALREADY_PENDING (kể cả khi reverse hướng)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.sendFriendRequest(a.userId, b.userId, null);

    await expect(
      social.sendFriendRequest(a.userId, b.userId, null),
    ).rejects.toMatchObject({ code: 'ALREADY_PENDING' });

    // Reverse hướng cũng reject
    await expect(
      social.sendFriendRequest(b.userId, a.userId, null),
    ).rejects.toMatchObject({ code: 'ALREADY_PENDING' });
  });

  it('Block 2 chiều reject BLOCKED khi gửi request', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    await expect(
      social.sendFriendRequest(a.userId, b.userId, null),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      social.sendFriendRequest(b.userId, a.userId, null),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('Reject ALREADY_FRIENDS nếu đã friend nhau', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await social.acceptFriendRequest(b.userId, req.id);
    await expect(
      social.sendFriendRequest(a.userId, b.userId, null),
    ).rejects.toMatchObject({ code: 'ALREADY_FRIENDS' });
  });

  it('Reject INVALID_INPUT khi message > 140 char', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await expect(
      social.sendFriendRequest(a.userId, b.userId, 'x'.repeat(141)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('Sau DECLINED có thể gửi lại request', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await social.declineFriendRequest(b.userId, req.id);
    const second = await social.sendFriendRequest(
      a.userId,
      b.userId,
      null,
    );
    expect(second.status).toBe('PENDING');
    expect(second.id).not.toBe(req.id);
  });
});

describe('Phase 19.1 — SocialService accept/decline/cancel', () => {
  it('Accept tạo friendship + đánh dấu ACCEPTED + respondedAt', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    const res = await social.acceptFriendRequest(b.userId, req.id);
    expect(res.request.status).toBe('ACCEPTED');
    expect(res.request.respondedAt).not.toBeNull();
    expect(res.friendUserId).toBe(a.userId);

    const friendsOfA = await social.listFriends(a.userId);
    const friendsOfB = await social.listFriends(b.userId);
    expect(friendsOfA.map((f) => f.friendUserId)).toContain(b.userId);
    expect(friendsOfB.map((f) => f.friendUserId)).toContain(a.userId);
  });

  it('Accept thất bại NOT_AUTHORIZED nếu không phải receiver', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await expect(
      social.acceptFriendRequest(c.userId, req.id),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('Accept thất bại NOT_FOUND nếu request không tồn tại', async () => {
    const u = await makePlayer();
    await expect(
      social.acceptFriendRequest(u.userId, 'does-not-exist'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Decline KHÔNG tạo friendship', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    const decl = await social.declineFriendRequest(b.userId, req.id);
    expect(decl.status).toBe('DECLINED');
    const friends = await social.listFriends(a.userId);
    expect(friends).toEqual([]);
  });

  it('Cancel thất bại NOT_AUTHORIZED nếu không phải sender', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await expect(
      social.cancelFriendRequest(b.userId, req.id),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('Cancel chuyển PENDING → CANCELLED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    const c = await social.cancelFriendRequest(a.userId, req.id);
    expect(c.status).toBe('CANCELLED');
    expect(c.respondedAt).not.toBeNull();
  });

  it('Accept lần 2 reject INVALID_TRANSITION', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await social.acceptFriendRequest(b.userId, req.id);
    await expect(
      social.acceptFriendRequest(b.userId, req.id),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('Phase 19.1 — SocialService removeFriend / lists', () => {
  it('removeFriend xoá friendship + idempotent (không lỗi gọi lại)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await social.acceptFriendRequest(b.userId, req.id);

    const r1 = await social.removeFriend(a.userId, b.userId);
    expect(r1.removed).toBe(true);

    const r2 = await social.removeFriend(a.userId, b.userId);
    expect(r2.removed).toBe(false);

    expect(await social.listFriends(a.userId)).toEqual([]);
    expect(await social.listFriends(b.userId)).toEqual([]);
  });

  it('removeFriend self → SELF_NOT_ALLOWED', async () => {
    const u = await makePlayer();
    await expect(
      social.removeFriend(u.userId, u.userId),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('listIncomingRequests trả về PENDING mới nhất trước', async () => {
    const r = await makePlayer();
    const a = await makePlayer();
    const b = await makePlayer();
    const req1 = await social.sendFriendRequest(a.userId, r.userId, null);
    await new Promise((res) => setTimeout(res, 5));
    const req2 = await social.sendFriendRequest(b.userId, r.userId, null);
    const list = await social.listIncomingRequests(r.userId);
    expect(list.map((x) => x.id)).toEqual([req2.id, req1.id]);
  });

  it('listOutgoingRequests chỉ trả PENDING của caller', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    const out = await social.listOutgoingRequests(a.userId);
    expect(out.map((r) => r.id)).toContain(req.id);
    const out2 = await social.listOutgoingRequests(b.userId);
    expect(out2).toEqual([]);
  });

  it('listIncomingRequests filter ra request từ người đã block caller', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    // b block a sau khi a gửi request → request bị auto cancel rồi, list rỗng
    await social.blockUser(b.userId, a.userId);
    expect(await social.listIncomingRequests(b.userId)).toEqual([]);
    // request giờ là CANCELLED
    const fr = await prisma.friendRequest.findUnique({
      where: { id: req.id },
    });
    expect(fr?.status).toBe(FriendRequestStatus.CANCELLED);
  });
});

describe('Phase 19.1 — SocialService block / unblock', () => {
  it('Self block → SELF_NOT_ALLOWED', async () => {
    const u = await makePlayer();
    await expect(
      social.blockUser(u.userId, u.userId),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('Block idempotent (gọi 2 lần OK)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    const second = await social.blockUser(a.userId, b.userId);
    expect(second.blockedUserId).toBe(b.userId);
  });

  it('Block tự cancel mọi pending request 2 chiều + xoá friendship', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    // pending request từ a→b
    const reqAB = await social.sendFriendRequest(a.userId, b.userId, null);
    // friendship chưa có
    await social.blockUser(a.userId, b.userId);
    const updated = await prisma.friendRequest.findUnique({
      where: { id: reqAB.id },
    });
    expect(updated?.status).toBe(FriendRequestStatus.CANCELLED);
    expect(updated?.respondedAt).not.toBeNull();

    // Trường hợp 2: đã là bạn rồi mới block
    const c = await makePlayer();
    const d = await makePlayer();
    const reqCD = await social.sendFriendRequest(c.userId, d.userId, null);
    await social.acceptFriendRequest(d.userId, reqCD.id);
    await social.blockUser(c.userId, d.userId);
    expect(await social.listFriends(c.userId)).toEqual([]);
    expect(await social.listFriends(d.userId)).toEqual([]);
  });

  it('Unblock idempotent + cho phép gửi lại friend request', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    const r1 = await social.unblockUser(a.userId, b.userId);
    expect(r1.removed).toBe(true);
    const r2 = await social.unblockUser(a.userId, b.userId);
    expect(r2.removed).toBe(false);

    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    expect(req.status).toBe('PENDING');
  });

  it('listBlocks trả về danh sách block của caller (kèm displayName)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    const list = await social.listBlocks(a.userId);
    expect(list).toHaveLength(1);
    expect(list[0].blockedUserId).toBe(b.userId);
    expect(list[0].blockedDisplayName).toBe(b.name);
  });

  it('listFriends filter out user đã bị block / đang block caller', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const req = await social.sendFriendRequest(a.userId, b.userId, null);
    await social.acceptFriendRequest(b.userId, req.id);
    // a block b → friendship đã bị auto xoá
    await social.blockUser(a.userId, b.userId);
    expect(await social.listFriends(a.userId)).toEqual([]);
    expect(await social.listFriends(b.userId)).toEqual([]);
  });

  it('isBlockedBetween + areFriends helpers chính xác', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    expect(await social.isBlockedBetween(a.userId, b.userId)).toBe(false);
    expect(await social.areFriends(a.userId, b.userId)).toBe(false);
    await social.blockUser(a.userId, b.userId);
    expect(await social.isBlockedBetween(a.userId, b.userId)).toBe(true);
    expect(await social.isBlockedBetween(b.userId, a.userId)).toBe(true);

    const c = await makePlayer();
    const d = await makePlayer();
    const req = await social.sendFriendRequest(c.userId, d.userId, null);
    await social.acceptFriendRequest(d.userId, req.id);
    expect(await social.areFriends(c.userId, d.userId)).toBe(true);
    expect(await social.areFriends(d.userId, c.userId)).toBe(true);
  });
});

describe('Phase 19.1 — SocialError class', () => {
  it('SocialError carry code', () => {
    const e = new SocialError('BLOCKED');
    expect(e.code).toBe('BLOCKED');
    expect(e.message).toBe('BLOCKED');
  });
});
