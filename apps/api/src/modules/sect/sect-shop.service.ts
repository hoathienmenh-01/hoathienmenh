import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_SHOP_ENTRIES,
  itemByKey,
  sectMissionPeriodKey,
  sectShopEntryByKey,
  type SectShopEntryDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  InMemorySlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';

/**
 * Phase 13.1.B — Sect Shop service.
 *
 * Server-authoritative invariants:
 *   - `Character.sectId` required (non-sect-member reject early).
 *   - Cost server-side; client gửi `entryKey + qty` only.
 *   - Atomic spend qua `tx.character.updateMany` với guard
 *     `sectContribBalance >= cost*qty` → race-safe (mirror `currency
 *     .applyTx` non-negative pattern).
 *   - daily/weekly limit qua sum `SectShopPurchase.qty` trong window.
 *   - Insert `SectShopPurchase` audit row + `SectContributionLedger` row
 *     reason=`SECT_SHOP_BUY` + `InventoryService.grantTx` cùng tx.
 *   - Bất cứ step fail → rollback toàn bộ (currency-spend pattern).
 *   - Per-user rate limit (30 req / 60s) chống spam script.
 */

export type SectShopErrorCode =
  | 'NO_CHARACTER'
  | 'SECT_REQUIRED'
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_QTY'
  | 'NON_STACKABLE_QTY_GT_1'
  | 'INSUFFICIENT_CONTRIBUTION'
  | 'DAILY_LIMIT'
  | 'WEEKLY_LIMIT'
  | 'SECT_LEVEL_REQUIRED'
  | 'RATE_LIMITED';

export class SectShopError extends Error {
  readonly code: SectShopErrorCode;
  constructor(code: SectShopErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectShopError';
    this.code = code;
  }
}

export const SECT_SHOP_BUY_RATE_LIMIT_WINDOW_MS = 60_000;
export const SECT_SHOP_BUY_RATE_LIMIT_MAX = 30;
export const SECT_SHOP_BUY_RATE_LIMITER = Symbol('SECT_SHOP_BUY_RATE_LIMITER');

export interface SectShopEntryView {
  key: string;
  itemKey: string;
  itemNameI18nKey: string | null;
  contributionCost: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  /** Qty đã mua trong DAILY window hiện tại (server-authoritative). */
  boughtToday: number;
  /** Qty đã mua trong WEEKLY window hiện tại. */
  boughtThisWeek: number;
  requiredSectLevel?: number;
  labelI18nKey: string;
  descriptionI18nKey: string;
}

export interface SectShopListView {
  hasSect: boolean;
  contributionBalance: number;
  contributionLifetime: number;
  dailyPeriodKey: string;
  weeklyPeriodKey: string;
  entries: ReadonlyArray<SectShopEntryView>;
}

export interface SectShopBuyResult {
  entryKey: string;
  itemKey: string;
  qty: number;
  totalCost: number;
  contributionBalance: number;
  contributionLifetime: number;
}

