import { Injectable } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  TRIAL_TOWERS,
  computeFloorFirstClearReward,
  computeFloorPower,
  computeFloorRepeatReward,
  getTrialTowerByKey,
  resolveFloorEnemyType,
  type TrialTowerDef,
  type TrialTowerFloorReward,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';

/**
 * Phase 26.5 — `TrialTowerService`.
 *
 * Server-authoritative trial-tower runner. Floor attempt là synchronous:
 * client request `POST /world/towers/:towerKey/attempt` với `floor` →
 * server compute `floorPower(tower, floor)`, compare với
 * `battlePowerSnapshot` (caller pass từ Character power summary), grant
 * reward nếu `success=true` AND `floor > progress.highestFloorCleared`
 * (first-clear-only). Repeat = 0 reward.
 *
 * Milestone reward (every 50/100/500/1000 floors) chỉ grant 1 lần per
 * `claimedMilestones` array stored trên `TrialTowerProgress`.
 *
 * Ranking: `seasonHighestFloor` reset weekly/season qua admin cron
 * (out-of-scope phase này, ranking service phase sau).
 */
@Injectable()
export class TrialTowerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  /** List tower catalog view + progress per user. */
  async listForCharacter(input: {
    characterId: string;
    playerRealmOrder: number;
  }): Promise<TrialTowerView[]> {
    const progressList = await this.prisma.trialTowerProgress.findMany({
      where: { characterId: input.characterId },
      select: {
        towerKey: true,
        highestFloorCleared: true,
        seasonHighestFloor: true,
        claimedMilestonesJson: true,
      },
    });
    const progressMap = new Map(progressList.map((p) => [p.towerKey, p]));

    return TRIAL_TOWERS.map((t) => {
      const p = progressMap.get(t.key);
      return {
        key: t.key,
        towerType: t.towerType,
        nameVi: t.nameVi,
        nameEn: t.nameEn,
        descriptionVi: t.descriptionVi,
        descriptionEn: t.descriptionEn,
        unlockRealmOrder: t.unlockRealmOrder,
        unlocked: input.playerRealmOrder >= t.unlockRealmOrder,
        infiniteScaling: t.infiniteScaling,
        maxGeneratedFloor: t.maxGeneratedFloor ?? null,
        dailyAttempts: t.dailyAttempts,
        statWeights: t.statWeights,
        highestFloorCleared: p?.highestFloorCleared ?? 0,
        seasonHighestFloor: p?.seasonHighestFloor ?? 0,
        enabled: t.enabled,
      };
    });
  }

  /**
   * Attempt 1 floor. Server-authoritative — caller pass `battlePowerSnapshot`
   * (đã tính từ `Character` stats + entitlement etc.); KHÔNG trust client
   * pass success flag.
   */
  async attemptFloor(input: {
    characterId: string;
    towerKey: string;
    floor: number;
    battlePowerSnapshot: number;
    clearTimeSeconds?: number;
  }): Promise<TrialTowerAttemptResult> {
    const tower = getTrialTowerByKey(input.towerKey);
    if (!tower || !tower.enabled) {
      throw new TrialTowerError('TOWER_NOT_FOUND');
    }
    if (input.floor < 1) {
      throw new TrialTowerError('INVALID_FLOOR');
    }
    if (
      tower.maxGeneratedFloor != null &&
      input.floor > tower.maxGeneratedFloor
    ) {
      throw new TrialTowerError('FLOOR_NOT_GENERATED');
    }

    const requiredPower = computeFloorPower(tower, input.floor);
    const success = input.battlePowerSnapshot >= requiredPower;
    const enemyType = resolveFloorEnemyType(input.floor);

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic upsert progress + enforce daily attempts cap.
      const existing = await tx.trialTowerProgress.upsert({
        where: {
          characterId_towerKey: {
            characterId: input.characterId,
            towerKey: tower.key,
          },
        },
        create: {
          characterId: input.characterId,
          towerKey: tower.key,
          highestFloorCleared: 0,
          seasonHighestFloor: 0,
        },
        update: {},
        select: {
          highestFloorCleared: true,
          seasonHighestFloor: true,
          claimedMilestonesJson: true,
        },
      });

      const isFirstClear =
        success && input.floor > existing.highestFloorCleared;
      let reward: TrialTowerFloorReward = computeFloorRepeatReward();
      let milestoneClaimed = false;
      let claimedMilestones: string[] = parseClaimedMilestones(
        existing.claimedMilestonesJson,
      );

      if (isFirstClear) {
        reward = computeFloorFirstClearReward(tower, input.floor);
        const milestoneKey = milestoneKeyFor(tower, input.floor);
        if (milestoneKey && !claimedMilestones.includes(milestoneKey)) {
          milestoneClaimed = true;
          claimedMilestones = [...claimedMilestones, milestoneKey];
        }

        // Grant reward currency atomic
        if (reward.linhThach > 0) {
          await this.currency.applyTx(tx, {
            characterId: input.characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.linhThach),
            reason: 'TRIAL_TOWER_REWARD',
            refType: 'TrialTowerAttempt',
            refId: `${tower.key}#${input.floor}`,
          });
        }
        if (reward.exp > 0) {
          await tx.character.update({
            where: { id: input.characterId },
            data: { exp: { increment: BigInt(reward.exp) } },
          });
        }

        // Update progress
        const newSeasonHighest = Math.max(
          existing.seasonHighestFloor,
          input.floor,
        );
        await tx.trialTowerProgress.update({
          where: {
            characterId_towerKey: {
              characterId: input.characterId,
              towerKey: tower.key,
            },
          },
          data: {
            highestFloorCleared: input.floor,
            seasonHighestFloor: newSeasonHighest,
            claimedMilestonesJson: claimedMilestones,
            lastAttemptAt: new Date(),
          },
        });
      } else {
        await tx.trialTowerProgress.update({
          where: {
            characterId_towerKey: {
              characterId: input.characterId,
              towerKey: tower.key,
            },
          },
          data: { lastAttemptAt: new Date() },
        });
      }

      // Always log attempt
      await tx.trialTowerAttemptLog.create({
        data: {
          characterId: input.characterId,
          towerKey: tower.key,
          floor: input.floor,
          success,
          battlePowerSnapshot: input.battlePowerSnapshot,
          clearTimeSeconds: input.clearTimeSeconds ?? null,
          rewardJson: isFirstClear ? (reward as object) : {},
        },
      });

      return { isFirstClear, milestoneClaimed, reward, claimedMilestones };
    });

    return {
      towerKey: tower.key,
      floor: input.floor,
      success,
      requiredPower,
      battlePower: input.battlePowerSnapshot,
      enemyType,
      isFirstClear: result.isFirstClear,
      milestoneClaimed: result.milestoneClaimed,
      reward: result.reward,
    };
  }
}

