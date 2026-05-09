import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TERRITORY_DECAY_DEFAULT_BPS,
  computeTerritoryDecay,
  isTerritoryPeriodKey,
  isValidTerritoryDecayBps,
  previousTerritoryPeriodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError } from './territory.service';

/**
 * Phase 14.0.C — Territory Influence Decay runtime service.
 *
 * Server-authoritative invariants:
 *   - {@link decay}: ADMIN-only entry point (qua `AdminTerritoryController`).
 *     Reduce influence points cho mọi row trong DB theo `decayBps` rate.
 *   - Idempotency qua UNIQUE `periodKey` ở `SectTerritoryDecayLog`. Gọi lại
 *     cùng `periodKey` → trả `skipped: true` (no-op).
 *   - Race-safe: P2002 swallow. 2 admin click cùng lúc → 1 thắng (apply
 *     decay), 1 skip (xem log).
 *   - No negative points: `computeTerritoryDecay()` floor ở 0.
 *   - decayBps validate qua `isValidTerritoryDecayBps()` — admin endpoint
 *     phải reject trước khi gọi service nhưng helper an toàn fallback.
 *
 * Strategy:
 *   - SQL UPDATE batch: `points = GREATEST(0, FLOOR(points * (10000 - bps) / 10000))`.
 *     Áp dụng cho mọi row cùng formula → deterministic, tương đương loop
 *     `computeTerritoryDecay()` per row.
 *   - 1 transaction: aggregate trước/sau + insert log + update rows. Nếu fail
 *     giữa chừng → rollback, log không ghi → admin retry an toàn.
 *
 * Phase 14.0.C KHÔNG xử lý:
 *   - Cron auto decay (defer 14.0.D — cần distributed lock).
 *   - Per-region decay rate (uniform decayBps cho mọi region).
 *   - Decay rollback (DELETE log không revert điểm — caller cleanup manual).
 */

export interface TerritoryDecayResult {
  /** Period key đã decay (ISO week format hoặc `manual_xxx`). */
  readonly periodKey: string;
  /** Decay rate basis points (1..5000). */
  readonly decayBps: number;
  /** True nếu period đã decay trước đó (idempotency hit, no-op). */
  readonly skipped: boolean;
  /** Tổng số influence row bị scale điểm (0 nếu skipped). */
  readonly rowsAffected: number;
  /** Tổng điểm trước decay (0 nếu skipped). */
  readonly pointsBefore: number;
  /** Tổng điểm sau decay (0 nếu skipped). */
  readonly pointsAfter: number;
  /** Tổng delta = pointsBefore - pointsAfter (≥ 0). */
  readonly delta: number;
  /** ISO timestamp khi log row insert. */
  readonly triggeredAt: string;
}

