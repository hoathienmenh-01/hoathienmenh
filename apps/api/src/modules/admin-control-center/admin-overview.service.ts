import { Injectable } from '@nestjs/common';
import type { AdminOverviewSnapshot } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.6 — Admin Control Center V2 Overview aggregator.
 *
 * Tổng hợp dashboard read-only từ các bảng đã có (Phase 18.x admin
 * foundation, Phase 27.0 monetization, Phase 26.5 farm/dungeon/boss).
 * KHÔNG tạo bảng mới — dùng `count` + `aggregate` Prisma.
 *
 * "Today" = UTC day bucket (consistent với Phase 21.3 `MonetizationDayBucket`).
 * Sai ±1 giờ cho admin xem nhanh — chấp nhận được. Spec Phase 27.6 §4
 * cho phép timezone UTC default.
 */
@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(): Promise<AdminOverviewSnapshot> {
    const now = new Date();
    const startOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );

    const [
      totalUsers,
      newUsersToday,
      activeUsersToday,
      activeCharacters,
      farmSessionsToday,
      bossKillsToday,
      towerAttemptsToday,
      pendingTopupsCount,
      monthlyCardActiveCount,
      activeFeatureFlags,
      activeEvents,
      activeMaintenance,
      scheduledMaintenance,
      battlePassActiveSeason,
      suspiciousEventsCount,
      mintedAgg,
      spentAgg,
      rareDropsToday,
      dungeonRunsToday,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { createdAt: { gte: startOfDayUtc } },
      }),
      this.prisma.user.count({
        where: { lastLoginAt: { gte: startOfDayUtc } },
      }),
      this.prisma.character.count(),
      this.prisma.farmSession.count({
        where: { createdAt: { gte: startOfDayUtc } },
      }),
      this.prisma.adminAuditLog
        .count({
          where: {
            action: { in: ['BOSS_KILL', 'WORLD_BOSS_KILL', 'admin.boss.spawn'] },
            createdAt: { gte: startOfDayUtc },
          },
        })
        .catch(() => 0),
      this.prisma.trialTowerAttemptLog.count({
        where: { createdAt: { gte: startOfDayUtc } },
      }),
      this.prisma.topupOrder.count({ where: { status: 'PENDING' } }),
      this.prisma.monthlyCardSubscription.count({
        where: { activeUntil: { gt: now } },
      }),
      this.prisma.featureFlag.count({ where: { enabled: true } }),
      this.prisma.liveOpsScheduledEvent
        .count({
          where: {
            startsAt: { lte: now },
            endsAt: { gt: now },
            status: 'ACTIVE',
          },
        })
        .catch(() => 0),
      this.prisma.maintenanceWindow
        .count({ where: { status: 'ACTIVE' } })
        .catch(() => 0),
      this.prisma.maintenanceWindow
        .count({ where: { status: 'SCHEDULED' } })
        .catch(() => 0),
      this.prisma.battlePassSeason
        .findFirst({
          where: { active: true },
          select: { seasonId: true },
        })
        .catch(() => null),
      this.prisma.adminAuditLog
        .count({
          where: {
            action: {
              in: [
                'ECONOMY_ANOMALY',
                'GAMEPLAY_ANOMALY',
                'ANTI_CHEAT_DETECTED',
                'MARKET_ABUSE_DETECTED',
              ],
            },
            createdAt: { gte: startOfDayUtc },
          },
        })
        .catch(() => 0),
      this.prisma.currencyLedger
        .aggregate({
          _sum: { delta: true },
          where: {
            currency: 'LINH_THACH',
            delta: { gt: 0 },
            createdAt: { gte: startOfDayUtc },
          },
        })
        .catch(() => ({ _sum: { delta: BigInt(0) } as { delta: bigint | null } })),
      this.prisma.currencyLedger
        .aggregate({
          _sum: { delta: true },
          where: {
            currency: 'LINH_THACH',
            delta: { lt: 0 },
            createdAt: { gte: startOfDayUtc },
          },
        })
        .catch(() => ({ _sum: { delta: BigInt(0) } as { delta: bigint | null } })),
      this.prisma.itemLedger
        .count({
          where: {
            createdAt: { gte: startOfDayUtc },
            // Best-effort match — rare drops thường có reason chứa RARE/WORLD_BOSS.
            // Để tránh dependency cứng vào enum reason, dùng startsWith trên text reason.
            reason: { contains: 'RARE' },
          },
        })
        .catch(() => 0),
      this.prisma.farmSession
        .count({
          where: {
            createdAt: { gte: startOfDayUtc },
            // Dungeon runs gắn farm session với mapKey bắt đầu `dungeon_`.
            // (Best-effort heuristic; chính xác sẽ improve trong PR sau khi có
            // bảng DungeonRun riêng.)
            farmMapKey: { startsWith: 'dungeon_' },
          },
        })
        .catch(() => 0),
    ]);

    const mintedTotal =
      mintedAgg._sum.delta !== null && mintedAgg._sum.delta !== undefined
        ? BigInt(mintedAgg._sum.delta as unknown as bigint).toString()
        : '0';
    const spentTotal =
      spentAgg._sum.delta !== null && spentAgg._sum.delta !== undefined
        ? BigInt(-(spentAgg._sum.delta as unknown as bigint)).toString()
        : '0';

    const maintenanceStatus: AdminOverviewSnapshot['maintenanceStatus'] =
      activeMaintenance > 0
        ? 'ACTIVE'
        : scheduledMaintenance > 0
          ? 'SCHEDULED'
          : 'NONE';

    return {
      totalUsers,
      activeUsersToday,
      activeCharacters,
      newUsersToday,
      currencyMintedTodayLinhThach: mintedTotal,
      currencySpentTodayLinhThach: spentTotal,
      rareDropsToday,
      farmSessionsToday,
      dungeonRunsToday,
      bossKillsToday,
      towerAttemptsToday,
      battlePassActiveSeason: battlePassActiveSeason?.seasonId ?? null,
      monthlyCardActiveCount,
      suspiciousEventsCount,
      pendingTopupsCount,
      activeFeatureFlags,
      activeEvents,
      maintenanceStatus,
      generatedAt: now.toISOString(),
    };
  }
}
