import { Injectable, Logger, Optional } from '@nestjs/common';
import { CurrencyKind, MailType, Prisma } from '@prisma/client';
import { DEFAULT_MAIL_TYPE, deriveMailStatus, type MailStatus } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WebPushService } from '../web-push/web-push.service';

export class MailError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'MAIL_NOT_FOUND'
      | 'MAIL_EXPIRED'
      | 'NO_REWARD'
      | 'ALREADY_CLAIMED'
      | 'MAIL_DELETED'
      | 'RECIPIENT_NOT_FOUND'
      | 'INVALID_INPUT',
  ) {
    super(code);
  }
}

export interface MailRewardItem {
  itemKey: string;
  qty: number;
}

export interface MailView {
  id: string;
  senderName: string;
  subject: string;
  body: string;
  rewardLinhThach: string;
  rewardTienNgoc: number;
  rewardExp: string;
  rewardItems: MailRewardItem[];
  readAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Có reward gì đó (LT/TN/EXP/item) và chưa claim + chưa hết hạn. */
  claimable: boolean;
  /** Phase 31.0 — taxonomy lý do gửi mail. */
  mailType: MailType;
  /** Phase 31.0 — derived status (UNREAD/READ/CLAIMED/EXPIRED). */
  status: MailStatus;
  /** Phase 31.0 — true nếu user đã soft-delete mail. List inbox ẩn nhưng `getById` vẫn trả về. */
  deleted: boolean;
}

export interface MailSendInput {
  recipientCharacterId: string;
  subject: string;
  body: string;
  senderName?: string;
  rewardLinhThach?: bigint;
  rewardTienNgoc?: number;
  rewardExp?: bigint;
  rewardItems?: MailRewardItem[];
  expiresAt?: Date;
  createdByAdminId?: string;
  /** Phase 31.0 — mặc định `SYSTEM` để compat. */
  mailType?: MailType;
}

export interface MailBroadcastInput {
  subject: string;
  body: string;
  senderName?: string;
  rewardLinhThach?: bigint;
  rewardTienNgoc?: number;
  rewardExp?: bigint;
  rewardItems?: MailRewardItem[];
  expiresAt?: Date;
  createdByAdminId?: string;
  /** Phase 31.0 — restrict broadcast to specific recipientIds. Nếu omit → mọi character. */
  recipientCharacterIds?: string[];
  /** Phase 31.0 — mặc định `SYSTEM` để compat. */
  mailType?: MailType;
}

export interface ClaimAllResult {
  /** Số mail đã claim thành công. */
  claimedCount: number;
  /** Tổng linh thạch đã trao (string bigint). */
  totalLinhThach: string;
  /** Tổng tiên ngọc đã trao. */
  totalTienNgoc: number;
  /** Tổng EXP đã trao (string bigint). */
  totalExp: string;
  /** Số mail đã thử claim nhưng skip (hết hạn / no-reward). */
  skippedCount: number;
}

const MAX_INBOX = 100;
const MAX_ITEMS_PER_MAIL = 10;
/** Phase 31.0 — cap per `claim-all` call. User claim nhiều hơn → gọi lần 2. */
const MAX_CLAIM_ALL_BATCH = 50;

