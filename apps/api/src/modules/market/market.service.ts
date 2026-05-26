import { Injectable, Logger, Optional } from '@nestjs/common';
import { CurrencyKind, ListingStatus } from '@prisma/client';
import {
  checkListingPriceBand,
  itemByKey,
  type ItemDef,
  type ItemKind,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyError, CurrencyService } from '../character/currency.service';
import { MissionService } from '../mission/mission.service';
import { AchievementService } from '../character/achievement.service';
import { MarketTradeAbuseService } from '../admin-market-abuse/market-trade-abuse.service';
import { createModuleLogger } from '../../common/logger.helper';

class MarketError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'INVENTORY_ITEM_NOT_FOUND'
      | 'ITEM_NOT_FOUND'
      | 'ITEM_EQUIPPED'
      | 'INVALID_QTY'
      | 'INVALID_PRICE'
      | 'PRICE_TOO_LOW'
      | 'PRICE_TOO_HIGH'
      | 'LISTING_NOT_FOUND'
      | 'LISTING_INACTIVE'
      | 'CANNOT_BUY_OWN'
      | 'NOT_OWNER'
      | 'INSUFFICIENT_LINH_THACH',
  ) {
    super(code);
  }
}

export const DEFAULT_MARKET_FEE_PCT = 0.05; // 5% phí thiên đạo (mặc định)
export const MIN_MARKET_FEE_PCT = 0;
export const MAX_MARKET_FEE_PCT = 0.5; // 50% trần — bảo vệ khỏi gõ nhầm 5 thay vì 0.05

const marketLogger = createModuleLogger('market');

/**
 * Đọc `MARKET_FEE_PCT` từ env. Hợp lệ: số trong khoảng [0, 0.5].
 * Không hợp lệ → silent fallback `DEFAULT_MARKET_FEE_PCT` + structured warning.
 *
 * Cố ý KHÔNG `throw` để app vẫn boot khi ops đặt sai env (config-only,
 * không phải security). Test verify silent fallback behavior.
 */
export function resolveMarketFeePct(envValue: string | undefined): number {
  if (envValue === undefined || envValue.trim() === '') return DEFAULT_MARKET_FEE_PCT;
  const n = Number(envValue);
  if (!Number.isFinite(n)) {
    marketLogger.warn(
      { envValue, fallback: DEFAULT_MARKET_FEE_PCT },
      'MARKET_FEE_PCT is not a valid number, using default',
    );
    return DEFAULT_MARKET_FEE_PCT;
  }
  if (n < MIN_MARKET_FEE_PCT || n > MAX_MARKET_FEE_PCT) {
    marketLogger.warn(
      { value: n, min: MIN_MARKET_FEE_PCT, max: MAX_MARKET_FEE_PCT, fallback: DEFAULT_MARKET_FEE_PCT },
      'MARKET_FEE_PCT out of valid range, using default',
    );
    return DEFAULT_MARKET_FEE_PCT;
  }
  return n;
}

export const MARKET_FEE_PCT = resolveMarketFeePct(process.env.MARKET_FEE_PCT);

export interface ListingView {
  id: string;
  sellerId: string;
  sellerName: string;
  itemKey: string;
  qty: number;
  pricePerUnit: string;
  totalPrice: string;
  status: ListingStatus;
  createdAt: string;
  item: ItemDef;
  isMine: boolean;
}

