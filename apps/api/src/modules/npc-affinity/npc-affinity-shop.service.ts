import { Injectable } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  AFFINITY_TIERS,
  NPC_AFFINITY_SHOPS,
  affinityTierForScore,
  itemByKey,
  npcAffinityDefForKey,
  npcAffinityShopForNpc,
  npcAffinityShopItem,
  npcByKey,
  npcHiddenUnlocksForAffinity,
  toNpcAffinityShopItemView,
  type AffinityTierKey,
  type NpcAffinityShopItemDef,
  type NpcAffinityShopItemView,
  type NpcHiddenUnlockView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService, CurrencyError } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { startOfLocalDay } from '../combat/combat.service';

/**
 * Phase 12.10.C — NPC Affinity Shop & Hidden Unlocks runtime.
 *
 * Phân biệt với:
 *   - `ShopService` (Phase 9, generic NPC vendor) — single global catalog
 *     `NPC_SHOP[]`, không gắn affinity tier.
 *   - `NpcAffinityService` (Phase 12.10.A/B) — score / tier helpers + gift logic.
 *
 * Service NÀY ráp cả hai:
 *   - Đọc shop catalog `NPC_AFFINITY_SHOPS[]` filter theo (npcKey + tier).
 *   - Buy: atomic spend currency + grant inventory + ledger với
 *     `reason='NPC_SHOP_BUY'`, `refType='NpcAffinityShop'`,
 *     `refId='${npcKey}:${itemKey}'`. Daily/weekly limit kiểm qua ItemLedger
 *     aggregate.
 *   - Hidden unlocks: trả list dialogue/quest theo tier hiện tại của NPC.
 */

export class NpcAffinityShopError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NPC_AFFINITY_UNKNOWN'
      | 'ITEM_NOT_IN_SHOP'
      | 'INSUFFICIENT_AFFINITY_TIER'
      | 'INSUFFICIENT_FUNDS'
      | 'DAILY_LIMIT_REACHED'
      | 'WEEKLY_LIMIT_REACHED'
      | 'INVALID_QTY'
      | 'NON_STACKABLE_QTY_GT_1',
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface NpcShopEntryView extends NpcAffinityShopItemView {
  /** Tier của NPC mà player đã đạt — server compute từ score. */
  currentTier: AffinityTierKey;
  /** True khi `currentTier` order ≥ `requiredAffinityTier` order. */
  unlocked: boolean;
  /** Số đã mua trong cửa sổ daily/weekly hiện tại. */
  purchased: number;
  /** Số còn lại; null khi `stockType='unlimited'`. */
  remaining: number | null;
  /** True khi đạt limit (purchased ≥ limit). */
  limitReached: boolean;
}

export interface NpcShopListResult {
  npcKey: string;
  npcName: string;
  currentScore: number;
  currentTier: {
    key: AffinityTierKey;
    label: string;
    labelEn: string;
    minScore: number;
    order: number;
  };
  entries: NpcShopEntryView[];
}

export interface BuyShopItemInput {
  characterId: string;
  npcKey: string;
  itemKey: string;
  /** Mặc định 1; non-stackable bắt buộc 1. */
  qty?: number;
  /** Optional override `Date.now()` cho test deterministic bucket. */
  now?: Date;
  actorUserId?: string;
}

export interface BuyShopItemResult {
  characterId: string;
  npcKey: string;
  itemKey: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  currency: CurrencyKind;
  /** Snapshot purchased/remaining sau buy (cùng cửa sổ). */
  purchased: number;
  remaining: number | null;
  stockType: NpcAffinityShopItemDef['stockType'];
}

function getNpcShopResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

/**
 * Trả Date đại diện 00:00 local Monday của tuần hiện tại theo `tz` (UTC).
 * Dùng cho weekly limit window. ISO week — Monday start.
 *
 * Cách tính: lấy `startOfLocalDay`, cộng tz offset để đọc local day-of-week,
 * rồi backtrack về Monday.
 */
export function startOfLocalWeek(now: Date, tz: string): Date {
  const dayStart = startOfLocalDay(now, tz);
  const tzMin = parseTzOffsetMinutes(tz, now);
  const localDate = new Date(dayStart.getTime() + tzMin * 60_000);
  const localDay = localDate.getUTCDay(); // 0=Sun..6=Sat
  const backDays = localDay === 0 ? 6 : localDay - 1;
  return new Date(dayStart.getTime() - backDays * 86400000);
}

/**
 * Mirror `combat.service.tzOffsetMinutes` — giữ private helper để không export
 * thừa. Chỉ hỗ trợ tz dạng `±HH:MM` hoặc tên Asia/Ho_Chi_Minh / UTC.
 */
