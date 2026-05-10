import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  SECT_MISSIONS,
  itemByKey,
  sectMissionByKey,
  sectMissionPeriodKey,
  startOfSectWarWeek,
  type SectMissionCadence,
  type SectMissionDef,
  type SectMissionGoalKind,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { startOfLocalDay } from '../combat/combat.service';
import { getMissionResetTz } from '../mission/mission.service';

/**
 * Phase 13.1.B — Sect Mission service (Nhiệm vụ Tông Môn).
 *
 * Server-authoritative invariants:
 *   - Progress derive từ existing audit log (`SectWarContribution` cho 4
 *     activity-based goal kinds, `BreakthroughAttemptLog` cho breakthrough
 *     success). KHÔNG có row `MissionProgress` riêng cho sect mission —
 *     tránh double source of truth, tránh hook drift.
 *   - Claim idempotency qua composite UNIQUE
 *     `(characterId, missionKey, periodKey)`. P2002 ⇒ swallow → throw
 *     `ALREADY_CLAIMED`. Race-safe (2 concurrent POST chỉ 1 thắng).
 *   - Reward grant atomic trong `$transaction`:
 *       1. Insert `SectMissionClaim` row.
 *       2. Update `Character.sectContribBalance` + `sectContribLifetime`
 *          increment.
 *       3. Insert `SectContributionLedger` row reason=`SECT_MISSION_CLAIM`.
 *       4. Optional currency grant qua `CurrencyService.applyTx`.
 *       5. Optional item grant qua `InventoryService.grantTx`.
 *     Bất cứ step nào fail → rollback toàn bộ → balance + ledger consistent.
 *   - Period key match cadence:
 *       - DAILY  → `YYYY-MM-DD` theo `MISSION_RESET_TZ`.
 *       - WEEKLY → `YYYY-Www` ISO week.
 *     Reset đúng nửa đêm ICT cùng mọi mission/dungeon/sect-war daily.
 */

export type SectMissionErrorCode =
  | 'NO_CHARACTER'
  | 'SECT_REQUIRED'
  | 'MISSION_NOT_FOUND'
  | 'MISSION_NOT_READY'
  | 'ALREADY_CLAIMED';

export class SectMissionError extends Error {
  readonly code: SectMissionErrorCode;
  constructor(code: SectMissionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectMissionError';
    this.code = code;
  }
}

export interface SectMissionView {
  key: string;
  cadence: SectMissionCadence;
  goalKind: SectMissionGoalKind;
  target: number;
  currentAmount: number;
  ready: boolean;
  claimed: boolean;
  rewardContribution: number;
  rewardLinhThach?: number;
  rewardItems?: ReadonlyArray<{ itemKey: string; qty: number }>;
  labelI18nKey: string;
  descriptionI18nKey: string;
  rewardHintI18nKey: string;
  periodKey: string;
}

export interface SectMissionListView {
  /** Period key DAILY hiện tại (`YYYY-MM-DD`). */
  dailyPeriodKey: string;
  /** Period key WEEKLY hiện tại (`YYYY-Www`). */
  weeklyPeriodKey: string;
  hasSect: boolean;
  /** Snapshot `Character.sectContribBalance` tại thời điểm query. */
  contributionBalance: number;
  contributionLifetime: number;
  missions: ReadonlyArray<SectMissionView>;
}

export interface SectMissionClaimResult {
  missionKey: string;
  periodKey: string;
  rewardContribution: number;
  rewardLinhThach: number;
  rewardItems: ReadonlyArray<{ itemKey: string; qty: number }>;
  contributionBalance: number;
  contributionLifetime: number;
}

