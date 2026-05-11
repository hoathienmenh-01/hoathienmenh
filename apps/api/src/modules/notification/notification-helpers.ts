import {
  notificationBodyKey,
  notificationTitleKey,
  type NotificationType,
} from '@xuantoi/shared';
import { NotificationService } from './notification.service';

/**
 * Phase 19.3 — Convenience helpers cho integration hook caller (vd
 * SocialService.acceptFriendRequest, ChatPrivateService.send).
 *
 * Mỗi helper:
 *   1. Build `titleKey` + `bodyKey` từ shared `notificationTitleKey` /
 *      `notificationBodyKey` (deterministic, vi/en parity ở FE i18n).
 *   2. Gán `entityType` + `entityId` để FE click navigate đúng route.
 *   3. Sanitize `data` qua shared helper trước khi lưu DB.
 *
 * Không throw nếu fail — caller (vd `SocialService.acceptFriendRequest`)
 * dùng wrapper try/catch để tránh notification fail làm hỏng main flow.
 */
export class NotificationHelpers {
  constructor(private readonly notifications: NotificationService) {}

  /** Friend request mới — gửi cho receiver. */
  async notifyFriendRequestReceived(input: {
    receiverUserId: string;
    senderUserId: string;
    senderName: string;
    requestId: string;
  }): Promise<void> {
    const type: NotificationType = 'FRIEND_REQUEST_RECEIVED';
    await this.safeCreate({
      userId: input.receiverUserId,
      type,
      titleKey: notificationTitleKey(type),
      bodyKey: notificationBodyKey(type),
      entityType: 'FRIEND_REQUEST',
      entityId: input.requestId,
      data: {
        senderUserId: input.senderUserId,
        senderName: input.senderName,
        requestId: input.requestId,
      },
    });
  }

  /** Friend request được accept — gửi cho sender. */
  async notifyFriendRequestAccepted(input: {
    senderUserId: string;
    accepterUserId: string;
    accepterName: string;
    requestId: string;
  }): Promise<void> {
    const type: NotificationType = 'FRIEND_REQUEST_ACCEPTED';
    await this.safeCreate({
      userId: input.senderUserId,
      type,
      titleKey: notificationTitleKey(type),
      bodyKey: notificationBodyKey(type),
      entityType: 'FRIEND_REQUEST',
      entityId: input.requestId,
      data: {
        accepterUserId: input.accepterUserId,
        accepterName: input.accepterName,
        requestId: input.requestId,
      },
    });
  }

  /** Private message — gửi cho receiver (không cho sender). */
  async notifyPrivateMessageReceived(input: {
    receiverUserId: string;
    senderUserId: string;
    senderName: string;
    threadId: string;
    messageId: string;
  }): Promise<void> {
    if (input.receiverUserId === input.senderUserId) return;
    const type: NotificationType = 'PRIVATE_MESSAGE_RECEIVED';
    await this.safeCreate({
      userId: input.receiverUserId,
      type,
      titleKey: notificationTitleKey(type),
      bodyKey: notificationBodyKey(type),
      entityType: 'PRIVATE_THREAD',
      entityId: input.threadId,
      data: {
        senderUserId: input.senderUserId,
        senderName: input.senderName,
        threadId: input.threadId,
        messageId: input.messageId,
      },
    });
  }

  /** Group message — gửi cho tất cả member (không phải sender). */
  async notifyGroupMessageReceivedBulk(input: {
    memberUserIds: readonly string[];
    senderUserId: string;
    senderName: string;
    groupId: string;
    groupName: string;
    messageId: string;
  }): Promise<void> {
    const type: NotificationType = 'GROUP_MESSAGE_RECEIVED';
    const targets = input.memberUserIds.filter(
      (uid) => uid !== input.senderUserId,
    );
    for (const uid of targets) {
      await this.safeCreate({
        userId: uid,
        type,
        titleKey: notificationTitleKey(type),
        bodyKey: notificationBodyKey(type),
        entityType: 'GROUP_CHAT',
        entityId: input.groupId,
        data: {
          senderUserId: input.senderUserId,
          senderName: input.senderName,
          groupId: input.groupId,
          groupName: input.groupName,
          messageId: input.messageId,
        },
      });
    }
  }

  /** User được add vào group — gửi cho user mới. */
  async notifyGroupMemberAdded(input: {
    addedUserId: string;
    addedByUserId: string;
    addedByName: string;
    groupId: string;
    groupName: string;
  }): Promise<void> {
    const type: NotificationType = 'GROUP_MEMBER_ADDED';
    await this.safeCreate({
      userId: input.addedUserId,
      type,
      titleKey: notificationTitleKey(type),
      bodyKey: notificationBodyKey(type),
      entityType: 'GROUP_CHAT',
      entityId: input.groupId,
      data: {
        addedByUserId: input.addedByUserId,
        addedByName: input.addedByName,
        groupId: input.groupId,
        groupName: input.groupName,
      },
    });
  }

  /** Chat report resolved hoặc rejected — gửi cho reporter. */
  async notifyChatReportResolved(input: {
    reporterUserId: string;
    reportId: string;
    /** RESOLVED | REJECTED — text mã gọn. */
    resolutionStatus: string;
  }): Promise<void> {
    const type: NotificationType = 'CHAT_REPORT_RESOLVED';
    await this.safeCreate({
      userId: input.reporterUserId,
      type,
      titleKey: notificationTitleKey(type),
      bodyKey: notificationBodyKey(type),
      entityType: 'CHAT_REPORT',
      entityId: input.reportId,
      data: {
        reportId: input.reportId,
        resolutionStatus: input.resolutionStatus,
      },
    });
  }

  /**
   * Wrapper try/catch quanh `notifications.createNotification` để
   * integration hook (vd `SocialService.send`) không bị fail nếu
   * notification DB write throw. Log warn, no rethrow.
   */
  private async safeCreate(
    input: Parameters<NotificationService['createNotification']>[0],
  ): Promise<void> {
    try {
      await this.notifications.createNotification(input);
    } catch {
      // intentionally swallow — caller's main flow tiếp tục.
    }
  }
}
