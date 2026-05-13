import { Injectable } from '@nestjs/common';
import { MailType, Prisma } from '@prisma/client';
import {
  ADMIN_MAIL_LIMITS,
  validateAdminMailSendInput,
  type AdminMailLogRow,
  type AdminMailSendBulkInput,
  type AdminMailSendGlobalInput,
  type AdminMailSendInput,
  type AdminMailSendOneInput,
  type SystemGiftTargetRule,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MailService } from '../mail/mail.service';
import { SystemGiftService } from '../system-gift/system-gift.service';

/**
 * Phase 31.0 — Admin Mail / Announcement service.
 *
 * Guarantees:
 *   - Pure validator chạy trước khi persist (`validateAdminMailSendInput`).
 *   - Mỗi send (kể cả preview) tạo 1 `AdminMailLog` row → audit. KHÔNG
 *     thể có mail admin nào không có audit.
 *   - SEND_BULK: 1 audit row, `mailIdsSnapshot` chứa N mail id đã tạo.
 *   - SEND_GLOBAL: 1 audit row, `targetRuleSnapshot` lưu rule, `mailCount`
 *     = số mail thực sự tạo (sau khi resolve target).
 *   - `tienNgoc` không bao giờ >0 (validator block ở `MAX_TIEN_NGOC_PER_MAIL=0`).
 */
export class AdminMailError extends Error {
  constructor(public code: 'INVALID_INPUT' | 'INVALID_RECIPIENT') {
    super(code);
  }
}

export interface AdminMailSendResult {
  /** Audit log id. */
  logId: string;
  /** Số mail đã tạo. SEND_GLOBAL previewOnly=true → 0. */
  mailCount: number;
  /** Resolved character ids đã gửi (SEND_GLOBAL preview cũng trả). */
  targetCount: number;
}

