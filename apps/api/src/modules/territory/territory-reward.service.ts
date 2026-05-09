import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAP_REGIONS,
  isTerritoryPeriodKey,
  territoryOwnerRewardByRegion,
  type RegionKey,
  type TerritoryOwnerRewardDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError } from './territory.service';

/**
 * Phase 14.0.E — Territory Owner Reward mail grant runtime.
 *
 * Server-authoritative invariants:
 *   - Idempotency qua composite UNIQUE
 *     `(periodKey, regionKey, characterId)` ở `TerritoryOwnerRewardGrant`.
 *     Gọi lại cùng `periodKey` không gửi mail trùng (P2002 swallow → row
 *     đã tồn tại tính là `skippedAlreadyGranted`).
 *   - Race-safe: 2 concurrent admin trigger cùng `periodKey` chỉ 1 winner
 *     ghi grant row + tạo mail. Loser P2002 → skip.
 *   - Snapshot rule: nhận thưởng theo member HIỆN TẠI tại thời điểm grant
 *     (`Character.sectId === winnerSectId` lúc query). Nếu member rời
 *     sect sau settlement nhưng trước grant → KHÔNG nhận thưởng. Nếu
 *     member join sau settlement → NHẬN thưởng (catalog đã ghi rõ trong
 *     `BALANCE_MODEL.md` §11.20).
 *   - dryRun: KHÔNG mutate (không insert grant, không tạo mail). Chỉ đếm.
 *
 * Reward source-of-truth: `TERRITORY_OWNER_REWARDS` shared catalog. Reward
 * delivery 100% qua mail (`Mail` table, `recipientId = characterId`)
 * — KHÔNG `CurrencyService.applyTx` trực tiếp ở đây (player phải tự
 * `MAIL_CLAIM` để credit). Audit row vẫn track grant qua
 * `TerritoryOwnerRewardGrant.rewardJson` snapshot.
 *
 * NO cron tự động trong Phase 14.0.E — admin trigger only. Cron handoff
 * Phase 14.0.F.
 */

export interface TerritoryRewardGrantSummary {
  periodKey: string;
  regionsProcessed: number;
  mailsCreated: number;
  skippedAlreadyGranted: number;
  skippedNoWinner: number;
  skippedNoMembers: number;
  dryRun: boolean;
  /** Per-region breakdown, ordered by `sortOrder`. */
  regions: ReadonlyArray<TerritoryRewardGrantRegionSummary>;
}

export interface TerritoryRewardGrantRegionSummary {
  regionKey: RegionKey;
  /** True nếu region không có winner snapshot cho periodKey → skip. */
  skippedNoWinner: boolean;
  /** True nếu winner sect không còn member nào → skip. */
  skippedNoMembers: boolean;
  /** Sect snapshot tại thời điểm grant (null nếu skip). */
  winnerSectId: string | null;
  winnerSectName: string | null;
  /** Số mail tạo NEW trong run này (loại trừ already-granted). */
  mailsCreated: number;
  /** Số grant row tồn tại từ trước (skipped). */
  alreadyGranted: number;
  /** Số member đủ điều kiện thấy ở thời điểm grant. */
  memberCount: number;
}

export interface TerritoryRewardGrantOptions {
  /** ADMIN userId từ AdminGuard — denormalized vào Mail.createdByAdminId. */
  triggeredBy?: string | null;
  /** Nếu true: KHÔNG mutate state (không insert grant, không tạo mail). */
  dryRun?: boolean;
}

const SYSTEM_SENDER_NAME = 'Thiên Đạo Sứ Giả — Lãnh Địa';

