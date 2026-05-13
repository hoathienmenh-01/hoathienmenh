import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canSweepContentType,
  getExtraAttemptLimit,
  type ExtraAttemptLimitKey,
  type MonetizationErrorCode,
  type SweepableContentType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { WalletService } from './wallet.service';
import { MonetizationFoundationError } from './monetization-shop.service';

export interface UseSweepTicketInput {
  characterId: string;
  ticketKey: string;
  contentType: string;
  contentKey: string;
  now?: Date;
}

export interface UseSweepTicketResult {
  ticketKey: string;
  contentType: SweepableContentType;
  contentKey: string;
  logId: string;
}

/**
 * Phase 27.0 — Sweep ticket service.
 *
 * Rule:
 *   - `contentType` phải ∈ `SWEEPABLE_CONTENT_TYPES` (`DUNGEON` /
 *     `FARM_MAP` / `SECT_DUNGEON`) → `canSweepContentType`.
 *   - Player phải đã clear nội dung đó (có `DungeonRun.completedAt` /
 *     `FarmSession` claim đã đóng) — guard `CONTENT_NOT_CLEARED`.
 *   - Tốn 1 vé quét (debit `TIEN_NGOC_KHOA` mặc định 30) — foundation
 *     phase chưa có ticket inventory model, dùng currency balance ticker.
 *   - Log vào `SweepTicketLog`.
 *
 * Reward grant (loot table) là Phase 27.1+ — foundation chỉ wire skeleton.
 */
@Injectable()
export class SweepTicketService {
  /** Phí 1 vé quét (TIEN_NGOC_KHOA). Foundation default; balance theo PR sau. */
  static readonly TICKET_COST_KHOA = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async useTicket(input: UseSweepTicketInput): Promise<UseSweepTicketResult> {
    if (!canSweepContentType(input.contentType)) {
      throw new MonetizationFoundationError(
        'INVALID_INPUT' as MonetizationErrorCode,
        `Content type ${input.contentType} cannot be swept`,
      );
    }
    const cleared = await this.isContentCleared(
      input.characterId,
      input.contentType,
      input.contentKey,
    );
    if (!cleared) {
      throw new MonetizationFoundationError('CONTENT_NOT_CLEARED');
    }
    const contentType = input.contentType as SweepableContentType;
    return await this.prisma.$transaction(async (tx) => {
      // Debit ticket cost
      try {
        await this.wallet.applyTx(tx, {
          characterId: input.characterId,
          currency: 'TIEN_NGOC_KHOA',
          delta: -SweepTicketService.TICKET_COST_KHOA,
          reason: 'MONETIZATION_SWEEP_TICKET_USE',
          refType: 'SweepTicketLog',
          refId: `${contentType}:${input.contentKey}`,
          meta: {
            ticketKey: input.ticketKey,
            contentType,
            contentKey: input.contentKey,
          },
        });
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message === 'INSUFFICIENT_FUNDS' || err.message === 'NOT_FOUND')
        ) {
          throw new MonetizationFoundationError('INSUFFICIENT_CURRENCY');
        }
        throw err;
      }
      const log = await tx.sweepTicketLog.create({
        data: {
          characterId: input.characterId,
          ticketKey: input.ticketKey,
          contentType,
          contentKey: input.contentKey,
          rewardJson: {} as Prisma.InputJsonValue,
        },
      });
      return {
        ticketKey: input.ticketKey,
        contentType,
        contentKey: input.contentKey,
        logId: log.id,
      };
    });
  }

  private async isContentCleared(
    characterId: string,
    contentType: string,
    contentKey: string,
  ): Promise<boolean> {
    if (contentType === 'DUNGEON') {
      const run = await this.prisma.dungeonRun.findFirst({
        where: {
          characterId,
          templateKey: contentKey,
          status: 'COMPLETED',
        },
        select: { id: true },
      });
      return Boolean(run);
    }
    if (contentType === 'FARM_MAP') {
      const session = await this.prisma.farmSession.findFirst({
        where: {
          characterId,
          farmMapKey: contentKey,
          status: 'CLAIMED',
        },
        select: { id: true },
      });
      return Boolean(session);
    }
    if (contentType === 'SECT_DUNGEON') {
      // Foundation phase: bất kỳ attempt nào đã log với bossKey = contentKey.
      // Phase 27.1 sẽ refine sang first-clear marker riêng.
      const log = await this.prisma.sectBossAttemptLog.findFirst({
        where: { characterId, bossKey: contentKey },
        select: { id: true },
      });
      return Boolean(log);
    }
    return false;
  }
}

export interface BuyExtraAttemptInput {
  characterId: string;
  limitKey: string;
  now?: Date;
}

