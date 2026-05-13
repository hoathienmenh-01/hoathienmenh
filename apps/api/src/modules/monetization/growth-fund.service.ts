import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  getAnyGrowthFundVariant,
  type GrowthFundKey,
  type GrowthFundMilestoneDef,
  type MonetizationReward,
} from '@xuantoi/shared';
import { realmByKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { MonetizationFoundationError } from './monetization-shop.service';
import { WalletService } from './wallet.service';

export interface GrowthFundView {
  fundKey: GrowthFundKey;
  purchasedAt: Date;
  milestones: Array<{
    key: string;
    realmKey: string;
    realmOrder: number;
    nameVi: string;
    reward: readonly MonetizationReward[];
    /** Player đã đạt realm chưa. */
    eligible: boolean;
    /** Đã claim row này chưa. */
    claimed: boolean;
  }>;
}

export interface ClaimGrowthFundMilestoneInput {
  characterId: string;
  fundKey: string;
  milestoneKey: string;
  now?: Date;
}

/**
 * Phase 27.0 — Growth fund (Quỹ Trưởng Thành).
 *
 *   - Mua 1 lần / fundKey / character (`UNIQUE(characterId, fundKey)`).
 *   - Reward chia thành milestone theo realm — chỉ unlock khi player đạt
 *     `realmOrder` tương ứng (`Character.realmKey.order ≥ milestone.realmOrder`).
 *   - `claimedMilestonesJson` là string[] of milestoneKey đã claim — atomic
 *     CAS bằng `updateMany WHERE NOT (… @> 'milestoneKey')`. Foundation
 *     phase: dùng simple optimistic read-mod-write trong $transaction
 *     Serializable.
 *
 * Anti-P2W: realm gating (`eligibility`) đảm bảo growth fund không bypass
 * tốc độ tu luyện — phải đạt cảnh giới mới claim.
 */
@Injectable()
export class GrowthFundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
  ) {}

  async getFund(
    characterId: string,
    fundKey: string,
  ): Promise<GrowthFundView | null> {
    const variant = getAnyGrowthFundVariant(fundKey);
    if (!variant) return null;
    const state = await this.prisma.growthFundState.findUnique({
      where: { characterId_fundKey: { characterId, fundKey } },
    });
    if (!state) return null;
    const claimed = new Set<string>(
      (state.claimedMilestonesJson as Prisma.JsonArray | null)?.filter(
        (v): v is string => typeof v === 'string',
      ) ?? [],
    );
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true },
    });
    const currentOrder = character ? realmByKey(character.realmKey)?.order ?? -1 : -1;
    return {
      fundKey: variant.key,
      purchasedAt: state.purchasedAt,
      milestones: variant.milestones.map((m) => ({
        key: m.key,
        realmKey: m.realmKey,
        realmOrder: m.realmOrder,
        nameVi: m.nameVi,
        reward: m.reward,
        eligible: currentOrder >= m.realmOrder,
        claimed: claimed.has(m.key),
      })),
    };
  }

  async claimMilestone(input: ClaimGrowthFundMilestoneInput): Promise<GrowthFundView> {
    const variant = getAnyGrowthFundVariant(input.fundKey);
    if (!variant) {
      throw new MonetizationFoundationError('FUND_NOT_PURCHASED');
    }
    const milestone = variant.milestones.find((m) => m.key === input.milestoneKey);
    if (!milestone) {
      throw new MonetizationFoundationError('INVALID_INPUT');
    }
    const now = input.now ?? new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const state = await tx.growthFundState.findUnique({
          where: {
            characterId_fundKey: {
              characterId: input.characterId,
              fundKey: input.fundKey,
            },
          },
        });
        if (!state) throw new MonetizationFoundationError('FUND_NOT_PURCHASED');

        // Check eligibility
        const character = await tx.character.findUnique({
          where: { id: input.characterId },
          select: { realmKey: true },
        });
        const currentOrder = character ? realmByKey(character.realmKey)?.order ?? -1 : -1;
        if (currentOrder < milestone.realmOrder) {
          throw new MonetizationFoundationError('MILESTONE_LOCKED');
        }

        const claimedArr = (state.claimedMilestonesJson as Prisma.JsonArray | null)?.filter(
          (v): v is string => typeof v === 'string',
        ) ?? [];
        if (claimedArr.includes(milestone.key)) {
          throw new MonetizationFoundationError('MILESTONE_ALREADY_CLAIMED');
        }
        const newClaimed = [...claimedArr, milestone.key];
        const upd = await tx.growthFundState.updateMany({
          where: {
            id: state.id,
            // Optimistic: cùng `purchasedAt` (stable), `updatedAt` chưa thay.
            updatedAt: state.updatedAt,
          },
          data: {
            claimedMilestonesJson: newClaimed as Prisma.InputJsonValue,
          },
        });
        if (upd.count === 0) {
          throw new MonetizationFoundationError('TRANSACTION_CONFLICT');
        }

        await this.grantMilestoneRewardTx(tx, input.characterId, variant.key, milestone, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const view = await this.getFund(input.characterId, variant.key);
    if (!view) throw new MonetizationFoundationError('FUND_NOT_PURCHASED');
    return view;
  }

  private async grantMilestoneRewardTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    fundKey: GrowthFundKey,
    milestone: GrowthFundMilestoneDef,
    now: Date,
  ): Promise<void> {
    void now;
    const refId = `${fundKey}:${milestone.key}`;
    for (const reward of milestone.reward) {
      if (reward.kind === 'currency') {
        const currencyKey = legacyToWallet(reward.key);
        await this.wallet.applyTx(tx, {
          characterId,
          currency: currencyKey,
          delta: reward.qty,
          reason: 'MONETIZATION_GROWTH_FUND_CLAIM',
          refType: 'GrowthFundState',
          refId,
          meta: { fundKey, milestoneKey: milestone.key },
        });
      } else if (reward.kind === 'item') {
        await this.inventory.grantTx(
          tx,
          characterId,
          [{ itemKey: reward.key, qty: reward.qty }],
          {
            reason: 'MONETIZATION_GROWTH_FUND_CLAIM',
            refType: 'GrowthFundState',
            refId,
          },
        );
      }
    }
  }
}

function legacyToWallet(key: string): 'TIEN_NGOC' | 'TIEN_NGOC_KHOA' | 'LINH_THACH' {
  switch (key) {
    case 'TIEN_NGOC':
    case 'tienNgoc':
      return 'TIEN_NGOC';
    case 'TIEN_NGOC_KHOA':
    case 'tienNgocKhoa':
      return 'TIEN_NGOC_KHOA';
    case 'LINH_THACH':
    case 'linhThach':
      return 'LINH_THACH';
    default:
      throw new MonetizationFoundationError(
        'INVALID_CURRENCY',
        `Unknown reward currency: ${key}`,
      );
  }
}
