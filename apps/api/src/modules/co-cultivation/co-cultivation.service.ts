import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoCultivationStatus, Prisma } from '@prisma/client';
import {
  CO_CULTIVATION_LIMITS,
  type CoCultivationDailyUsageRow,
  type CoCultivationErrorCode,
  type CoCultivationHistoryResponse,
  type CoCultivationSessionRow,
  type CoCultivationStatusResponse,
  clampBuffPercent,
  clampDurationSec,
  computeCoCultivationBonusExp,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { dayBucketFor } from '../economy/reward-cap.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialService } from '../social/social.service';

/**
 * Phase 35.1 — Co-Cultivation / Hợp Luyện service.
 *
 * Lifecycle PENDING → ACTIVE → COMPLETED (hoặc CANCELLED / EXPIRED).
 *
 * Server-authoritative:
 *   - Friendship + block check qua `SocialService` (Phase 19.1).
 *   - Presence check qua `RealtimeService.isOnline` (best-effort —
 *     fallback `true` khi service không inject để unit test pass).
 *   - Bonus EXP áp 1 lần ở `complete` qua `RewardCapService.applyCapTx`
 *     source `CULTIVATION` (share budget tránh dual-farm với regular
 *     tick). Idempotent qua `rewardApplied` CAS flag.
 *
 * Anti-abuse:
 *   - Daily cap 3 session + 1800s buff / ngày / user.
 *   - Cooldown 60s giữa 2 COMPLETED.
 *   - Không tự hợp luyện chính mình.
 *   - Phải là friend (Phase 19.1 Friendship).
 *   - Không khi block 2 chiều.
 *   - 1 user tối đa 1 session ACTIVE/PENDING tại 1 thời điểm.
 *
 * KHÔNG sửa cultivation processor — bonus chỉ áp tại complete.
 * Follow-up: wire processor để buff live-during-tick (xem
 * `docs/social/phase-35-1-friend-co-cultivation-plan.md` §11).
 */

export class CoCultivationError extends Error {
  constructor(public readonly code: CoCultivationErrorCode) {
    super(code);
  }
}

export interface CoCultivationRequestInput {
  partnerUserId: string;
  durationSec?: number;
  buffPercent?: number;
}

@Injectable()
export class CoCultivationService {
  private readonly logger = new Logger(CoCultivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rewardCap: RewardCapService,
    private readonly social: SocialService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  /**
   * Khởi tạo phiên hợp luyện ở trạng thái PENDING. Partner phải accept
   * mới chuyển sang ACTIVE.
   */
  async requestSession(
    initiatorUserId: string,
    input: CoCultivationRequestInput,
  ): Promise<CoCultivationSessionRow> {
    if (initiatorUserId === input.partnerUserId) {
      throw new CoCultivationError('SELF_NOT_ALLOWED');
    }
    if (!input.partnerUserId || typeof input.partnerUserId !== 'string') {
      throw new CoCultivationError('INVALID_INPUT');
    }

    const [isFriend, isBlocked] = await Promise.all([
      this.social.areFriends(initiatorUserId, input.partnerUserId),
      this.social.isBlockedBetween(initiatorUserId, input.partnerUserId),
    ]);
    if (isBlocked) throw new CoCultivationError('BLOCKED');
    if (!isFriend) throw new CoCultivationError('NOT_FRIEND');

    // Presence check — best-effort. Khi RealtimeService không bound
    // (test / single-instance startup), skip check.
    if (this.realtime && !this.realtime.isOnline(input.partnerUserId)) {
      throw new CoCultivationError('PARTNER_OFFLINE');
    }

    // Resolve character snapshot cho cả 2 user. Cần cho audit + future
    // processor wire. Không có character → NO_CHARACTER.
    const [initiatorChar, partnerChar] = await Promise.all([
      this.prisma.character.findUnique({
        where: { userId: initiatorUserId },
        select: { id: true },
      }),
      this.prisma.character.findUnique({
        where: { userId: input.partnerUserId },
        select: { id: true },
      }),
    ]);
    if (!initiatorChar || !partnerChar) {
      throw new CoCultivationError('NO_CHARACTER');
    }

    // Bất kỳ session PENDING/ACTIVE nào của initiator HOẶC partner →
    // block ALREADY_ACTIVE. Mỗi user chỉ 1 session active tại 1 lúc.
    const activeOrPending = await this.prisma.coCultivationSession.findFirst({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        OR: [
          { initiatorUserId },
          { partnerUserId: initiatorUserId },
          { initiatorUserId: input.partnerUserId },
          { partnerUserId: input.partnerUserId },
        ],
      },
      select: { id: true },
    });
    if (activeOrPending) {
      throw new CoCultivationError('ALREADY_ACTIVE');
    }

    // Daily cap check — initiator phía. Partner cap sẽ check lần nữa
    // ở `accept` (defense-in-depth).
    const today = dayBucketFor();
    const usage = await this.prisma.coCultivationDailyUsage.findUnique({
      where: { userId_dateKey: { userId: initiatorUserId, dateKey: today } },
    });
    const sessionsToday = usage?.sessionsCompleted ?? 0;
    const buffSecondsToday = usage?.totalBuffSeconds ?? 0;
    if (sessionsToday >= CO_CULTIVATION_LIMITS.DAILY_SESSIONS_CAP) {
      throw new CoCultivationError('DAILY_CAP_REACHED');
    }

    const duration = clampDurationSec(
      input.durationSec ?? CO_CULTIVATION_LIMITS.DEFAULT_DURATION_SEC,
    );
    if (
      buffSecondsToday + duration >
      CO_CULTIVATION_LIMITS.DAILY_BUFF_SECONDS_CAP
    ) {
      throw new CoCultivationError('BUFF_BUDGET_EXCEEDED');
    }

    // Cooldown check — initiator's last COMPLETED.
    if (
      await this.isCooldownActive(initiatorUserId, CO_CULTIVATION_LIMITS.COMPLETE_COOLDOWN_SEC)
    ) {
      throw new CoCultivationError('COOLDOWN_ACTIVE');
    }

    const buffPct = clampBuffPercent(
      input.buffPercent ?? CO_CULTIVATION_LIMITS.BUFF_PERCENT_DEFAULT,
    );
    const expiresAt = new Date(
      Date.now() + CO_CULTIVATION_LIMITS.PENDING_EXPIRES_SEC * 1000,
    );

    const row = await this.prisma.coCultivationSession.create({
      data: {
        initiatorUserId,
        partnerUserId: input.partnerUserId,
        initiatorCharacterId: initiatorChar.id,
        partnerCharacterId: partnerChar.id,
        status: 'PENDING',
        durationSec: duration,
        buffPercent: buffPct,
        expiresAt,
      },
    });
    return this.toRow(row);
  }

  /**
   * Partner accept session — chuyển PENDING → ACTIVE.
   */
  async acceptSession(
    actorUserId: string,
    sessionId: string,
  ): Promise<CoCultivationSessionRow> {
    const row = await this.prisma.coCultivationSession.findUnique({
      where: { id: sessionId },
    });
    if (!row) throw new CoCultivationError('NOT_FOUND');
    if (row.partnerUserId !== actorUserId) {
      throw new CoCultivationError('NOT_AUTHORIZED');
    }
    if (row.status !== 'PENDING') {
      throw new CoCultivationError('INVALID_TRANSITION');
    }
    // Defensive: partner-side cap check (initiator was checked at request).
    const today = dayBucketFor();
    const usage = await this.prisma.coCultivationDailyUsage.findUnique({
      where: { userId_dateKey: { userId: actorUserId, dateKey: today } },
    });
    if (
      (usage?.sessionsCompleted ?? 0) >= CO_CULTIVATION_LIMITS.DAILY_SESSIONS_CAP
    ) {
      throw new CoCultivationError('DAILY_CAP_REACHED');
    }
    if (
      (usage?.totalBuffSeconds ?? 0) + row.durationSec >
      CO_CULTIVATION_LIMITS.DAILY_BUFF_SECONDS_CAP
    ) {
      throw new CoCultivationError('BUFF_BUDGET_EXCEEDED');
    }

    const updated = await this.prisma.coCultivationSession.update({
      where: { id: sessionId },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });
    return this.toRow(updated);
  }

  /**
   * Cancel session. Cả initiator + partner đều được cancel (đối xứng).
   * Idempotent — gọi 2 lần với session đã CANCELLED → INVALID_TRANSITION.
   */
  async cancelSession(
    actorUserId: string,
    sessionId: string,
  ): Promise<CoCultivationSessionRow> {
    const row = await this.prisma.coCultivationSession.findUnique({
      where: { id: sessionId },
    });
    if (!row) throw new CoCultivationError('NOT_FOUND');
    if (
      row.initiatorUserId !== actorUserId &&
      row.partnerUserId !== actorUserId
    ) {
      throw new CoCultivationError('NOT_AUTHORIZED');
    }
    if (row.status !== 'PENDING' && row.status !== 'ACTIVE') {
      throw new CoCultivationError('INVALID_TRANSITION');
    }
    const updated = await this.prisma.coCultivationSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
    });
    return this.toRow(updated);
  }

  /**
   * Complete session — áp bonus EXP cho cả 2 character (server-authoritative)
   * qua `RewardCapService` source `CULTIVATION`. Idempotent qua
   * `rewardApplied` CAS guard.
   *
   * Side effects:
   *   - Character.exp += grantedExp (per cap apply).
   *   - CoCultivationDailyUsage upsert (+1 session, +durationSec, +totalGranted).
   *   - Session: status = COMPLETED, completedAt = now, rewardApplied = true,
   *     bonusExpGranted = tổng đã grant.
   */
  async completeSession(
    actorUserId: string,
    sessionId: string,
  ): Promise<CoCultivationSessionRow> {
    const row = await this.prisma.coCultivationSession.findUnique({
      where: { id: sessionId },
    });
    if (!row) throw new CoCultivationError('NOT_FOUND');
    if (
      row.initiatorUserId !== actorUserId &&
      row.partnerUserId !== actorUserId
    ) {
      throw new CoCultivationError('NOT_AUTHORIZED');
    }
    if (row.status !== 'ACTIVE') {
      throw new CoCultivationError('INVALID_TRANSITION');
    }
    if (row.rewardApplied) {
      // Re-completing → just return row (idempotent).
      return this.toRow(row);
    }

    const requestedExp = BigInt(
      computeCoCultivationBonusExp(row.durationSec, row.buffPercent),
    );

    const txOutcome = await this.prisma.$transaction(async (tx) => {
      // CAS guard: chỉ update khi rewardApplied=false.
      const cas = await tx.coCultivationSession.updateMany({
        where: { id: sessionId, rewardApplied: false, status: 'ACTIVE' },
        data: { rewardApplied: true },
      });
      if (cas.count === 0) {
        return { kind: 'race' as const };
      }

      let totalGranted = 0n;
      for (const target of [
        {
          userId: row.initiatorUserId,
          characterId: row.initiatorCharacterId,
        },
        {
          userId: row.partnerUserId,
          characterId: row.partnerCharacterId,
        },
      ]) {
        // Lookup realmKey (caller pass để skip 1 query trong applyCapTx).
        const c = await tx.character.findUnique({
          where: { id: target.characterId },
          select: { realmKey: true },
        });
        if (!c) continue;
        const cap = await this.rewardCap.applyCapTx(tx, {
          characterId: target.characterId,
          source: 'CULTIVATION',
          requestedExp,
          requestedLinhThach: 0n,
          realmKey: c.realmKey,
          refType: 'CoCultivationComplete',
          refId: sessionId,
          meta: { partnerUserId: row.partnerUserId, durationSec: row.durationSec },
        });
        if (cap.grantedExp > 0n) {
          await tx.character.update({
            where: { id: target.characterId },
            data: { exp: { increment: cap.grantedExp } },
          });
          totalGranted += cap.grantedExp;
        }
      }

      const dateKey = dayBucketFor();
      for (const userId of [row.initiatorUserId, row.partnerUserId]) {
        await tx.coCultivationDailyUsage.upsert({
          where: { userId_dateKey: { userId, dateKey } },
          create: {
            userId,
            dateKey,
            sessionsCompleted: 1,
            totalBuffSeconds: row.durationSec,
            totalBonusExp: requestedExp,
          },
          update: {
            sessionsCompleted: { increment: 1 },
            totalBuffSeconds: { increment: row.durationSec },
            totalBonusExp: { increment: requestedExp },
          },
        });
      }

      const updated = await tx.coCultivationSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          bonusExpGranted: totalGranted,
        },
      });
      return { kind: 'ok' as const, row: updated };
    });

    if (txOutcome.kind === 'race') {
      // Re-fetch + return idempotent.
      const refreshed = await this.prisma.coCultivationSession.findUnique({
        where: { id: sessionId },
      });
      return this.toRow(refreshed!);
    }
    return this.toRow(txOutcome.row);
  }

  /**
   * Status cho FE: phiên hiện tại (PENDING|ACTIVE) + usage hôm nay.
   */
  async getStatus(userId: string): Promise<CoCultivationStatusResponse> {
    const [active, usage] = await Promise.all([
      this.prisma.coCultivationSession.findFirst({
        where: {
          status: { in: ['PENDING', 'ACTIVE'] },
          OR: [{ initiatorUserId: userId }, { partnerUserId: userId }],
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.coCultivationDailyUsage.findUnique({
        where: { userId_dateKey: { userId, dateKey: dayBucketFor() } },
      }),
    ]);

    return {
      active: active ? this.toRow(active) : null,
      today: this.toUsageRow(userId, usage),
    };
  }

  /**
   * Lịch sử phiên gần đây cho user. Cap `limit` ≤ 50.
   */
  async getHistory(
    userId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<CoCultivationHistoryResponse> {
    const rawLimit = Math.floor(opts.limit ?? 20);
    const limit = Math.min(
      CO_CULTIVATION_LIMITS.HISTORY_LIMIT_MAX,
      Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20),
    );
    const where: Prisma.CoCultivationSessionWhereInput = {
      OR: [{ initiatorUserId: userId }, { partnerUserId: userId }],
    };
    if (opts.before && typeof opts.before === 'string') {
      const d = new Date(opts.before);
      if (!Number.isNaN(d.getTime())) {
        where.createdAt = { lt: d };
      }
    }
    // Fetch limit+1 to detect hasMore.
    const rows = await this.prisma.coCultivationSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const sliced = rows.slice(0, limit);
    return {
      sessions: sliced.map((r) => this.toRow(r)),
      hasMore: rows.length > limit,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async isCooldownActive(
    userId: string,
    cooldownSec: number,
  ): Promise<boolean> {
    const last = await this.prisma.coCultivationSession.findFirst({
      where: {
        status: 'COMPLETED',
        OR: [{ initiatorUserId: userId }, { partnerUserId: userId }],
        completedAt: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    if (!last?.completedAt) return false;
    const elapsed = (Date.now() - last.completedAt.getTime()) / 1000;
    return elapsed < cooldownSec;
  }

  private toRow(r: {
    id: string;
    initiatorUserId: string;
    partnerUserId: string;
    initiatorCharacterId: string;
    partnerCharacterId: string;
    status: CoCultivationStatus;
    durationSec: number;
    buffPercent: number;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
    rewardApplied: boolean;
    bonusExpGranted: bigint;
    createdAt: Date;
  }): CoCultivationSessionRow {
    return {
      id: r.id,
      initiatorUserId: r.initiatorUserId,
      partnerUserId: r.partnerUserId,
      initiatorCharacterId: r.initiatorCharacterId,
      partnerCharacterId: r.partnerCharacterId,
      status: r.status,
      durationSec: r.durationSec,
      buffPercent: r.buffPercent,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      rewardApplied: r.rewardApplied,
      bonusExpGranted: r.bonusExpGranted.toString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toUsageRow(
    userId: string,
    u: {
      sessionsCompleted: number;
      totalBuffSeconds: number;
      totalBonusExp: bigint;
    } | null,
  ): CoCultivationDailyUsageRow {
    const sessions = u?.sessionsCompleted ?? 0;
    const buffSeconds = u?.totalBuffSeconds ?? 0;
    return {
      userId,
      dateKey: dayBucketFor(),
      sessionsCompleted: sessions,
      totalBuffSeconds: buffSeconds,
      totalBonusExp: (u?.totalBonusExp ?? 0n).toString(),
      remainingSessions: Math.max(
        0,
        CO_CULTIVATION_LIMITS.DAILY_SESSIONS_CAP - sessions,
      ),
      remainingBuffSeconds: Math.max(
        0,
        CO_CULTIVATION_LIMITS.DAILY_BUFF_SECONDS_CAP - buffSeconds,
      ),
    };
  }
}
