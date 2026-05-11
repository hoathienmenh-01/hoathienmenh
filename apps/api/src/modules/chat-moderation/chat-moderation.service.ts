import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CHAT_MODERATION_LIMITS,
  isChatMessageReportReason,
  isChatMessageReportStatus,
  isChatMessageReportType,
  isChatMuteScope,
  muteScopeApplies,
  sanitizeChatModerationText,
  validateChatMutePayload,
  validateChatReportSubmission,
  type AdminChatModerationSummary,
  type AdminChatMuteListResponse,
  type AdminChatReportListItem,
  type AdminChatReportListResponse,
  type ChatMessageReportReason,
  type ChatMessageReportRow,
  type ChatMessageReportStatus,
  type ChatMessageReportType,
  type ChatMuteRow,
  type ChatMuteScope,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 19.2 — Chat Moderation & Report System service.
 *
 * Server-authoritative invariants (test-enforced):
 *   - User chỉ report được message họ có quyền nhìn thấy (thread/group
 *     member). Non-member → `NOT_FOUND` mask (KHÔNG leak existence).
 *   - Cấm duplicate report cùng `(reporter, message)` qua unique index
 *     Prisma. Service catch + map ra `DUPLICATE_REPORT`.
 *   - Reason invalid → `INVALID_INPUT`.
 *   - Details quá dài → tự sanitize cap 500 ký tự (không reject).
 *   - Mute: enforce qua `findActiveMuteForSend` trước mọi send path.
 *     `ALL_CHAT` mute cover mọi target scope.
 *   - Mute hết hạn auto-skip ở query (filter expiresAt > now).
 *   - Hide message: soft-hide (set `hiddenAt` + `hiddenByAdminId` +
 *     `hideReason`), KHÔNG hard-delete để giữ audit. Service trả về
 *     placeholder cho FE qua `listX` paths khi `hiddenAt != null`.
 *   - Group lock: reject send + add member với `GROUP_LOCKED`.
 *   - Group dissolve: soft-delete, reject mọi mutation, không list.
 *
 * AdminAuditLog: mọi admin mutation (ack/resolve/mute/unmute/hide/
 * unhide/lock/unlock/dissolve) ghi 1 row qua helper `audit()`.
 *
 * Privacy:
 *   - KHÔNG lưu raw IP / token / cookie / password.
 *   - `detailsText` sanitize qua `sanitizeChatModerationText` trước
 *     khi persist.
 *   - Admin lookup message preview qua service-level method có policy
 *     gate (Phase 19.2 default: admin xem full body khi report).
 */

export type ChatModerationErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'DUPLICATE_REPORT'
  | 'INVALID_TRANSITION'
  | 'GROUP_LOCKED'
  | 'GROUP_DISSOLVED'
  | 'MUTED';

export class ChatModerationError extends Error {
  constructor(public readonly code: ChatModerationErrorCode) {
    super(code);
  }
}

export interface SubmitReportInput {
  messageType: unknown;
  privateMessageId?: string | null;
  groupMessageId?: string | null;
  reason: unknown;
  detailsText?: string | null;
}

export interface AdminListReportsFilter {
  status?: ChatMessageReportStatus;
  reason?: ChatMessageReportReason;
  messageType?: ChatMessageReportType;
  targetUserId?: string;
  reporterUserId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AdminMutePayload {
  userId: string;
  scope: unknown;
  reason: unknown;
  expiresAt?: string | Date | null;
}

@Injectable()
export class ChatModerationService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // User-facing API
  // ---------------------------------------------------------------------------

