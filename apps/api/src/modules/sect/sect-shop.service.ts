import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_SHOP_ENTRIES,
  clampLiveOpsMultiplier,
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
import { LiveOpsEventSchedulerService } from '../liveops-event-scheduler/liveops-event-scheduler.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

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
  /**
   * Đóng vai trò alias cho `finalCost` để backward-compat. Kể từ
   * Phase 15.3.A, giá trị này = `finalCost` (sau discount). FE mới
   * nên dọc `finalCost` / `originalCost` để rõ ràng.
   */
  totalCost: number;
  /** Phase 15.3.A — cost trước khi apply discount = unitCost × qty. */
  originalCost: number;
  /** Phase 15.3.A — cost thực bị trừ khi sect_contrib_balance, sau discount. ≥ 0. */
  finalCost: number;
  /**
   * Phase 15.3.A — `null` nếu không có SECT_SHOP_DISCOUNT active,
   * `{ multiplier, eventKey }` nếu có.
   */
  liveOpsDiscount: { multiplier: number; eventKey: string } | null;
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
    @Optional()
    private readonly liveOpsEvents?: LiveOpsEventSchedulerService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
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

    const originalCost = entry.contributionCost * qty;

    // Phase 15.3.A — LiveOps `SECT_SHOP_DISCOUNT` runtime wire.
    // Compose policy: max-only — discount tốt nhất winner. Cap server-side
    // ≤ 0.5. Fail-soft: lỗi service → discount 0 (no-op), buy tiếp tục.
    let liveOpsDiscount: { multiplier: number; eventKey: string } | null = null;
    let discountMultiplier = 0;
    const discountEnabled = !this.featureFlags || await this.featureFlags.isEnabled('SECT_SHOP_DISCOUNT_EVENTS_ENABLED');
    try {
      if (this.liveOpsEvents && discountEnabled) {
        const modifiers = await this.liveOpsEvents.getRuntimeModifiers(now);
        const matches = modifiers.filter((m) => m.type === 'SECT_SHOP_DISCOUNT');
        for (const m of matches) {
          const clamped = clampLiveOpsMultiplier(
            'SECT_SHOP_DISCOUNT',
            m.multiplier,
          );
          if (clamped > discountMultiplier) {
            discountMultiplier = clamped;
            liveOpsDiscount = {
              multiplier: clamped,
              eventKey: m.eventKey,
            };
          }
        }
      }
    } catch {
      discountMultiplier = 0;
      liveOpsDiscount = null;
    }

    const discountAmount =
      discountMultiplier > 0
        ? Math.floor(originalCost * discountMultiplier)
        : 0;
    const finalCost = Math.max(0, originalCost - discountAmount);

    if (char.sectContribBalance < finalCost) {
      throw new SectShopError('INSUFFICIENT_CONTRIBUTION');
    }

    const dailyPeriodKey = sectMissionPeriodKey('DAILY', now);
    const weeklyPeriodKey = sectMissionPeriodKey('WEEKLY', now);

    // Pre-check daily/weekly limit. Race window có thể slip 1-2 req nhưng
    // rate limit chặn 30/min nên overshoot bounded. Discount KHÔNG bypass
    // limit — limit theo qty, không theo cost.
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
      // 1. CAS spend balance — guard `sectContribBalance >= finalCost`.
      // finalCost = 0 case (100% discount theoretical, cap 0.5 chặn)
      // skip update; vẫn ghi audit + grant item.
      if (finalCost > 0) {
        const upd = await tx.character.updateMany({
          where: {
            id: char.id,
            sectContribBalance: { gte: finalCost },
          },
          data: {
            sectContribBalance: { decrement: finalCost },
          },
        });
        if (upd.count !== 1) {
          // Race lose hoặc balance < cost (concurrent buy đã trừ trước).
          throw new SectShopError('INSUFFICIENT_CONTRIBUTION');
        }
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
          contributionSpent: finalCost,
          dailyPeriodKey,
          weeklyPeriodKey,
        },
        select: { id: true },
      });
      purchaseId = purchase.id;

      // 3. Ledger row reason=SECT_SHOP_BUY (negative delta).
      // Skip ledger row nếu finalCost = 0 (no actual contribution spent).
      if (finalCost > 0) {
        await tx.sectContributionLedger.create({
          data: {
            characterId: char.id,
            delta: -finalCost,
            reason: 'SECT_SHOP_BUY',
            refType: 'SectShopPurchase',
            refId: purchase.id,
            meta: {
              entryKey,
              itemKey: entry.itemKey,
              qty,
              unitCost: entry.contributionCost,
              originalCost,
              finalCost,
              liveOpsDiscount,
              dailyPeriodKey,
              weeklyPeriodKey,
            },
          },
        });
      }

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
            originalCost,
            finalCost,
            liveOpsDiscount,
          },
        },
      );
    });

    void purchaseId; // Reserved cho future Pino structured-log nếu cần.

    return {
      entryKey,
      itemKey: entry.itemKey,
      qty,
      totalCost: finalCost,
      originalCost,
      finalCost,
      liveOpsDiscount,
      contributionBalance: balance,
      contributionLifetime: lifetime,
    };
  }

  /** Helper internal — meta cast for InputJsonValue. */
  static metaToJson(meta: Record<string, unknown>): Prisma.InputJsonValue {
    return meta as Prisma.InputJsonValue;
  }
}