@Injectable()
export class SectMissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly currency?: CurrencyService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

  /**
   * Compute current progress amount for a mission def. Caller phải truyền
   * `tx`/`prisma` client; method dùng read-only query.
   */
  private async computeProgress(
    db: Prisma.TransactionClient | PrismaService,
    characterId: string,
    def: SectMissionDef,
    now: Date,
  ): Promise<number> {
    const tz = getMissionResetTz();
    const since =
      def.cadence === 'DAILY'
        ? startOfLocalDay(now, tz)
        : startOfSectWarWeek(now, tz);

    switch (def.goalKind) {
      case 'dungeon_clear':
        return countSectWarRows(db, characterId, 'dungeon_clear', since);
      case 'boss_participate':
        return countSectWarRows(db, characterId, 'boss_participation', since);
      case 'boss_damage': {
        // Sum points cho boss_top_damage trong window.
        const agg = await db.sectWarContribution.aggregate({
          where: {
            characterId,
            activityKey: 'boss_top_damage',
            createdAt: { gte: since },
          },
          _sum: { points: true },
        });
        return agg._sum.points ?? 0;
      }
      case 'quest_complete':
        return countSectWarRows(db, characterId, 'quest_complete', since);
      case 'breakthrough_success': {
        // Phase 13.1.B: derive từ BreakthroughAttemptLog `success=true` trong
        // window — không hook vào SectWarContribution để tránh double source.
        return db.breakthroughAttemptLog.count({
          where: {
            characterId,
            success: true,
            createdAt: { gte: since },
          },
        });
      }
    }
  }

  /**
   * Build full mission list view với progress + claim status. Default
   * trả về cả 5 mission catalog (DAILY + WEEKLY).
   */
  async list(userId: string, now: Date = new Date()): Promise<SectMissionListView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        sectId: true,
        sectContribBalance: true,
        sectContribLifetime: true,
      },
    });
    if (!char) throw new SectMissionError('NO_CHARACTER');

    const dailyPeriodKey = sectMissionPeriodKey('DAILY', now);
    const weeklyPeriodKey = sectMissionPeriodKey('WEEKLY', now);

    // Query existing claims ngắn gọn — single query với in() cho cả DAILY +
    // WEEKLY period key.
    const claims = await this.prisma.sectMissionClaim.findMany({
      where: {
        characterId: char.id,
        OR: [
          { periodKey: dailyPeriodKey },
          { periodKey: weeklyPeriodKey },
        ],
      },
      select: { missionKey: true, periodKey: true },
    });
    const claimedSet = new Set(
      claims.map((c) => `${c.missionKey}::${c.periodKey}`),
    );

    const missions: SectMissionView[] = [];
    for (const def of SECT_MISSIONS) {
      const periodKey =
        def.cadence === 'DAILY' ? dailyPeriodKey : weeklyPeriodKey;
      const claimed = claimedSet.has(`${def.key}::${periodKey}`);
      // Skip progress compute nếu đã claim (giảm DB load), giữ currentAmount
      // = target để FE hiển thị đầy.
      const currentAmount = claimed
        ? def.target
        : await this.computeProgress(this.prisma, char.id, def, now);
      const ready = !claimed && currentAmount >= def.target;
      missions.push({
        key: def.key,
        cadence: def.cadence,
        goalKind: def.goalKind,
        target: def.target,
        currentAmount,
        ready,
        claimed,
        rewardContribution: def.rewardContribution,
        rewardLinhThach: def.rewardLinhThach,
        rewardItems: def.rewardItems
          ? def.rewardItems.map((i) => ({ itemKey: i.itemKey, qty: i.qty }))
          : undefined,
        labelI18nKey: def.labelI18nKey,
        descriptionI18nKey: def.descriptionI18nKey,
        rewardHintI18nKey: def.rewardHintI18nKey,
        periodKey,
      });
    }

    return {
      dailyPeriodKey,
      weeklyPeriodKey,
      hasSect: !!char.sectId,
      contributionBalance: char.sectContribBalance,
      contributionLifetime: char.sectContribLifetime,
      missions,
    };
  }

  /**
   * Claim reward cho mission. Idempotent qua DB UNIQUE.
   *
   * Throws:
   *   - NO_CHARACTER:    user không có character.
   *   - SECT_REQUIRED:   character không thuộc sect.
   *   - MISSION_NOT_FOUND: missionKey không có trong catalog.
   *   - MISSION_NOT_READY: progress < target.
   *   - ALREADY_CLAIMED: P2002 hoặc claim đã tồn tại.
   */
  async claim(
    userId: string,
    missionKey: string,
    now: Date = new Date(),
  ): Promise<SectMissionClaimResult> {
    const def = sectMissionByKey(missionKey);
    if (!def) throw new SectMissionError('MISSION_NOT_FOUND');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectMissionError('NO_CHARACTER');
    if (!char.sectId) throw new SectMissionError('SECT_REQUIRED');

    const periodKey = sectMissionPeriodKey(def.cadence, now);

    // Cheap pre-check: existing claim row (race-safe via DB UNIQUE bên dưới).
    const existing = await this.prisma.sectMissionClaim.findUnique({
      where: {
        characterId_missionKey_periodKey: {
          characterId: char.id,
          missionKey,
          periodKey,
        },
      },
      select: { id: true },
    });
    if (existing) throw new SectMissionError('ALREADY_CLAIMED');

    const progress = await this.computeProgress(this.prisma, char.id, def, now);
    if (progress < def.target) throw new SectMissionError('MISSION_NOT_READY');

    let balance = 0;
    let lifetime = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT trước — P2002 → rollback toàn bộ tx.
        await tx.sectMissionClaim.create({
          data: {
            characterId: char.id,
            missionKey,
            periodKey,
            rewardContributionGranted: def.rewardContribution,
          },
        });

        if (def.rewardContribution > 0) {
          // Atomic increment balance + lifetime; ledger row.
          const upd = await tx.character.update({
            where: { id: char.id },
            data: {
              sectContribBalance: { increment: def.rewardContribution },
              sectContribLifetime: { increment: def.rewardContribution },
            },
            select: {
              sectContribBalance: true,
              sectContribLifetime: true,
            },
          });
          balance = upd.sectContribBalance;
          lifetime = upd.sectContribLifetime;
          await tx.sectContributionLedger.create({
            data: {
              characterId: char.id,
              delta: def.rewardContribution,
              reason: 'SECT_MISSION_CLAIM',
              refType: 'SectMission',
              refId: missionKey,
              meta: {
                cadence: def.cadence,
                periodKey,
                target: def.target,
                progress,
              },
            },
          });
        } else {
          // Mission có rewardContribution=0 (placeholder) — vẫn cho claim,
          // nhưng skip ledger / balance update.
          const cur = await tx.character.findUniqueOrThrow({
            where: { id: char.id },
            select: {
              sectContribBalance: true,
              sectContribLifetime: true,
            },
          });
          balance = cur.sectContribBalance;
          lifetime = cur.sectContribLifetime;
        }

        if (def.rewardLinhThach && def.rewardLinhThach > 0 && this.currency) {
          await this.currency.applyTx(tx, {
            characterId: char.id,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(def.rewardLinhThach),
            reason: 'MISSION_CLAIM',
            refType: 'SectMission',
            refId: missionKey,
            meta: {
              cadence: def.cadence,
              periodKey,
              source: 'sect_mission',
            },
          });
        }

        if (def.rewardItems && def.rewardItems.length > 0 && this.inventory) {
          // Validate items có trong catalog (defensive — catalog có thể stale).
          const grants = def.rewardItems
            .filter((it) => itemByKey(it.itemKey))
            .map((it) => ({ itemKey: it.itemKey, qty: it.qty }));
          if (grants.length > 0) {
            await this.inventory.grantTx(tx, char.id, grants, {
              reason: 'MISSION_CLAIM',
              refType: 'SectMission',
              refId: missionKey,
              extra: { cadence: def.cadence, periodKey },
            });
          }
        }
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new SectMissionError('ALREADY_CLAIMED');
      }
      throw e;
    }

    return {
      missionKey,
      periodKey,
      rewardContribution: def.rewardContribution,
      rewardLinhThach: def.rewardLinhThach ?? 0,
      rewardItems:
        def.rewardItems?.map((i) => ({ itemKey: i.itemKey, qty: i.qty })) ??
        [],
      contributionBalance: balance,
      contributionLifetime: lifetime,
    };
  }
}


async function countSectWarRows(
  db: Prisma.TransactionClient | PrismaService,
  characterId: string,
  activityKey: string,
  since: Date,
): Promise<number> {
  return db.sectWarContribution.count({
    where: {
      characterId,
      activityKey,
      createdAt: { gte: since },
    },
  });
}