/**
 * Service thư hệ thống + thư từ admin.
 *
 * - `inbox(userId)`: 100 thư gần nhất của nhân vật (desc `createdAt`).
 * - `markRead(userId, id)`: set `readAt=now()` (idempotent).
 * - `claim(userId, id)`: atomic — trao tiền (ledger `MAIL_CLAIM`) + item + exp
 *   rồi set `claimedAt=now()`. Không claim được nếu:
 *   - thư không tồn tại / không thuộc về user,
 *   - không có reward gì (NO_REWARD),
 *   - đã claim (ALREADY_CLAIMED),
 *   - đã hết hạn (MAIL_EXPIRED).
 * - `sendToCharacter(...)`: admin gửi 1 thư cho 1 nhân vật.
 * - `broadcast(...)`: admin gửi 1 thư cho TẤT CẢ nhân vật hiện có.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly webPush?: WebPushService,
  ) {}

  async inbox(userId: string, opts?: { mailType?: MailType }): Promise<MailView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new MailError('NO_CHARACTER');
    const rows = await this.prisma.mail.findMany({
      where: {
        recipientId: char.id,
        deletedAt: null,
        ...(opts?.mailType ? { mailType: opts.mailType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_INBOX,
    });
    const now = new Date();
    return rows.map((r) => toView(r, now));
  }

  /**
   * Phase 31.0 — GET /mail/:id. Trả về mail row đầy đủ (kể cả khi đã
   * soft-delete). 404 mask cho ownership: user khác không thấy mail của
   * người khác — trả `MAIL_NOT_FOUND`.
   */
  async getById(userId: string, mailId: string): Promise<MailView> {
    const char = await this.requireCharacter(userId);
    const mail = await this.prisma.mail.findFirst({
      where: { id: mailId, recipientId: char.id },
    });
    if (!mail) throw new MailError('MAIL_NOT_FOUND');
    return toView(mail, new Date());
  }

  /**
   * Đếm số mail chưa đọc + chưa hết hạn của user. Cheap query (count(*)) dùng
   * cho mail badge — KHÔNG cần fetch full inbox. Trả 0 nếu user chưa có
   * character (silent — không throw, để FE hiển thị badge=0 thay vì lỗi).
   *
   * Index: `Mail(@@index recipientId, readAt)` cover cả filter readAt=null.
   */
  async unreadCount(userId: string): Promise<number> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) return 0;
    const now = new Date();
    return this.prisma.mail.count({
      where: {
        recipientId: char.id,
        readAt: null,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async markRead(userId: string, mailId: string): Promise<MailView> {
    const char = await this.requireCharacter(userId);
    const mail = await this.prisma.mail.findFirst({
      where: { id: mailId, recipientId: char.id },
    });
    if (!mail) throw new MailError('MAIL_NOT_FOUND');
    if (mail.deletedAt) throw new MailError('MAIL_DELETED');
    if (!mail.readAt) {
      await this.prisma.mail.update({
        where: { id: mailId },
        data: { readAt: new Date() },
      });
    }
    const updated = await this.prisma.mail.findUniqueOrThrow({
      where: { id: mailId },
    });
    return toView(updated, new Date());
  }

  /**
   * Phase 31.0 — POST /mail/:id/delete. Soft-delete bởi user. Mail bị
   * delete vẫn còn trong DB nhưng KHÔNG hiển thị trong inbox (và không
   * tính vào unread count). User KHÔNG thể claim sau khi delete (anti-
   * trick: delete sau khi claim không refund; delete trước khi claim
   * mất quyền claim — kiểm tra ở claim path).
   */
  async softDelete(userId: string, mailId: string): Promise<MailView> {
    const char = await this.requireCharacter(userId);
    const mail = await this.prisma.mail.findFirst({
      where: { id: mailId, recipientId: char.id },
    });
    if (!mail) throw new MailError('MAIL_NOT_FOUND');
    if (mail.deletedAt) {
      return toView(mail, new Date());
    }
    await this.prisma.mail.update({
      where: { id: mailId },
      data: { deletedAt: new Date() },
    });
    const updated = await this.prisma.mail.findUniqueOrThrow({
      where: { id: mailId },
    });
    return toView(updated, new Date());
  }

  async claim(userId: string, mailId: string): Promise<MailView> {
    const char = await this.requireCharacter(userId);

    await this.prisma.$transaction(async (tx) => {
      const mail = await tx.mail.findFirst({
        where: { id: mailId, recipientId: char.id },
      });
      if (!mail) throw new MailError('MAIL_NOT_FOUND');
      if (mail.deletedAt) throw new MailError('MAIL_DELETED');
      if (mail.claimedAt) throw new MailError('ALREADY_CLAIMED');
      if (mail.expiresAt && mail.expiresAt.getTime() <= Date.now()) {
        throw new MailError('MAIL_EXPIRED');
      }
      const items = parseItems(mail.rewardItems);
      const hasReward =
        mail.rewardLinhThach > 0n ||
        mail.rewardTienNgoc > 0 ||
        mail.rewardExp > 0n ||
        items.length > 0;
      if (!hasReward) throw new MailError('NO_REWARD');

      // CAS: chỉ set claimedAt nếu vẫn null.
      const upd = await tx.mail.updateMany({
        where: { id: mailId, claimedAt: null, deletedAt: null },
        data: { claimedAt: new Date(), readAt: mail.readAt ?? new Date() },
      });
      if (upd.count !== 1) throw new MailError('ALREADY_CLAIMED');

      // Phase 31.0 — belt-and-suspenders idempotency: ghi 1 row vào
      // MailAttachmentClaim. Nếu đã có (do retry / race) → unique
      // constraint throw → CAS phía trên đã catch trước, nhưng giữ
      // ledger để audit.
      await tx.mailAttachmentClaim.create({
        data: {
          mailId,
          characterId: char.id,
          rewardSnapshotJson: {
            linhThach: mail.rewardLinhThach.toString(),
            tienNgoc: mail.rewardTienNgoc,
            exp: mail.rewardExp.toString(),
            items,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      if (mail.rewardLinhThach > 0n) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: mail.rewardLinhThach,
          reason: 'MAIL_CLAIM',
          refType: 'MAIL',
          refId: mailId,
        });
      }
      if (mail.rewardTienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(mail.rewardTienNgoc),
          reason: 'MAIL_CLAIM',
          refType: 'MAIL',
          refId: mailId,
        });
      }
      if (mail.rewardExp > 0n) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: mail.rewardExp } },
        });
      }
      if (items.length > 0) {
        await this.inventory.grantTx(tx, char.id, items, {
          reason: 'MAIL_CLAIM',
          refType: 'Mail',
          refId: mail.id,
        });
      }
    });

    const updated = await this.prisma.mail.findUniqueOrThrow({
      where: { id: mailId },
    });
    return toView(updated, new Date());
  }

  /**
   * Phase 31.0 — POST /mail/claim-all. Claim mọi mail có reward, chưa
   * claim, chưa hết hạn, chưa soft-delete. Idempotent per-mail qua CAS
   * (`Mail.claimedAt` null) — spam request KHÔNG duplicate reward.
   *
   * Cap per call: 50 mail (`MAX_CLAIM_ALL_BATCH`). User cần claim
   * nhiều hơn → gọi lần 2.
   */
  async claimAll(userId: string): Promise<ClaimAllResult> {
    const char = await this.requireCharacter(userId);
    const now = new Date();
    const candidates = await this.prisma.mail.findMany({
      where: {
        recipientId: char.id,
        claimedAt: null,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_CLAIM_ALL_BATCH,
    });
    let totalLT = 0n;
    let totalTN = 0;
    let totalEx = 0n;
    let claimed = 0;
    let skipped = 0;
    for (const m of candidates) {
      const items = parseItems(m.rewardItems);
      const hasReward =
        m.rewardLinhThach > 0n ||
        m.rewardTienNgoc > 0 ||
        m.rewardExp > 0n ||
        items.length > 0;
      if (!hasReward) {
        skipped += 1;
        continue;
      }
      try {
        // Reuse single-claim path → atomic + idempotent qua CAS.
        await this.claim(userId, m.id);
        claimed += 1;
        totalLT += m.rewardLinhThach;
        totalTN += m.rewardTienNgoc;
        totalEx += m.rewardExp;
      } catch (e) {
        if (e instanceof MailError) {
          // ALREADY_CLAIMED / MAIL_EXPIRED / NO_REWARD → skip & continue.
          skipped += 1;
          continue;
        }
        throw e;
      }
    }
    return {
      claimedCount: claimed,
      totalLinhThach: totalLT.toString(),
      totalTienNgoc: totalTN,
      totalExp: totalEx.toString(),
      skippedCount: skipped,
    };
  }

  async sendToCharacter(input: MailSendInput): Promise<MailView> {
    this.validateInput(input);
    const exists = await this.prisma.character.findUnique({
      where: { id: input.recipientCharacterId },
      select: { id: true, userId: true },
    });
    if (!exists) throw new MailError('RECIPIENT_NOT_FOUND');
    const row = await this.prisma.mail.create({
      data: {
        recipientId: input.recipientCharacterId,
        senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
        subject: input.subject,
        body: input.body,
        rewardLinhThach: input.rewardLinhThach ?? 0n,
        rewardTienNgoc: input.rewardTienNgoc ?? 0,
        rewardExp: input.rewardExp ?? 0n,
        rewardItems: (input.rewardItems ?? []) as unknown as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
        createdByAdminId: input.createdByAdminId ?? null,
        mailType: input.mailType ?? (DEFAULT_MAIL_TYPE as MailType),
      },
    });
    const view = toView(row, new Date());
    this.realtime.emitToUser(exists.userId, 'mail:new', {
      mailId: view.id,
      subject: view.subject,
      senderName: view.senderName,
      hasReward: view.claimable,
    });
    // Phase 44.1 — Web Push 'MAIL_NEW' fire-and-forget. Push log de-dupe
    // theo mailId. Fail-soft — push gateway error không crash mail send.
    if (this.webPush) {
      void this.webPush
        .sendToUser(exists.userId, 'MAIL_NEW', {
          title: `Thư mới: ${view.senderName}`,
          body: view.subject,
          url: '/mail',
          tag: `mail-${view.id}`,
          dedupeKey: `mail-${view.id}`,
        })
        .catch((e) =>
          this.logger.warn(
            `mail push send userId=${exists.userId} mailId=${view.id}: ${(e as Error).message}`,
          ),
        );
    }
    return view;
  }

  /** Gửi cho TẤT CẢ nhân vật hiện có (hoặc subset qua `recipientCharacterIds`). Trả về số thư đã tạo. */
  async broadcast(input: MailBroadcastInput): Promise<number> {
    this.validateInput(input);
    const where = input.recipientCharacterIds
      ? { id: { in: input.recipientCharacterIds } }
      : {};
    const chars = await this.prisma.character.findMany({
      where,
      select: { id: true, userId: true },
    });
    if (chars.length === 0) return 0;
    await this.prisma.mail.createMany({
      data: chars.map((c) => ({
        recipientId: c.id,
        senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
        subject: input.subject,
        body: input.body,
        rewardLinhThach: input.rewardLinhThach ?? 0n,
        rewardTienNgoc: input.rewardTienNgoc ?? 0,
        rewardExp: input.rewardExp ?? 0n,
        rewardItems: (input.rewardItems ?? []) as unknown as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
        createdByAdminId: input.createdByAdminId ?? null,
        mailType: input.mailType ?? (DEFAULT_MAIL_TYPE as MailType),
      })),
    });
    const hasReward =
      (input.rewardLinhThach ?? 0n) > 0n ||
      (input.rewardTienNgoc ?? 0) > 0 ||
      (input.rewardExp ?? 0n) > 0n ||
      (input.rewardItems ?? []).length > 0;
    // Phase 44.1 — query các mail vừa tạo để có mailId cho web push dedupe.
    let createdMails: { id: string; recipientId: string }[] = [];
    if (this.webPushTrigger) {
      try {
        createdMails = await this.prisma.mail.findMany({
          where: {
            recipientId: { in: chars.map((c) => c.id) },
            subject: input.subject,
            senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
          },
          orderBy: { createdAt: 'desc' },
          take: chars.length,
          select: { id: true, recipientId: true },
        });
      } catch (e) {
        this.logger.warn(
          `mail broadcast: failed to fetch mail ids for push: ${(e as Error).message}`,
        );
      }
    }
    const mailByRecipient = new Map(
      createdMails.map((m) => [m.recipientId, m.id]),
    );
    for (const c of chars) {
      this.realtime.emitToUser(c.userId, 'mail:new', {
        subject: input.subject,
        senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
        hasReward,
      });
      // Phase 44.1 — Web Push trigger broadcast. Fail-soft.
      if (this.webPushTrigger) {
        const mailId = mailByRecipient.get(c.id);
        if (!mailId) continue;
        this.webPushTrigger
          .notifyMailNew({
            userId: c.userId,
            mailId,
            subject: input.subject,
            senderName: input.senderName ?? 'Thiên Đạo Sứ Giả',
          })
          .catch((e) =>
            this.logger.warn(
              `webPush.notifyMailNew (broadcast) failed: ${(e as Error).message}`,
            ),
          );
      }
    }
    // Phase 44.1 — Web Push 'MAIL_NEW' broadcast. Per-user cooldown (30s)
    // + dedupeKey theo broadcast batch đảm bảo không spam recipient.
    if (this.webPush && chars.length > 0) {
      const dedupeKey = `mail-broadcast-${Date.now()}-${input.subject.slice(0, 24)}`;
      void this.webPush
        .broadcastToUsers(
          chars.map((c) => c.userId),
          'MAIL_NEW',
          {
            title: `Thư mới: ${input.senderName ?? 'Thiên Đạo Sứ Giả'}`,
            body: input.subject,
            url: '/mail',
            tag: dedupeKey,
            dedupeKey,
          },
        )
        .catch((e) =>
          this.logger.warn(
            `mail broadcast push fan-out failed: ${(e as Error).message}`,
          ),
        );
    }
    return chars.length;
  }

  /**
   * Xoá thư đã claim + quá hạn. Cron có thể gọi.
   *
   * Rule: (a) thư đã claim cũ hơn `olderThan` → rác lịch sử, xoá.
   * (b) thư expired mà KHÔNG còn reward nào chưa claim → rác tin tức, xoá.
   * GIỮ lại thư expired nhưng có reward (LT/TN/EXP hoặc item) chưa claim —
   * người chơi vẫn có thể mở ra xem lại / khiếu nại GM.
   */
  async pruneExpired(olderThan: Date): Promise<number> {
    const res = await this.prisma.mail.deleteMany({
      where: {
        OR: [
          { claimedAt: { lt: olderThan } },
          {
            expiresAt: { lt: new Date() },
            rewardLinhThach: 0n,
            rewardTienNgoc: 0,
            rewardExp: 0n,
            rewardItems: { equals: [] },
          },
        ],
      },
    });
    return res.count;
  }

  private async requireCharacter(userId: string): Promise<{ id: string }> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new MailError('NO_CHARACTER');
    return char;
  }

  private validateInput(input: MailSendInput | MailBroadcastInput): void {
    if (!input.subject || input.subject.length > 120) {
      throw new MailError('INVALID_INPUT');
    }
    if (!input.body || input.body.length > 2000) {
      throw new MailError('INVALID_INPUT');
    }
    if (input.rewardLinhThach !== undefined && input.rewardLinhThach < 0n) {
      throw new MailError('INVALID_INPUT');
    }
    if (input.rewardTienNgoc !== undefined && input.rewardTienNgoc < 0) {
      throw new MailError('INVALID_INPUT');
    }
    if (input.rewardExp !== undefined && input.rewardExp < 0n) {
      throw new MailError('INVALID_INPUT');
    }
    if (input.rewardItems && input.rewardItems.length > MAX_ITEMS_PER_MAIL) {
      throw new MailError('INVALID_INPUT');
    }
    for (const it of input.rewardItems ?? []) {
      if (!it.itemKey || it.qty <= 0) throw new MailError('INVALID_INPUT');
    }
  }
}

