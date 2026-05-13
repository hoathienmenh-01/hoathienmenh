import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BATTLE_PASS_MISSIONS_V1,
  type BattlePassExpSource,
  type BattlePassMissionDef,
  type BattlePassMissionScope,
  type BattlePassSeasonDef,
  type MonetizationErrorCode,
  getActiveBattlePassSeason,
  getBattlePassLevelForXp,
  getBattlePassMissionsBySource,
  periodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MonetizationFoundationError } from './monetization-shop.service';

/**
 * Ensure `BattlePassSeason` row exists in DB — required for FK constraint
 * on `BattlePassProgress.seasonId` and `BattlePassMissionProgress.seasonId`.
 * Idempotent upsert.
 */
async function ensureSeasonRow(
  prisma: PrismaService,
  season: BattlePassSeasonDef,
): Promise<void> {
  await prisma.battlePassSeason.upsert({
    where: { seasonId: season.seasonId },
    create: {
      seasonId: season.seasonId,
      name: season.nameVi,
      startAt: new Date(season.startAt),
      endAt: new Date(season.endAt),
      active: season.active,
      config: season as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export interface MissionViewItem {
  mission: BattlePassMissionDef;
  scopeBucket: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
}

export interface BattlePassMissionsView {
  seasonId: string;
  daily: MissionViewItem[];
  weekly: MissionViewItem[];
  season: MissionViewItem[];
}

export interface AddMissionExpResult {
  granted: number;
  newXp: number;
  newLevel: number;
  completedMissions: string[];
}

/**
 * Phase 27.1–27.5 — BattlePassV2Service.
 *
 * Quản lý mission counter cho Battle Pass:
 *   - `addProgress(characterId, source, delta)` tăng progress cho mọi
 *     mission có source khớp + scope đang ở period hiện tại; complete
 *     mission → cộng exp vào `BattlePassProgress.xp`, update `level` =
 *     `getBattlePassLevelForXp(xp)`.
 *   - `listMissions(characterId)` trả list mission DAILY/WEEKLY/SEASON
 *     + progress/state.
 *   - `unlockPaidTrack(characterId)` flip `premiumUnlocked = true`. Gọi
 *     bởi shop service khi mua `battle_pass_premium_unlock`.
 *
 * Anti-P2W:
 *   - Mỗi mission complete = 1 row UNIQUE (period bucket khác → 1 row
 *     mới). Không double grant.
 *   - Mission `expReward ≤ BATTLE_PASS_MISSION_EXP_CAP` (catalog test
 *     enforce).
 *   - Premium track chỉ tăng reward type (Tiên Ngọc khóa, vé quét) chứ
 *     không tăng exp gain rate.
 */
@Injectable()
export class BattlePassV2Service {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve scope bucket key cho mission tại thời điểm `now`. DAILY/
   * WEEKLY dùng `periodKey()` chung; SEASON dùng seasonId.
   */
  static computeScopeBucket(
    scope: BattlePassMissionScope,
    season: BattlePassSeasonDef,
    now: Date,
  ): string {
    switch (scope) {
      case 'DAILY':
        return periodKey(now, 'DAILY');
      case 'WEEKLY':
        return periodKey(now, 'WEEKLY');
      case 'SEASON':
        return season.seasonId;
    }
  }

  async listMissions(
    characterId: string,
    now: Date = new Date(),
  ): Promise<BattlePassMissionsView> {
    const season = getActiveBattlePassSeason(now);
    if (!season) throw new MonetizationFoundationError('NO_ACTIVE_SEASON');

    const byScope: Record<BattlePassMissionScope, MissionViewItem[]> = {
      DAILY: [],
      WEEKLY: [],
      SEASON: [],
    };
    for (const mission of BATTLE_PASS_MISSIONS_V1) {
      const scopeBucket = BattlePassV2Service.computeScopeBucket(
        mission.scope,
        season,
        now,
      );
      const row = await this.prisma.battlePassMissionProgress.findUnique({
        where: {
          characterId_seasonId_missionKey_scopeBucket: {
            characterId,
            seasonId: season.seasonId,
            missionKey: mission.key,
            scopeBucket,
          },
        },
      });
      byScope[mission.scope].push({
        mission,
        scopeBucket,
        progress: row?.progress ?? 0,
        target: mission.target,
        completed: row?.completed ?? false,
        claimed: !!row?.claimedAt,
      });
    }
    return {
      seasonId: season.seasonId,
      daily: byScope.DAILY,
      weekly: byScope.WEEKLY,
      season: byScope.SEASON,
    };
  }

  async addProgress(
    characterId: string,
    source: BattlePassExpSource,
    delta: number,
    now: Date = new Date(),
  ): Promise<AddMissionExpResult> {
    if (!Number.isInteger(delta) || delta <= 0) {
      return {
        granted: 0,
        newXp: await this.currentXp(characterId),
        newLevel: await this.currentLevel(characterId),
        completedMissions: [],
      };
    }
    const season = getActiveBattlePassSeason(now);
    if (!season) {
      return {
        granted: 0,
        newXp: await this.currentXp(characterId),
        newLevel: await this.currentLevel(characterId),
        completedMissions: [],
      };
    }
    const missions = getBattlePassMissionsBySource(source);
    if (missions.length === 0) {
      return {
        granted: 0,
        newXp: await this.currentXp(characterId),
        newLevel: await this.currentLevel(characterId),
        completedMissions: [],
      };
    }

    await ensureSeasonRow(this.prisma, season);

    let totalGranted = 0;
    const completed: string[] = [];

    return await this.prisma.$transaction(async (tx) => {
      for (const mission of missions) {
        const scopeBucket = BattlePassV2Service.computeScopeBucket(
          mission.scope,
          season,
          now,
        );
        // Upsert progress row.
        const existing = await tx.battlePassMissionProgress.findUnique({
          where: {
            characterId_seasonId_missionKey_scopeBucket: {
              characterId,
              seasonId: season.seasonId,
              missionKey: mission.key,
              scopeBucket,
            },
          },
        });
        if (existing?.claimedAt) continue; // already claimed exp
        const newProgress = (existing?.progress ?? 0) + delta;
        const isComplete = newProgress >= mission.target;
        if (existing) {
          await tx.battlePassMissionProgress.update({
            where: { id: existing.id },
            data: {
              progress: newProgress,
              completed: isComplete,
              claimedAt: isComplete ? now : null,
            },
          });
        } else {
          await tx.battlePassMissionProgress.create({
            data: {
              characterId,
              seasonId: season.seasonId,
              missionKey: mission.key,
              scopeBucket,
              progress: newProgress,
              target: mission.target,
              completed: isComplete,
              claimedAt: isComplete ? now : null,
            },
          });
        }
        if (isComplete && !(existing?.completed && existing.claimedAt)) {
          totalGranted += mission.expReward;
          completed.push(mission.key);
        }
      }
      if (totalGranted > 0) {
        // Ensure progress row exists then bump xp.
        const progressRow = await tx.battlePassProgress.upsert({
          where: {
            characterId_seasonId: {
              characterId,
              seasonId: season.seasonId,
            },
          },
          create: {
            characterId,
            seasonId: season.seasonId,
            xp: totalGranted,
            level: getBattlePassLevelForXp(totalGranted, season),
          },
          update: {
            xp: { increment: totalGranted },
          },
        });
        // Recompute level after increment (since update.increment is
        // not visible inside this op result on some Prisma versions).
        const fresh = await tx.battlePassProgress.findUnique({
          where: { id: progressRow.id },
        });
        const newLevel = fresh
          ? getBattlePassLevelForXp(fresh.xp, season)
          : progressRow.level;
        if (fresh && fresh.level !== newLevel) {
          await tx.battlePassProgress.update({
            where: { id: progressRow.id },
            data: { level: newLevel },
          });
        }
        return {
          granted: totalGranted,
          newXp: fresh?.xp ?? totalGranted,
          newLevel,
          completedMissions: completed,
        };
      }
      // No exp granted — still report current state.
      const progressRow = await tx.battlePassProgress.findUnique({
        where: {
          characterId_seasonId: {
            characterId,
            seasonId: season.seasonId,
          },
        },
      });
      return {
        granted: 0,
        newXp: progressRow?.xp ?? 0,
        newLevel: progressRow?.level ?? 0,
        completedMissions: completed,
      };
    });
  }

  async unlockPaidTrack(
    characterId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const season = getActiveBattlePassSeason(now);
    if (!season) throw new MonetizationFoundationError('NO_ACTIVE_SEASON');
    await ensureSeasonRow(this.prisma, season);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.battlePassProgress.findUnique({
        where: {
          characterId_seasonId: {
            characterId,
            seasonId: season.seasonId,
          },
        },
      });
      if (existing) {
        if (!existing.premiumUnlocked) {
          await tx.battlePassProgress.update({
            where: { id: existing.id },
            data: { premiumUnlocked: true },
          });
        }
      } else {
        await tx.battlePassProgress.create({
          data: {
            characterId,
            seasonId: season.seasonId,
            premiumUnlocked: true,
          },
        });
      }
    });
  }

  private async currentXp(characterId: string, now: Date = new Date()): Promise<number> {
    const season = getActiveBattlePassSeason(now);
    if (!season) return 0;
    const row = await this.prisma.battlePassProgress.findUnique({
      where: {
        characterId_seasonId: {
          characterId,
          seasonId: season.seasonId,
        },
      },
    });
    return row?.xp ?? 0;
  }

  private async currentLevel(characterId: string, now: Date = new Date()): Promise<number> {
    const season = getActiveBattlePassSeason(now);
    if (!season) return 0;
    const row = await this.prisma.battlePassProgress.findUnique({
      where: {
        characterId_seasonId: {
          characterId,
          seasonId: season.seasonId,
        },
      },
    });
    return row?.level ?? 0;
  }
}

/** Helper for tests / external — re-export error code. */
export type BattlePassV2ErrorCode = MonetizationErrorCode;

/** Cast helper for Prisma transaction param. */
export type _BpTx = Prisma.TransactionClient;
