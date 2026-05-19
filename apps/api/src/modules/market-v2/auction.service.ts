/**
 * Phase 30.0 — Auction Service.
 *
 * Create auction (lock item từ inventory), Bid (escrow linhThach buyer
 * + refund bid trước đó vào claim box), Cancel by seller (return item
 * → claim box, refund highest bid). Finalize sẽ ở cron / admin trigger
 * (out-of-scope cho commit này; sẽ thêm ở milestone tiếp theo).
 *
 * Anti-abuse:
 *   - Validator shared: `validateAuctionInput`, `validateBid`.
 *   - Self-bid blocked qua validator.
 *   - Bid escrow: trừ thẳng linhThach buyer; refund vào claim box khi
 *     bị outbid.
 *   - Currency cấm TIEN_NGOC (nạp).
 */
import { Injectable, Logger } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  validateAuctionInput,
  validateBid,
  classifyMarketAnomaly,
  MIN_AUCTION_DURATION_MINUTES,
  MAX_AUCTION_DURATION_MINUTES,
  type MarketCurrency,
  type MarketAnomalyType,
} from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';
import { CurrencyService, CurrencyError, type LedgerReason } from '../character/currency.service';
import { ClaimBoxService } from './claim-box.service';

export class AuctionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const MARKET_CURRENCY_TO_KIND: Record<MarketCurrency, CurrencyKind> = {
  LINH_THACH: CurrencyKind.LINH_THACH,
  SECT_CONTRIBUTION: CurrencyKind.CONG_HIEN_TONG_MON,
  EVENT_TOKEN: CurrencyKind.EVENT_TOKEN,
  TIEN_NGOC_KHOA: CurrencyKind.TIEN_NGOC_KHOA,
};

export interface CreateAuctionInput {
  sellerCharacterId: string;
  itemKey: string;
  quantity: number;
  currency: MarketCurrency;
  startPrice: bigint;
  minBidStep: bigint;
  buyoutPrice?: bigint;
  durationMinutes: number;
}

