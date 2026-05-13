import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  dayBucketFor,
  getDailyRewardCapTz,
} from '../economy/reward-cap.service';
import { weekBucketFor } from '../economy/drop-economy.service';

/**
 * Phase 26.5 — `WorldCapService`.
 *
 * Atomic CAS guard cho daily/weekly content caps. Server-authoritative —
 * mutate ONLY qua `consumeDailyTx` / `consumeWeeklyTx` trong cùng `$transaction`
 * với reward grant (mirror `DropEconomyService` pattern phase 26.2).
 *
 * Anti-P2W: premium KHÔNG bypass — cùng `capKey` áp dụng cho mọi player.
 */
@Injectable()
export class WorldCapService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consume daily cap atomic. Throw nếu sẽ vượt `limitQty` (hoặc `limitCount`).
   * Return new accumulated usage sau khi tăng.
   */
  async consumeDailyTx(
    tx: Prisma.TransactionClient,
    input: {
      characterId: string;
      capKey: string;
      source: string;
      limitCount?: number | null;
      limitQty?: number | null;
      countDelta?: number;
      qtyDelta?: number;
      now?: Date;
    },
  ): Promise<{ usedCount: number; usedQty: number; dayBucket: string }> {
    const tz = getDailyRewardCapTz();
    const dayBucket = dayBucketFor(input.now ?? new Date(), tz);
    const countDelta = input.countDelta ?? 0;
    const qtyDelta = input.qtyDelta ?? 0;

    const existing = await tx.dailyContentCap.upsert({
      where: {
        characterId_dayBucket_capKey: {
          characterId: input.characterId,
          dayBucket,
          capKey: input.capKey,
        },
      },
      create: {
        characterId: input.characterId,
        capKey: input.capKey,
        source: input.source,
        dayBucket,
        usedCount: 0,
        usedQty: 0,
      },
      update: {},
    });

    const nextCount = existing.usedCount + countDelta;
    const nextQty = existing.usedQty + qtyDelta;

    if (input.limitCount != null && nextCount > input.limitCount) {
      throw new WorldCapError('DAILY_CAP_REACHED', {
        capKey: input.capKey,
        usedCount: existing.usedCount,
        limitCount: input.limitCount,
      });
    }
    if (input.limitQty != null && nextQty > input.limitQty) {
      throw new WorldCapError('DAILY_CAP_REACHED', {
        capKey: input.capKey,
        usedQty: existing.usedQty,
        limitQty: input.limitQty,
      });
    }

    const updated = await tx.dailyContentCap.update({
      where: { id: existing.id },
      data: {
        usedCount: { increment: countDelta },
        usedQty: { increment: qtyDelta },
      },
      select: { usedCount: true, usedQty: true },
    });
    return { usedCount: updated.usedCount, usedQty: updated.usedQty, dayBucket };
  }

  /**
   * Consume weekly cap atomic. Same pattern as `consumeDailyTx` nhưng dùng
   * `weekBucket` ISO 8601 `YYYY-Www`.
   */
  async consumeWeeklyTx(
    tx: Prisma.TransactionClient,
    input: {
      characterId: string;
      capKey: string;
      source: string;
      limitCount?: number | null;
      limitQty?: number | null;
      countDelta?: number;
      qtyDelta?: number;
      now?: Date;
    },
  ): Promise<{ usedCount: number; usedQty: number; weekBucket: string }> {
    const tz = getDailyRewardCapTz();
    const weekBucket = weekBucketFor(input.now ?? new Date(), tz);
    const countDelta = input.countDelta ?? 0;
    const qtyDelta = input.qtyDelta ?? 0;

    const existing = await tx.weeklyContentCap.upsert({
      where: {
        characterId_weekBucket_capKey: {
          characterId: input.characterId,
          weekBucket,
          capKey: input.capKey,
        },
      },
      create: {
        characterId: input.characterId,
        capKey: input.capKey,
        source: input.source,
        weekBucket,
        usedCount: 0,
        usedQty: 0,
      },
      update: {},
    });

    const nextCount = existing.usedCount + countDelta;
    const nextQty = existing.usedQty + qtyDelta;

    if (input.limitCount != null && nextCount > input.limitCount) {
      throw new WorldCapError('WEEKLY_CAP_REACHED', {
        capKey: input.capKey,
        usedCount: existing.usedCount,
        limitCount: input.limitCount,
      });
    }
    if (input.limitQty != null && nextQty > input.limitQty) {
      throw new WorldCapError('WEEKLY_CAP_REACHED', {
        capKey: input.capKey,
        usedQty: existing.usedQty,
        limitQty: input.limitQty,
      });
    }

    const updated = await tx.weeklyContentCap.update({
      where: { id: existing.id },
      data: {
        usedCount: { increment: countDelta },
        usedQty: { increment: qtyDelta },
      },
      select: { usedCount: true, usedQty: true },
    });
    return { usedCount: updated.usedCount, usedQty: updated.usedQty, weekBucket };
  }

  /** Read-only — không mutate. Dùng cho FE preview / cap-remaining hint. */
  async getDailyUsage(
    characterId: string,
    capKey: string,
    now: Date = new Date(),
  ): Promise<{ usedCount: number; usedQty: number; dayBucket: string }> {
    const tz = getDailyRewardCapTz();
    const dayBucket = dayBucketFor(now, tz);
    const row = await this.prisma.dailyContentCap.findUnique({
      where: {
        characterId_dayBucket_capKey: { characterId, dayBucket, capKey },
      },
      select: { usedCount: true, usedQty: true },
    });
    return {
      usedCount: row?.usedCount ?? 0,
      usedQty: row?.usedQty ?? 0,
      dayBucket,
    };
  }

  async getWeeklyUsage(
    characterId: string,
    capKey: string,
    now: Date = new Date(),
  ): Promise<{ usedCount: number; usedQty: number; weekBucket: string }> {
    const tz = getDailyRewardCapTz();
    const weekBucket = weekBucketFor(now, tz);
    const row = await this.prisma.weeklyContentCap.findUnique({
      where: {
        characterId_weekBucket_capKey: { characterId, weekBucket, capKey },
      },
      select: { usedCount: true, usedQty: true },
    });
    return {
      usedCount: row?.usedCount ?? 0,
      usedQty: row?.usedQty ?? 0,
      weekBucket,
    };
  }
}

export class WorldCapError extends Error {
  constructor(
    public readonly code: 'DAILY_CAP_REACHED' | 'WEEKLY_CAP_REACHED',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'WorldCapError';
  }
}
