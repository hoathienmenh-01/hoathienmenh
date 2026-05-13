import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type MonetizationErrorCode,
  type MonetizationReward,
  type ShopProductDef,
  SHOP_PRODUCTS,
  getMonthlyCardVariant,
  getShopProduct,
  periodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { EntitlementService } from './entitlement.service';
import { WalletService } from './wallet.service';
import { getActiveBattlePassSeason } from '@xuantoi/shared';

export class MonetizationFoundationError extends Error {
  constructor(public code: MonetizationErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface ShopListing {
  product: ShopProductDef;
  /** Số lần đã mua trong period hiện tại. */
  purchasedInPeriod: number;
  /** Còn mua được mấy lần (0 nếu hết hạn / hết limit). */
  remaining: number;
  /** Đã hết limit hay chưa. */
  soldOut: boolean;
}

export interface ShopPurchaseResult {
  product: ShopProductDef;
  reward: readonly MonetizationReward[];
  purchaseId: string;
  /** Wallet snapshot sau khi purchase. */
  walletDelta: { currency: string; delta: number };
}

/**
 * Phase 27.0 — Shop service. Server-authoritative purchase flow:
 *   1. Resolve product trong catalog (`SHOP_PRODUCTS`).
 *   2. Tính `periodKey` (DAILY/WEEKLY/MONTHLY/LIFETIME) từ `now`.
 *   3. Trong $transaction Serializable:
 *      a. Count purchases trong period → guard `< purchaseLimitCount`.
 *      b. Debit currency qua `WalletService.applyTx` (atomic CAS, fail
 *         → `INSUFFICIENT_CURRENCY`).
 *      c. Grant reward (currency increment + entitlement grant).
 *      d. Insert `MonetizationShopPurchase` row.
 *   4. Trả về snapshot.
 *
 * Idempotency: 2 click parallel sẽ race ở (3a) — vì period count đọc
 * trước update, ít nhất 1 sẽ thấy đủ purchase limit. Đảm bảo bằng
 * `$transaction(isolationLevel: Serializable)` — Postgres sẽ rollback
 * 1 trong 2 với `40001 serialization_failure` → ta trả về
 * `TRANSACTION_CONFLICT`. UI retry safely.
 */
@Injectable()
export class MonetizationShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly entitlements: EntitlementService,
    private readonly inventory: InventoryService,
  ) {}

  async listProducts(
    characterId: string,
    now: Date = new Date(),
  ): Promise<ShopListing[]> {
    const listings: ShopListing[] = [];
    for (const product of SHOP_PRODUCTS) {
      if (!product.enabled) continue;
      const pk = periodKey(now, product.purchaseLimitType);
      const purchasedInPeriod = await this.prisma.monetizationShopPurchase.count({
        where: { characterId, productKey: product.key, periodKey: pk },
      });
      const limit = product.purchaseLimitCount;
      const remaining =
        product.purchaseLimitType === 'NONE'
          ? Number.MAX_SAFE_INTEGER
          : Math.max(limit - purchasedInPeriod, 0);
      listings.push({
        product,
        purchasedInPeriod,
        remaining,
        soldOut: remaining === 0,
      });
    }
    return listings;
  }

