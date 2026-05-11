import { Inject, Injectable, Optional } from '@nestjs/common';
import { NotificationHelpers } from '../notification/notification-helpers';
import {
  CHAT_HIDDEN_MESSAGE_PLACEHOLDER,
  type GroupChatMemberRow,
  type GroupChatMessageRow,
  type GroupChatRow,
  SOCIAL_LIMITS,
  validateChatMessageBody,
  validateGroupName,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  ChatModerationError,
  ChatModerationService,
} from '../chat-moderation/chat-moderation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialService } from '../social/social.service';

/**
 * Phase 19.1 — Group chat (chat nhóm cơ bản).
 *
 * Server-authoritative invariants (test-enforced):
 *   - Owner luôn là member (tự động insert khi `createGroupChat`).
 *   - Chỉ owner mới `addGroupMember` / `removeGroupMember`. Owner
 *     không thể tự remove khỏi group (FE muốn dissolve group nên dùng
 *     follow-up endpoint).
 *   - Add member reject nếu owner đã block target hoặc target đã
 *     block owner (`BLOCKED`).
 *   - Chỉ member mới send/list message. Non-member → 404 mask cho cả
 *     GET messages và POST message (không leak existence).
 *   - Cap member count ≤ `SOCIAL_LIMITS.GROUP_MEMBER_MAX` (30).
 *   - Body message 1..500 char.
 *
 * Realtime fanout:
 *   - Khi gửi group message → emit `group-chat:msg` đến mọi member
 *     qua `RealtimeService.emitToUser` (không broadcast).
 */
export type ChatGroupErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'BLOCKED'
  | 'GROUP_FULL'
  | 'DUPLICATE_MEMBER'
  | 'MUTED'
  | 'GROUP_LOCKED'
  | 'GROUP_DISSOLVED';

export class ChatGroupError extends Error {
  constructor(public readonly code: ChatGroupErrorCode) {
    super(code);
  }
}

