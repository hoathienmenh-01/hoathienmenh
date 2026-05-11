import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type PrivateChatMessageRow,
  type PrivateChatThreadRow,
  sortUserPair,
  validateChatMessageBody,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialError, SocialService } from '../social/social.service';

/**
 * Phase 19.1 — Private chat 1-1 giữa 2 user.
 *
 * Server-authoritative invariants (test-enforced):
 *   - Thread invariant `userAId < userBId` (lexicographic). Service
 *     chuẩn hoá thứ tự trước khi upsert qua `getOrCreatePrivateThread`.
 *   - Chỉ thành viên thread đọc được. User thứ 3 → 404 mask (không
 *     leak existence).
 *   - Block 2 chiều cấm gửi (reject `BLOCKED`). Đọc lịch sử vẫn cho
 *     phép nếu trước khi block đã có thread (history preserve).
 *   - Empty/whitespace-only body reject `INVALID_INPUT`. Body >500
 *     reject `INVALID_INPUT`.
 *   - Cấm self-thread (cấm thread A-A).
 *
 * Realtime fanout:
 *   - Khi gửi private message → emit `private-chat:msg` đến cả 2 user
 *     qua `RealtimeService.emitToUser`. Không broadcast.
 */
export type ChatPrivateErrorCode =
  | 'SELF_NOT_ALLOWED'
  | 'BLOCKED'
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT';

export class ChatPrivateError extends Error {
  constructor(public readonly code: ChatPrivateErrorCode) {
    super(code);
  }
}