  /**
   * Người chơi report 1 tin nhắn private/group. Service:
   *  1. Validate input (reason + messageType + sanitize details).
   *  2. Verify message exists + reporter có quyền nhìn (thread/group
   *     member). Non-member → NOT_FOUND mask.
   *  3. Snapshot `targetUserId` từ message (deterministic at-time-of-
   *     report; admin xoá user sau không break audit).
   *  4. Insert ChatMessageReport. Unique index conflict → DUPLICATE_REPORT.
   */
  async submitReport(
    reporterUserId: string,
    input: SubmitReportInput,
  ): Promise<ChatMessageReportRow> {
    const v = validateChatReportSubmission({
      messageType: input.messageType,
      reason: input.reason,
      detailsText: input.detailsText ?? null,
    });
    if (!v.ok) throw new ChatModerationError('INVALID_INPUT');

    let targetUserId: string | null = null;
    let privateMessageId: string | null = null;
    let groupMessageId: string | null = null;
    let groupId: string | null = null;

    if (v.value.messageType === 'PRIVATE') {
      if (!input.privateMessageId) {
        throw new ChatModerationError('INVALID_INPUT');
      }
      const msg = await this.prisma.privateChatMessage.findUnique({
        where: { id: input.privateMessageId },
        select: { id: true, threadId: true, senderUserId: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      // Verify reporter là thành viên thread.
      const thread = await this.prisma.privateChatThread.findUnique({
        where: { id: msg.threadId },
        select: { userAId: true, userBId: true },
      });
      if (
        !thread ||
        (thread.userAId !== reporterUserId && thread.userBId !== reporterUserId)
      ) {
        throw new ChatModerationError('NOT_FOUND');
      }
      // Reporter không report message của chính mình.
      if (msg.senderUserId === reporterUserId) {
        throw new ChatModerationError('INVALID_INPUT');
      }
      privateMessageId = msg.id;
      targetUserId = msg.senderUserId;
    } else {
      if (!input.groupMessageId) {
        throw new ChatModerationError('INVALID_INPUT');
      }
      const msg = await this.prisma.groupChatMessage.findUnique({
        where: { id: input.groupMessageId },
        select: { id: true, groupId: true, senderUserId: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      // Verify reporter là member group.
      const member = await this.prisma.groupChatMember.findUnique({
        where: {
          groupId_userId: { groupId: msg.groupId, userId: reporterUserId },
        },
        select: { id: true },
      });
      if (!member) throw new ChatModerationError('NOT_FOUND');
      if (msg.senderUserId === reporterUserId) {
        throw new ChatModerationError('INVALID_INPUT');
      }
      groupMessageId = msg.id;
      groupId = msg.groupId;
      targetUserId = msg.senderUserId;
    }

    try {
      const row = await this.prisma.chatMessageReport.create({
        data: {
          reporterUserId,
          targetUserId,
          messageType: v.value.messageType,
          privateMessageId,
          groupMessageId,
          groupId,
          reason: v.value.reason,
          detailsText: v.value.detailsText,
        },
      });
      return this.toReportRow(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ChatModerationError('DUPLICATE_REPORT');
      }
      throw e;
    }
  }

  /**
   * Người chơi xem report của chính mình (limit + descending by createdAt).
   */
  async listMyReports(
    reporterUserId: string,
    limit = 50,
  ): Promise<ChatMessageReportRow[]> {
    const rows = await this.prisma.chatMessageReport.findMany({
      where: { reporterUserId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, limit), 100),
    });
    return rows.map((r) => this.toReportRow(r));
  }

  // ---------------------------------------------------------------------------
  // Admin API — report lifecycle
  // ---------------------------------------------------------------------------

  async adminListReports(
    filter: AdminListReportsFilter,
  ): Promise<AdminChatReportListResponse> {
    const where: Prisma.ChatMessageReportWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.reason) where.reason = filter.reason;
    if (filter.messageType) where.messageType = filter.messageType;
    if (filter.targetUserId) where.targetUserId = filter.targetUserId;
    if (filter.reporterUserId) where.reporterUserId = filter.reporterUserId;
    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }

    const take = Math.min(
      Math.max(1, filter.limit ?? CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_SIZE),
      CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_MAX,
    );
    const skip = Math.max(0, filter.offset ?? 0);

    const [rows, total] = await Promise.all([
      this.prisma.chatMessageReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.chatMessageReport.count({ where }),
    ]);

    // Fetch preview + display names — batch to reduce N+1.
    const privateMsgIds = rows
      .filter((r) => r.privateMessageId)
      .map((r) => r.privateMessageId as string);
    const groupMsgIds = rows
      .filter((r) => r.groupMessageId)
      .map((r) => r.groupMessageId as string);
    const reporterIds = Array.from(new Set(rows.map((r) => r.reporterUserId)));
    const targetIds = Array.from(
      new Set(
        rows
          .map((r) => r.targetUserId)
          .filter((v): v is string => typeof v === 'string'),
      ),
    );

    const [privateMsgs, groupMsgs, chars] = await Promise.all([
      privateMsgIds.length
        ? this.prisma.privateChatMessage.findMany({
            where: { id: { in: privateMsgIds } },
            select: { id: true, body: true, hiddenAt: true },
          })
        : Promise.resolve([]),
      groupMsgIds.length
        ? this.prisma.groupChatMessage.findMany({
            where: { id: { in: groupMsgIds } },
            select: { id: true, body: true, hiddenAt: true },
          })
        : Promise.resolve([]),
      reporterIds.length || targetIds.length
        ? this.prisma.character.findMany({
            where: {
              userId: { in: Array.from(new Set([...reporterIds, ...targetIds])) },
            },
            select: { userId: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const privateMap = new Map(privateMsgs.map((m) => [m.id, m]));
    const groupMap = new Map(groupMsgs.map((m) => [m.id, m]));
    const charMap = new Map(chars.map((c) => [c.userId, c.name]));

    const items: AdminChatReportListItem[] = rows.map((r) => {
      let preview: string | null = null;
      let hiddenAt: string | null = null;
      if (r.privateMessageId) {
        const m = privateMap.get(r.privateMessageId);
        if (m) {
          preview = m.body;
          hiddenAt = m.hiddenAt?.toISOString() ?? null;
        }
      } else if (r.groupMessageId) {
        const m = groupMap.get(r.groupMessageId);
        if (m) {
          preview = m.body;
          hiddenAt = m.hiddenAt?.toISOString() ?? null;
        }
      }
      return {
        ...this.toReportRow(r),
        messagePreview: preview,
        messageHiddenAt: hiddenAt,
        reporterDisplayName: charMap.get(r.reporterUserId) ?? null,
        targetDisplayName: r.targetUserId
          ? charMap.get(r.targetUserId) ?? null
          : null,
      };
    });

    return { items, total };
  }

  /** Admin transition report `OPEN → ACKNOWLEDGED`. */
  async adminAckReport(
    adminUserId: string,
    reportId: string,
  ): Promise<ChatMessageReportRow> {
    const row = await this.prisma.chatMessageReport.findUnique({
      where: { id: reportId },
    });
    if (!row) throw new ChatModerationError('NOT_FOUND');
    if (row.status !== 'OPEN') {
      throw new ChatModerationError('INVALID_TRANSITION');
    }
    const updated = await this.prisma.chatMessageReport.update({
      where: { id: reportId },
      data: { status: 'ACKNOWLEDGED' },
    });
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_REPORT_ACK', {
      reportId,
      reporterUserId: row.reporterUserId,
      targetUserId: row.targetUserId,
      reason: row.reason,
      messageType: row.messageType,
    });
    return this.toReportRow(updated);
  }

  /**
   * Admin chuyển report sang `RESOLVED` hoặc `REJECTED`. Resolved =
   * action đã thực hiện (mute / hide / etc — admin tự chọn). Rejected =
   * không vi phạm, đóng case.
   */
  async adminResolveReport(
    adminUserId: string,
    reportId: string,
    nextStatus: ChatMessageReportStatus,
    rawNote: string | null,
  ): Promise<ChatMessageReportRow> {
    if (nextStatus !== 'RESOLVED' && nextStatus !== 'REJECTED') {
      throw new ChatModerationError('INVALID_INPUT');
    }
    const row = await this.prisma.chatMessageReport.findUnique({
      where: { id: reportId },
    });
    if (!row) throw new ChatModerationError('NOT_FOUND');
    if (row.status === 'RESOLVED' || row.status === 'REJECTED') {
      throw new ChatModerationError('INVALID_TRANSITION');
    }
    const note = sanitizeChatModerationText(
      rawNote,
      CHAT_MODERATION_LIMITS.RESOLUTION_NOTE_MAX,
    );
    const now = new Date();
    const updated = await this.prisma.chatMessageReport.update({
      where: { id: reportId },
      data: {
        status: nextStatus,
        resolvedAt: now,
        resolvedByAdminId: adminUserId,
        resolutionNote: note,
      },
    });
    await this.audit(
      adminUserId,
      nextStatus === 'RESOLVED'
        ? 'ADMIN_CHAT_MODERATION_REPORT_RESOLVE'
        : 'ADMIN_CHAT_MODERATION_REPORT_REJECT',
      {
        reportId,
        reporterUserId: row.reporterUserId,
        targetUserId: row.targetUserId,
        reason: row.reason,
        messageType: row.messageType,
        note,
      },
    );
    return this.toReportRow(updated);
  }

  // ---------------------------------------------------------------------------
  // Admin API — mute lifecycle
  // ---------------------------------------------------------------------------

  async adminCreateMute(
    adminUserId: string,
    payload: AdminMutePayload,
  ): Promise<ChatMuteRow> {
    if (!payload.userId || typeof payload.userId !== 'string') {
      throw new ChatModerationError('INVALID_INPUT');
    }
    if (payload.userId === adminUserId) {
      // Admin không tự câm chính mình — bug-prevent.
      throw new ChatModerationError('INVALID_INPUT');
    }
    const now = new Date();
    const v = validateChatMutePayload(
      {
        scope: payload.scope,
        reason: payload.reason,
        expiresAt: payload.expiresAt ?? null,
      },
      now,
    );
    if (!v.ok) throw new ChatModerationError('INVALID_INPUT');

    const targetExists = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
    if (!targetExists) throw new ChatModerationError('NOT_FOUND');

    const row = await this.prisma.chatMute.create({
      data: {
        userId: payload.userId,
        mutedByAdminId: adminUserId,
        reason: v.value.reason,
        scope: v.value.scope,
        expiresAt: v.value.expiresAt,
        startsAt: now,
      },
    });

    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_MUTE_CREATE', {
      muteId: row.id,
      targetUserId: payload.userId,
      scope: v.value.scope,
      expiresAt: v.value.expiresAt?.toISOString() ?? null,
      reason: v.value.reason,
    });

    return this.toMuteRow(row, now);
  }

  async adminRevokeMute(adminUserId: string, muteId: string): Promise<ChatMuteRow> {
    const row = await this.prisma.chatMute.findUnique({ where: { id: muteId } });
    if (!row) throw new ChatModerationError('NOT_FOUND');
    if (row.revokedAt) {
      throw new ChatModerationError('INVALID_TRANSITION');
    }
    const now = new Date();
    const updated = await this.prisma.chatMute.update({
      where: { id: muteId },
      data: { revokedAt: now, revokedByAdminId: adminUserId },
    });
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_MUTE_REVOKE', {
      muteId,
      targetUserId: row.userId,
      scope: row.scope,
    });
    return this.toMuteRow(updated, now);
  }

  async adminListMutes(filter: {
    userId?: string;
    scope?: ChatMuteScope;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AdminChatMuteListResponse> {
    const where: Prisma.ChatMuteWhereInput = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.scope) where.scope = filter.scope;
    if (filter.activeOnly) {
      where.revokedAt = null;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }
    const take = Math.min(
      Math.max(1, filter.limit ?? CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_SIZE),
      CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_MAX,
    );
    const skip = Math.max(0, filter.offset ?? 0);
    const [rows, total] = await Promise.all([
      this.prisma.chatMute.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.chatMute.count({ where }),
    ]);
    const now = new Date();
    return {
      items: rows.map((r) => this.toMuteRow(r, now)),
      total,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin API — hide / unhide message
  // ---------------------------------------------------------------------------

  async adminHideMessage(
    adminUserId: string,
    messageType: ChatMessageReportType,
    messageId: string,
    rawReason: string | null,
  ): Promise<{ ok: true; messageId: string; messageType: ChatMessageReportType }> {
    if (!isChatMessageReportType(messageType)) {
      throw new ChatModerationError('INVALID_INPUT');
    }
    const reason = sanitizeChatModerationText(
      rawReason,
      CHAT_MODERATION_LIMITS.ADMIN_REASON_MAX,
    );
    const now = new Date();
    if (messageType === 'PRIVATE') {
      const msg = await this.prisma.privateChatMessage.findUnique({
        where: { id: messageId },
        select: { id: true, hiddenAt: true, senderUserId: true, threadId: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      if (msg.hiddenAt) throw new ChatModerationError('INVALID_TRANSITION');
      await this.prisma.privateChatMessage.update({
        where: { id: messageId },
        data: { hiddenAt: now, hiddenByAdminId: adminUserId, hideReason: reason },
      });
      await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_MESSAGE_HIDE', {
        messageType,
        messageId,
        senderUserId: msg.senderUserId,
        threadId: msg.threadId,
        reason,
      });
    } else {
      const msg = await this.prisma.groupChatMessage.findUnique({
        where: { id: messageId },
        select: { id: true, hiddenAt: true, senderUserId: true, groupId: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      if (msg.hiddenAt) throw new ChatModerationError('INVALID_TRANSITION');
      await this.prisma.groupChatMessage.update({
        where: { id: messageId },
        data: { hiddenAt: now, hiddenByAdminId: adminUserId, hideReason: reason },
      });
      await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_MESSAGE_HIDE', {
        messageType,
        messageId,
        senderUserId: msg.senderUserId,
        groupId: msg.groupId,
        reason,
      });
    }
    return { ok: true, messageId, messageType };
  }

  async adminUnhideMessage(
    adminUserId: string,
    messageType: ChatMessageReportType,
    messageId: string,
  ): Promise<{ ok: true; messageId: string; messageType: ChatMessageReportType }> {
    if (!isChatMessageReportType(messageType)) {
      throw new ChatModerationError('INVALID_INPUT');
    }
    if (messageType === 'PRIVATE') {
      const msg = await this.prisma.privateChatMessage.findUnique({
        where: { id: messageId },
        select: { id: true, hiddenAt: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      if (!msg.hiddenAt) throw new ChatModerationError('INVALID_TRANSITION');
      await this.prisma.privateChatMessage.update({
        where: { id: messageId },
        data: { hiddenAt: null, hiddenByAdminId: null, hideReason: null },
      });
    } else {
      const msg = await this.prisma.groupChatMessage.findUnique({
        where: { id: messageId },
        select: { id: true, hiddenAt: true },
      });
      if (!msg) throw new ChatModerationError('NOT_FOUND');
      if (!msg.hiddenAt) throw new ChatModerationError('INVALID_TRANSITION');
      await this.prisma.groupChatMessage.update({
        where: { id: messageId },
        data: { hiddenAt: null, hiddenByAdminId: null, hideReason: null },
      });
    }
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_MESSAGE_UNHIDE', {
      messageType,
      messageId,
    });
    return { ok: true, messageId, messageType };
  }

  // ---------------------------------------------------------------------------
  // Admin API — group lock / unlock / dissolve
  // ---------------------------------------------------------------------------

  async adminLockGroup(
    adminUserId: string,
    groupId: string,
    rawReason: string | null,
  ): Promise<{ ok: true; groupId: string; lockedAt: string }> {
    const g = await this.prisma.groupChat.findUnique({ where: { id: groupId } });
    if (!g) throw new ChatModerationError('NOT_FOUND');
    if (g.dissolvedAt) throw new ChatModerationError('GROUP_DISSOLVED');
    if (g.lockedAt) throw new ChatModerationError('INVALID_TRANSITION');
    const reason = sanitizeChatModerationText(
      rawReason,
      CHAT_MODERATION_LIMITS.ADMIN_REASON_MAX,
    );
    const now = new Date();
    await this.prisma.groupChat.update({
      where: { id: groupId },
      data: { lockedAt: now, lockedByAdminId: adminUserId, lockReason: reason },
    });
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_GROUP_LOCK', {
      groupId,
      ownerUserId: g.ownerUserId,
      reason,
    });
    return { ok: true, groupId, lockedAt: now.toISOString() };
  }

  async adminUnlockGroup(
    adminUserId: string,
    groupId: string,
  ): Promise<{ ok: true; groupId: string }> {
    const g = await this.prisma.groupChat.findUnique({ where: { id: groupId } });
    if (!g) throw new ChatModerationError('NOT_FOUND');
    if (!g.lockedAt) throw new ChatModerationError('INVALID_TRANSITION');
    await this.prisma.groupChat.update({
      where: { id: groupId },
      data: { lockedAt: null, lockedByAdminId: null, lockReason: null },
    });
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_GROUP_UNLOCK', {
      groupId,
    });
    return { ok: true, groupId };
  }

  async adminDissolveGroup(
    adminUserId: string,
    groupId: string,
    rawReason: string | null,
  ): Promise<{ ok: true; groupId: string; dissolvedAt: string }> {
    const g = await this.prisma.groupChat.findUnique({ where: { id: groupId } });
    if (!g) throw new ChatModerationError('NOT_FOUND');
    if (g.dissolvedAt) throw new ChatModerationError('INVALID_TRANSITION');
    const reason = sanitizeChatModerationText(
      rawReason,
      CHAT_MODERATION_LIMITS.ADMIN_REASON_MAX,
    );
    const now = new Date();
    await this.prisma.groupChat.update({
      where: { id: groupId },
      data: {
        dissolvedAt: now,
        dissolvedByAdminId: adminUserId,
        dissolveReason: reason,
      },
    });
    await this.audit(adminUserId, 'ADMIN_CHAT_MODERATION_GROUP_DISSOLVE', {
      groupId,
      ownerUserId: g.ownerUserId,
      reason,
    });
    return { ok: true, groupId, dissolvedAt: now.toISOString() };
  }

  // ---------------------------------------------------------------------------
  // Admin summary (cho dashboard cards)
  // ---------------------------------------------------------------------------

  async adminSummary(): Promise<AdminChatModerationSummary> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [
      openReports,
      acknowledgedReports,
      resolvedToday,
      mutedUsers,
      hiddenPrivate,
      hiddenGroup,
      lockedGroups,
    ] = await Promise.all([
      this.prisma.chatMessageReport.count({ where: { status: 'OPEN' } }),
      this.prisma.chatMessageReport.count({
        where: { status: 'ACKNOWLEDGED' },
      }),
      this.prisma.chatMessageReport.count({
        where: {
          status: { in: ['RESOLVED', 'REJECTED'] },
          resolvedAt: { gte: startOfDay },
        },
      }),
      this.prisma.chatMute.count({
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.privateChatMessage.count({
        where: { hiddenAt: { not: null } },
      }),
      this.prisma.groupChatMessage.count({
        where: { hiddenAt: { not: null } },
      }),
      this.prisma.groupChat.count({
        where: { lockedAt: { not: null }, dissolvedAt: null },
      }),
    ]);

    return {
      openReports,
      acknowledgedReports,
      resolvedToday,
      mutedUsers,
      hiddenMessages: hiddenPrivate + hiddenGroup,
      lockedGroups,
    };
  }

  // ---------------------------------------------------------------------------
  // Enforcement helpers (consumed by other chat services)
  // ---------------------------------------------------------------------------

  /**
   * Lookup mute active cho user. Trả về row đầu tiên match scope target
   * hoặc `ALL_CHAT`. Caller throw `MUTED` error nếu non-null.
   *
   * `targetScope` = scope của send path đang thực hiện (PRIVATE_CHAT /
   * GROUP_CHAT / WORLD_SECT_CHAT).
   */
  async findActiveMuteForSend(
    userId: string,
    targetScope: ChatMuteScope,
  ): Promise<ChatMuteRow | null> {
    if (!isChatMuteScope(targetScope)) return null;
    const now = new Date();
    const rows = await this.prisma.chatMute.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        scope: { in: [targetScope, 'ALL_CHAT'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (rows.length === 0) return null;
    const row = rows[0];
    // Safety: cross-check via shared helper (idempotent với query above).
    if (!muteScopeApplies(row.scope, targetScope)) return null;
    return this.toMuteRow(row, now);
  }

  /**
   * Throw `MUTED` nếu user đang bị câm scope target. No-op nếu không.
   * Convenience wrapper cho chat send services.
   */
  async assertNotMuted(
    userId: string,
    targetScope: ChatMuteScope,
  ): Promise<void> {
    const mute = await this.findActiveMuteForSend(userId, targetScope);
    if (mute) throw new ChatModerationError('MUTED');
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private toReportRow(row: {
    id: string;
    reporterUserId: string;
    targetUserId: string | null;
    messageType: ChatMessageReportType;
    privateMessageId: string | null;
    groupMessageId: string | null;
    groupId: string | null;
    reason: ChatMessageReportReason;
    detailsText: string | null;
    status: ChatMessageReportStatus;
    createdAt: Date;
    resolvedAt: Date | null;
    resolvedByAdminId: string | null;
    resolutionNote: string | null;
  }): ChatMessageReportRow {
    return {
      id: row.id,
      reporterUserId: row.reporterUserId,
      targetUserId: row.targetUserId,
      messageType: row.messageType,
      privateMessageId: row.privateMessageId,
      groupMessageId: row.groupMessageId,
      groupId: row.groupId,
      reason: row.reason,
      detailsText: row.detailsText,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolvedByAdminId: row.resolvedByAdminId,
      resolutionNote: row.resolutionNote,
    };
  }

  private toMuteRow(
    row: {
      id: string;
      userId: string;
      mutedByAdminId: string;
      reason: string;
      scope: ChatMuteScope;
      startsAt: Date;
      expiresAt: Date | null;
      revokedAt: Date | null;
      revokedByAdminId: string | null;
      createdAt: Date;
    },
    now: Date,
  ): ChatMuteRow {
    const active =
      !row.revokedAt &&
      (!row.expiresAt || row.expiresAt.getTime() > now.getTime());
    return {
      id: row.id,
      userId: row.userId,
      mutedByAdminId: row.mutedByAdminId,
      reason: row.reason,
      scope: row.scope,
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedByAdminId: row.revokedByAdminId,
      createdAt: row.createdAt.toISOString(),
      isActive: active,
    };
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId, action, meta },
    });
  }

  /**
   * Parse helpers cho admin filter input.
   */
  static parseStatusFilter(v: unknown): ChatMessageReportStatus | undefined {
    if (typeof v === 'string' && isChatMessageReportStatus(v)) return v;
    return undefined;
  }
  static parseReasonFilter(v: unknown): ChatMessageReportReason | undefined {
    if (typeof v === 'string' && isChatMessageReportReason(v)) return v;
    return undefined;
  }
  static parseTypeFilter(v: unknown): ChatMessageReportType | undefined {
    if (typeof v === 'string' && isChatMessageReportType(v)) return v;
    return undefined;
  }
  static parseScopeFilter(v: unknown): ChatMuteScope | undefined {
    if (typeof v === 'string' && isChatMuteScope(v)) return v;
    return undefined;
  }
}