@Injectable()
export class TerritoryRewardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grant weekly territory owner reward mail cho mọi region đã settle
   * tại `periodKey`. Idempotent qua UNIQUE `(periodKey, regionKey,
   * characterId)`.
   *
   * Throw `TerritoryError('PERIOD_INVALID')` nếu `periodKey` không match
   * ISO week / manual_* format.
   */
  async grantWeeklyOwnerRewardMail(
    periodKey: string,
    opts: TerritoryRewardGrantOptions = {},
  ): Promise<TerritoryRewardGrantSummary> {
    if (!isTerritoryPeriodKey(periodKey)) {
      throw new TerritoryError('PERIOD_INVALID');
    }
    const dryRun = opts.dryRun === true;
    const triggeredBy = opts.triggeredBy ?? null;

    const regions: TerritoryRewardGrantRegionSummary[] = [];
    let mailsCreated = 0;
    let skippedAlreadyGranted = 0;
    let skippedNoWinner = 0;
    let skippedNoMembers = 0;

    // Iterate sorted region list (deterministic order — important cho
    // test snapshot + admin UI render).
    const sortedRegions = [...MAP_REGIONS].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    for (const region of sortedRegions) {
      const rewardDef = territoryOwnerRewardByRegion(region.key);
      if (!rewardDef) {
        // Catalog parity invariant — defensive: chỉ xảy ra nếu shared
        // catalog miss region (test sẽ catch trước khi merge).
        skippedNoWinner++;
        regions.push({
          regionKey: region.key,
          skippedNoWinner: true,
          skippedNoMembers: false,
          winnerSectId: null,
          winnerSectName: null,
          mailsCreated: 0,
          alreadyGranted: 0,
          memberCount: 0,
        });
        continue;
      }

      const snapshot =
        await this.prisma.sectTerritorySettlementSnapshot.findUnique({
          where: {
            regionKey_periodKey: {
              regionKey: region.key,
              periodKey,
            },
          },
          select: {
            winnerSectId: true,
            winnerSectName: true,
          },
        });
      if (!snapshot || !snapshot.winnerSectId) {
        skippedNoWinner++;
        regions.push({
          regionKey: region.key,
          skippedNoWinner: true,
          skippedNoMembers: false,
          winnerSectId: null,
          winnerSectName: null,
          mailsCreated: 0,
          alreadyGranted: 0,
          memberCount: 0,
        });
        continue;
      }

      const winnerSectId = snapshot.winnerSectId;
      const winnerSectName = snapshot.winnerSectName;

      // Snapshot rule: lấy MEMBER HIỆN TẠI tại thời điểm grant.
      const members = await this.prisma.character.findMany({
        where: { sectId: winnerSectId },
        select: { id: true },
      });
      if (members.length === 0) {
        skippedNoMembers++;
        regions.push({
          regionKey: region.key,
          skippedNoWinner: false,
          skippedNoMembers: true,
          winnerSectId,
          winnerSectName,
          mailsCreated: 0,
          alreadyGranted: 0,
          memberCount: 0,
        });
        continue;
      }

      let regionMailsCreated = 0;
      let regionAlreadyGranted = 0;

      for (const m of members) {
        const granted = await this.grantOneMember({
          periodKey,
          regionKey: region.key,
          sectId: winnerSectId,
          characterId: m.id,
          rewardDef,
          triggeredBy,
          dryRun,
        });
        if (granted === 'created') {
          regionMailsCreated++;
          mailsCreated++;
        } else {
          regionAlreadyGranted++;
          skippedAlreadyGranted++;
        }
      }

      regions.push({
        regionKey: region.key,
        skippedNoWinner: false,
        skippedNoMembers: false,
        winnerSectId,
        winnerSectName,
        mailsCreated: regionMailsCreated,
        alreadyGranted: regionAlreadyGranted,
        memberCount: members.length,
      });
    }

    return {
      periodKey,
      regionsProcessed: sortedRegions.length,
      mailsCreated,
      skippedAlreadyGranted,
      skippedNoWinner,
      skippedNoMembers,
      dryRun,
      regions,
    };
  }

  /**
   * Grant 1 reward (1 character / 1 region / 1 period) — atomic transaction
   * cho insert grant row + Mail row. Trả `created` nếu mới grant, `existed`
   * nếu đã có (idempotent skip).
   *
   * Race-safe: catch P2002 (unique violation `periodKey + regionKey +
   * characterId`) → trả `existed`. Caller không cần wrap.
   *
   * dryRun: SKIP mọi mutation, chỉ check existing row có tồn tại không
   * → trả `existed` nếu có, `created` nếu chưa (không insert thật).
   */
  private async grantOneMember(input: {
    periodKey: string;
    regionKey: RegionKey;
    sectId: string;
    characterId: string;
    rewardDef: TerritoryOwnerRewardDef;
    triggeredBy: string | null;
    dryRun: boolean;
  }): Promise<'created' | 'existed'> {
    const existing = await this.prisma.territoryOwnerRewardGrant.findUnique({
      where: {
        periodKey_regionKey_characterId: {
          periodKey: input.periodKey,
          regionKey: input.regionKey,
          characterId: input.characterId,
        },
      },
      select: { id: true },
    });
    if (existing) return 'existed';
    if (input.dryRun) return 'created';

    const rewardJson: Prisma.InputJsonValue = {
      linhThach: input.rewardDef.linhThach,
      exp: input.rewardDef.exp,
      itemRewards: input.rewardDef.itemRewards.map((it) => ({
        itemKey: it.itemKey,
        qty: it.qty,
      })),
    };
    const itemsJson: Prisma.InputJsonValue = input.rewardDef.itemRewards.map(
      (it) => ({ itemKey: it.itemKey, qty: it.qty }),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT grant row trước — P2002 sẽ rollback toàn bộ tx (mail
        // chưa được tạo). Race winner duy nhất.
        const grant = await tx.territoryOwnerRewardGrant.create({
          data: {
            periodKey: input.periodKey,
            regionKey: input.regionKey,
            sectId: input.sectId,
            characterId: input.characterId,
            mailId: null,
            rewardJson,
          },
          select: { id: true },
        });
        const mail = await tx.mail.create({
          data: {
            recipientId: input.characterId,
            senderName: SYSTEM_SENDER_NAME,
            subject: input.rewardDef.subjectVi,
            body: input.rewardDef.bodyVi,
            rewardLinhThach: BigInt(input.rewardDef.linhThach),
            rewardTienNgoc: 0,
            rewardExp: BigInt(input.rewardDef.exp),
            rewardItems: itemsJson,
            createdByAdminId: input.triggeredBy ?? null,
          },
          select: { id: true },
        });
        await tx.territoryOwnerRewardGrant.update({
          where: { id: grant.id },
          data: { mailId: mail.id },
        });
      });
      return 'created';
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return 'existed';
      }
      throw e;
    }
  }
}