@Injectable()
export class ChatGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly realtime: RealtimeService,
    private readonly moderation: ChatModerationService,
    @Optional()
    @Inject(NotificationHelpers)
    private readonly notifications: NotificationHelpers | null = null,
  ) {}

  // ---------------------------------------------------------------------------
  // Group lifecycle
  // ---------------------------------------------------------------------------

  async createGroupChat(
    ownerUserId: string,
    rawName: string,
  ): Promise<GroupChatRow> {
    const v = validateGroupName(rawName);
    if (!v.ok) throw new ChatGroupError('INVALID_INPUT');

    const group = await this.prisma.$transaction(async (tx) => {
      const g = await tx.groupChat.create({
        data: { name: v.value, ownerUserId },
      });
      await tx.groupChatMember.create({
        data: { groupId: g.id, userId: ownerUserId },
      });
      return g;
    });

    return {
      id: group.id,
      name: group.name,
      ownerUserId: group.ownerUserId,
      memberCount: 1,
      createdAt: group.createdAt.toISOString(),
    };
  }

  /**
   * Add member vào group. Chỉ owner thực hiện. Reject:
   *   - `NOT_FOUND` nếu group không tồn tại.
   *   - `NOT_AUTHORIZED` nếu caller không phải owner.
   *   - `BLOCKED` nếu owner và target đang block lẫn nhau.
   *   - `DUPLICATE_MEMBER` nếu target đã là member.
   *   - `GROUP_FULL` nếu memberCount >= GROUP_MEMBER_MAX.
   */
  async addGroupMember(
    callerUserId: string,
    groupId: string,
    targetUserId: string,
  ): Promise<GroupChatMemberRow> {
    const group = await this.prisma.groupChat.findUnique({
      where: { id: groupId },
    });
    if (!group) throw new ChatGroupError('NOT_FOUND');
    if (group.ownerUserId !== callerUserId) {
      throw new ChatGroupError('NOT_AUTHORIZED');
    }
    if (callerUserId === targetUserId) {
      throw new ChatGroupError('DUPLICATE_MEMBER');
    }
    if (await this.social.isBlockedBetween(callerUserId, targetUserId)) {
      throw new ChatGroupError('BLOCKED');
    }

    const existing = await this.prisma.groupChatMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (existing) throw new ChatGroupError('DUPLICATE_MEMBER');

    const count = await this.prisma.groupChatMember.count({
      where: { groupId },
    });
    if (count >= SOCIAL_LIMITS.GROUP_MEMBER_MAX) {
      throw new ChatGroupError('GROUP_FULL');
    }

    const m = await this.prisma.groupChatMember.create({
      data: { groupId, userId: targetUserId },
    });

    const char = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { name: true },
    });

    // Phase 19.3 — best-effort GROUP_MEMBER_ADDED notification for
    // the newly added user. Caller (owner) is not notified.
    if (this.notifications) {
      const ownerChar = await this.prisma.character.findUnique({
        where: { userId: callerUserId },
        select: { name: true },
      });
      await this.notifications.notifyGroupMemberAdded({
        addedUserId: targetUserId,
        addedByUserId: callerUserId,
        addedByName: ownerChar?.name ?? callerUserId.slice(-6),
        groupId,
        groupName: group.name,
      });
    }

    return {
      id: m.id,
      groupId: m.groupId,
      userId: m.userId,
      displayName: char?.name ?? null,
      joinedAt: m.joinedAt.toISOString(),
    };
  }

  /**
   * Remove member khỏi group. Chỉ owner thực hiện. Owner KHÔNG thể
   * tự remove (sẽ throw NOT_AUTHORIZED — dùng deleteGroup follow-up).
   */
  async removeGroupMember(
    callerUserId: string,
    groupId: string,
    targetUserId: string,
  ): Promise<{ removed: boolean }> {
    const group = await this.prisma.groupChat.findUnique({
      where: { id: groupId },
    });
    if (!group) throw new ChatGroupError('NOT_FOUND');
    if (group.ownerUserId !== callerUserId) {
      throw new ChatGroupError('NOT_AUTHORIZED');
    }
    if (targetUserId === group.ownerUserId) {
      throw new ChatGroupError('NOT_AUTHORIZED');
    }

    const result = await this.prisma.groupChatMember.deleteMany({
      where: { groupId, userId: targetUserId },
    });
    return { removed: result.count > 0 };
  }

  // ---------------------------------------------------------------------------
  // Group message
  // ---------------------------------------------------------------------------

  async sendGroupMessage(
    callerUserId: string,
    groupId: string,
    rawBody: string,
  ): Promise<GroupChatMessageRow> {
    await this.requireMember(callerUserId, groupId);

    // Phase 19.2 — group lock / dissolve guard. Mask dissolved groups
    // as NOT_FOUND for users (membership preserved is irrelevant once
    // dissolved).
    const group = await this.prisma.groupChat.findUnique({
      where: { id: groupId },
      select: { id: true, lockedAt: true, dissolvedAt: true },
    });
    if (!group || group.dissolvedAt) {
      throw new ChatGroupError('NOT_FOUND');
    }
    if (group.lockedAt) throw new ChatGroupError('GROUP_LOCKED');

    // Phase 19.2 — mute enforcement (GROUP_CHAT scope).
    try {
      await this.moderation.assertNotMuted(callerUserId, 'GROUP_CHAT');
    } catch (e) {
      if (e instanceof ChatModerationError && e.code === 'MUTED') {
        throw new ChatGroupError('MUTED');
      }
      throw e;
    }

    const v = validateChatMessageBody(rawBody, 'GROUP');
    if (!v.ok) throw new ChatGroupError('INVALID_INPUT');

    const row = await this.prisma.groupChatMessage.create({
      data: { groupId, senderUserId: callerUserId, body: v.value },
    });

    const senderChar = await this.prisma.character.findUnique({
      where: { userId: callerUserId },
      select: { name: true },
    });
    const view: GroupChatMessageRow = {
      id: row.id,
      groupId: row.groupId,
      senderUserId: row.senderUserId,
      senderDisplayName: senderChar?.name ?? null,
      body: row.body,
      isHidden: false,
      createdAt: row.createdAt.toISOString(),
    };

    // Fanout WS to all members (best-effort, fail-soft).
    let memberUserIds: string[] = [];
    try {
      const members = await this.prisma.groupChatMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      memberUserIds = members.map((m) => m.userId);
      for (const uid of memberUserIds) {
        this.realtime.emitToUser(uid, 'group-chat:msg', view);
      }
    } catch {
      // realtime fanout best-effort
    }

    // Phase 19.3 — best-effort notification to every member except
    // sender. Helper iterates and swallows errors per row.
    if (this.notifications && memberUserIds.length > 0) {
      const groupRow = await this.prisma.groupChat.findUnique({
        where: { id: groupId },
        select: { name: true },
      });
      await this.notifications.notifyGroupMessageReceivedBulk({
        memberUserIds,
        senderUserId: callerUserId,
        senderName: senderChar?.name ?? callerUserId.slice(-6),
        groupId,
        groupName: groupRow?.name ?? '',
        messageId: row.id,
      });
    }

    return view;
  }

  async listGroupMessages(
    callerUserId: string,
    groupId: string,
    limit = 50,
  ): Promise<GroupChatMessageRow[]> {
    await this.requireMember(callerUserId, groupId);
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const rows = await this.prisma.groupChatMessage.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    const senderIds = Array.from(new Set(rows.map((r) => r.senderUserId)));
    const chars = senderIds.length
      ? await this.prisma.character.findMany({
          where: { userId: { in: senderIds } },
          select: { userId: true, name: true },
        })
      : [];
    const nameMap = new Map(chars.map((c) => [c.userId, c.name]));

    // Phase 19.2 — soft-hide: thay body bằng placeholder khi
    // `row.hiddenAt != null`. FE phân biệt qua `isHidden`.
    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      senderUserId: r.senderUserId,
      senderDisplayName: nameMap.get(r.senderUserId) ?? null,
      body: r.hiddenAt ? CHAT_HIDDEN_MESSAGE_PLACEHOLDER : r.body,
      isHidden: r.hiddenAt !== null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Group list / members
  // ---------------------------------------------------------------------------

  async listGroups(callerUserId: string): Promise<GroupChatRow[]> {
    const memberRows = await this.prisma.groupChatMember.findMany({
      where: { userId: callerUserId },
      orderBy: { joinedAt: 'desc' },
    });
    const groupIds = memberRows.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const groups = await this.prisma.groupChat.findMany({
      where: { id: { in: groupIds } },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.prisma.groupChatMember.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.groupId, c._count._all]));

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      ownerUserId: g.ownerUserId,
      memberCount: countMap.get(g.id) ?? 0,
      createdAt: g.createdAt.toISOString(),
    }));
  }

  async listGroupMembers(
    callerUserId: string,
    groupId: string,
  ): Promise<GroupChatMemberRow[]> {
    await this.requireMember(callerUserId, groupId);
    const rows = await this.prisma.groupChatMember.findMany({
      where: { groupId },
      orderBy: { joinedAt: 'asc' },
    });
    const userIds = rows.map((r) => r.userId);
    const chars = userIds.length
      ? await this.prisma.character.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, name: true },
        })
      : [];
    const nameMap = new Map(chars.map((c) => [c.userId, c.name]));
    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      userId: r.userId,
      displayName: nameMap.get(r.userId) ?? null,
      joinedAt: r.joinedAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Reject `NOT_FOUND` (mask) nếu group không tồn tại HOẶC caller
   * không phải member.
   */
  private async requireMember(
    callerUserId: string,
    groupId: string,
  ): Promise<void> {
    const group = await this.prisma.groupChat.findUnique({
      where: { id: groupId },
    });
    if (!group) throw new ChatGroupError('NOT_FOUND');

    const m = await this.prisma.groupChatMember.findUnique({
      where: { groupId_userId: { groupId, userId: callerUserId } },
    });
    if (!m) throw new ChatGroupError('NOT_FOUND');
  }
}