export interface BuyExtraAttemptResult {
  limitKey: ExtraAttemptLimitKey;
  /** Số lượt còn lại có thể mua trong day. */
  remaining: number;
  /** Tổng đã mua trong day sau lần này. */
  usedCount: number;
  maxCount: number;
}

/**
 * Phase 27.0 — Extra attempt service. Mua thêm lượt content (bí cảnh thường,
 * boss cá nhân, farm map). Day-bucket UTC (`YYYY-MM-DD`).
 *
 * Pattern: upsert `PaidLimitPurchase(characterId, limitKey, periodKey)` →
 * atomic `updateMany` increment `usedCount` guard `< maxCount`. Phí
 * `TIEN_NGOC_KHOA` (foundation default 30 / lượt; balance theo catalog
 * shop product nếu cần).
 */
@Injectable()
export class ExtraAttemptService {
  /** Phí default cho 1 lượt extra (TIEN_NGOC_KHOA). */
  static readonly EXTRA_ATTEMPT_COST_KHOA = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async buyExtraAttempt(input: BuyExtraAttemptInput): Promise<BuyExtraAttemptResult> {
    const def = getExtraAttemptLimit(input.limitKey);
    if (!def) {
      throw new MonetizationFoundationError(
        'INVALID_INPUT' as MonetizationErrorCode,
        `Unknown extra attempt limit: ${input.limitKey}`,
      );
    }
    const now = input.now ?? new Date();
    const periodKey = utcDayBucket(now);
    return await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.paidLimitPurchase.findUnique({
          where: {
            characterId_limitKey_periodKey: {
              characterId: input.characterId,
              limitKey: def.key,
              periodKey,
            },
          },
        });
        let used: number;
        let row;
        if (existing) {
          // CAS guard: increment only if usedCount < maxCount.
          const upd = await tx.paidLimitPurchase.updateMany({
            where: {
              id: existing.id,
              usedCount: { lt: existing.maxCount },
            },
            data: { usedCount: { increment: 1 } },
          });
          if (upd.count === 0) {
            throw new MonetizationFoundationError('EXTRA_ATTEMPT_LIMIT_REACHED');
          }
          used = existing.usedCount + 1;
          row = existing;
        } else {
          row = await tx.paidLimitPurchase.create({
            data: {
              characterId: input.characterId,
              limitKey: def.key,
              periodKey,
              usedCount: 1,
              maxCount: def.maxPerDay,
            },
          });
          used = 1;
        }

        // Debit cost AFTER limit increment so 2 concurrent buys can't both deduct
        // and only one wins limit. If debit fails (INSUFFICIENT_CURRENCY),
        // rollback the increment by raising error from transaction.
        try {
          await this.wallet.applyTx(tx, {
            characterId: input.characterId,
            currency: 'TIEN_NGOC_KHOA',
            delta: -ExtraAttemptService.EXTRA_ATTEMPT_COST_KHOA,
            reason: 'MONETIZATION_EXTRA_ATTEMPT_BUY',
            refType: 'PaidLimitPurchase',
            refId: row.id,
            meta: { limitKey: def.key, periodKey, usedCount: used },
          });
        } catch (err) {
          if (
            err instanceof Error &&
            (err.message === 'INSUFFICIENT_FUNDS' || err.message === 'NOT_FOUND')
          ) {
            throw new MonetizationFoundationError('INSUFFICIENT_CURRENCY');
          }
          throw err;
        }

        return {
          limitKey: def.key,
          remaining: Math.max(def.maxPerDay - used, 0),
          usedCount: used,
          maxCount: def.maxPerDay,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getState(
    characterId: string,
    now: Date = new Date(),
  ): Promise<Array<{ limitKey: ExtraAttemptLimitKey; usedCount: number; maxCount: number; remaining: number }>> {
    const periodKey = utcDayBucket(now);
    const rows = await this.prisma.paidLimitPurchase.findMany({
      where: { characterId, periodKey },
    });
    const byKey = new Map(rows.map((r) => [r.limitKey, r] as const));
    const result: Array<{
      limitKey: ExtraAttemptLimitKey;
      usedCount: number;
      maxCount: number;
      remaining: number;
    }> = [];
    const { EXTRA_ATTEMPT_LIMITS } = await import('@xuantoi/shared');
    for (const def of EXTRA_ATTEMPT_LIMITS) {
      const row = byKey.get(def.key);
      const used = row?.usedCount ?? 0;
      result.push({
        limitKey: def.key,
        usedCount: used,
        maxCount: def.maxPerDay,
        remaining: Math.max(def.maxPerDay - used, 0),
      });
    }
    return result;
  }
}

function utcDayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}