export interface PlaceBidInput {
  auctionId: string;
  bidderCharacterId: string;
  bidAmount: bigint;
}

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly claimBox: ClaimBoxService,
  ) {}

  async create(input: CreateAuctionInput) {
    const policy = validateAuctionInput({
      sellerCharacterId: input.sellerCharacterId,
      itemKey: input.itemKey,
      quantity: input.quantity,
      startPrice: Number(input.startPrice),
      minBidStep: Number(input.minBidStep),
      buyoutPrice: input.buyoutPrice ? Number(input.buyoutPrice) : undefined,
      currency: input.currency,
      durationMinutes: input.durationMinutes,
    });
    if (!policy.ok) throw new AuctionError(policy.code);
    if (
      input.durationMinutes < MIN_AUCTION_DURATION_MINUTES ||
      input.durationMinutes > MAX_AUCTION_DURATION_MINUTES
    ) {
      throw new AuctionError('MARKET_AUCTION_DURATION_OUT_OF_RANGE');
    }
    if (input.currency === 'TIEN_NGOC_KHOA') {
      // Allowed in policy nhưng admin có thể chọn block ở MarketItemPolicy.
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // Lock item: trừ inventory + ghi ledger consume.
      const inv = await tx.inventoryItem.findFirst({
        where: {
          characterId: input.sellerCharacterId,
          itemKey: input.itemKey,
          equippedSlot: null,
        },
      });
      if (!inv || inv.qty < input.quantity) {
        throw new AuctionError('AUCTION_INVENTORY_INSUFFICIENT');
      }
      const dec = await tx.inventoryItem.updateMany({
        where: { id: inv.id, qty: { gte: input.quantity } },
        data: { qty: { decrement: input.quantity } },
      });
      if (dec.count === 0) throw new AuctionError('AUCTION_INVENTORY_INSUFFICIENT');

      await tx.itemLedger.create({
        data: {
          characterId: input.sellerCharacterId,
          itemKey: input.itemKey,
          qtyDelta: -input.quantity,
          reason: 'MARKET_AUCTION_LIST',
          refType: 'MarketAuction',
          refId: 'pending',
        },
      });

      const auction = await tx.marketAuction.create({
        data: {
          sellerCharacterId: input.sellerCharacterId,
          itemKey: input.itemKey,
          quantity: input.quantity,
          currency: input.currency,
          startPrice: input.startPrice,
          buyoutPrice: input.buyoutPrice ?? null,
          minBidStep: input.minBidStep,
          startsAt: now,
          endsAt,
          status: 'ACTIVE',
        },
      });

      // Anomaly: price-per-unit outliers (LINH_THACH only, skip if no reference).
      if (input.currency === 'LINH_THACH' && input.quantity > 0) {
        const pricePerUnit = Number(input.startPrice) / input.quantity;
        if (pricePerUnit > 0 && pricePerUnit < 10) {
          await this.logAnomaly(tx, {
            type: 'PRICE_TOO_LOW',
            sellerCharacterId: input.sellerCharacterId,
            auctionId: auction.id,
            totalValue: input.startPrice,
            detail: { pricePerUnit, itemKey: input.itemKey, quantity: input.quantity },
          });
        }
        if (pricePerUnit > 5_000_000) {
          await this.logAnomaly(tx, {
            type: 'PRICE_TOO_HIGH',
            sellerCharacterId: input.sellerCharacterId,
            auctionId: auction.id,
            totalValue: input.startPrice,
            detail: { pricePerUnit, itemKey: input.itemKey, quantity: input.quantity },
          });
        }
      }

      return auction;
    });
  }

  async listActive(opts: { itemKey?: string; limit?: number } = {}) {
    return this.prisma.marketAuction.findMany({
      where: {
        status: 'ACTIVE',
        ...(opts.itemKey ? { itemKey: opts.itemKey } : {}),
        endsAt: { gt: new Date() },
      },
      orderBy: { endsAt: 'asc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
  }

  async get(auctionId: string) {
    return this.prisma.marketAuction.findUnique({
      where: { id: auctionId },
      include: {
        bids: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  async placeBid(input: PlaceBidInput) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.marketAuction.findUnique({ where: { id: input.auctionId } });
      if (!a) throw new AuctionError('AUCTION_NOT_FOUND');
      if (a.status !== 'ACTIVE') throw new AuctionError('MARKET_AUCTION_NOT_ACTIVE');
      const now = new Date();

      const policy = validateBid({
        auctionId: a.id,
        bidderCharacterId: input.bidderCharacterId,
        bidAmount: Number(input.bidAmount),
        currency: a.currency as MarketCurrency,
        currentBid: a.currentBid ? Number(a.currentBid) : Number(a.startPrice),
        minBidStep: Number(a.minBidStep),
        buyoutPrice: a.buyoutPrice ? Number(a.buyoutPrice) : undefined,
        sellerCharacterId: a.sellerCharacterId,
        auctionStatus: 'ACTIVE',
        endsAt: a.endsAt.toISOString(),
        nowIso: now.toISOString(),
      });
      if (!policy.ok) throw new AuctionError(policy.code);
      const isBuyout = policy.isBuyout;

      // Escrow new bid
      const kind = MARKET_CURRENCY_TO_KIND[a.currency as MarketCurrency];
      try {
        await this.currency.applyTx(tx, {
          characterId: input.bidderCharacterId,
          currency: kind,
          delta: -input.bidAmount,
          reason: 'MARKET_AUCTION_BID_ESCROW' as LedgerReason,
          refType: 'MarketAuction',
          refId: a.id,
        });
      } catch (e) {
        if (e instanceof CurrencyError) {
          throw new AuctionError('MARKET_INSUFFICIENT_FUNDS');
        }
        throw e;
      }

      // Refund previous high bid into claim box.
      if (a.currentBid && a.currentBidderId) {
        await this.claimBox.deposit({
          characterId: a.currentBidderId,
          source: 'AUCTION_REFUND',
          sourceRefId: a.id,
          currency: kind as 'LINH_THACH' | 'TIEN_NGOC_KHOA' | 'EVENT_TOKEN' | 'CONG_HIEN_TONG_MON',
          amount: a.currentBid,
          metadata: { reason: 'OUTBID' },
        });
      }

      const bid = await tx.marketBid.create({
        data: {
          auctionId: a.id,
          bidderCharacterId: input.bidderCharacterId,
          bidAmount: input.bidAmount,
          currency: a.currency,
          status: 'ACTIVE',
          wasBuyout: isBuyout,
        },
      });

      // Mark previous bids as OUTBID.
      await tx.marketBid.updateMany({
        where: { auctionId: a.id, id: { not: bid.id }, status: 'ACTIVE' },
        data: { status: 'OUTBID', refundedAt: now },
      });

      // Update auction snapshot.
      await tx.marketAuction.update({
        where: { id: a.id },
        data: {
          currentBid: input.bidAmount,
          currentBidderId: input.bidderCharacterId,
          ...(isBuyout ? { status: 'FINALIZED', finalizedAt: now } : {}),
        },
      });

      // Buyout → trigger finalize inline.
      if (isBuyout) {
        await this.finalizeInner(tx, a.id);
      }

      // Anomaly: large value transfer.
      if (input.bidAmount > 10_000_000n) {
        await this.logAnomaly(tx, {
          type: 'LARGE_VALUE_TRANSFER',
          buyerCharacterId: input.bidderCharacterId,
          sellerCharacterId: a.sellerCharacterId,
          auctionId: a.id,
          totalValue: input.bidAmount,
          detail: { currency: a.currency, wasBuyout: isBuyout },
        });
      }

      return bid;
    });
  }

  async cancelBySeller(auctionId: string, sellerCharacterId: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.marketAuction.findUnique({ where: { id: auctionId } });
      if (!a) throw new AuctionError('AUCTION_NOT_FOUND');
      if (a.sellerCharacterId !== sellerCharacterId) {
        throw new AuctionError('AUCTION_NOT_OWNER');
      }
      if (a.status !== 'ACTIVE') {
        throw new AuctionError('MARKET_AUCTION_NOT_ACTIVE');
      }
      if (a.currentBid && a.currentBid > 0n) {
        throw new AuctionError('AUCTION_HAS_BID');
      }
      const flip = await tx.marketAuction.updateMany({
        where: { id: a.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', finalizedAt: new Date() },
      });
      if (flip.count === 0) throw new AuctionError('MARKET_AUCTION_NOT_ACTIVE');

      // Return item to seller claim box.
      await this.claimBox.deposit({
        characterId: a.sellerCharacterId,
        source: 'AUCTION_REFUND',
        sourceRefId: a.id,
        itemKey: a.itemKey,
        itemQty: a.quantity,
        metadata: { reason: 'AUCTION_CANCELLED_BY_SELLER' },
      });

      // Anomaly: excessive cancel-relist (≥5 cancels in 24h).
      const recentCancels = await tx.marketAuction.count({
        where: {
          sellerCharacterId: a.sellerCharacterId,
          status: 'CANCELLED',
          finalizedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (recentCancels >= 5) {
        await this.logAnomaly(tx, {
          type: 'EXCESSIVE_CANCEL_RELIST',
          sellerCharacterId: a.sellerCharacterId,
          auctionId: a.id,
          detail: { recentCancels, window: '24h' },
        });
      }

      return { ok: true as const };
    });
  }

  /**
   * Finalize cron: scan auction ACTIVE & endsAt < now → finalize.
   * Public API; idempotent per auction.
   */
  async finalizeExpired(now = new Date()) {
    const due = await this.prisma.marketAuction.findMany({
      where: { status: 'ACTIVE', endsAt: { lte: now } },
      take: 100,
    });
    let finalized = 0;
    for (const a of due) {
      try {
        await this.prisma.$transaction((tx) => this.finalizeInner(tx, a.id));
        finalized++;
      } catch (e) {
        this.logger.error(`finalize auction ${a.id} failed`, e);
      }
    }
    return { finalized, candidates: due.length };
  }

  /**
   * Fire-and-forget anomaly log. Errors are swallowed to never block the
   * main transaction path.
   */
  private async logAnomaly(
    tx: Prisma.TransactionClient,
    params: {
      type: MarketAnomalyType;
      sellerCharacterId?: string;
      buyerCharacterId?: string;
      auctionId?: string;
      totalValue?: bigint;
      detail?: Record<string, unknown>;
    },
  ) {
    const severity = classifyMarketAnomaly({
      type: params.type,
      totalValue: params.totalValue ? Number(params.totalValue) : undefined,
    });
    try {
      await tx.marketAnomaly.create({
        data: {
          anomalyType: params.type,
          severity,
          sellerCharacterId: params.sellerCharacterId ?? null,
          buyerCharacterId: params.buyerCharacterId ?? null,
          auctionId: params.auctionId ?? null,
          totalValue: params.totalValue ?? null,
          detailJson: (params.detail ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Anomaly logging must never break the auction flow.
    }
  }

  private async finalizeInner(tx: Prisma.TransactionClient, auctionId: string) {
    const a = await tx.marketAuction.findUnique({ where: { id: auctionId } });
    if (!a) return;
    if (a.status !== 'ACTIVE' && a.status !== 'FINALIZED') return;

    // No bid → return item to seller.
    if (!a.currentBid || !a.currentBidderId) {
      await tx.marketAuction.updateMany({
        where: { id: a.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', finalizedAt: new Date() },
      });
      await this.claimBox.deposit({
        characterId: a.sellerCharacterId,
        source: 'LISTING_EXPIRED',
        sourceRefId: a.id,
        itemKey: a.itemKey,
        itemQty: a.quantity,
        metadata: { reason: 'AUCTION_NO_BID' },
      });
      return;
    }

    // Has winner → item → winner; payout → seller (minus tax).
    const taxPct = 0.05;
    const tax = (a.currentBid * 5n) / 100n;
    const sellerGain = a.currentBid - tax;

    if (a.status === 'ACTIVE') {
      await tx.marketAuction.updateMany({
        where: { id: a.id, status: 'ACTIVE' },
        data: {
          status: 'FINALIZED',
          finalizedAt: new Date(),
          taxAmount: tax,
        },
      });
    } else {
      // Already FINALIZED from buyout → set tax.
      await tx.marketAuction.update({
        where: { id: a.id },
        data: { taxAmount: tax },
      });
    }

    await this.claimBox.deposit({
      characterId: a.currentBidderId,
      source: 'AUCTION_WON',
      sourceRefId: a.id,
      itemKey: a.itemKey,
      itemQty: a.quantity,
      metadata: {
        winningBid: a.currentBid.toString(),
        currency: a.currency,
        tax: tax.toString(),
        taxPct,
      },
    });
    await this.claimBox.deposit({
      characterId: a.sellerCharacterId,
      source: 'AUCTION_SELLER_PAYOUT',
      sourceRefId: a.id,
      currency: (a.currency === 'SECT_CONTRIBUTION'
        ? 'CONG_HIEN_TONG_MON'
        : (a.currency as 'LINH_THACH' | 'TIEN_NGOC_KHOA' | 'EVENT_TOKEN')),
      amount: sellerGain,
      metadata: {
        gross: a.currentBid.toString(),
        tax: tax.toString(),
        net: sellerGain.toString(),
      },
    });

    // Winning bid → SETTLED.
    await tx.marketBid.updateMany({
      where: { auctionId: a.id, bidderCharacterId: a.currentBidderId, status: 'ACTIVE' },
      data: { status: 'SETTLED' },
    });

    // Anomaly: rapid resale (≥10 sales by same seller in 24h).
    const recentSales = await tx.marketAuction.count({
      where: {
        sellerCharacterId: a.sellerCharacterId,
        status: 'FINALIZED',
        finalizedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (recentSales >= 10) {
      await this.logAnomaly(tx, {
        type: 'RAPID_RESALE',
        sellerCharacterId: a.sellerCharacterId,
        buyerCharacterId: a.currentBidderId,
        auctionId: a.id,
        totalValue: a.currentBid,
        detail: { recentSales, window: '24h' },
      });
    }
  }
}
