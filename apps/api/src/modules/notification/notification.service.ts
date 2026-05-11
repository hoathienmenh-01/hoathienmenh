import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma, NotificationType as PrismaNotificationType } from '@prisma/client';
import {
  NOTIFICATION_LIMITS,
  isNotificationEntityType,
  sanitizeNotificationData,
  type NotificationCreatedBroadcastPayload,
  type NotificationListResponse,
  type NotificationRow,
  type NotificationType,
  type NotificationUnreadCountBroadcastPayload,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  titleKey: string;
  bodyKey: string;
  entityType?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
  /** Optional TTL — null = no expiry. */
  expiresAt?: Date | null;
}

interface ListNotificationsParams {
  userId: string;
  /** Filter by type (array, optional). */
  types?: readonly NotificationType[] | null;
  /** `true` = chỉ unread, `false` = chỉ read, undefined = cả 2. */
  unreadOnly?: boolean;
  /** Pagination cursor: createdAt ISO. */
  cursor?: string | null;
  /** Page size; default 20, max NOTIFICATION_LIMITS.LIST_PAGE_MAX. */
  limit?: number;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

/**
 * Phase 19.3 — Notification service.
 *
 * Responsibilities:
 *   - Persist `Notification` rows (DB-first; emit `notification:new`
 *     WS event best-effort sau khi commit).
 *   - List notifications của user (own only — query luôn filter
 *     `userId === requester`).
 *   - Count unread badge cho bell.
 *   - Mark read / mark all read; emit `notification:unread-count`
 *     sau commit để FE sync badge.
 *
 * Privacy:
 *   - User chỉ xem / mark read được notification của chính mình.
 *     Service từ chối nếu `Notification.userId !== requester`.
 *   - Body content được i18n-key based — service KHÔNG lưu raw user
 *     text vào title/body (tránh injection). Sender name, group name,
 *     etc. lưu trong `dataJson` (đã sanitize qua shared helper).
 *
 * Idempotency:
 *   - Phase 19.3 KHÔNG dedupe theo eventId — caller (vd
 *     SocialService.acceptFriendRequest) phải tự đảm bảo không gọi
 *     `createNotification` 2 lần cho cùng event. Future: thêm
 *     `eventKey unique` column.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Tạo notification + emit realtime nếu user online.
   *
   * Best-effort emit: DB ghi commit trước; nếu socket emit fail
   * (user offline / server bind chưa xong / etc.), DB row vẫn tồn
   * tại → user thấy ở REST poll / reload.
   */
  async createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
    const data = sanitizeNotificationData(input.data ?? {});
    const entityType =
      input.entityType && isNotificationEntityType(input.entityType)
        ? input.entityType
        : null;

    const created = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type as PrismaNotificationType,
        titleKey: input.titleKey,
        bodyKey: input.bodyKey,
        entityType,
        entityId: input.entityId ?? null,
        dataJson: data as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
      },
    });

    const row = this.toRow(created);
    void this.fanoutRealtimeIfOnline(input.userId, row);
    return row;
  }

  /**
   * Emit `notification:new` + updated unread count cho user nếu họ
   * đang online. Tách helper để integration tests verify được fanout.
   */
  async fanoutRealtimeIfOnline(
    userId: string,
    row: NotificationRow,
  ): Promise<void> {
    if (!this.realtime.isOnline(userId)) return;
    try {
      const unreadCount = await this.countUnread(userId);
      const payload: NotificationCreatedBroadcastPayload = {
        notification: row,
        unreadCount,
      };
      this.realtime.emitToUser(userId, 'notification:new', payload);
      const countPayload: NotificationUnreadCountBroadcastPayload = {
        unreadCount,
      };
      this.realtime.emitToUser(userId, 'notification:unread-count', countPayload);
    } catch (e) {
      this.logger.warn(
        `fanout notification failed user=${userId}: ${(e as Error).message}`,
      );
    }
  }

  async listNotifications(
    params: ListNotificationsParams,
  ): Promise<NotificationListResponse> {
    const limit = Math.min(
      Math.max(params.limit ?? 20, 1),
      NOTIFICATION_LIMITS.LIST_PAGE_MAX,
    );

    const where: {
      userId: string;
      type?: { in: PrismaNotificationType[] };
      readAt?: null | { not: null };
      createdAt?: { lt: Date };
    } = { userId: params.userId };

    if (params.types && params.types.length > 0) {
      where.type = { in: params.types as PrismaNotificationType[] };
    }
    if (params.unreadOnly === true) where.readAt = null;
    else if (params.unreadOnly === false) where.readAt = { not: null };

    if (params.cursor) {
      const cursorDate = new Date(params.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }

    // Fetch 1 extra row để biết có nextCursor không.
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const sliced = rows.slice(0, limit);

    const [total, unreadCount] = await Promise.all([
      this.prisma.notification.count({ where: { userId: params.userId } }),
      this.countUnread(params.userId),
    ]);

    return {
      notifications: sliced.map((r) => this.toRow(r)),
      total,
      unreadCount,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Mark 1 notification as read. Reject nếu notification thuộc user
   * khác → `FORBIDDEN`. Nếu đã read trước đó, idempotent (chỉ
   * không update lại `readAt`).
   *
   * Sau commit, emit `notification:unread-count` để FE sync badge.
   */
  async markRead(userId: string, notificationId: string): Promise<NotificationRow> {
    const existing = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!existing) fail('NOTIFICATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (existing.userId !== userId) {
      fail('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    let row = existing;
    if (!existing.readAt) {
      row = await this.prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    }
    await this.emitUnreadCount(userId);
    return this.toRow(row);
  }

  async markAllRead(userId: string): Promise<{ markedCount: number }> {
    const now = new Date();
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    await this.emitUnreadCount(userId);
    return { markedCount: res.count };
  }

  private async emitUnreadCount(userId: string): Promise<void> {
    if (!this.realtime.isOnline(userId)) return;
    try {
      const unreadCount = await this.countUnread(userId);
      const payload: NotificationUnreadCountBroadcastPayload = { unreadCount };
      this.realtime.emitToUser(userId, 'notification:unread-count', payload);
    } catch (e) {
      this.logger.warn(
        `emit unread count failed user=${userId}: ${(e as Error).message}`,
      );
    }
  }

  private toRow(n: {
    id: string;
    userId: string;
    type: PrismaNotificationType;
    titleKey: string;
    bodyKey: string;
    entityType: string | null;
    entityId: string | null;
    dataJson: unknown;
    readAt: Date | null;
    createdAt: Date;
    expiresAt: Date | null;
  }): NotificationRow {
    const rawData = n.dataJson;
    const data: Record<string, unknown> =
      rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? (rawData as Record<string, unknown>)
        : {};
    return {
      id: n.id,
      type: n.type as NotificationType,
      titleKey: n.titleKey,
      bodyKey: n.bodyKey,
      entityType:
        n.entityType && isNotificationEntityType(n.entityType)
          ? n.entityType
          : null,
      entityId: n.entityId,
      dataJson: data,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
      expiresAt: n.expiresAt ? n.expiresAt.toISOString() : null,
    };
  }
}