@Injectable()
export class AdminMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly systemGift: SystemGiftService,
  ) {}

  async send(
    adminUserId: string,
    input: AdminMailSendInput,
  ): Promise<AdminMailSendResult> {
    const err = validateAdminMailSendInput(input);
    if (err) throw new AdminMailError('INVALID_INPUT');

    switch (input.kind) {
      case 'SEND_ONE':
        return this.sendOne(adminUserId, input);
      case 'SEND_BULK':
        return this.sendBulk(adminUserId, input);
      case 'SEND_GLOBAL':
        return this.sendGlobal(adminUserId, input);
    }
  }

  /** GET /admin/mail — list audit log rows. */
  async listAuditLogs(opts?: {
    cursor?: string | null;
    limit?: number;
  }): Promise<AdminMailLogRow[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const rows = await this.prisma.adminMailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts?.cursor
        ? { cursor: { id: opts.cursor }, skip: 1 }
        : {}),
    });
    return rows.map(rowToLog);
  }

  async getAuditLog(id: string): Promise<AdminMailLogRow | null> {
    const row = await this.prisma.adminMailLog.findUnique({ where: { id } });
    return row ? rowToLog(row) : null;
  }

  private async sendOne(
    adminUserId: string,
    input: AdminMailSendOneInput,
  ): Promise<AdminMailSendResult> {
    // Verify recipient exists trước khi commit mail.
    const recipient = await this.prisma.character.findUnique({
      where: { id: input.recipientCharacterId },
      select: { id: true },
    });
    if (!recipient) throw new AdminMailError('INVALID_RECIPIENT');

    const mailView = await this.mail.sendToCharacter({
      recipientCharacterId: input.recipientCharacterId,
      subject: input.subject,
      body: input.body,
      senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
      rewardLinhThach: BigInt(input.reward.linhThach),
      rewardTienNgoc: 0, // Phase 31 cap.
      rewardExp: BigInt(input.reward.exp),
      rewardItems: input.reward.items,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      createdByAdminId: adminUserId,
      mailType: input.mailType as MailType,
    });

    const log = await this.prisma.adminMailLog.create({
      data: {
        adminUserId,
        kind: 'SEND_ONE',
        mailType: input.mailType as MailType,
        subject: input.subject,
        reason: input.reason,
        mailCount: 1,
        recipientsSnapshot: [input.recipientCharacterId] as unknown as Prisma.InputJsonValue,
        mailIdsSnapshot: [mailView.id] as unknown as Prisma.InputJsonValue,
        previewOnly: false,
      },
    });
    return { logId: log.id, mailCount: 1, targetCount: 1 };
  }

  private async sendBulk(
    adminUserId: string,
    input: AdminMailSendBulkInput,
  ): Promise<AdminMailSendResult> {
    if (input.recipientCharacterIds.length > ADMIN_MAIL_LIMITS.MAX_BULK_RECIPIENTS) {
      throw new AdminMailError('INVALID_INPUT');
    }
    // De-dup + verify existence.
    const ids = Array.from(new Set(input.recipientCharacterIds));
    const found = await this.prisma.character.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const validIds = found.map((c) => c.id);

    // Fanout: dùng `broadcast` với explicit recipientCharacterIds. Mail
    // service đã enforce caps + ledger; chúng ta thu thập mail ids
    // bằng count = số valid id (broadcast tạo `createMany`, không trả
    // ids — fetch sau theo subject+createdAt nếu cần precise audit).
    // Để audit chính xác, dùng `sendToCharacter` per id (slow nhưng
    // < 500 entries cap → OK).
    const mailIds: string[] = [];
    for (const recipientId of validIds) {
      const v = await this.mail.sendToCharacter({
        recipientCharacterId: recipientId,
        subject: input.subject,
        body: input.body,
        senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
        rewardLinhThach: BigInt(input.reward.linhThach),
        rewardTienNgoc: 0,
        rewardExp: BigInt(input.reward.exp),
        rewardItems: input.reward.items,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        createdByAdminId: adminUserId,
        mailType: input.mailType as MailType,
      });
      mailIds.push(v.id);
    }

    const log = await this.prisma.adminMailLog.create({
      data: {
        adminUserId,
        kind: 'SEND_BULK',
        mailType: input.mailType as MailType,
        subject: input.subject,
        reason: input.reason,
        mailCount: mailIds.length,
        // Snapshot tối đa 50 recipients để tránh log JSON quá lớn.
        recipientsSnapshot: validIds.slice(0, 50) as unknown as Prisma.InputJsonValue,
        mailIdsSnapshot: mailIds.slice(0, 50) as unknown as Prisma.InputJsonValue,
        previewOnly: false,
      },
    });
    return {
      logId: log.id,
      mailCount: mailIds.length,
      targetCount: validIds.length,
    };
  }

  private async sendGlobal(
    adminUserId: string,
    input: AdminMailSendGlobalInput,
  ): Promise<AdminMailSendResult> {
    const targets = await this.systemGift.resolveTargets(input.targetRule);
    if (input.previewOnly) {
      const log = await this.prisma.adminMailLog.create({
        data: {
          adminUserId,
          kind: 'SEND_GLOBAL',
          mailType: input.mailType as MailType,
          subject: input.subject,
          reason: input.reason,
          mailCount: 0,
          recipientsSnapshot: [] as unknown as Prisma.InputJsonValue,
          mailIdsSnapshot: [] as unknown as Prisma.InputJsonValue,
          targetRuleSnapshot: input.targetRule as unknown as Prisma.InputJsonValue,
          previewOnly: true,
        },
      });
      return { logId: log.id, mailCount: 0, targetCount: targets.length };
    }

    const mailIds: string[] = [];
    for (const recipientId of targets) {
      try {
        const v = await this.mail.sendToCharacter({
          recipientCharacterId: recipientId,
          subject: input.subject,
          body: input.body,
          senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
          rewardLinhThach: BigInt(input.reward.linhThach),
          rewardTienNgoc: 0,
          rewardExp: BigInt(input.reward.exp),
          rewardItems: input.reward.items,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          createdByAdminId: adminUserId,
          mailType: input.mailType as MailType,
        });
        mailIds.push(v.id);
      } catch {
        // Skip individual mail failures (e.g. character deleted between
        // resolve + send).
      }
    }
    const log = await this.prisma.adminMailLog.create({
      data: {
        adminUserId,
        kind: 'SEND_GLOBAL',
        mailType: input.mailType as MailType,
        subject: input.subject,
        reason: input.reason,
        mailCount: mailIds.length,
        recipientsSnapshot: targets.slice(0, 50) as unknown as Prisma.InputJsonValue,
        mailIdsSnapshot: mailIds.slice(0, 50) as unknown as Prisma.InputJsonValue,
        targetRuleSnapshot: input.targetRule as unknown as Prisma.InputJsonValue,
        previewOnly: false,
      },
    });
    return {
      logId: log.id,
      mailCount: mailIds.length,
      targetCount: targets.length,
    };
  }
}

function rowToLog(row: {
  id: string;
  adminUserId: string;
  kind: string;
  mailType: MailType;
  subject: string;
  reason: string;
  mailCount: number;
  recipientsSnapshot: Prisma.JsonValue;
  targetRuleSnapshot: Prisma.JsonValue | null;
  createdAt: Date;
}): AdminMailLogRow {
  const recipients = Array.isArray(row.recipientsSnapshot)
    ? (row.recipientsSnapshot as string[])
    : [];
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    kind: row.kind as AdminMailLogRow['kind'],
    mailType: row.mailType as unknown as AdminMailLogRow['mailType'],
    subject: row.subject,
    reason: row.reason,
    mailCount: row.mailCount,
    recipientsSnapshot: recipients,
    targetRuleSnapshot:
      row.targetRuleSnapshot
        ? (row.targetRuleSnapshot as unknown as SystemGiftTargetRule)
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}
