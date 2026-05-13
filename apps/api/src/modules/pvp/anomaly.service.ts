/**
 * Phase 29.0 — PvP Anomaly service.
 *
 * Anti-cheat detection layer. 8 anomaly type (spec PHẦN 15):
 *   1. PVP_POWER_JUMP_BEFORE_MATCH (power tăng đột biến trước trận).
 *   2. PVP_DAMAGE_OUTLIER (damage roll lệch xa median).
 *   3. ARENA_RATING_GAIN_OUTLIER (rating tăng quá nhanh trong 24h).
 *   4. ARENA_TARGET_FARMING (cùng cặp attacker-defender lặp lại bất thường).
 *   5. SECT_WAR_SCORE_OUTLIER (1 player ghi quá nhiều score).
 *   6. TERRITORY_PRODUCTION_DUPLICATE_CLAIM (claim 2 lần cùng window).
 *   7. SEASON_REWARD_DOUBLE_CLAIM (claim season reward 2 lần).
 *   8. ROSTER_SWAP_EXPLOIT (đổi roster sau lock deadline).
 *
 * Severity weight & blockRewardClaim derive từ shared
 * `classifyPvpAnomaly`. Admin queue review qua
 * `/admin/pvp/anomalies?status=PENDING`.
 */
import { Injectable } from '@nestjs/common';
import {
  classifyPvpAnomaly,
  type PvpAnomalyType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export interface RecordAnomalyInput {
  anomalyType: PvpAnomalyType;
  characterId?: string | null;
  sectId?: string | null;
  relatedBattleId?: string | null;
  detail: unknown;
}

@Injectable()
export class PvpAnomalyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record 1 anomaly row. severity & blockedReward derive từ
   * `classifyPvpAnomaly`. Caller (battle.service / arena.service)
   * gọi mỗi khi detect signal.
   */
  async record(input: RecordAnomalyInput) {
    const cls = classifyPvpAnomaly(input.anomalyType);
    return await this.prisma.pvpAnomalyLog.create({
      data: {
        anomalyType: input.anomalyType,
        severity: cls.severity,
        characterId: input.characterId ?? null,
        sectId: input.sectId ?? null,
        relatedBattleId: input.relatedBattleId ?? null,
        detailJson: input.detail as object,
        blockedReward: cls.blockRewardClaim,
      },
    });
  }

  /**
   * Admin list — filter theo status (PENDING / RESOLVED / ALL) & type.
   * Pagination cursor-based qua `createdAt`.
   */
  async list(options: {
    status?: 'PENDING' | 'RESOLVED' | 'ALL';
    type?: PvpAnomalyType;
    limit?: number;
  }) {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const where: {
      resolution?: { equals: null } | { not: null };
      anomalyType?: PvpAnomalyType;
    } = {};
    if (options.status === 'PENDING') where.resolution = { equals: null };
    if (options.status === 'RESOLVED') where.resolution = { not: null };
    if (options.type) where.anomalyType = options.type;
    return await this.prisma.pvpAnomalyLog.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Admin resolve — đánh dấu DISMISSED / CONFIRMED / ESCALATED + reason.
   */
  async resolve(
    anomalyId: string,
    resolvedBy: string,
    resolution: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED',
    reason: string,
  ) {
    return await this.prisma.pvpAnomalyLog.update({
      where: { id: anomalyId },
      data: {
        resolvedBy,
        resolution,
        resolveReason: reason,
        resolvedAt: new Date(),
      },
    });
  }
}