@Injectable()
export class SectShopService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @Optional() @Inject(SECT_SHOP_BUY_RATE_LIMITER) limiter?: RateLimiter,
  ) {
    this.limiter =
      limiter ??
      new InMemorySlidingWindowRateLimiter(
        SECT_SHOP_BUY_RATE_LIMIT_WINDOW_MS,
        SECT_SHOP_BUY_RATE_LIMIT_MAX,
      );
  }

  async list(userId: string, now: Date = new Date()): Promise<SectShopListView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        sectId: true,
        sectContribBalance: true,
        sectContribLifetime: true,
      },
    });
    if (!char) throw new SectShopError('NO_CHARACTER');

    const dailyPeriodKey = sectMissionPeriodKey('DAILY', now);
    const weeklyPeriodKey = sectMissionPeriodKey('WEEKLY', now);

    // Single query covering cả DAILY + WEEKLY rows trong scope của character.
    // Filter trong-memory theo periodKey để giảm round-trip.
    const purchases = await this.prisma.sectShopPurchase.findMany({
      where: {
        characterId: char.id,
        OR: [
          { dailyPeriodKey: dailyPeriodKey },
          { weeklyPeriodKey: weeklyPeriodKey },
        ],
      },
      select: {
        entryKey: true,
        qty: true,
        dailyPeriodKey: true,
        weeklyPeriodKey: true,
      },
    });

    const dailyTotal = new Map<string, number>();
    const weeklyTotal = new Map<string, number>();
    for (const p of purchases) {
      if (p.dailyPeriodKey === dailyPeriodKey) {
        dailyTotal.set(p.entryKey, (dailyTotal.get(p.entryKey) ?? 0) + p.qty);
      }
      if (p.weeklyPeriodKey === weeklyPeriodKey) {
        weeklyTotal.set(p.entryKey, (weeklyTotal.get(p.entryKey) ?? 0) + p.qty);
      }
    }

    const entries: SectShopEntryView[] = SECT_SHOP_ENTRIES.map((e) => {
      const def = itemByKey(e.itemKey);
      return {
        key: e.key,
        itemKey: e.itemKey,
        itemNameI18nKey: def?.name ?? null,
        contributionCost: e.contributionCost,
        dailyLimit: e.dailyLimit,
        weeklyLimit: e.weeklyLimit,
        boughtToday: dailyTotal.get(e.key) ?? 0,
        boughtThisWeek: weeklyTotal.get(e.key) ?? 0,
        requiredSectLevel: e.requiredSectLevel,
        labelI18nKey: e.labelI18nKey,
        descriptionI18nKey: e.descriptionI18nKey,
      };
    });

    return {
      hasSect: !!char.sectId,
      contributionBalance: char.sectContribBalance,
      contributionLifetime: char.sectContribLifetime,
      dailyPeriodKey,
      weeklyPeriodKey,
      entries,
    };
  }

  async buy(
    userId: string,
    entryKey: string,
    qty: number,
    now: Date = new Date(),
  ): Promise<SectShopBuyResult> {
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new SectShopError('INVALID_QTY');
    }
    const entry: SectShopEntryDef | undefined = sectShopEntryByKey(entryKey);
    if (!entry) throw new SectShopError('ENTRY_NOT_FOUND');
    const itemDef = itemByKey(entry.itemKey);
    if (!itemDef) throw new SectShopError('ENTRY_NOT_FOUND');
    if (!itemDef.stackable && qty > 1) {
      throw new SectShopError('NON_STACKABLE_QTY_GT_1');
    }

    // Rate-limit theo userId trước khi DB lookup.
    const rl = await this.limiter.check(userId);
    if (!rl.allowed) throw new SectShopError('RATE_LIMITED');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true, sectContribBalance: true },
    });
    if (!char) throw new SectShopError('NO_CHARACTER');
    if (!char.sectId) throw new SectShopError('SECT_REQUIRED');

    const totalCost = entry.contributionCost * qty;
    if (char.sectContribBalance < totalCost) {
      throw new SectShopError('INSUFFICIENT_CONTRIBUTION');
    }

    const dailyPeriodKey = sectMissionPeriodKey('DAILY', now);
    const weeklyPeriodKey = sectMissionPeriodKey('WEEKLY', now);

    // Pre-check daily/weekly limit. Race window có thể slip 1-2 req nhưng
    // rate limit chặn 30/min nên overshoot bounded.
    if (typeof entry.dailyLimit === 'number' && entry.dailyLimit > 0) {
      const agg = await this.prisma.sectShopPurchase.aggregate({
        where: {
          characterId: char.id,
          entryKey,
          dailyPeriodKey,
        },
        _sum: { qty: true },
      });
      const todayQty = agg._sum.qty ?? 0;
      if (todayQty + qty > entry.dailyLimit) {
        throw new SectShopError('DAILY_LIMIT');
      }
    }
    if (typeof entry.weeklyLimit === 'number' && entry.weeklyLimit > 0) {
      const agg = await this.prisma.sectShopPurchase.aggregate({
        where: {
          characterId: char.id,
          entryKey,
          weeklyPeriodKey,
        },
        _sum: { qty: true },
      });
      const weekQty = agg._sum.qty ?? 0;
      if (weekQty + qty > entry.weeklyLimit) {
        throw new SectShopError('WEEKLY_LIMIT');
      }
    }

    let balance = 0;
    let lifetime = 0;
    let purchaseId = '';

    await this.prisma.$transaction(async (tx) => {
      // 1. CAS spend balance — guard `sectContribBalance >= totalCost`.
      const upd = await tx.character.updateMany({
        where: {
          id: char.id,
          sectContribBalance: { gte: totalCost },
        },
        data: {
          sectContribBalance: { decrement: totalCost },
        },
      });
      if (upd.count !== 1) {
        // Race lose hoặc balance < cost (concurrent buy đã trừ trước).
        throw new SectShopError('INSUFFICIENT_CONTRIBUTION');
      }

      const after = await tx.character.findUniqueOrThrow({
        where: { id: char.id },
        select: { sectContribBalance: true, sectContribLifetime: true },
      });
      balance = after.sectContribBalance;
      lifetime = after.sectContribLifetime;

      // 2. Insert purchase audit row.
      const purchase = await tx.sectShopPurchase.create({
        data: {
          characterId: char.id,
          entryKey,
          itemKey: entry.itemKey,
          qty,
          contributionSpent: totalCost,
          dailyPeriodKey,
          weeklyPeriodKey,
        },
        select: { id: true },
      });
      purchaseId = purchase.id;

      // 3. Ledger row reason=SECT_SHOP_BUY (negative delta).
      await tx.sectContributionLedger.create({
        data: {
          characterId: char.id,
          delta: -totalCost,
          reason: 'SECT_SHOP_BUY',
          refType: 'SectShopPurchase',
          refId: purchase.id,
          meta: {
            entryKey,
            itemKey: entry.itemKey,
            qty,
            unitCost: entry.contributionCost,
            dailyPeriodKey,
            weeklyPeriodKey,
          },
        },
      });

      // 4. Grant item via inventory service (cùng tx → rollback nếu fail).
      await this.inventory.grantTx(
        tx,
        char.id,
        [{ itemKey: entry.itemKey, qty }],
        {
          reason: 'SHOP_BUY',
          refType: 'SectShopPurchase',
          refId: purchase.id,
          actorUserId: userId,
          extra: {
            source: 'sect_shop',
            entryKey,
            unitCost: entry.contributionCost,
          },
        },
      );
    });

    void purchaseId; // Reserved cho future Pino structured-log nếu cần.

    return {
      entryKey,
      itemKey: entry.itemKey,
      qty,
      totalCost,
      contributionBalance: balance,
      contributionLifetime: lifetime,
    };
  }

  /** Helper internal — meta cast for InputJsonValue. */
  static metaToJson(meta: Record<string, unknown>): Prisma.InputJsonValue {
    return meta as Prisma.InputJsonValue;
  }
}
