import { Inject, Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  itemByKey,
  npcShopByKey,
  npcShopEntries,
  toShopEntryView,
  type ShopEntryView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  InMemorySlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';
import { startOfLocalDay } from '../combat/combat.service';

export class ShopError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'ITEM_NOT_IN_SHOP'
      | 'INVALID_QTY'
      | 'NON_STACKABLE_QTY_GT_1'
      | 'INSUFFICIENT_FUNDS'
      | 'SHOP_DAILY_LIMIT'
      | 'RATE_LIMITED',
  ) {
    super(code);
  }
}

/**
 * M10 — Per-user buy rate limit. 30 request / 60s. Đủ cho người chơi
 * thật click mua nhanh, nhưng chặn script abuse hoặc race exploit
 * concurrent bypass `dailyLimit` qua nhiều req cùng lúc.
 */
export const SHOP_BUY_RATE_LIMIT_WINDOW_MS = 60_000;
export const SHOP_BUY_RATE_LIMIT_MAX = 30;
export const SHOP_BUY_RATE_LIMITER = Symbol('SHOP_BUY_RATE_LIMITER');

/**
 * M10 — Đọc env `MISSION_RESET_TZ` để xác định TZ cho daily window.
 * Mirror `combat.service.getCombatResetTz` / `dungeon-run.service.
 * getDungeonRunResetTz`. Mặc định Asia/Ho_Chi_Minh để các loại "daily"
 * trong game (mission / daily-login / dungeon dailyLimit / shop
 * dailyLimit) reset cùng mốc → đỡ confuse player.
 */
function getShopResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

@Injectable()
export class ShopService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    @Optional() @Inject(SHOP_BUY_RATE_LIMITER) limiter?: RateLimiter,
  ) {
    this.limiter =
      limiter ??
      new InMemorySlidingWindowRateLimiter(
        SHOP_BUY_RATE_LIMIT_WINDOW_MS,
        SHOP_BUY_RATE_LIMIT_MAX,
      );
  }

  /** Trả danh sách entries của NPC shop (đã merge ItemDef + price hiệu dụng). */
  list(): ShopEntryView[] {
    return npcShopEntries().map(toShopEntryView);
  }

  /**
   * Mua item từ NPC shop. Atomic trong 1 transaction:
   * 1. Spend currency (CurrencyService.applyTx với LedgerReason='SHOP_BUY').
   * 2. Grant qty vào inventory (InventoryService.grantTx).
   *
   * M10 layered protection (anti-abuse economy):
   * - **Per-user rate limit** (`SHOP_BUY_RATE_LIMIT_MAX` = 30 req / 60s) —
   *   chặn spam script. Limit theo `userId` (không phải IP) để 1 acc share
   *   IP với người khác không bị liên đới.
   * - **Per-item daily cap** (`ShopEntryDef.dailyLimit`, opt-in) — count
   *   `sum(qtyDelta)` của ItemLedger reason='SHOP_BUY' trong cửa sổ DAILY
   *   local tz (`MISSION_RESET_TZ`). Pre-check `current + qty > dailyLimit`
   *   → throw `SHOP_DAILY_LIMIT`. Race window có thể slip 1-2 req nhưng
   *   rate limit chặn 30/min nên overshoot vẫn bounded.
   *
   * Validate:
   * - itemKey phải có trong NPC_SHOP catalog (anti-spoof — không cho mua boss item).
   * - qty là integer >= 1, <= 99.
   * - Item non-stackable thì qty phải = 1 (mỗi cái 1 row riêng → muốn nhiều thì
   *   gọi nhiều lần; tránh user mua 99 cái stuck slot).
   */
  async buy(
    userId: string,
    itemKey: string,
    qty: number,
  ): Promise<{ characterId: string; itemKey: string; qty: number; totalPrice: number; currency: CurrencyKind }> {
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new ShopError('INVALID_QTY');
    }
    const shopEntry = npcShopByKey(itemKey);
    if (!shopEntry) throw new ShopError('ITEM_NOT_IN_SHOP');
    const def = itemByKey(itemKey);
    if (!def) throw new ShopError('ITEM_NOT_IN_SHOP');
    if (!def.stackable && qty > 1) {
      throw new ShopError('NON_STACKABLE_QTY_GT_1');
    }

    // Rate limit theo userId (chạy trước DB lookup để giảm tải khi bị spam).
    const rl = await this.limiter.check(userId);
    if (!rl.allowed) throw new ShopError('RATE_LIMITED');

    const character = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!character) throw new ShopError('NO_CHARACTER');

    // Daily limit pre-check. Count = sum(qtyDelta>0 ledger SHOP_BUY hôm nay).
    // Refund (qty âm) không xảy ra ở shop nhưng dùng `gt: 0` để defensive.
    const limit = shopEntry.entry.dailyLimit;
    if (typeof limit === 'number' && limit > 0) {
      const dayStart = startOfLocalDay(new Date(), getShopResetTz());
      const agg = await this.prisma.itemLedger.aggregate({
        where: {
          characterId: character.id,
          itemKey,
          reason: 'SHOP_BUY',
          qtyDelta: { gt: 0 },
          createdAt: { gte: dayStart },
        },
        _sum: { qtyDelta: true },
      });
      const todayQty = agg._sum.qtyDelta ?? 0;
      if (todayQty + qty > limit) {
        throw new ShopError('SHOP_DAILY_LIMIT');
      }
    }

    const totalPrice = shopEntry.price * qty;
    const currencyKind: CurrencyKind =
      shopEntry.entry.currency === 'TIEN_NGOC'
        ? CurrencyKind.TIEN_NGOC
        : CurrencyKind.LINH_THACH;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.currency.applyTx(tx, {
          characterId: character.id,
          currency: currencyKind,
          delta: -BigInt(totalPrice),
          reason: 'SHOP_BUY',
          refType: 'NPC_SHOP',
          refId: itemKey,
          meta: { itemKey, qty, unitPrice: shopEntry.price },
          actorUserId: userId,
        });
        await this.inventory.grantTx(tx, character.id, [{ itemKey, qty }], {
          reason: 'SHOP_BUY',
          refType: 'NPC_SHOP',
          refId: itemKey,
          actorUserId: userId,
          extra: { unitPrice: shopEntry.price },
        });
      });
    } catch (e) {
      if (
        e instanceof Error &&
        (e as { code?: string }).code === 'INSUFFICIENT_FUNDS'
      ) {
        throw new ShopError('INSUFFICIENT_FUNDS');
      }
      throw e;
    }

    // Client sẽ tự gọi /character/state lại sau response để refresh balance.
    // Không cần WS push riêng cho mỗi giao dịch shop (giảm noise).

    return {
      characterId: character.id,
      itemKey,
      qty,
      totalPrice,
      currency: currencyKind,
    };
  }

  /** Helper internal cho test/admin: ép Prisma error về InputJsonValue khi cần. */
  static metaToJson(meta: Record<string, unknown>): Prisma.InputJsonValue {
    return meta as Prisma.InputJsonValue;
  }
}