interface PostInput {
  inventoryItemId: string;
  qty: number;
  pricePerUnit: bigint;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly chars: CharacterService,
    private readonly currency: CurrencyService,
    private readonly missions: MissionService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly abuseDetector?: MarketTradeAbuseService,
  ) {}

  async listActive(viewerCharacterId: string, kind?: ItemKind): Promise<ListingView[]> {
    const rows = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.ACTIVE,
        ...(kind ? { itemKind: kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (rows.length === 0) return [];
    const sellers = await this.prisma.character.findMany({
      where: { id: { in: rows.map((r) => r.sellerId) } },
      select: { id: true, name: true },
    });
    const sellerMap = new Map(sellers.map((s) => [s.id, s.name]));
    const out: ListingView[] = [];
    for (const r of rows) {
      const item = itemByKey(r.itemKey);
      if (!item) continue;
      out.push(this.toView(r, item, sellerMap.get(r.sellerId) ?? '???', viewerCharacterId));
    }
    return out;
  }

  async listMine(characterId: string): Promise<ListingView[]> {
    const rows = await this.prisma.listing.findMany({
      where: { sellerId: characterId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (rows.length === 0) return [];
    const me = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { name: true },
    });
    const out: ListingView[] = [];
    for (const r of rows) {
      const item = itemByKey(r.itemKey);
      if (!item) continue;
      out.push(this.toView(r, item, me?.name ?? '???', characterId));
    }
    return out;
  }

  async post(userId: string, input: PostInput): Promise<ListingView> {
    if (input.qty <= 0) throw new MarketError('INVALID_QTY');
    if (input.pricePerUnit <= 0n) throw new MarketError('INVALID_PRICE');

    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new MarketError('NO_CHARACTER');

    // Re-load + lock-style validate inv qty/equip status TRONG transaction để
    // tránh TOCTOU khi 2 request đồng thời cùng inventoryItemId.
    const { listing, item } = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.inventoryItem.findUnique({
        where: { id: input.inventoryItemId },
      });
      if (!inv || inv.characterId !== char.id) {
        throw new MarketError('INVENTORY_ITEM_NOT_FOUND');
      }
      if (inv.equippedSlot) throw new MarketError('ITEM_EQUIPPED');
      const itemDef = itemByKey(inv.itemKey);
      if (!itemDef) throw new MarketError('ITEM_NOT_FOUND');
      if (input.qty > inv.qty) throw new MarketError('INVALID_QTY');

      // Phase 16.6 — Market Price Band check. Reject listing có
      // pricePerUnit ngoài band của itemKey (override > rarity > global
      // fallback). KHÔNG mutate listing đã ACTIVE từ trước (chỉ apply
      // khi POST mới).
      const bandCheck = checkListingPriceBand(inv.itemKey, input.pricePerUnit);
      if (!bandCheck.ok) {
        throw new MarketError(
          bandCheck.reason === 'TOO_LOW' ? 'PRICE_TOO_LOW' : 'PRICE_TOO_HIGH',
        );
      }

      if (inv.qty - input.qty <= 0) {
        // Xoá row, ràng buộc qty cũ phải khớp để invalidate concurrent updater.
        const del = await tx.inventoryItem.deleteMany({
          where: { id: inv.id, qty: inv.qty },
        });
        if (del.count === 0) throw new MarketError('INVALID_QTY');
      } else {
        // Atomic decrement với guard qty đủ.
        const upd = await tx.inventoryItem.updateMany({
          where: { id: inv.id, qty: { gte: input.qty } },
          data: { qty: { decrement: input.qty } },
        });
        if (upd.count === 0) throw new MarketError('INVALID_QTY');
      }
      const created = await tx.listing.create({
        data: {
          sellerId: char.id,
          itemKey: inv.itemKey,
          itemKind: itemDef.kind,
          qty: input.qty,
          pricePerUnit: input.pricePerUnit,
        },
      });
      // Item rời túi seller → escrow listing. Ghi ledger outflow.
      await tx.itemLedger.create({
        data: {
          characterId: char.id,
          itemKey: inv.itemKey,
          qtyDelta: -input.qty,
          reason: 'MARKET_SELL',
          refType: 'Listing',
          refId: created.id,
          meta: { stage: 'POST', pricePerUnit: input.pricePerUnit.toString() },
        },
      });
      return { listing: created, item: itemDef };
    });

    // Phase 16.4 — Detection-only hook. Post-mutation, fail-soft.
    if (this.abuseDetector) {
      try {
        await this.abuseDetector.recordListingCreate({
          listingId: listing.id,
          sellerId: char.id,
          itemKey: listing.itemKey,
          qty: listing.qty,
          pricePerUnit: listing.pricePerUnit,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`recordListingCreate failed: ${msg}`);
      }
    }

    return this.toView(listing, item, char.name, char.id);
  }

  async cancel(userId: string, listingId: string): Promise<ListingView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new MarketError('NO_CHARACTER');
    const l = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!l) throw new MarketError('LISTING_NOT_FOUND');
    if (l.sellerId !== char.id) throw new MarketError('NOT_OWNER');
    if (l.status !== ListingStatus.ACTIVE) throw new MarketError('LISTING_INACTIVE');
    const item = itemByKey(l.itemKey);
    if (!item) throw new MarketError('ITEM_NOT_FOUND');

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-check listing inside transaction để chặn double-cancel.
      const cur = await tx.listing.findUnique({ where: { id: l.id } });
      if (!cur || cur.status !== ListingStatus.ACTIVE) {
        throw new MarketError('LISTING_INACTIVE');
      }
      // Atomic flip status — nếu count=0 nghĩa là vừa bị thay đổi bởi tx khác.
      const flip = await tx.listing.updateMany({
        where: { id: l.id, status: ListingStatus.ACTIVE },
        data: { status: ListingStatus.CANCELLED },
      });
      if (flip.count === 0) throw new MarketError('LISTING_INACTIVE');

      // Hoàn item về túi (gộp nếu stackable)
      if (item.stackable) {
        const existing = await tx.inventoryItem.findFirst({
          where: { characterId: char.id, itemKey: l.itemKey, equippedSlot: null },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { qty: { increment: l.qty } },
          });
        } else {
          await tx.inventoryItem.create({
            data: { characterId: char.id, itemKey: l.itemKey, qty: l.qty },
          });
        }
      } else {
        await tx.inventoryItem.create({
          data: { characterId: char.id, itemKey: l.itemKey, qty: l.qty },
        });
      }
      // Ghi ledger refund (item về túi seller).
      await tx.itemLedger.create({
        data: {
          characterId: char.id,
          itemKey: l.itemKey,
          qtyDelta: l.qty,
          reason: 'MARKET_SELL',
          refType: 'Listing',
          refId: l.id,
          meta: { stage: 'CANCEL' },
        },
      });
      return tx.listing.findUniqueOrThrow({ where: { id: l.id } });
    });

    await this.refreshState(userId);
    return this.toView(updated, item, char.name, char.id);
  }

  async buy(userId: string, listingId: string): Promise<ListingView> {
    const buyer = await this.prisma.character.findUnique({ where: { userId } });
    if (!buyer) throw new MarketError('NO_CHARACTER');

    const l = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!l) throw new MarketError('LISTING_NOT_FOUND');
    if (l.status !== ListingStatus.ACTIVE) throw new MarketError('LISTING_INACTIVE');
    if (l.sellerId === buyer.id) throw new MarketError('CANNOT_BUY_OWN');

    const item = itemByKey(l.itemKey);
    if (!item) throw new MarketError('ITEM_NOT_FOUND');

    const total = l.pricePerUnit * BigInt(l.qty);
    if (buyer.linhThach < total) throw new MarketError('INSUFFICIENT_LINH_THACH');

    // Phí thiên đạo
    const fee = (total * BigInt(Math.round(MARKET_FEE_PCT * 1000))) / 1000n;
    const sellerGain = total - fee;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-check listing + atomic flip status để chặn double-buy.
      const cur = await tx.listing.findUnique({ where: { id: l.id } });
      if (!cur || cur.status !== ListingStatus.ACTIVE) {
        throw new MarketError('LISTING_INACTIVE');
      }
      const flip = await tx.listing.updateMany({
        where: { id: l.id, status: ListingStatus.ACTIVE },
        data: {
          status: ListingStatus.SOLD,
          buyerId: buyer.id,
          soldAt: new Date(),
        },
      });
      if (flip.count === 0) throw new MarketError('LISTING_INACTIVE');

      // Trừ tiền buyer — atomic guard linhThach >= total qua CurrencyService.
      try {
        await this.currency.applyTx(tx, {
          characterId: buyer.id,
          currency: CurrencyKind.LINH_THACH,
          delta: -total,
          reason: 'MARKET_BUY',
          refType: 'Listing',
          refId: l.id,
          meta: {
            itemKey: l.itemKey,
            qty: l.qty,
            pricePerUnit: l.pricePerUnit.toString(),
            sellerId: l.sellerId,
          },
        });
      } catch (e) {
        if (e instanceof CurrencyError && e.code === 'INSUFFICIENT_FUNDS') {
          throw new MarketError('INSUFFICIENT_LINH_THACH');
        }
        throw e;
      }
      // Cộng tiền seller (đã trừ phí thiên đạo).
      await this.currency.applyTx(tx, {
        characterId: l.sellerId,
        currency: CurrencyKind.LINH_THACH,
        delta: sellerGain,
        reason: 'MARKET_SELL',
        refType: 'Listing',
        refId: l.id,
        meta: {
          itemKey: l.itemKey,
          qty: l.qty,
          buyerId: buyer.id,
          gross: total.toString(),
          fee: fee.toString(),
        },
      });
      // Grant item cho buyer
      if (item.stackable) {
        const existing = await tx.inventoryItem.findFirst({
          where: { characterId: buyer.id, itemKey: l.itemKey, equippedSlot: null },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { qty: { increment: l.qty } },
          });
        } else {
          await tx.inventoryItem.create({
            data: { characterId: buyer.id, itemKey: l.itemKey, qty: l.qty },
          });
        }
      } else {
        await tx.inventoryItem.create({
          data: { characterId: buyer.id, itemKey: l.itemKey, qty: l.qty },
        });
      }
      // Ghi ledger inflow cho buyer.
      await tx.itemLedger.create({
        data: {
          characterId: buyer.id,
          itemKey: l.itemKey,
          qtyDelta: l.qty,
          reason: 'MARKET_BUY',
          refType: 'Listing',
          refId: l.id,
          meta: {
            sellerId: l.sellerId,
            pricePerUnit: l.pricePerUnit.toString(),
            total: total.toString(),
          },
        },
      });
      return tx.listing.findUniqueOrThrow({ where: { id: l.id } });
    });

    await this.refreshState(userId);
    // Notify seller (state:update) + lấy tên seller cho response.
    const seller = await this.prisma.character.findUnique({
      where: { id: l.sellerId },
      select: { userId: true, name: true },
    });
    if (seller) {
      const sellerState = await this.chars.findByUser(seller.userId);
      if (sellerState) {
        this.realtime.emitToUser(seller.userId, 'state:update', sellerState);
      }
    }

    // Mission + Achievement tracking — buyer BUY_LISTING +1, seller SELL_LISTING
    // +1. Phase 11.10.C-2 wire trackEvent vào achievement bằng cùng goalKind.
    // Fail-soft: không rollback giao dịch nếu mission/achievement lỗi.
    try {
      await this.missions.track(buyer.id, 'BUY_LISTING', 1);
      await this.missions.track(l.sellerId, 'SELL_LISTING', 1);
      if (this.achievements) {
        await this.achievements.trackEvent(buyer.id, 'BUY_LISTING', 1);
        await this.achievements.trackEvent(l.sellerId, 'SELL_LISTING', 1);
      }
    } catch {
      // bỏ qua
    }

    // Phase 16.4 — Detection-only hook. Post-mutation, fail-soft.
    if (this.abuseDetector) {
      try {
        await this.abuseDetector.recordListingBuy({
          listingId: l.id,
          sellerId: l.sellerId,
          buyerId: buyer.id,
          itemKey: l.itemKey,
          qty: l.qty,
          pricePerUnit: l.pricePerUnit,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`recordListingBuy failed: ${msg}`);
      }
    }

    return this.toView(updated, item, seller?.name ?? '???', buyer.id);
  }

  private async refreshState(userId: string): Promise<void> {
    const state = await this.chars.findByUser(userId);
    if (state) this.realtime.emitToUser(userId, 'state:update', state);
  }

  private toView(
    l: {
      id: string;
      sellerId: string;
      itemKey: string;
      qty: number;
      pricePerUnit: bigint;
      status: ListingStatus;
      createdAt: Date;
    },
    item: ItemDef,
    sellerName: string,
    viewerCharacterId: string,
  ): ListingView {
    const total = l.pricePerUnit * BigInt(l.qty);
    return {
      id: l.id,
      sellerId: l.sellerId,
      sellerName,
      itemKey: l.itemKey,
      qty: l.qty,
      pricePerUnit: l.pricePerUnit.toString(),
      totalPrice: total.toString(),
      status: l.status,
      createdAt: l.createdAt.toISOString(),
      item,
      isMine: l.sellerId === viewerCharacterId,
    };
  }
}

export { MarketError };
