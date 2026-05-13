import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIMITED_SHOP_ITEMS,
  LIMITED_SHOP_KEYS,
  LIMITED_SHOP_PERIOD_BY_KEY,
  type LimitedShopItemDef,
  type LimitedShopKey,
  periodKey,
  type MonetizationErrorCode,
  type WalletCurrencyKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { MonetizationFoundationError } from './monetization-shop.service';
import { WalletService } from './wallet.service';

export interface LimitedShopItemListing {
  item: LimitedShopItemDef;
  periodKey: string;
  purchasedInPeriod: number;
  remaining: number;
  soldOut: boolean;
}

export interface LimitedShopListing {
  shopKey: LimitedShopKey;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  periodKey: string;
  items: LimitedShopItemListing[];
}

export interface LimitedShopPurchaseResult {
  shopKey: LimitedShopKey;
  itemKey: string;
  periodKey: string;
  quantity: number;
  totalInPeriod: number;
  limit: number;
}

/**
 * Phase 27.1–27.5 — LimitedShopService.
 *
 * Shop rotating ngày/tuần/tháng. Mỗi item có:
 *   - `purchaseLimitCount`: số lần tối đa mua trong 1 period.
 *   - `priceCurrency` + `priceAmount`: debit qua WalletService (ledger
 *     `MONETIZATION_LIMITED_SHOP_BUY`).
 *   - `reward`: list `MonetizationReward` grant (item / currency).
 *
 * Server-authoritative:
 *   1. Resolve item từ catalog (`getLimitedShopItem`).
 *   2. Tính `periodKey(now, period)` — UTC bucket.
 *   3. $transaction Serializable:
 *      a. Count `LimitedShopPurchase.quantity` trong period.
 *      b. Guard `< purchaseLimitCount`.
 *      c. Debit currency.
 *      d. Grant reward.
 *      e. Upsert ledger row (cộng `quantity`).
 *   4. Trả về snapshot.
 *
 * Anti-P2W:
 *   - `purchaseLimitCount` hard-cap monthly ≤ 5 (catalog test enforce).
 *   - Reward không cho endgame item (`validateMonetizationSystemsReward`
 *     catalog test enforce).
 *   - Không reset cap khi tăng VIP / monthly card.
 */
@Injectable()
export class LimitedShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly inventory: InventoryService,
  ) {}

  async listShops(
    characterId: string,
    now: Date = new Date(),
  ): Promise<LimitedShopListing[]> {
    const out: LimitedShopListing[] = [];
    for (const shopKey of LIMITED_SHOP_KEYS) {
      const period = LIMITED_SHOP_PERIOD_BY_KEY[shopKey];
      const pk = periodKey(now, period);
      const items = LIMITED_SHOP_ITEMS.filter((it) => it.shopKey === shopKey && it.enabled);
      const listings: LimitedShopItemListing[] = [];
      for (const item of items) {
        const row = await this.prisma.limitedShopPurchase.findUnique({
          where: {
            characterId_shopKey_itemKey_periodKey: {
              characterId,
              shopKey: item.shopKey,
              itemKey: item.itemKey,
              periodKey: pk,
            },
          },
        });
        const purchased = row?.quantity ?? 0;
        const remaining = Math.max(item.purchaseLimitCount - purchased, 0);
        listings.push({
          item,
          periodKey: pk,
          purchasedInPeriod: purchased,
          remaining,
          soldOut: remaining === 0,
        });
      }
      out.push({
        shopKey,
        period,
        periodKey: pk,
        items: listings,
      });
    }
    return out;
  }

  async purchase(
    characterId: string,
    shopKey: LimitedShopKey,
    itemKey: string,
    now: Date = new Date(),
  ): Promise<LimitedShopPurchaseResult> {
    const item = LIMITED_SHOP_ITEMS.find(
      (i) => i.shopKey === shopKey && i.itemKey === itemKey,
    );
    if (!item) throw new MonetizationFoundationError('PRODUCT_NOT_FOUND');
    if (!item.enabled) throw new MonetizationFoundationError('PRODUCT_DISABLED');

    const period = LIMITED_SHOP_PERIOD_BY_KEY[shopKey];
    const pk = periodKey(now, period);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.limitedShopPurchase.findUnique({
            where: {
              characterId_shopKey_itemKey_periodKey: {
                characterId,
                shopKey,
                itemKey,
                periodKey: pk,
              },
            },
          });
          const currentQty = existing?.quantity ?? 0;
          if (currentQty + 1 > item.purchaseLimitCount) {
            throw new MonetizationFoundationError('PURCHASE_LIMIT_REACHED');
          }
          try {
            await this.wallet.applyTx(tx, {
              characterId,
              currency: item.priceCurrency as WalletCurrencyKey,
              delta: -item.priceAmount,
              reason: 'MONETIZATION_LIMITED_SHOP_BUY',
              refType: 'LimitedShopPurchase',
              refId: `${shopKey}:${itemKey}:${pk}`,
              meta: { shopKey, itemKey, periodKey: pk },
            });
          } catch (err) {
            if (
              err instanceof Error &&
              (err.message === 'INSUFFICIENT_FUNDS' || err.message === 'NOT_FOUND')
            ) {
              throw new MonetizationFoundationError('INSUFFICIENT_CURRENCY');
            }
            throw err;
          }

          // Grant reward
          for (const reward of item.reward) {
            if (reward.kind === 'currency') {
              const currencyKey = reward.key as WalletCurrencyKey;
              await this.wallet.applyTx(tx, {
                characterId,
                currency: currencyKey,
                delta: reward.qty,
                reason: 'MONETIZATION_LIMITED_SHOP_BUY',
                refType: 'LimitedShopPurchase',
                refId: `${shopKey}:${itemKey}:${pk}`,
                meta: { reward: true, shopKey, itemKey },
              });
            } else if (reward.kind === 'item') {
              await this.inventory.grantTx(
                tx,
                characterId,
                [{ itemKey: reward.key, qty: reward.qty }],
                {
                  reason: 'MONETIZATION_LIMITED_SHOP_BUY',
                  refType: 'LimitedShopPurchase',
                  refId: `${shopKey}:${itemKey}:${pk}`,
                  extra: { shopKey, itemKey } as Prisma.InputJsonValue,
                },
              );
            }
          }

          // Upsert ledger row
          if (existing) {
            await tx.limitedShopPurchase.update({
              where: { id: existing.id },
              data: {
                quantity: currentQty + 1,
                priceCurrency: item.priceCurrency,
                priceAmount: item.priceAmount,
                rewardJson: item.reward as unknown as Prisma.InputJsonValue,
              },
            });
          } else {
            await tx.limitedShopPurchase.create({
              data: {
                characterId,
                shopKey,
                itemKey,
                periodKey: pk,
                quantity: 1,
                priceCurrency: item.priceCurrency,
                priceAmount: item.priceAmount,
                rewardJson: item.reward as unknown as Prisma.InputJsonValue,
              },
            });
          }

          return {
            shopKey,
            itemKey,
            periodKey: pk,
            quantity: 1,
            totalInPeriod: currentQty + 1,
            limit: item.purchaseLimitCount,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (isSerializationFailure(err)) {
        throw new MonetizationFoundationError('TRANSACTION_CONFLICT');
      }
      throw err;
    }
  }
}

export type LimitedShopErrorCode = MonetizationErrorCode;

function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034' || err.message.includes('40001');
  }
  return false;
}