function parseTzOffsetMinutes(tz: string, _at: Date): number {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  if (tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon') return 7 * 60;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }
  // Fallback: 0
  return 0;
}

@Injectable()
export class NpcAffinityShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Liệt kê shop của 1 NPC + state locked/unlocked + purchased/remaining
   * theo cửa sổ daily/weekly hiện tại.
   */
  async listShop(
    characterId: string,
    npcKey: string,
    now: Date = new Date(),
  ): Promise<NpcShopListResult> {
    const def = npcAffinityDefForKey(npcKey);
    if (!def) {
      throw new NpcAffinityShopError('NPC_AFFINITY_UNKNOWN', npcKey);
    }

    const row = await this.prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey } },
      select: { score: true },
    });
    const score = row?.score ?? def.initialScore;
    const tier = affinityTierForScore(score);
    const tz = getNpcShopResetTz();

    const entries = npcAffinityShopForNpc(npcKey);
    const out: NpcShopEntryView[] = [];
    for (const entry of entries) {
      const view = toNpcAffinityShopItemView(entry);
      if (!view) continue; // catalog drift — skip silent.

      const purchased = await this.countPurchasedInWindow(
        characterId,
        npcKey,
        entry,
        now,
        tz,
      );
      const limit =
        entry.stockType === 'daily'
          ? entry.dailyLimit ?? null
          : entry.stockType === 'weekly'
            ? entry.weeklyLimit ?? null
            : null;
      const remaining = limit === null ? null : Math.max(0, limit - purchased);
      const reqOrder =
        AFFINITY_TIERS.find((t) => t.key === entry.requiredAffinityTier)?.order ??
        0;
      const unlocked = tier.order >= reqOrder;

      out.push({
        ...view,
        currentTier: tier.key,
        unlocked,
        purchased,
        remaining,
        limitReached: limit !== null && purchased >= limit,
      });
    }

    const npcDef = npcByKey(npcKey);
    return {
      npcKey,
      npcName: npcDef?.name ?? npcKey,
      currentScore: score,
      currentTier: {
        key: tier.key,
        label: tier.label,
        labelEn: tier.labelEn,
        minScore: tier.minScore,
        order: tier.order,
      },
      entries: out,
    };
  }

  /**
   * Mua 1 item từ NPC affinity shop. Atomic transaction:
   *   1. Re-check tier (server-authoritative — không tin client).
   *   2. Re-check daily/weekly limit (count ItemLedger reason='NPC_SHOP_BUY' theo refId).
   *   3. CurrencyService.applyTx (-cost) — throw INSUFFICIENT_FUNDS nếu thiếu.
   *   4. InventoryService.grantTx — grant qty.
   *
   * Race condition: 2 concurrent buy cùng item, cùng cửa sổ →
   *   - count A == count B (snapshot trước khi insert).
   *   - Cả 2 spend OK, cả 2 grant OK → ledger sum vượt limit 1 đơn vị.
   *   Acceptable for MVP (mirror ShopService); rate-limit + dailyLimit nhỏ
   *   giữ overshoot bounded.
   */
  async buy(input: BuyShopItemInput): Promise<BuyShopItemResult> {
    const qty = input.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new NpcAffinityShopError('INVALID_QTY');
    }

    const def = npcAffinityDefForKey(input.npcKey);
    if (!def) {
      throw new NpcAffinityShopError('NPC_AFFINITY_UNKNOWN', input.npcKey);
    }

    const entry = npcAffinityShopItem(input.npcKey, input.itemKey);
    if (!entry) {
      throw new NpcAffinityShopError('ITEM_NOT_IN_SHOP', `${input.npcKey}:${input.itemKey}`);
    }
    const itemDef = itemByKey(input.itemKey);
    if (!itemDef) {
      throw new NpcAffinityShopError('ITEM_NOT_IN_SHOP', `${input.itemKey} not in catalog`);
    }
    if (!itemDef.stackable && qty > 1) {
      throw new NpcAffinityShopError('NON_STACKABLE_QTY_GT_1');
    }

    // Resolve current score → tier.
    const row = await this.prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId: input.characterId, npcKey: input.npcKey } },
      select: { score: true },
    });
    const score = row?.score ?? def.initialScore;
    const tier = affinityTierForScore(score);
    const reqOrder =
      AFFINITY_TIERS.find((t) => t.key === entry.requiredAffinityTier)?.order ?? 0;
    if (tier.order < reqOrder) {
      throw new NpcAffinityShopError(
        'INSUFFICIENT_AFFINITY_TIER',
        `current=${tier.key}, required=${entry.requiredAffinityTier}`,
      );
    }

    const now = input.now ?? new Date();
    const tz = getNpcShopResetTz();
    const purchased = await this.countPurchasedInWindow(
      input.characterId,
      input.npcKey,
      entry,
      now,
      tz,
    );

    if (entry.stockType === 'daily' && typeof entry.dailyLimit === 'number') {
      if (purchased + qty > entry.dailyLimit) {
        throw new NpcAffinityShopError(
          'DAILY_LIMIT_REACHED',
          `${entry.dailyLimit}/day, used=${purchased}`,
        );
      }
    } else if (entry.stockType === 'weekly' && typeof entry.weeklyLimit === 'number') {
      if (purchased + qty > entry.weeklyLimit) {
        throw new NpcAffinityShopError(
          'WEEKLY_LIMIT_REACHED',
          `${entry.weeklyLimit}/week, used=${purchased}`,
        );
      }
    }

    const totalCost = entry.cost * qty;
    const currencyKind: CurrencyKind =
      entry.currency === 'TIEN_NGOC' ? CurrencyKind.TIEN_NGOC : CurrencyKind.LINH_THACH;
    const refId = `${input.npcKey}:${input.itemKey}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.currency.applyTx(tx, {
          characterId: input.characterId,
          currency: currencyKind,
          delta: -BigInt(totalCost),
          reason: 'NPC_SHOP_BUY',
          refType: 'NpcAffinityShop',
          refId,
          meta: {
            npcKey: input.npcKey,
            itemKey: input.itemKey,
            qty,
            unitCost: entry.cost,
            stockType: entry.stockType,
          },
          actorUserId: input.actorUserId,
        });
        await this.inventory.grantTx(
          tx,
          input.characterId,
          [{ itemKey: input.itemKey, qty }],
          {
            reason: 'NPC_SHOP_BUY',
            refType: 'NpcAffinityShop',
            refId,
            actorUserId: input.actorUserId,
            extra: {
              npcKey: input.npcKey,
              unitCost: entry.cost,
              stockType: entry.stockType,
            },
          },
        );
      });
    } catch (err) {
      if (err instanceof CurrencyError && err.code === 'INSUFFICIENT_FUNDS') {
        throw new NpcAffinityShopError('INSUFFICIENT_FUNDS');
      }
      throw err;
    }

    const purchasedAfter = purchased + qty;
    const limit =
      entry.stockType === 'daily'
        ? entry.dailyLimit ?? null
        : entry.stockType === 'weekly'
          ? entry.weeklyLimit ?? null
          : null;
    const remaining = limit === null ? null : Math.max(0, limit - purchasedAfter);

    return {
      characterId: input.characterId,
      npcKey: input.npcKey,
      itemKey: input.itemKey,
      qty,
      unitCost: entry.cost,
      totalCost,
      currency: currencyKind,
      purchased: purchasedAfter,
      remaining,
      stockType: entry.stockType,
    };
  }

  /**
   * Hidden unlocks (dialogue + quest) cho 1 NPC + tier hiện tại của character.
   */
  async listUnlocks(
    characterId: string,
    npcKey: string,
  ): Promise<{
    npcKey: string;
    currentTier: AffinityTierKey;
    unlocks: NpcHiddenUnlockView[];
  }> {
    const def = npcAffinityDefForKey(npcKey);
    if (!def) {
      throw new NpcAffinityShopError('NPC_AFFINITY_UNKNOWN', npcKey);
    }
    const row = await this.prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey } },
      select: { score: true },
    });
    const score = row?.score ?? def.initialScore;
    const tier = affinityTierForScore(score);
    return {
      npcKey,
      currentTier: tier.key,
      unlocks: npcHiddenUnlocksForAffinity(npcKey, tier.key),
    };
  }

  /**
   * Count `qtyDelta>0` ItemLedger trong cửa sổ daily/weekly cho 1 entry.
   * Mirror `ShopService.buy` daily aggregate; weekly query thêm cho stockType=weekly.
   */
  private async countPurchasedInWindow(
    characterId: string,
    npcKey: string,
    entry: NpcAffinityShopItemDef,
    now: Date,
    tz: string,
  ): Promise<number> {
    if (entry.stockType === 'unlimited') return 0;
    let windowStart: Date;
    if (entry.stockType === 'daily') {
      windowStart = startOfLocalDay(now, tz);
    } else {
      windowStart = startOfLocalWeek(now, tz);
    }
    const refId = `${npcKey}:${entry.itemKey}`;
    const agg = await this.prisma.itemLedger.aggregate({
      where: {
        characterId,
        itemKey: entry.itemKey,
        reason: 'NPC_SHOP_BUY',
        refType: 'NpcAffinityShop',
        refId,
        qtyDelta: { gt: 0 },
        createdAt: { gte: windowStart },
      },
      _sum: { qtyDelta: true },
    });
    return agg._sum.qtyDelta ?? 0;
  }
}

/** Re-export catalog cho controller nếu cần debug. */
export const NPC_AFFINITY_SHOP_CATALOG = NPC_AFFINITY_SHOPS;