function parseItems(raw: unknown): MailRewardItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MailRewardItem[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object' && 'itemKey' in r && 'qty' in r) {
      const v = r as { itemKey: unknown; qty: unknown };
      if (typeof v.itemKey === 'string' && typeof v.qty === 'number' && v.qty > 0) {
        out.push({ itemKey: v.itemKey, qty: v.qty });
      }
    }
  }
  return out;
}

function toView(
  row: {
    id: string;
    senderName: string;
    subject: string;
    body: string;
    rewardLinhThach: bigint;
    rewardTienNgoc: number;
    rewardExp: bigint;
    rewardItems: Prisma.JsonValue;
    readAt: Date | null;
    claimedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    mailType?: MailType;
    deletedAt?: Date | null;
  },
  now: Date,
): MailView {
  const items = parseItems(row.rewardItems);
  const expired = row.expiresAt ? row.expiresAt.getTime() <= now.getTime() : false;
  const hasReward =
    row.rewardLinhThach > 0n ||
    row.rewardTienNgoc > 0 ||
    row.rewardExp > 0n ||
    items.length > 0;
  const status = deriveMailStatus({
    readAt: row.readAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    now: now.toISOString(),
    hasReward,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  });
  return {
    id: row.id,
    senderName: row.senderName,
    subject: row.subject,
    body: row.body,
    rewardLinhThach: row.rewardLinhThach.toString(),
    rewardTienNgoc: row.rewardTienNgoc,
    rewardExp: row.rewardExp.toString(),
    rewardItems: items,
    readAt: row.readAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    claimable: hasReward && !row.claimedAt && !expired && !row.deletedAt,
    mailType: row.mailType ?? ('SYSTEM' as MailType),
    status,
    deleted: !!row.deletedAt,
  };
}
