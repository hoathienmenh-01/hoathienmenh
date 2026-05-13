import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventShop,
  validateEventShopItem,
  defaultEventBalancePolicy,
  type EventShopDef,
  type EventShopItemDef,
  type EventRewardContext,
  type RewardJsonEntry,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventShopService.
 *
 * - CRUD shop & shop item.
 * - Purchase logic: token balance check + daily/weekly/event limit check.
 * - Idempotent purchase (trace via createdAt + characterId + shopItemKey).
 */
@Injectable()
export class EventShopService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Shop CRUD
  // -------------------------------------------------------------------------

  async listShops(eventKey: string): Promise<EventShopDef[]> {
    const rows = await this.prisma.eventShopDef.findMany({
      where: { eventKey },
      orderBy: [{ enabled: 'desc' }, { startsAt: 'asc' }],
    });
    return rows.map((r) => this.toSharedShop(r));
  }

  async listShopItems(shopKey: string): Promise<EventShopItemDef[]> {
    const rows = await this.prisma.eventShopItemDef.findMany({
      where: { shopKey },
      orderBy: [{ enabled: 'desc' }, { priceTokenAmount: 'asc' }],
    });
    return rows.map((r) => this.toSharedItem(r));
  }

  async upsertShop(
    input: EventShopDef,
    _adminUserId: string,
  ): Promise<EventShopDef> {
    const v = validateEventShop(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_SHOP_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const evt = await this.prisma.eventDef.findUnique({
      where: { key: input.eventKey },
    });
    if (!evt) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.eventShopDef.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey,
        name: input.name,
        tokenCurrencyKey: input.tokenCurrencyKey,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        enabled: input.enabled,
      },
      update: {
        eventKey: input.eventKey,
        name: input.name,
        tokenCurrencyKey: input.tokenCurrencyKey,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        enabled: input.enabled,
      },
    });
    return this.toSharedShop(row);
  }

  async upsertShopItem(
    input: EventShopItemDef,
    ctx: EventRewardContext,
    _adminUserId: string,
  ): Promise<EventShopItemDef> {
    const v = validateEventShopItem(input, ctx);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_SHOP_ITEM_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const shop = await this.prisma.eventShopDef.findUnique({
      where: { key: input.shopKey },
    });
    if (!shop) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_SHOP_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.eventShopItemDef.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        shopKey: input.shopKey,
        itemKey: input.itemKey,
        rewardsJson: input.rewardJson as unknown as object,
        priceTokenAmount: input.priceTokenAmount,
        requiredBracketKey: input.requiredBracketKey ?? null,
        minRealmOrder: input.minRealmOrder ?? null,
        maxRealmOrder: input.maxRealmOrder ?? null,
        purchaseLimitDaily: input.purchaseLimitDaily ?? null,
        purchaseLimitWeekly: input.purchaseLimitWeekly ?? null,
        purchaseLimitEvent: input.purchaseLimitEvent ?? null,
        enabled: input.enabled,
      },
      update: {
        shopKey: input.shopKey,
        itemKey: input.itemKey,
        rewardsJson: input.rewardJson as unknown as object,
        priceTokenAmount: input.priceTokenAmount,
        requiredBracketKey: input.requiredBracketKey ?? null,
        minRealmOrder: input.minRealmOrder ?? null,
        maxRealmOrder: input.maxRealmOrder ?? null,
        purchaseLimitDaily: input.purchaseLimitDaily ?? null,
        purchaseLimitWeekly: input.purchaseLimitWeekly ?? null,
        purchaseLimitEvent: input.purchaseLimitEvent ?? null,
        enabled: input.enabled,
      },
    });
    return this.toSharedItem(row);
  }

  // -------------------------------------------------------------------------
  // Purchase (player runtime)
  // -------------------------------------------------------------------------

  /**
   * Mua 1 shop item. Trừ token wallet + ghi purchase row + check limit.
   *
   * KHÔNG grant reward thực (PR2 wire qua RewardService); chỉ trả
   * `rewardJson` để controller forward, đảm bảo audit consistency.
   */
  async purchase(input: {
    shopItemKey: string;
    characterId: string;
    qty?: number;
    playerRealmOrder: number;
    bracketKey: string | null;
    now?: Date;
  }): Promise<{
    purchaseId: string;
    pricePaid: number;
    rewardJson: readonly RewardJsonEntry[];
  }> {
    const now = input.now ?? new Date();
    const qty = Math.max(1, Math.floor(input.qty ?? 1));
    const item = await this.prisma.eventShopItemDef.findUnique({
      where: { key: input.shopItemKey },
      include: { shop: true },
    });
    if (!item || !item.enabled) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_ITEM_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const shop = item.shop;
    if (!shop.enabled) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_DISABLED' } },
        HttpStatus.CONFLICT,
      );
    }
    if (now < shop.startsAt || now > shop.endsAt) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_WINDOW_CLOSED' } },
        HttpStatus.CONFLICT,
      );
    }
    if (
      item.requiredBracketKey &&
      input.bracketKey !== item.requiredBracketKey
    ) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_BRACKET_MISMATCH' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      item.minRealmOrder !== null &&
      input.playerRealmOrder < item.minRealmOrder
    ) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_REALM_BELOW_MIN' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      item.maxRealmOrder !== null &&
      input.playerRealmOrder > item.maxRealmOrder
    ) {
      throw new HttpException(
        { ok: false, error: { code: 'SHOP_REALM_ABOVE_MAX' } },
        HttpStatus.FORBIDDEN,
      );
    }
    const { resetDay, resetWeek } = this.computeResetIds(
      now,
      shop.eventKey,
    );

    // Check limits.
    if (item.purchaseLimitDaily !== null) {
      const used = await this.prisma.eventShopPurchase.count({
        where: {
          shopItemKey: input.shopItemKey,
          characterId: input.characterId,
          resetDay,
        },
      });
      if (used + qty > item.purchaseLimitDaily) {
        throw new HttpException(
          { ok: false, error: { code: 'SHOP_LIMIT_DAILY' } },
          HttpStatus.CONFLICT,
        );
      }
    }
    if (item.purchaseLimitWeekly !== null) {
      const used = await this.prisma.eventShopPurchase.count({
        where: {
          shopItemKey: input.shopItemKey,
          characterId: input.characterId,
          resetWeek,
        },
      });
      if (used + qty > item.purchaseLimitWeekly) {
        throw new HttpException(
          { ok: false, error: { code: 'SHOP_LIMIT_WEEKLY' } },
          HttpStatus.CONFLICT,
        );
      }
    }
    if (item.purchaseLimitEvent !== null) {
      const used = await this.prisma.eventShopPurchase.count({
        where: {
          shopItemKey: input.shopItemKey,
          characterId: input.characterId,
        },
      });
      if (used + qty > item.purchaseLimitEvent) {
        throw new HttpException(
          { ok: false, error: { code: 'SHOP_LIMIT_EVENT' } },
          HttpStatus.CONFLICT,
        );
      }
    }

    // Check + spend token wallet.
    const pricePaid = item.priceTokenAmount * qty;
    const wallet = await this.prisma.eventTokenWallet.findUnique({
      where: {
        eventKey_characterId_tokenKey: {
          eventKey: shop.eventKey,
          characterId: input.characterId,
          tokenKey: shop.tokenCurrencyKey,
        },
      },
    });
    if (!wallet || wallet.balance < pricePaid) {
      throw new HttpException(
        { ok: false, error: { code: 'TOKEN_BALANCE_INSUFFICIENT' } },
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.eventTokenWallet.update({
      where: { id: wallet.id },
      data: { balance: wallet.balance - pricePaid },
    });
    const purchase = await this.prisma.eventShopPurchase.create({
      data: {
        eventKey: shop.eventKey,
        shopItemKey: input.shopItemKey,
        characterId: input.characterId,
        qty,
        pricePaid,
        resetDay,
        resetWeek,
      },
    });
    return {
      purchaseId: purchase.id,
      pricePaid,
      rewardJson: (item.rewardsJson as unknown as RewardJsonEntry[]) ?? [],
    };
  }

  /** Compute resetDay/resetWeek IDs cho purchase (UTC). */
  computeResetIds(now: Date, eventKey: string) {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const d = new Date(Date.UTC(yyyy, now.getUTCMonth(), now.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return {
      resetDay: `${eventKey}__D${yyyy}${mm}${dd}`,
      resetWeek: `${eventKey}__W${d.getUTCFullYear()}${String(weekNo).padStart(
        2,
        '0',
      )}`,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private toSharedShop(row: {
    key: string;
    eventKey: string;
    name: string;
    tokenCurrencyKey: string;
    startsAt: Date;
    endsAt: Date;
    enabled: boolean;
  }): EventShopDef {
    return {
      key: row.key,
      eventKey: row.eventKey,
      name: row.name,
      tokenCurrencyKey: row.tokenCurrencyKey,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      enabled: row.enabled,
    };
  }

  private toSharedItem(row: {
    key: string;
    shopKey: string;
    itemKey: string;
    rewardsJson: unknown;
    priceTokenAmount: number;
    requiredBracketKey: string | null;
    minRealmOrder: number | null;
    maxRealmOrder: number | null;
    purchaseLimitDaily: number | null;
    purchaseLimitWeekly: number | null;
    purchaseLimitEvent: number | null;
    enabled: boolean;
  }): EventShopItemDef {
    return {
      key: row.key,
      shopKey: row.shopKey,
      itemKey: row.itemKey,
      rewardJson:
        (row.rewardsJson as unknown as RewardJsonEntry[] | null) ?? [],
      priceTokenAmount: row.priceTokenAmount,
      requiredBracketKey: row.requiredBracketKey,
      minRealmOrder: row.minRealmOrder,
      maxRealmOrder: row.maxRealmOrder,
      purchaseLimitDaily: row.purchaseLimitDaily,
      purchaseLimitWeekly: row.purchaseLimitWeekly,
      purchaseLimitEvent: row.purchaseLimitEvent,
      enabled: row.enabled,
    };
  }
}

export { defaultEventBalancePolicy };
