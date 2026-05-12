import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  SHOP_PACKS,
  canPurchaseShopPack,
  getActiveShopPacks,
  getPurchaseWindowKey,
  getShopPackById,
  validateShopPackReward,
  type ShopPackDef,
  type ShopPackView,
} from '@xuantoi/shared';
import type { MonetizationReward } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';

export class ShopPackError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'PACK_NOT_FOUND'
      | 'PACK_INACTIVE'
      | 'PACK_NOT_STARTED'
      | 'PACK_EXPIRED'
      | 'REALM_TOO_LOW'
      | 'REALM_TOO_HIGH'
      | 'VIP_REQUIRED'
      | 'PURCHASE_LIMIT_REACHED'
      | 'INSUFFICIENT_FUNDS'
      | 'INVALID_REWARD'
      | 'DUPLICATE_PURCHASE'
      | 'INVALID_INPUT',
  ) {
    super(code);
  }
}

export interface ShopPackPurchaseResult {
  purchaseId: string;
  packId: string;
  rewards: readonly MonetizationReward[];
}

@Injectable()
export class ShopPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
  ) {}

  async listPacks(userId: string, now: Date = new Date()): Promise<ShopPackView[]> {
    const character = await this.getCharacter(userId);
    const activePacks = getActiveShopPacks(now);
    const purchases = await this.prisma.shopPackPurchase.findMany({
      where: { characterId: character.id },
      select: { packId: true, purchaseWindowKey: true, quantity: true },
    });

    return activePacks.map((pack) => {
      const windowKey = getPurchaseWindowKey(pack.purchaseLimitWindow, now);
      const bought = purchases
        .filter((p) => p.packId === pack.packId && p.purchaseWindowKey === windowKey)
        .reduce((sum, p) => sum + p.quantity, 0);
      return {
        ...pack,
        remainingPurchases: Math.max(0, pack.purchaseLimit - bought),
      };
    });
  }

  async purchaseHistory(userId: string) {
    const character = await this.getCharacter(userId);
    return this.prisma.shopPackPurchase.findMany({
      where: { characterId: character.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async purchase(
    userId: string,
    input: { packId: string; idempotencyKey?: string },
    now: Date = new Date(),
  ): Promise<ShopPackPurchaseResult> {
    if (!input.packId) throw new ShopPackError('INVALID_INPUT');
    const pack = getShopPackById(input.packId);
    if (!pack) throw new ShopPackError('PACK_NOT_FOUND');

    if (!pack.rewards.every(validateShopPackReward)) {
      throw new ShopPackError('INVALID_REWARD');
    }

    const character = await this.getCharacter(userId);
    const eligibility = canPurchaseShopPack(
      pack,
      character.realmOrder,
      character.vipLevel,
      now,
    );
    if (!eligibility.ok) {
      throw new ShopPackError(
        eligibility.reason as ShopPackError['code'],
      );
    }

    const windowKey = getPurchaseWindowKey(pack.purchaseLimitWindow, now);

    const purchaseId = await this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const dup = await tx.shopPackPurchase.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (dup) {
          if (dup.characterId === character.id && dup.packId === pack.packId) {
            return dup.id;
          }
          throw new ShopPackError('DUPLICATE_PURCHASE');
        }
      }

      // Check purchase limit
      const existing = await tx.shopPackPurchase.findUnique({
        where: {
          characterId_packId_purchaseWindowKey: {
            characterId: character.id,
            packId: pack.packId,
            purchaseWindowKey: windowKey,
          },
        },
      });
      if (existing && existing.quantity >= pack.purchaseLimit) {
        throw new ShopPackError('PURCHASE_LIMIT_REACHED');
      }

      // Deduct currency
      await this.deductCurrencyTx(tx, character.id, pack);

      // Grant rewards
      await this.grantRewardsTx(tx, character.id, pack.rewards, {
        reason: 'SHOP_PACK_REWARD',
        refType: 'ShopPackPurchase',
        refId: `${pack.packId}:${windowKey}`,
        meta: { packId: pack.packId, windowKey },
      });

      // Upsert purchase record
      if (existing) {
        const updated = await tx.shopPackPurchase.updateMany({
          where: {
            id: existing.id,
            quantity: { lt: pack.purchaseLimit },
          },
          data: { quantity: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new ShopPackError('PURCHASE_LIMIT_REACHED');
        }
        return existing.id;
      } else {
        const created = await tx.shopPackPurchase.create({
          data: {
            characterId: character.id,
            packId: pack.packId,
            quantity: 1,
            purchaseWindowKey: windowKey,
            priceCurrency: pack.priceCurrency,
            priceAmount: pack.priceAmount,
            rewardsJson: pack.rewards as unknown as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey ?? undefined,
          },
        });
        return created.id;
      }
    });

    return { purchaseId, packId: pack.packId, rewards: pack.rewards };
  }

  async adminGrantPack(
    actorUserId: string,
    targetUserId: string,
    packId: string,
    now: Date = new Date(),
  ): Promise<ShopPackPurchaseResult> {
    const pack = getShopPackById(packId);
    if (!pack) throw new ShopPackError('PACK_NOT_FOUND');
    const character = await this.getCharacter(targetUserId);
    const windowKey = `ADMIN_GRANT_${now.toISOString()}`;

    await this.prisma.$transaction(async (tx) => {
      await this.grantRewardsTx(tx, character.id, pack.rewards, {
        reason: 'SHOP_PACK_REWARD',
        refType: 'ShopPackPurchase',
        refId: `admin:${pack.packId}:${windowKey}`,
        meta: { packId: pack.packId, adminGrant: true },
        actorUserId,
      });
      await tx.shopPackPurchase.create({
        data: {
          characterId: character.id,
          packId: pack.packId,
          quantity: 1,
          purchaseWindowKey: windowKey,
          priceCurrency: 'admin_grant',
          priceAmount: 0,
          rewardsJson: pack.rewards as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'admin.shop_pack.grant',
          meta: { targetUserId, characterId: character.id, packId },
        },
      });
    });

    return { purchaseId: 'admin_grant', packId, rewards: pack.rewards };
  }

  private async getCharacter(userId: string) {
    const character = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        realmKey: true,
        tienNgoc: true,
        tienNgocKhoa: true,
        vipProfile: { select: { vipLevel: true } },
      },
    });
    if (!character) throw new ShopPackError('NO_CHARACTER');
    const { REALMS } = await import('@xuantoi/shared');
    const realm = REALMS.find((r) => r.key === character.realmKey);
    return {
      id: character.id,
      realmOrder: realm?.order ?? 0,
      tienNgoc: character.tienNgoc,
      tienNgocKhoa: character.tienNgocKhoa,
      vipLevel: character.vipProfile?.vipLevel ?? 0,
    };
  }

  private async deductCurrencyTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    pack: ShopPackDef,
  ) {
    if (pack.priceCurrency === 'tienNgoc') {
      const upd = await tx.character.updateMany({
        where: { id: characterId, tienNgoc: { gte: pack.priceAmount } },
        data: { tienNgoc: { decrement: pack.priceAmount } },
      });
      if (upd.count === 0) throw new ShopPackError('INSUFFICIENT_FUNDS');
      await tx.currencyLedger.create({
        data: {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(-pack.priceAmount),
          reason: 'SHOP_PACK_PURCHASE',
          refType: 'ShopPackPurchase',
          refId: pack.packId,
          meta: { packId: pack.packId, priceCurrency: pack.priceCurrency },
        },
      });
    } else {
      const upd = await tx.character.updateMany({
        where: { id: characterId, tienNgocKhoa: { gte: pack.priceAmount } },
        data: { tienNgocKhoa: { decrement: pack.priceAmount } },
      });
      if (upd.count === 0) throw new ShopPackError('INSUFFICIENT_FUNDS');
      await tx.currencyLedger.create({
        data: {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(-pack.priceAmount),
          reason: 'SHOP_PACK_PURCHASE',
          refType: 'ShopPackPurchase',
          refId: pack.packId,
          meta: { packId: pack.packId, priceCurrency: pack.priceCurrency, locked: true },
        },
      });
    }
  }

  private async grantRewardsTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    rewards: readonly MonetizationReward[],
    meta: {
      reason: 'SHOP_PACK_REWARD';
      refType: string;
      refId: string;
      meta: Record<string, unknown>;
      actorUserId?: string;
    },
  ) {
    const items: { itemKey: string; qty: number }[] = [];
    for (const reward of rewards) {
      if (reward.kind === 'currency') {
        if (reward.key === 'linhThach') {
          await this.currency.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.qty),
            reason: meta.reason as 'SHOP_PACK_REWARD',
            refType: meta.refType,
            refId: meta.refId,
            meta: meta.meta,
            actorUserId: meta.actorUserId,
          });
        }
        if (reward.key === 'tienNgocKhoa') {
          await tx.character.update({
            where: { id: characterId },
            data: { tienNgocKhoa: { increment: reward.qty } },
          });
          await tx.currencyLedger.create({
            data: {
              characterId,
              currency: CurrencyKind.TIEN_NGOC,
              delta: BigInt(reward.qty),
              reason: meta.reason,
              refType: meta.refType,
              refId: meta.refId,
              meta: { ...meta.meta, locked: true },
              actorUserId: meta.actorUserId,
            },
          });
        }
      }
      if (reward.kind === 'item') {
        items.push({ itemKey: reward.key, qty: reward.qty });
      }
    }
    if (items.length > 0) {
      await this.inventory.grantTx(tx, characterId, items, {
        reason: meta.reason,
        refType: meta.refType,
        refId: meta.refId,
      });
    }
  }
}