function parseClaimedMilestones(json: unknown): string[] {
  if (Array.isArray(json)) {
    return json.filter((s): s is string => typeof s === 'string');
  }
  return [];
}

function milestoneKeyFor(
  tower: TrialTowerDef,
  floor: number,
): string | null {
  for (const rule of tower.milestoneRules) {
    if (floor % rule.everyFloors === 0) {
      return `every:${rule.everyFloors}:${floor}`;
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Types + Errors
// ───────────────────────────────────────────────────────────────────────────

export interface TrialTowerView {
  key: string;
  towerType: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  unlockRealmOrder: number;
  unlocked: boolean;
  infiniteScaling: boolean;
  maxGeneratedFloor: number | null;
  dailyAttempts: number;
  statWeights: TrialTowerDef['statWeights'];
  highestFloorCleared: number;
  seasonHighestFloor: number;
  enabled: boolean;
}

export interface TrialTowerAttemptResult {
  towerKey: string;
  floor: number;
  success: boolean;
  requiredPower: number;
  battlePower: number;
  enemyType: string;
  isFirstClear: boolean;
  milestoneClaimed: boolean;
  reward: TrialTowerFloorReward;
}

export class TrialTowerError extends Error {
  constructor(
    public readonly code:
      | 'TOWER_NOT_FOUND'
      | 'INVALID_FLOOR'
      | 'FLOOR_NOT_GENERATED',
  ) {
    super(code);
    this.name = 'TrialTowerError';
  }
}