  async purchase(
    characterId: string,
    productKey: string,
    now: Date = new Date(),
  ): Promise<ShopPurchaseResult> {
    const product = getShopProduct(productKey);
    if (!product) {
      throw new MonetizationFoundationError('PRODUCT_NOT_FOUND');
    }
    if (!product.enabled) {
      throw new MonetizationFoundationError('PRODUCT_DISABLED');
    }
    const pk = periodKey(now, product.purchaseLimitType);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // 1. Guard purchase limit
          if (product.purchaseLimitType !== 'NONE') {
            const count = await tx.monetizationShopPurchase.count({
              where: { characterId, productKey: product.key, periodKey: pk },
            });
            if (count >= product.purchaseLimitCount) {
              throw new MonetizationFoundationError('PURCHASE_LIMIT_REACHED');
            }
          }

          // 2. Debit currency. WalletService throws on INSUFFICIENT_FUNDS;
          //    convert to MONETIZATION_FOUNDATION INSUFFICIENT_CURRENCY.
          try {
            await this.wallet.applyTx(tx, {
              characterId,
              currency: product.priceCurrency,
              delta: -product.priceAmount,
              reason: 'MONETIZATION_SHOP_BUY',
              refType: 'MonetizationShopPurchase',
              refId: product.key,
              meta: { productKey: product.key, productType: product.productType },
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

          // 3. Grant rewards
          await this.grantRewardTx(tx, characterId, product, now);

          // 4. Insert log row
          const purchase = await tx.monetizationShopPurchase.create({
            data: {
              characterId,
              productKey: product.key,
              productType: product.productType,
              priceCurrency: walletKindForLog(product.priceCurrency),
              priceAmount: product.priceAmount,
              rewardJson: product.reward as unknown as Prisma.InputJsonValue,
              status: 'COMPLETED',
              periodKey: pk,
            },
          });

          return {
            product,
            reward: product.reward,
            purchaseId: purchase.id,
            walletDelta: {
              currency: product.priceCurrency,
              delta: -product.priceAmount,
            },
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

  private async grantRewardTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    product: ShopProductDef,
    now: Date,
  ): Promise<void> {
    const source = `SHOP:${product.key}`;

    // 1. Reward = currency / item
    for (const reward of product.reward) {
      if (reward.kind === 'currency') {
        const currencyKey = mapLegacyRewardCurrency(reward.key);
        await this.wallet.applyTx(tx, {
          characterId,
          currency: currencyKey,
          delta: reward.qty,
          reason: 'MONETIZATION_SHOP_BUY',
          refType: 'MonetizationShopPurchase',
          refId: product.key,
          meta: { reward: true, productKey: product.key },
        });
      } else if (reward.kind === 'item') {
        await this.inventory.grantTx(
          tx,
          characterId,
          [{ itemKey: reward.key, qty: reward.qty }],
          {
            reason: 'MONETIZATION_SHOP_BUY',
            refType: 'MonetizationShopPurchase',
            refId: product.key,
            extra: { productKey: product.key } as Prisma.InputJsonValue,
          },
        );
      }
      // Cosmetic kind: foundation phase chưa wire (Cosmetic system riêng).
    }

    // 2. Entitlement grant (shop product trực tiếp grant)
    if (product.entitlement) {
      await this.entitlements.grantEntitlementTx(tx, {
        characterId,
        key: product.entitlement.key,
        value: product.entitlement.value,
        durationDays: product.entitlementDurationDays,
        source,
        now,
      });
    }

    // 3. Monthly card variant — grant entitlements từ variant catalog
    if (product.productType === 'MONTHLY_CARD' && product.monthlyCardKey) {
      const variant = getMonthlyCardVariant(product.monthlyCardKey);
      if (!variant) {
        throw new MonetizationFoundationError('PRODUCT_NOT_FOUND');
      }
      const activeUntil = new Date(now.getTime() + variant.durationDays * 86_400_000);
      const subscription = await tx.monthlyCardSubscription.upsert({
        where: {
          characterId_cardKey: { characterId, cardKey: variant.key },
        },
        create: {
          characterId,
          cardKey: variant.key,
          activeUntil,
        },
        update: {
          activeUntil: new Date(
            Math.max(activeUntil.getTime(), now.getTime() + variant.durationDays * 86_400_000),
          ),
        },
      });
      // Grant entitlements
      for (const grant of variant.entitlements) {
        await this.entitlements.grantEntitlementTx(tx, {
          characterId,
          key: grant.key,
          value: grant.value,
          durationDays: variant.durationDays,
          source: `MONTHLY_CARD:${variant.key}`,
          now,
        });
      }
      // Grant upfront reward
      for (const reward of variant.upfrontReward) {
        if (reward.kind === 'currency') {
          await this.wallet.applyTx(tx, {
            characterId,
            currency: mapLegacyRewardCurrency(reward.key),
            delta: reward.qty,
            reason: 'MONETIZATION_MONTHLY_CARD_BUY',
            refType: 'MonthlyCardSubscription',
            refId: `${subscription.id}:upfront`,
            meta: { cardKey: variant.key },
          });
        } else if (reward.kind === 'item') {
          await this.inventory.grantTx(
            tx,
            characterId,
            [{ itemKey: reward.key, qty: reward.qty }],
            {
              reason: 'MONETIZATION_MONTHLY_CARD_BUY',
              refType: 'MonthlyCardSubscription',
              refId: `${subscription.id}:upfront`,
            },
          );
        }
      }
    }

    // 4. Growth fund — register state (idempotent — 1 row per fund)
    if (product.productType === 'GROWTH_FUND' && product.growthFundKey) {
      const existing = await tx.growthFundState.findUnique({
        where: {
          characterId_fundKey: { characterId, fundKey: product.growthFundKey },
        },
      });
      if (existing) {
        throw new MonetizationFoundationError('FUND_ALREADY_PURCHASED');
      }
      await tx.growthFundState.create({
        data: {
          characterId,
          fundKey: product.growthFundKey,
          purchasedAt: now,
          claimedMilestonesJson: [] as Prisma.InputJsonValue,
        },
      });
    }

    // 5. Battle pass premium unlock — flip `premiumUnlocked = true` on
    // current season `BattlePassProgress`. (Phase 27.1–27.5 — wire real
    // unlock; foundation phase chỉ là marker.)
    if (product.productType === 'BATTLE_PASS_PREMIUM') {
      const season = getActiveBattlePassSeason(now);
      if (!season) throw new MonetizationFoundationError('NO_ACTIVE_SEASON');
      const existing = await tx.battlePassProgress.findUnique({
        where: {
          characterId_seasonId: { characterId, seasonId: season.seasonId },
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
    }
  }
}

/**
 * Phase 27.0 — Legacy reward.key (vd `linhThach`, `tienNgocKhoa`, hoặc
 * `TIEN_NGOC_KHOA`) → `WalletCurrencyKey`. Catalog mới dùng SCREAMING_CASE;
 * giữ legacy lower-camel để không phá `monetization.ts` cũ.
 */
function mapLegacyRewardCurrency(key: string): 'TIEN_NGOC' | 'TIEN_NGOC_KHOA' | 'LINH_THACH' {
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
        `Unknown reward currency key: ${key}`,
      );
  }
}

function walletKindForLog(key: 'TIEN_NGOC' | 'TIEN_NGOC_KHOA' | 'LINH_THACH' | string) {
  switch (key) {
    case 'TIEN_NGOC':
      return 'TIEN_NGOC' as const;
    case 'TIEN_NGOC_KHOA':
      return 'TIEN_NGOC_KHOA' as const;
    case 'LINH_THACH':
      return 'LINH_THACH' as const;
    case 'CONG_HIEN_TONG_MON':
      return 'CONG_HIEN_TONG_MON' as const;
    case 'TRIAL_POINT':
      return 'TRIAL_POINT' as const;
    case 'EVENT_TOKEN':
      return 'EVENT_TOKEN' as const;
    default:
      throw new MonetizationFoundationError(
        'INVALID_CURRENCY',
        `Unknown price currency: ${key}`,
      );
  }
}

function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034' || err.message.includes('40001');
  }
  return false;
}