@Injectable()
export class ChatPrivateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly social: SocialService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Lấy thread giữa caller và peer; tạo nếu chưa có. Reject:
   *   - `SELF_NOT_ALLOWED` nếu caller === peer.
   *   - `BLOCKED` nếu 2 user đang block lẫn nhau (chặn tạo thread mới).
   *
   * Idempotent qua UNIQUE (userAId, userBId).
   */
  async getOrCreatePrivateThread(
    callerUserId: string,
    peerUserId: string,
  ): Promise<PrivateChatThreadRow> {
    if (callerUserId === peerUserId) {
      throw new ChatPrivateError('SELF_NOT_ALLOWED');
    }
    const pair = sortUserPair(callerUserId, peerUserId);
    if (!pair) throw new ChatPrivateError('SELF_NOT_ALLOWED');

    if (await this.social.isBlockedBetween(callerUserId, peerUserId)) {
      throw new ChatPrivateError('BLOCKED');
    }

    const thread = await this.prisma.privateChatThread.upsert({
      where: {
        userAId_userBId: { userAId: pair.low, userBId: pair.high },
      },
      update: {},
      create: { userAId: pair.low, userBId: pair.high },
    });

    return await this.toThreadRow(callerUserId, thread);
  }

  /**
   * Gửi private message. Reject:
   *   - `NOT_FOUND` nếu thread không tồn tại HOẶC caller không phải
   *     thành viên (mask để không leak existence).
   *   - `BLOCKED` nếu 2 user đang block.
   *   - `INVALID_INPUT` nếu body empty/whitespace/quá 500 char.
   */
  async sendPrivateMessage(
    callerUserId: string,
    threadId: string,
    rawBody: string,
  ): Promise<PrivateChatMessageRow> {
    const thread = await this.requireMemberThread(callerUserId, threadId);

    const peerUserId =
      thread.userAId === callerUserId ? thread.userBId : thread.userAId;

    if (await this.social.isBlockedBetween(callerUserId, peerUserId)) {
      throw new ChatPrivateError('BLOCKED');
    }

    const v = validateChatMessageBody(rawBody, 'PRIVATE');
    if (!v.ok) throw new ChatPrivateError('INVALID_INPUT');

    const row = await this.prisma.privateChatMessage.create({
      data: {
        threadId: thread.id,
        senderUserId: callerUserId,
        body: v.value,
      },
    });

    const senderChar = await this.prisma.character.findUnique({
      where: { userId: callerUserId },
      select: { name: true },
    });

    const view: PrivateChatMessageRow = {
      id: row.id,
      threadId: row.threadId,
      senderUserId: row.senderUserId,
      senderDisplayName: senderChar?.name ?? null,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };

    // Fanout WS — chỉ 2 thành viên thread (server emit per-user, không
    // broadcast). Wrap try/catch fail-soft: realtime down KHÔNG rollback
    // message insert.
    try {
      this.realtime.emitToUser(callerUserId, 'private-chat:msg', view);
      this.realtime.emitToUser(peerUserId, 'private-chat:msg', view);
    } catch {
      // realtime fanout best-effort
    }

    return view;
  }

  /**
   * List messages của thread (caller phải là thành viên, ngược lại
   * 404 mask). Trả về thứ tự desc theo createdAt — caller có thể
   * limit/cursor sau.
   */
  async listPrivateMessages(
    callerUserId: string,
    threadId: string,
    limit = 50,
  ): Promise<PrivateChatMessageRow[]> {
    await this.requireMemberThread(callerUserId, threadId);
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const rows = await this.prisma.privateChatMessage.findMany({
      where: { threadId },
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

    return rows.map((r) => ({
      id: r.id,
      threadId: r.threadId,
      senderUserId: r.senderUserId,
      senderDisplayName: nameMap.get(r.senderUserId) ?? null,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * List thread của caller (chỉ thread mà caller là 1 trong 2 thành
   * viên). Filter ra thread mà peer đang block caller hoặc bị caller
   * block.
   */
  async listPrivateThreads(
    callerUserId: string,
  ): Promise<PrivateChatThreadRow[]> {
    const threads = await this.prisma.privateChatThread.findMany({
      where: {
        OR: [{ userAId: callerUserId }, { userBId: callerUserId }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const peerIds = threads.map((t) =>
      t.userAId === callerUserId ? t.userBId : t.userAId,
    );

    const blockedSet = await this.fetchBlockedUserIdSet(callerUserId);
    const visibleThreads = threads.filter((t) => {
      const peer = t.userAId === callerUserId ? t.userBId : t.userAId;
      return !blockedSet.has(peer);
    });

    const chars = peerIds.length
      ? await this.prisma.character.findMany({
          where: { userId: { in: peerIds } },
          select: { userId: true, name: true },
        })
      : [];
    const nameMap = new Map(chars.map((c) => [c.userId, c.name]));

    return visibleThreads.map((t) => {
      const peer = t.userAId === callerUserId ? t.userBId : t.userAId;
      return {
        id: t.id,
        peerUserId: peer,
        peerDisplayName: nameMap.get(peer) ?? null,
        peerOnline: this.realtime.isOnline(peer),
        createdAt: t.createdAt.toISOString(),
      } satisfies PrivateChatThreadRow;
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Trả về thread row nếu caller là thành viên. Nếu không tìm thấy
   * thread hoặc caller không phải thành viên → throw `NOT_FOUND`
   * (mask để không leak existence).
   */
  private async requireMemberThread(
    callerUserId: string,
    threadId: string,
  ): Promise<Prisma.PrivateChatThreadGetPayload<object>> {
    const thread = await this.prisma.privateChatThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new ChatPrivateError('NOT_FOUND');
    if (
      thread.userAId !== callerUserId &&
      thread.userBId !== callerUserId
    ) {
      // 404 mask, không 403 (không leak existence).
      throw new ChatPrivateError('NOT_FOUND');
    }
    return thread;
  }

  private async fetchBlockedUserIdSet(
    userId: string,
  ): Promise<Set<string>> {
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

  private async toThreadRow(
    callerUserId: string,
    thread: Prisma.PrivateChatThreadGetPayload<object>,
  ): Promise<PrivateChatThreadRow> {
    const peer =
      thread.userAId === callerUserId ? thread.userBId : thread.userAId;
    const peerChar = await this.prisma.character.findUnique({
      where: { userId: peer },
      select: { name: true },
    });
    return {
      id: thread.id,
      peerUserId: peer,
      peerDisplayName: peerChar?.name ?? null,
      peerOnline: this.realtime.isOnline(peer),
      createdAt: thread.createdAt.toISOString(),
    };
  }
}

// Re-export SocialError for convenience (some controllers may catch
// either; explicit alias keeps imports clean).
export { SocialError };
