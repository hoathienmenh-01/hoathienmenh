import { Inject, Injectable, Optional } from '@nestjs/common';
import { FriendRequestStatus, Prisma } from '@prisma/client';
import { NotificationHelpers } from '../notification/notification-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import {
  type FriendRequestRow,
  type FriendRow,
  type PlayerBlockRow,
  type PublicCharacterSummaryDto,
  type PublicPlayerProfileDto,
  type RelationshipStatus,
  computePowerScore,
  computeProfileActions,
  formatJoinedYearMonth,
  fullRealmName,
  realmByKey,
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NotificationHelpers)
    private readonly notifications: NotificationHelpers | null = null,
    @Optional()
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService | null = null,
  ) {}

  /**
   * Phase 19.3 — best-effort live online check via RealtimeService.
   * Falls back to `false` when realtime is unavailable (e.g. unit
   * tests without realtime wiring). Safe because the server also
   * exposes `/social/presence` for FE to query in batch.
   */
  private isOnlineSafe(userId: string): boolean {
    try {
      return this.realtime?.isOnline(userId) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Phase 19.3 — Best-effort lookup of a user's display name for
   * embedding in notification `dataJson`. Uses `Character.name` first
   * (canonical display name); falls back to a short suffix of the
   * userId so the FE always has *some* label to render. Never throws.
   */
  private async lookupDisplayName(userId: string): Promise<string> {
    try {
      const char = await this.prisma.character.findUnique({
        where: { userId },
        select: { name: true },
      });
      if (char?.name) return char.name;
    } catch {
      // intentionally swallow — fall through to suffix.
    }
    return userId.slice(-6);
  }

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

    // Phase 19.3 — best-effort notify receiver. Never throws.
    if (this.notifications) {
      const senderName = await this.lookupDisplayName(senderUserId);
      await this.notifications.notifyFriendRequestReceived({
        receiverUserId,
        senderUserId,
        senderName,
        requestId: row.id,
      });
    }

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

    // Phase 19.3 — best-effort notify the original sender that the
    // receiver accepted. Never throws.
    if (this.notifications) {
      const accepterName = await this.lookupDisplayName(receiverUserId);
      await this.notifications.notifyFriendRequestAccepted({
        senderUserId: req.senderUserId,
        accepterUserId: receiverUserId,
        accepterName,
        requestId: req.id,
      });
    }

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
          online: this.isOnlineSafe(friendUserId),
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

  // ---------------------------------------------------------------------------
  // Phase 19.1.C — Public player profile
  // ---------------------------------------------------------------------------

  /**
   * Trả về public profile của `targetUserId` từ góc nhìn `viewerUserId`.
   *
   * Privacy invariants (server enforce):
   *   - KHÔNG bao giờ chọn `email`, `passwordHash`, `role`, `banned`,
   *     `linhThach`, `tienNgoc`, `tienTe`, `nguyenThach`, currency
   *     balance khác, inventory, ledger, IP, sessionId, token. Select
   *     whitelist ở `prisma.character.findUnique` chỉ lấy field cần.
   *   - `BLOCKED_ME` (target đã block viewer) → ném `SocialError('NOT_FOUND')`
   *     để controller mask 404 (chống enumeration "ai đã block tôi").
   *   - `BLOCKED_BY_ME` → trả minimal profile (id + displayName +
   *     relationship), KHÔNG kèm character snapshot.
   *
   * Relationship matrix (tính atomic — 1 query playerBlock + 1 query
   * friendship + 1 query friendRequest PENDING):
   *   - viewerId === targetId → SELF.
   *   - target block viewer → throw NOT_FOUND (404 mask).
   *   - viewer block target → BLOCKED_BY_ME.
   *   - friendship row tồn tại → FRIEND.
   *   - friendRequest PENDING sender=target receiver=viewer → PENDING_INCOMING.
   *   - friendRequest PENDING sender=viewer receiver=target → PENDING_OUTGOING.
   *   - mặc định → STRANGER.
   *
   * `mutualFriendCount` chỉ tính khi target là STRANGER hoặc PENDING
   * (chống leak social graph cho FRIEND/SELF/BLOCKED). Phase 19.1.C
   * dùng INTERSECT đơn giản 2 friend list (cap ở phase này coi như
   * acceptable < 1000 friend/user; Phase 21 sẽ tối ưu nếu cần).
   *
   * Throw `NOT_FOUND` khi target user không tồn tại HOẶC target đã
   * block viewer (mask).
   */
  async getPublicProfile(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicPlayerProfileDto> {
    // SELF early return — chỉ query 1 lần vào character của viewer.
    if (viewerUserId === targetUserId) {
      return this.buildSelfProfile(viewerUserId);
    }

    // 1. Block check 2 chiều — single query trả về cả hướng.
    const blocks = await this.prisma.playerBlock.findMany({
      where: {
        OR: [
          { blockerUserId: viewerUserId, blockedUserId: targetUserId },
          { blockerUserId: targetUserId, blockedUserId: viewerUserId },
        ],
      },
      select: { blockerUserId: true },
    });
    const targetBlockedViewer = blocks.some(
      (b) => b.blockerUserId === targetUserId,
    );
    const viewerBlockedTarget = blocks.some(
      (b) => b.blockerUserId === viewerUserId,
    );

    // Privacy mask: target đã block viewer → 404 (không leak existence).
    if (targetBlockedViewer) {
      throw new SocialError('NOT_FOUND');
    }

    // 2. Verify target user tồn tại (whitelist select — KHÔNG lấy
    // email/role/banned/passwordHash).
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, createdAt: true },
    });
    if (!targetUser) {
      throw new SocialError('NOT_FOUND');
    }

    // 3. Lấy character + sect snapshot (whitelist select — KHÔNG lấy
    // currency / inventory / cultivation settings).
    const targetChar = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: {
        name: true,
        realmKey: true,
        realmStage: true,
        title: true,
        level: true,
        power: true,
        spirit: true,
        speed: true,
        sectId: true,
        sect: { select: { id: true, name: true } },
      },
    });

    // 4. BLOCKED_BY_ME → minimal profile (chỉ relationship + displayName).
    if (viewerBlockedTarget) {
      const status: RelationshipStatus = 'BLOCKED_BY_ME';
      return {
        userId: targetUserId,
        displayName: targetChar?.name ?? null,
        relationshipStatus: status,
        actions: computeProfileActions(status),
        character: null,
        // BLOCKED_BY_ME view — viewer is the blocker; we may surface
        // presence of the blockee for the viewer. Phase 19.3 keeps
        // this conservative and reports OFFLINE to avoid leaking.
        online: false,
        joinedYearMonth: null,
        mutualFriendCount: null,
        sameSect: null,
      };
    }

    // 5. Tính FRIEND / PENDING_* — query friendship + friendRequest.
    const pair = sortUserPair(viewerUserId, targetUserId);
    let status: RelationshipStatus = 'STRANGER';

    if (pair) {
      const friendship = await this.prisma.friendship.findUnique({
        where: { userAId_userBId: { userAId: pair.low, userBId: pair.high } },
        select: { id: true },
      });
      if (friendship) {
        status = 'FRIEND';
      } else {
        // Tìm PENDING request 1 trong 2 hướng (single query).
        const pending = await this.prisma.friendRequest.findFirst({
          where: {
            status: FriendRequestStatus.PENDING,
            OR: [
              { senderUserId: viewerUserId, receiverUserId: targetUserId },
              { senderUserId: targetUserId, receiverUserId: viewerUserId },
            ],
          },
          select: { senderUserId: true },
        });
        if (pending) {
          status =
            pending.senderUserId === viewerUserId
              ? 'PENDING_OUTGOING'
              : 'PENDING_INCOMING';
        }
      }
    }

    // 6. Compute character summary nếu character tồn tại.
    const characterSummary = targetChar
      ? this.toPublicCharacterSummary(targetChar)
      : null;

    // 7. sameSect — null nếu viewer/target chưa có char hoặc target
    //    block-by-me (case này đã return ở bước 4).
    const sameSect = await this.computeSameSect(viewerUserId, targetChar);

    // 8. mutualFriendCount — chỉ tính cho STRANGER + PENDING_* (chống
    //    leak social graph cho FRIEND/SELF).
    const mutualFriendCount =
      status === 'STRANGER' ||
      status === 'PENDING_INCOMING' ||
      status === 'PENDING_OUTGOING'
        ? await this.countMutualFriends(viewerUserId, targetUserId)
        : null;

    return {
      userId: targetUserId,
      displayName: targetChar?.name ?? null,
      relationshipStatus: status,
      actions: computeProfileActions(status),
      character: characterSummary,
      online: this.isOnlineSafe(targetUserId),
      joinedYearMonth: formatJoinedYearMonth(targetUser.createdAt),
      mutualFriendCount,
      sameSect,
    };
  }

  private async buildSelfProfile(
    userId: string,
  ): Promise<PublicPlayerProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true },
    });
    if (!user) throw new SocialError('NOT_FOUND');
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        name: true,
        realmKey: true,
        realmStage: true,
        title: true,
        level: true,
        power: true,
        spirit: true,
        speed: true,
        sectId: true,
        sect: { select: { id: true, name: true } },
      },
    });
    const status: RelationshipStatus = 'SELF';
    return {
      userId,
      displayName: char?.name ?? null,
      relationshipStatus: status,
      actions: computeProfileActions(status),
      character: char ? this.toPublicCharacterSummary(char) : null,
      // SELF profile — viewer is the user; reuse realtime check to
      // reflect the same in-memory presence used for friends/strangers.
      online: this.isOnlineSafe(userId),
      joinedYearMonth: formatJoinedYearMonth(user.createdAt),
      mutualFriendCount: null,
      sameSect: null,
    };
  }

  private toPublicCharacterSummary(char: {
    name: string;
    realmKey: string;
    realmStage: number;
    title: string | null;
    level: number;
    power: number;
    spirit: number;
    speed: number;
    sectId: string | null;
    sect: { id: string; name: string } | null;
  }): PublicCharacterSummaryDto {
    const realmDef = realmByKey(char.realmKey);
    const realmFullName = realmDef
      ? fullRealmName(realmDef, char.realmStage)
      : `${char.realmKey} — ${char.realmStage}`;
    return {
      characterName: char.name,
      realmKey: char.realmKey,
      realmStage: char.realmStage,
      realmFullName,
      level: char.level,
      title: char.title,
      powerScore: computePowerScore({
        power: char.power,
        spirit: char.spirit,
        speed: char.speed,
      }),
      sectId: char.sect?.id ?? char.sectId ?? null,
      sectName: char.sect?.name ?? null,
    };
  }

  private async computeSameSect(
    viewerUserId: string,
    targetChar: { sectId: string | null } | null,
  ): Promise<boolean | null> {
    if (!targetChar || targetChar.sectId === null) return false;
    const viewerChar = await this.prisma.character.findUnique({
      where: { userId: viewerUserId },
      select: { sectId: true },
    });
    if (!viewerChar || viewerChar.sectId === null) return false;
    return viewerChar.sectId === targetChar.sectId;
  }

  /**
   * Count mutual friends giữa viewer + target. Phase 19.1.C dùng
   * INTERSECT 2 friend-id list trong JS. Acceptable < 1000 friend/user
   * (cap thực tế hiện nay). Phase 21 sẽ optimize bằng aggregate
   * query nếu cần.
   */
  private async countMutualFriends(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<number> {
    const [viewerFriends, targetFriends] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: viewerUserId }, { userBId: viewerUserId }] },
        select: { userAId: true, userBId: true },
      }),
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: targetUserId }, { userBId: targetUserId }] },
        select: { userAId: true, userBId: true },
      }),
    ]);
    const viewerSet = new Set<string>(
      viewerFriends.map((r) =>
        r.userAId === viewerUserId ? r.userBId : r.userAId,
      ),
    );
    let count = 0;
    for (const r of targetFriends) {
      const other = r.userAId === targetUserId ? r.userBId : r.userAId;
      if (other === viewerUserId) continue;
      if (viewerSet.has(other)) count += 1;
    }
    return count;
  }
}
