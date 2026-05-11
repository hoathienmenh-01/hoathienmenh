import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  PresenceRow,
  PresenceUpdateBroadcastPayload,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Phase 19.3 — Presence service (single-instance).
 *
 * Responsibilities:
 *   - Persist `lastSeenAt` per user trong `UserPresence` table khi
 *     socket connect / disconnect.
 *   - Online status được tính runtime từ `RealtimeService.userSockets`
 *     (in-memory). Multi-tab safety: chỉ offline khi socket cuối
 *     disconnect (`activeConnectionCount` về 0).
 *   - Fanout `presence:update` cho friend của user khi state đổi.
 *   - Cung cấp `listPresenceForUsers` cho FE query batch (Social
 *     panel friend list, etc.).
 *
 * Privacy:
 *   - KHÔNG expose IP / sessionId / socket id / user-agent.
 *   - User đã block viewer → `getPresenceForViewer` trả `OFFLINE`
 *     + `lastSeenAt=null` để không leak presence.
 *
 * Cross-shard / Redis pub-sub: out-of-scope Phase 19.3, ghi RUNBOOK
 * follow-up. Service vẫn an toàn ở single-instance API.
 */

export interface PresenceUpdate {
  userId: string;
  /** Số connection active TRƯỚC khi xử lý event này. */
  previousConnections: number;
  /** Số connection active SAU khi xử lý event này. */
  currentConnections: number;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeService))
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Gọi khi user connect 1 socket mới. Trả về update info để gateway
   * quyết định có fanout `presence:update` không (chỉ fanout khi
   * `previousConnections === 0 && currentConnections > 0`).
   *
   * Best-effort: nếu DB upsert fail, log warn nhưng KHÔNG throw —
   * connection vẫn được attach ở `RealtimeService` (in-memory).
   */
  async markConnected(userId: string): Promise<PresenceUpdate> {
    // `RealtimeService.attach` đã gọi ở gateway TRƯỚC khi gọi service
    // này → size hiện tại đã bao gồm socket vừa connect. Lấy `current`
    // trước, suy ngược `previous`.
    const current = this.realtime.countConnectionsForUser(userId);
    const previous = Math.max(0, current - 1);

    try {
      const now = new Date();
      await this.prisma.userPresence.upsert({
        where: { userId },
        update: { lastSeenAt: now },
        create: { userId, lastSeenAt: now },
      });
    } catch (e) {
      this.logger.warn(
        `markConnected DB upsert failed user=${userId}: ${(e as Error).message}`,
      );
    }

    return { userId, previousConnections: previous, currentConnections: current };
  }

  /**
   * Gọi khi user disconnect 1 socket. Gateway gọi sau khi
   * `RealtimeService.detach`. `previous` = current + 1.
   *
   * Best-effort upsert `lastSeenAt` (chỉ ý nghĩa khi current === 0
   * — disconnect cuối → user offline). Vẫn upsert ở mọi case để
   * tracking activity gần nhất.
   */
  async markDisconnected(userId: string): Promise<PresenceUpdate> {
    const current = this.realtime.countConnectionsForUser(userId);
    const previous = current + 1;

    try {
      const now = new Date();
      await this.prisma.userPresence.upsert({
        where: { userId },
        update: { lastSeenAt: now },
        create: { userId, lastSeenAt: now },
      });
    } catch (e) {
      this.logger.warn(
        `markDisconnected DB upsert failed user=${userId}: ${(e as Error).message}`,
      );
    }

    return { userId, previousConnections: previous, currentConnections: current };
  }

  /** Wrapper cho FE — quick check 1 user online hay không (in-memory). */
  isOnline(userId: string): boolean {
    return this.realtime.isOnline(userId);
  }

  /**
   * Trả về snapshot presence cho danh sách `userIds` từ góc nhìn của
   * `viewerUserId`. Privacy:
   *   - User đã block viewer (`PlayerBlock`) → trả `OFFLINE` +
   *     `lastSeenAt=null` (không leak khi nào người đó online).
   *   - Viewer block target không leak gì thêm — vẫn trả status thật
   *     để FE biết hiển thị "Offline" trên thread cũ. Phase 19.3 chính
   *     sách: chỉ blocker-side mới hidden.
   *
   * Trả về 1 entry per requested id (kể cả user không tồn tại → online=false, lastSeenAt=null).
   * Cap input length 50 (service-level, controller cũng validate).
   */
  async listPresenceForUsers(
    viewerUserId: string,
    userIds: readonly string[],
  ): Promise<PresenceRow[]> {
    if (userIds.length === 0) return [];

    // Dedupe + cap.
    const unique = Array.from(new Set(userIds)).slice(0, 50);

    // Fetch lastSeenAt for all requested users in single query.
    const rows = await this.prisma.userPresence.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, lastSeenAt: true },
    });
    const lastSeenMap = new Map(
      rows.map((r) => [r.userId, r.lastSeenAt]),
    );

    // Fetch blockers-of-viewer set (users who blocked viewer).
    // Viewer is blocked BY them → hide their presence.
    const blockerRows = await this.prisma.playerBlock.findMany({
      where: {
        blockedUserId: viewerUserId,
        blockerUserId: { in: unique },
      },
      select: { blockerUserId: true },
    });
    const hiddenSet = new Set(blockerRows.map((r) => r.blockerUserId));

    return unique.map((uid) => {
      if (hiddenSet.has(uid)) {
        return {
          userId: uid,
          status: 'OFFLINE' as const,
          lastSeenAt: null,
        } satisfies PresenceRow;
      }
      const online = this.realtime.isOnline(uid);
      const lastSeenAt = lastSeenMap.get(uid);
      return {
        userId: uid,
        status: online ? 'ONLINE' : 'OFFLINE',
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
      } satisfies PresenceRow;
    });
  }

  /**
   * Fanout `presence:update` tới friend của user changed. Phase 19.3
   * scope: chỉ emit khi state transition (0 ↔ ≥1 connection). Service
   * tự lookup friend list để emit; KHÔNG broadcast public.
   *
   * Best-effort: nếu emit fail, log warn nhưng KHÔNG throw.
   * Privacy: nếu friend đang block user → KHÔNG emit cho friend đó.
   */
  async fanoutPresenceUpdate(update: PresenceUpdate): Promise<void> {
    // Chỉ fanout khi state transition.
    const wasOnline = update.previousConnections > 0;
    const nowOnline = update.currentConnections > 0;
    if (wasOnline === nowOnline) return;

    let lastSeenAt: Date | null = null;
    try {
      const row = await this.prisma.userPresence.findUnique({
        where: { userId: update.userId },
        select: { lastSeenAt: true },
      });
      lastSeenAt = row?.lastSeenAt ?? null;
    } catch (e) {
      this.logger.warn(
        `fanoutPresenceUpdate lookup failed user=${update.userId}: ${(e as Error).message}`,
      );
    }

    const payload: PresenceUpdateBroadcastPayload = {
      userId: update.userId,
      status: nowOnline ? 'ONLINE' : 'OFFLINE',
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    };

    // Friend list query — bidirectional, exclude blocked.
    let friendUserIds: string[] = [];
    try {
      const friendships = await this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: update.userId }, { userBId: update.userId }],
        },
        select: { userAId: true, userBId: true },
      });
      friendUserIds = friendships.map((f) =>
        f.userAId === update.userId ? f.userBId : f.userAId,
      );

      if (friendUserIds.length > 0) {
        // Exclude friends who blocked user OR user blocked.
        const blockRows = await this.prisma.playerBlock.findMany({
          where: {
            OR: [
              { blockerUserId: update.userId, blockedUserId: { in: friendUserIds } },
              { blockerUserId: { in: friendUserIds }, blockedUserId: update.userId },
            ],
          },
          select: { blockerUserId: true, blockedUserId: true },
        });
        const blockedSet = new Set<string>();
        for (const b of blockRows) {
          if (b.blockerUserId === update.userId) blockedSet.add(b.blockedUserId);
          else blockedSet.add(b.blockerUserId);
        }
        friendUserIds = friendUserIds.filter((id) => !blockedSet.has(id));
      }
    } catch (e) {
      this.logger.warn(
        `fanoutPresenceUpdate friend lookup failed user=${update.userId}: ${(e as Error).message}`,
      );
      return;
    }

    for (const fid of friendUserIds) {
      try {
        this.realtime.emitToUser(fid, 'presence:update', payload);
      } catch {
        // best-effort
      }
    }
  }
}