@Injectable()
export class TerritoryDecayService {
  private readonly logger = new Logger(TerritoryDecayService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply decay cho mọi influence row. Idempotent per `periodKey`.
   *
   * Throws:
   *   - `TerritoryError('PERIOD_INVALID')` nếu `periodKey` format invalid.
   *   - `TerritoryError('DECAY_BPS_INVALID')` nếu `decayBps` out of range.
   *
   * Side-effects (chỉ khi !skipped):
   *   - UPDATE `SectTerritoryInfluence.points` cho mọi row có `points > 0`.
   *   - INSERT `SectTerritoryDecayLog` row với UNIQUE `periodKey`.
   */
  async decay(opts: {
    periodKey?: string | null;
    decayBps?: number | null;
    triggeredBy?: string | null;
  }): Promise<TerritoryDecayResult> {
    const periodKey =
      opts.periodKey && opts.periodKey.length > 0
        ? opts.periodKey
        : previousTerritoryPeriodKey();
    if (!isTerritoryPeriodKey(periodKey)) {
      throw new TerritoryError('PERIOD_INVALID');
    }
    const bps =
      opts.decayBps !== null && opts.decayBps !== undefined
        ? opts.decayBps
        : TERRITORY_DECAY_DEFAULT_BPS;
    if (!isValidTerritoryDecayBps(bps)) {
      throw new TerritoryError('DECAY_BPS_INVALID');
    }

    // Pre-check log: idempotency fast-path. Race-safe vì insert sau cũng
    // có UNIQUE constraint catch P2002.
    const existing = await this.prisma.sectTerritoryDecayLog.findUnique({
      where: { periodKey },
    });
    if (existing) {
      return {
        periodKey,
        decayBps: existing.decayBps,
        skipped: true,
        rowsAffected: existing.rowsAffected,
        pointsBefore: existing.pointsBefore,
        pointsAfter: existing.pointsAfter,
        delta: existing.pointsBefore - existing.pointsAfter,
        triggeredAt: existing.triggeredAt.toISOString(),
      };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Aggregate before — chỉ row có points > 0.
        const aggBefore = await tx.sectTerritoryInfluence.aggregate({
          where: { points: { gt: 0 } },
          _sum: { points: true },
          _count: { _all: true },
        });
        const pointsBefore = aggBefore._sum.points ?? 0;
        const rowsAffected = aggBefore._count._all;

        if (pointsBefore === 0 || rowsAffected === 0) {
          // No-op: không có điểm để decay. Vẫn ghi log để idempotency.
          const log = await tx.sectTerritoryDecayLog.create({
            data: {
              periodKey,
              decayBps: bps,
              rowsAffected: 0,
              pointsBefore: 0,
              pointsAfter: 0,
              triggeredBy: opts.triggeredBy ?? null,
            },
          });
          return {
            periodKey,
            decayBps: bps,
            skipped: false,
            rowsAffected: 0,
            pointsBefore: 0,
            pointsAfter: 0,
            delta: 0,
            triggeredAt: log.triggeredAt.toISOString(),
          };
        }

        // SQL UPDATE batch — formula match `computeTerritoryDecay`:
        // `floor(points * (10000 - bps) / 10000)`, floor at 0.
        const numerator = 10000 - bps;
        await tx.$executeRaw`
          UPDATE "SectTerritoryInfluence"
          SET "points" = GREATEST(0, FLOOR("points" * ${numerator}::int / 10000.0)::int)
          WHERE "points" > 0
        `;

        // Aggregate after — re-query để có pointsAfter chính xác.
        const aggAfter = await tx.sectTerritoryInfluence.aggregate({
          _sum: { points: true },
        });
        const pointsAfter = aggAfter._sum.points ?? 0;

        // Sanity: pointsAfter <= pointsBefore và >= 0. Defensive check
        // log warn nếu sai (tránh corrupt data).
        if (pointsAfter > pointsBefore || pointsAfter < 0) {
          this.logger.warn(
            `decay: anomalous totals — pointsBefore=${pointsBefore} pointsAfter=${pointsAfter} bps=${bps}`,
          );
        }

        const log = await tx.sectTerritoryDecayLog.create({
          data: {
            periodKey,
            decayBps: bps,
            rowsAffected,
            pointsBefore,
            pointsAfter,
            triggeredBy: opts.triggeredBy ?? null,
          },
        });

        return {
          periodKey,
          decayBps: bps,
          skipped: false,
          rowsAffected,
          pointsBefore,
          pointsAfter,
          delta: pointsBefore - pointsAfter,
          triggeredAt: log.triggeredAt.toISOString(),
        };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Race: 2 admin trigger cùng `periodKey`. Re-fetch log để trả
        // skipped result.
        const log = await this.prisma.sectTerritoryDecayLog.findUnique({
          where: { periodKey },
        });
        if (log) {
          return {
            periodKey,
            decayBps: log.decayBps,
            skipped: true,
            rowsAffected: log.rowsAffected,
            pointsBefore: log.pointsBefore,
            pointsAfter: log.pointsAfter,
            delta: log.pointsBefore - log.pointsAfter,
            triggeredAt: log.triggeredAt.toISOString(),
          };
        }
        // Log mất giữa chừng (extremely rare) → re-throw P2002.
      }
      throw e;
    }
  }

  /**
   * Read recent decay log entries — admin có thể view "history" decay.
   * Mặc định 20 row mới nhất.
   */
  async getDecayHistory(limit = 20): Promise<
    Array<{
      periodKey: string;
      decayBps: number;
      rowsAffected: number;
      pointsBefore: number;
      pointsAfter: number;
      triggeredBy: string | null;
      triggeredAt: string;
    }>
  > {
    const rows = await this.prisma.sectTerritoryDecayLog.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: Math.max(1, Math.min(100, Math.floor(limit))),
    });
    return rows.map((r) => ({
      periodKey: r.periodKey,
      decayBps: r.decayBps,
      rowsAffected: r.rowsAffected,
      pointsBefore: r.pointsBefore,
      pointsAfter: r.pointsAfter,
      triggeredBy: r.triggeredBy,
      triggeredAt: r.triggeredAt.toISOString(),
    }));
  }

  /**
   * Helper for tests / future re-use. Compute decay deterministic per row.
   * Wraps shared `computeTerritoryDecay()` for type safety + clamping.
   */
  computeRowDecay(points: number, decayBps: number): number {
    return computeTerritoryDecay(points, decayBps).pointsAfter;
  }
}
