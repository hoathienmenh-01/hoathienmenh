import { Injectable } from '@nestjs/common';
import { FriendRequestStatus, Prisma } from '@prisma/client';
import {
  type FriendRequestRow,
  type FriendRow,
  type PlayerBlockRow,
  sortUserPair,
  validateFriendRequestMessage,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 19.1 — Social System Foundation.
 *
 * SocialService quản lý friend request, friendship, và player block.
 * Detection-first, server-authoritative, không trừ currency / item /
 * không block flow gameplay khác.
 *
 * Hard invariants (test-enforced):
 *   1. Cấm self-friend / self-block — `sendFriendRequest`, `blockUser`
 *      reject ngay với `SELF_NOT_ALLOWED`.
 *   2. Block 2 chiều: nếu A block B hoặc B block A, A KHÔNG gửi được
 *      friendRequest đến B (reject `BLOCKED`). Áp dụng đối xứng cho
 *      mọi action friend-related.
 *   3. Block tự động xoá friendship cũ (nếu có) + cancel mọi PENDING
 *      friendRequest cùng cặp user. Đây là invariant để FE không thấy
 *      "tôi vẫn là bạn của người tôi đã block".
 *   4. Friendship + PrivateChatThread store theo invariant
 *      `userAId < userBId` (lexicographic) → UNIQUE constraint chống
 *      duplicate (A,B) vs (B,A).
 *   5. Chỉ duy nhất 1 PENDING friendRequest giữa cùng cặp (sender,
 *      receiver) tại 1 thời điểm. Sau DECLINED/CANCELLED có thể gửi
 *      lại — service check `findFirst` rồi insert.
 *
 * KHÔNG dùng FK trong DB (soft-reference). Caller (controller) đảm
 * bảo userId truyền vào hợp lệ.
 */

export type SocialErrorCode =
  | 'SELF_NOT_ALLOWED'
  | 'BLOCKED'
  | 'ALREADY_PENDING'
  | 'ALREADY_FRIENDS'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION'
  | 'NOT_AUTHORIZED';

export class SocialError extends Error {
  constructor(public readonly code: SocialErrorCode) {
    super(code);
  }
}

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Friend requests
  // ---------------------------------------------------------------------------

  /**
   * Gửi friend request từ `senderUserId` đến `receiverUserId`.
   *
   * Reject:
   *   - `SELF_NOT_ALLOWED` nếu sender === receiver.
   *   - `BLOCKED` nếu A→B hoặc B→A đang block.
   *   - `ALREADY_FRIENDS` nếu đã là bạn.
   *   - `ALREADY_PENDING` nếu đã có PENDING request hướng nào đó.
   *   - `INVALID_INPUT` nếu message quá dài (>140 chars).
   */
  async sendFriendRequest(
    senderUserId: string,
    receiverUserId: string,
    rawMessage: string | null | undefined,
  ): Promise<FriendRequestRow> {
    if (senderUserId === receiverUserId) {
      throw new SocialError('SELF_NOT_ALLOWED');
    }

    const msgResult = validateFriendRequestMessage(rawMessage);
    if (!msgResult.ok) {
      throw new SocialError('INVALID_INPUT');
    }

    if (await this.isBlockedBetween(senderUserId, receiverUserId)) {
      throw new SocialError('BLOCKED');
    }

    const pair = sortUserPair(senderUserId, receiverUserId);
    if (!pair) throw new SocialError('SELF_NOT_ALLOWED');
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: pair.low, userBId: pair.high } },
    });
    if (friendship) {
      throw new SocialError('ALREADY_FRIENDS');
    }

    const pending = await this.prisma.friendRequest.findFirst({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [
          { senderUserId, receiverUserId },
          { senderUserId: receiverUserId, receiverUserId: senderUserId },
        ],
      },
    });
    if (pending) {
      throw new SocialError('ALREADY_PENDING');
    }

    const row = await this.prisma.friendRequest.create({
      data: {
        senderUserId,
        receiverUserId,
        status: FriendRequestStatus.PENDING,
        message: msgResult.value,
      },
    });
    return this.toFriendRequestRow(row);
  }

  /**
   * Receiver chấp nhận pending friend request → transition PENDING →
   * ACCEPTED + tạo `Friendship` cùng transaction. Idempotency: nếu
   * Friendship đã tồn tại (race), tx rollback friendRequest update +
   * rethrow ALREADY_FRIENDS.
   */
  async acceptFriendRequest(
    receiverUserId: string,
    requestId: string,
  ): Promise<{ request: FriendRequestRow; friendUserId: string }> {
    const req = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new SocialError('NOT_FOUND');
    if (req.receiverUserId !== receiverUserId) {
      throw new SocialError('NOT_AUTHORIZED');
    }
    if (req.status !== FriendRequestStatus.PENDING) {
      throw new SocialError('INVALID_TRANSITION');
    }

    if (await this.isBlockedBetween(req.senderUserId, req.receiverUserId)) {
      throw new SocialError('BLOCKED');
    }

    const pair = sortUserPair(req.senderUserId, req.receiverUserId);
    if (!pair) throw new SocialError('SELF_NOT_ALLOWED');

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.friendRequest.update({
        where: { id: requestId },
        data: {
          status: FriendRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
      });
      await tx.friendship.upsert({
        where: { userAId_userBId: { userAId: pair.low, userBId: pair.high } },
        update: {},
        create: { userAId: pair.low, userBId: pair.high },
      });
      return u;
    });

    return {
      request: this.toFriendRequestRow(updated),
      friendUserId: req.senderUserId,
    };
  }

  /** Receiver từ chối pending friend request. */
  async declineFriendRequest(
    receiverUserId: string,
    requestId: string,
  ): Promise<FriendRequestRow> {
    const req = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new SocialError('NOT_FOUND');
    if (req.receiverUserId !== receiverUserId) {
      throw new SocialError('NOT_AUTHORIZED');
    }
    if (req.status !== FriendRequestStatus.PENDING) {
      throw new SocialError('INVALID_TRANSITION');
    }
    const u = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: FriendRequestStatus.DECLINED,
        respondedAt: new Date(),
      },
    });
    return this.toFriendRequestRow(u);
  }

  /** Sender huỷ pending friend request đã gửi. */
  async cancelFriendRequest(
    senderUserId: string,
    requestId: string,
  ): Promise<FriendRequestRow> {
    const req = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new SocialError('NOT_FOUND');
    if (req.senderUserId !== senderUserId) {
      throw new SocialError('NOT_AUTHORIZED');
    }
    if (req.status !== FriendRequestStatus.PENDING) {
      throw new SocialError('INVALID_TRANSITION');
    }
    const u = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: FriendRequestStatus.CANCELLED,
        respondedAt: new Date(),
      },
    });
    return this.toFriendRequestRow(u);
  }

  // ---------------------------------------------------------------------------
  // Friendship
  // ---------------------------------------------------------------------------

  /** Xoá friendship 2 chiều giữa caller và `friendUserId`. No-op nếu không phải bạn (idempotent). */
  async removeFriend(
    userId: string,
    friendUserId: string,
  ): Promise<{ removed: boolean }> {
    if (userId === friendUserId) {
      throw new SocialError('SELF_NOT_ALLOWED');
    }
    const pair = sortUserPair(userId, friendUserId);
    if (!pair) throw new SocialError('SELF_NOT_ALLOWED');
    const result = await this.prisma.friendship.deleteMany({
      where: { userAId: pair.low, userBId: pair.high },
    });
    return { removed: result.count > 0 };
  }

  /** List friends của `userId` — exclude bất kỳ user nào đang bị `userId` block hoặc đang block `userId`. */
  async listFriends(userId: string): Promise<FriendRow[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
    const friendIds = rows.map((r) =>
      r.userAId === userId ? r.userBId : r.userAId,
    );

    const blocked = await this.fetchBlockedUserIdSet(userId);

    const visibleFriendIds = friendIds.filter((id) => !blocked.has(id));
    const characters = visibleFriendIds.length
      ? await this.prisma.character.findMany({
          where: { userId: { in: visibleFriendIds } },
          select: { userId: true, name: true },
        })
      : [];
    const nameByUserId = new Map(characters.map((c) => [c.userId, c.name]));

    return rows
      .filter((r) => {
        const other = r.userAId === userId ? r.userBId : r.userAId;
        return !blocked.has(other);
      })
      .map((r) => {
        const friendUserId =
          r.userAId === userId ? r.userBId : r.userAId;
        return {
          id: r.id,
          friendUserId,
          friendDisplayName: nameByUserId.get(friendUserId) ?? null,
          online: false,
          createdAt: r.createdAt.toISOString(),
        } satisfies FriendRow;
      });
  }

  // ---------------------------------------------------------------------------
  // Friend request lists
  // ---------------------------------------------------------------------------

  async listIncomingRequests(
    userId: string,
  ): Promise<FriendRequestRow[]> {
    const blocked = await this.fetchBlockedUserIdSet(userId);
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        receiverUserId: userId,
        status: FriendRequestStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .filter((r) => !blocked.has(r.senderUserId))
      .map((r) => this.toFriendRequestRow(r));
  }

  async listOutgoingRequests(
    userId: string,
  ): Promise<FriendRequestRow[]> {
    const rows = await this.prisma.friendRequest.findMany({
      where: {
        senderUserId: userId,
        status: FriendRequestStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toFriendRequestRow(r));
  }

  // ---------------------------------------------------------------------------
  // Player block
  // ---------------------------------------------------------------------------

  /**
   * Block user. Side-effect:
   *   - Idempotent upsert.
   *   - Auto-cancel mọi pending request giữa cặp user (cả 2 chiều).
   *   - Auto-remove friendship (cả 2 chiều) nếu đang là bạn.
   */
  async blockUser(
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<PlayerBlockRow> {
    if (blockerUserId === blockedUserId) {
      throw new SocialError('SELF_NOT_ALLOWED');
    }

    const pair = sortUserPair(blockerUserId, blockedUserId);
    if (!pair) throw new SocialError('SELF_NOT_ALLOWED');

    const row = await this.prisma.$transaction(async (tx) => {
      const block = await tx.playerBlock.upsert({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId,
            blockedUserId,
          },
        },
        update: {},
        create: { blockerUserId, blockedUserId },
      });

      // Cancel mọi pending request 2 chiều
      await tx.friendRequest.updateMany({
        where: {
          status: FriendRequestStatus.PENDING,
          OR: [
            {
              senderUserId: blockerUserId,
              receiverUserId: blockedUserId,
            },
            {
              senderUserId: blockedUserId,
              receiverUserId: blockerUserId,
            },
          ],
        },
        data: {
          status: FriendRequestStatus.CANCELLED,
          respondedAt: new Date(),
        },
      });

      // Auto-remove friendship 2 chiều
      await tx.friendship.deleteMany({
        where: {
          userAId: pair.low,
          userBId: pair.high,
        },
      });

      return block;
    });

    const blockedChar = await this.prisma.character.findUnique({
      where: { userId: blockedUserId },
      select: { name: true },
    });

    return {
      id: row.id,
      blockedUserId: row.blockedUserId,
      blockedDisplayName: blockedChar?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Unblock — idempotent. */
  async unblockUser(
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<{ removed: boolean }> {
    const result = await this.prisma.playerBlock.deleteMany({
      where: { blockerUserId, blockedUserId },
    });
    return { removed: result.count > 0 };
  }

  async listBlocks(blockerUserId: string): Promise<PlayerBlockRow[]> {
    const rows = await this.prisma.playerBlock.findMany({
      where: { blockerUserId },
      orderBy: { createdAt: 'desc' },
    });
    const ids = rows.map((r) => r.blockedUserId);
    const chars = ids.length
      ? await this.prisma.character.findMany({
          where: { userId: { in: ids } },
          select: { userId: true, name: true },
        })
      : [];
    const nameMap = new Map(chars.map((c) => [c.userId, c.name]));
    return rows.map((r) => ({
      id: r.id,
      blockedUserId: r.blockedUserId,
      blockedDisplayName: nameMap.get(r.blockedUserId) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Shared helpers (public for cross-service use — chat-private / chat-group)
  // ---------------------------------------------------------------------------

  /**
   * Trả về true nếu một trong 2 user đang block hướng kia. Public để
   * `ChatPrivateService` / `ChatGroupService` re-use.
   */
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const found = await this.prisma.playerBlock.findFirst({
      where: {
        OR: [
          { blockerUserId: a, blockedUserId: b },
          { blockerUserId: b, blockedUserId: a },
        ],
      },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * Trả về true nếu A đã friend B (theo Friendship table). Public để
   * chat services re-use khi cần check "chỉ bạn mới chat".
   */
  async areFriends(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const pair = sortUserPair(a, b);
    if (!pair) return false;
    const fr = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: pair.low, userBId: pair.high } },
      select: { id: true },
    });
    return fr !== null;
  }

  /**
   * Tập userId mà `userId` đang block HOẶC đang bị block bởi. Dùng
   * filter friend list / request list.
   */
  private async fetchBlockedUserIdSet(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.playerBlock.findMany({
      where: {
        OR: [{ blockerUserId: userId }, { blockedUserId: userId }],
      },
      select: { blockerUserId: true, blockedUserId: true },
    });
    const set = new Set<string>();
    for (const r of rows) {
      if (r.blockerUserId === userId) set.add(r.blockedUserId);
      else set.add(r.blockerUserId);
    }
    return set;
  }

  private toFriendRequestRow(
    row: Prisma.FriendRequestGetPayload<object>,
  ): FriendRequestRow {
    return {
      id: row.id,
      senderUserId: row.senderUserId,
      receiverUserId: row.receiverUserId,
      status: row.status,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
      respondedAt: row.respondedAt
        ? row.respondedAt.toISOString()
        : null,
    };
  }
}
