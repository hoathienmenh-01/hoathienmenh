import { Injectable, Logger } from '@nestjs/common';
import { ListingStatus } from '@prisma/client';
import {
  buildMarketAbuseWindowKey,
  classifyListingPriceBand,
  classifyMarketTradeAbuseCount,
  classifyMarketTradeAbuseVolume,
  coerceMarketAbuseSource,
  estimateItemReferencePrice,
  MARKET_LISTING_SPAM_1H_CRITICAL,
  MARKET_LISTING_SPAM_1H_WARN,
  MARKET_REPEATED_PAIR_24H_CRITICAL,
  MARKET_REPEATED_PAIR_24H_WARN,
  type MarketAbuseSeverity,
  type MarketAbuseSource,
  type MarketAbuseType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 16.4 — Market Trade Abuse Hardening.
 *
 * Detection-only service: rà soát listing/trade trong cửa sổ thời
 * gian, phát hiện pattern abuse (price deviation, repeated pair,
 * listing spam, volume spike, unknown reference price) và CREATE
 * rows `MarketTradeAnomaly` để admin xem panel.
 *
 * Khác `EconomyAnomalyScannerService` (Phase 16.6 — economy aggregate)
 * và `GameplayAntiCheatService` (Phase 16.3 — farm pattern):
 *   - Service này tập trung **market trade behaviour**.
 *   - Idempotency qua `MarketTradeAnomaly @@unique([type, listingId,
 *     windowKey])`. Cho rule per-character per-window, listingId='' +
 *     windowKey scope hash.
 *
 * **Detection-first, guard-light**:
 *   - KHÔNG auto-ban / KHÔNG auto-rollback / KHÔNG tự trừ currency /
 *     item / KHÔNG khóa tài khoản.
 *   - Hook detection (`recordListingCreate` / `recordListingBuy`) chạy
 *     POST-mutation — nếu detection throw, KHÔNG ảnh hưởng listing/
 *     trade. MarketService wrap hook trong try/catch.
 *
 * Fail-soft: từng rule scan trong `try/catch` riêng — 1 rule throw
 * KHÔNG lật ngược các rule khác.
 */

export interface MarketScanOptions {
  /** Override `now` cho test reproducible. */
  now?: Date;
  /**
   * Override `windowKey` chung (rare; admin debug). Default = scanner
   * tự derive từ `buildMarketAbuseWindowKey` cho từng rule.
   */
  windowKey?: string;
  /**
   * Override `windowMs` (test). Default = derive từ rule (1h / 24h
   * / 7d).
   */
  windowMs?: number;
}

export interface MarketRuleScanResult {
  type: MarketAbuseType;
  created: number;
  skipped: number;
  errored: boolean;
  errorMessage: string | null;
}

export interface MarketScanSummary {
  windowKeysByType: Record<MarketAbuseType, string>;
  totalCreated: number;
  totalSkipped: number;
  totalErrored: number;
  rules: MarketRuleScanResult[];
  scannedAt: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const RULE_WINDOW_MS: Record<MarketAbuseType, number> = {
  PRICE_EXTREME_LOW: ONE_HOUR_MS,
  PRICE_EXTREME_HIGH: ONE_HOUR_MS,
  REPEATED_BUYER_SELLER_PAIR: ONE_DAY_MS,
  LISTING_SPAM: ONE_HOUR_MS,
  MARKET_VOLUME_SPIKE: ONE_DAY_MS,
  UNKNOWN_REFERENCE_PRICE: ONE_DAY_MS,
};

const RULE_WINDOW_SPAN: Record<MarketAbuseType, '1h' | '24h' | '7d'> = {
  PRICE_EXTREME_LOW: '1h',
  PRICE_EXTREME_HIGH: '1h',
  REPEATED_BUYER_SELLER_PAIR: '24h',
  LISTING_SPAM: '1h',
  MARKET_VOLUME_SPIKE: '24h',
  UNKNOWN_REFERENCE_PRICE: '24h',
};

const ALL_TYPES: MarketAbuseType[] = [
  'PRICE_EXTREME_LOW',
  'PRICE_EXTREME_HIGH',
  'REPEATED_BUYER_SELLER_PAIR',
  'LISTING_SPAM',
  'MARKET_VOLUME_SPIKE',
  'UNKNOWN_REFERENCE_PRICE',
];

@Injectable()
export class MarketTradeAbuseService {
  private readonly logger = new Logger(MarketTradeAbuseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 1 lượt scan đầy đủ cho mọi rule. Fail-soft per-rule.
   */
  async scanAll(options: MarketScanOptions = {}): Promise<MarketScanSummary> {
    const now = options.now ?? new Date();
    const rules: MarketRuleScanResult[] = [];
    const windowKeysByType = {} as Record<MarketAbuseType, string>;

    for (const type of ALL_TYPES) {
      const windowMs = options.windowMs ?? RULE_WINDOW_MS[type];
      const windowKey =
        options.windowKey ??
        buildMarketAbuseWindowKey(RULE_WINDOW_SPAN[type], now);
      windowKeysByType[type] = windowKey;

      try {
        const r = await this.scanRule({ type, now, windowMs, windowKey });
        rules.push({
          type,
          created: r.created,
          skipped: r.skipped,
          errored: false,
          errorMessage: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`scan market rule ${type} failed: ${msg}`);
        rules.push({
          type,
          created: 0,
          skipped: 0,
          errored: true,
          errorMessage: msg.slice(0, 500),
        });
      }
    }

    const totalCreated = rules.reduce((a, r) => a + r.created, 0);
    const totalSkipped = rules.reduce((a, r) => a + r.skipped, 0);
    const totalErrored = rules.reduce((a, r) => a + (r.errored ? 1 : 0), 0);

    return {
      windowKeysByType,
      totalCreated,
      totalSkipped,
      totalErrored,
      rules,
      scannedAt: now.toISOString(),
    };
  }

  /** Public for deterministic test. */
  async scanRule(args: {
    type: MarketAbuseType;
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    switch (args.type) {
      case 'PRICE_EXTREME_LOW':
        return this.scanPriceExtreme(args, 'LOW');
      case 'PRICE_EXTREME_HIGH':
        return this.scanPriceExtreme(args, 'HIGH');
      case 'REPEATED_BUYER_SELLER_PAIR':
        return this.scanRepeatedPair(args);
      case 'LISTING_SPAM':
        return this.scanListingSpam(args);
      case 'MARKET_VOLUME_SPIKE':
        return this.scanVolumeSpike(args);
      case 'UNKNOWN_REFERENCE_PRICE':
        return this.scanUnknownReference(args);
      default: {
        const _exhaustive: never = args.type;
        return _exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rule implementations
  // -------------------------------------------------------------------------

  /**
   * Price extreme low/high — scan listing tạo trong window. Phase 16.6
   * band reject đã filter listing tuyệt đối ngoài band; ở đây chỉ flag
   * listing **trong band** nhưng vẫn lệch xa median rarity.
   */
  private async scanPriceExtreme(
    args: { now: Date; windowMs: number; windowKey: string },
    direction: 'LOW' | 'HIGH',
  ): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const listings = await this.prisma.listing.findMany({
      where: { createdAt: { gte: cutoff } },
      take: 5_000,
    });

    const targetType: MarketAbuseType =
      direction === 'LOW' ? 'PRICE_EXTREME_LOW' : 'PRICE_EXTREME_HIGH';

    let created = 0;
    let skipped = 0;
    for (const l of listings) {
      const classify = classifyListingPriceBand({
        itemKey: l.itemKey,
        unitPrice: l.pricePerUnit,
      });
      if (classify.type !== targetType) continue;
      const wrote = await this.upsertAnomaly({
        type: targetType,
        source: 'SCAN_BATCH',
        severity: classify.severity,
        listingId: l.id,
        sellerCharacterId: l.sellerId,
        buyerCharacterId: l.buyerId,
        itemKey: l.itemKey,
        quantity: l.qty,
        unitPrice: l.pricePerUnit,
        referencePrice: classify.referencePrice,
        deviationRatio: classify.deviationRatio,
        windowKey: args.windowKey,
        details: {
          listingStatus: l.status,
          createdAt: l.createdAt.toISOString(),
          windowMs: args.windowMs,
          direction,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Repeated buyer/seller pair — group `Listing` SOLD trong 24h theo
   * (sellerId, buyerId) đếm số trade. ≥ warn → tạo anomaly.
   */
  private async scanRepeatedPair(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.listing.groupBy({
      by: ['sellerId', 'buyerId'],
      where: {
        status: ListingStatus.SOLD,
        soldAt: { gte: cutoff },
        buyerId: { not: null },
      },
      _count: { _all: true },
      _sum: { pricePerUnit: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      if (!g.buyerId) continue;
      const result = classifyMarketTradeAbuseCount({
        count: g._count._all,
        warnThreshold: MARKET_REPEATED_PAIR_24H_WARN,
        criticalThreshold: MARKET_REPEATED_PAIR_24H_CRITICAL,
      });
      if (!result.hit) continue;
      // windowKey scope hash per pair để dedupe trong cùng window.
      const scopedKey = `${args.windowKey}#${g.sellerId}>${g.buyerId}`;
      const wrote = await this.upsertAnomaly({
        type: 'REPEATED_BUYER_SELLER_PAIR',
        source: 'SCAN_BATCH',
        severity: result.severity,
        listingId: '',
        sellerCharacterId: g.sellerId,
        buyerCharacterId: g.buyerId,
        itemKey: null,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          tradeCount: g._count._all,
          warnThreshold: result.threshold.warn,
          criticalThreshold: result.threshold.critical,
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Listing spam — count listing 1h theo sellerId. ≥ warn → tạo
   * anomaly.
   */
  private async scanListingSpam(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.listing.groupBy({
      by: ['sellerId'],
      where: { createdAt: { gte: cutoff } },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const result = classifyMarketTradeAbuseCount({
        count: g._count._all,
        warnThreshold: MARKET_LISTING_SPAM_1H_WARN,
        criticalThreshold: MARKET_LISTING_SPAM_1H_CRITICAL,
      });
      if (!result.hit) continue;
      const scopedKey = `${args.windowKey}#${g.sellerId}`;
      const wrote = await this.upsertAnomaly({
        type: 'LISTING_SPAM',
        source: 'SCAN_BATCH',
        severity: result.severity,
        listingId: '',
        sellerCharacterId: g.sellerId,
        buyerCharacterId: null,
        itemKey: null,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          listingCount: g._count._all,
          warnThreshold: result.threshold.warn,
          criticalThreshold: result.threshold.critical,
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Volume spike — Σ (pricePerUnit × qty) trades SOLD 24h, group theo
   * sellerId VÀ buyerId riêng (2 chiều dòng tiền). Trade SOLD đếm cả
   * 2 phía.
   */
  private async scanVolumeSpike(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const sold = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.SOLD,
        soldAt: { gte: cutoff },
        buyerId: { not: null },
      },
      select: {
        sellerId: true,
        buyerId: true,
        pricePerUnit: true,
        qty: true,
      },
      take: 50_000,
    });

    const totalBySeller = new Map<string, bigint>();
    const totalByBuyer = new Map<string, bigint>();
    for (const s of sold) {
      const value = s.pricePerUnit * BigInt(s.qty);
      totalBySeller.set(
        s.sellerId,
        (totalBySeller.get(s.sellerId) ?? 0n) + value,
      );
      if (s.buyerId) {
        totalByBuyer.set(
          s.buyerId,
          (totalByBuyer.get(s.buyerId) ?? 0n) + value,
        );
      }
    }

    let created = 0;
    let skipped = 0;
    for (const [charId, total] of totalBySeller.entries()) {
      const result = classifyMarketTradeAbuseVolume({ totalValue: total });
      if (!result.hit) continue;
      const scopedKey = `${args.windowKey}#seller:${charId}`;
      const wrote = await this.upsertAnomaly({
        type: 'MARKET_VOLUME_SPIKE',
        source: 'SCAN_BATCH',
        severity: result.severity,
        listingId: '',
        sellerCharacterId: charId,
        buyerCharacterId: null,
        itemKey: null,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          totalValueLT: total.toString(),
          side: 'SELLER',
          warnThreshold: result.threshold.warn.toString(),
          criticalThreshold: result.threshold.critical.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    for (const [charId, total] of totalByBuyer.entries()) {
      const result = classifyMarketTradeAbuseVolume({ totalValue: total });
      if (!result.hit) continue;
      const scopedKey = `${args.windowKey}#buyer:${charId}`;
      const wrote = await this.upsertAnomaly({
        type: 'MARKET_VOLUME_SPIKE',
        source: 'SCAN_BATCH',
        severity: result.severity,
        listingId: '',
        sellerCharacterId: null,
        buyerCharacterId: charId,
        itemKey: null,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          totalValueLT: total.toString(),
          side: 'BUYER',
          warnThreshold: result.threshold.warn.toString(),
          criticalThreshold: result.threshold.critical.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Unknown reference price — list các itemKey trong window mà
   * `estimateItemReferencePrice` trả null. Tổng hợp 1 anomaly INFO
   * per itemKey trong window.
   */
  private async scanUnknownReference(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.listing.groupBy({
      by: ['itemKey'],
      where: { createdAt: { gte: cutoff } },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const ref = estimateItemReferencePrice(g.itemKey);
      if (ref !== null) continue;
      const scopedKey = `${args.windowKey}#${g.itemKey}`;
      const wrote = await this.upsertAnomaly({
        type: 'UNKNOWN_REFERENCE_PRICE',
        source: 'SCAN_BATCH',
        severity: 'INFO',
        listingId: '',
        sellerCharacterId: null,
        buyerCharacterId: null,
        itemKey: g.itemKey,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          listingCount: g._count._all,
          windowMs: args.windowMs,
          note: 'Item không có ItemDef hợp lệ — admin review.',
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  // -------------------------------------------------------------------------
  // Hook: post-mutation (called from MarketService)
  // -------------------------------------------------------------------------

  /**
   * Hook gọi từ `MarketService.create` SAU khi listing đã commit
   * thành công. Flag price extreme deviation ngay tại thời điểm
   * post (real-time) thay vì đợi scan batch.
   *
   * KHÔNG throw — lỗi ở đây không được phá flow market. Caller wrap
   * try/catch.
   */
  async recordListingCreate(args: {
    listingId: string;
    sellerId: string;
    itemKey: string;
    qty: number;
    pricePerUnit: bigint;
    now?: Date;
  }): Promise<void> {
    const now = args.now ?? new Date();
    const windowKey = buildMarketAbuseWindowKey('1h', now);
    const classify = classifyListingPriceBand({
      itemKey: args.itemKey,
      unitPrice: args.pricePerUnit,
    });
    if (classify.type === 'NORMAL') return;

    // UNKNOWN_REFERENCE_PRICE handled by scan; ignore here to avoid
    // duplicate noise per listing.
    if (classify.type === 'UNKNOWN_REFERENCE_PRICE') return;

    await this.upsertAnomaly({
      type: classify.type,
      source: 'LISTING_CREATE',
      severity: classify.severity,
      listingId: args.listingId,
      sellerCharacterId: args.sellerId,
      buyerCharacterId: null,
      itemKey: args.itemKey,
      quantity: args.qty,
      unitPrice: args.pricePerUnit,
      referencePrice: classify.referencePrice,
      deviationRatio: classify.deviationRatio,
      windowKey,
      details: {
        hook: 'recordListingCreate',
        listingStage: 'POST',
      },
    });
  }

  /**
   * Hook gọi từ `MarketService.buy` SAU khi trade commit thành công.
   * Flag pair (seller, buyer) nếu 24h gần nhất họ đã trade nhiều lần
   * + flag price extreme nếu unit price lệch xa reference.
   *
   * KHÔNG throw — lỗi ở đây không được phá flow market.
   */
  async recordListingBuy(args: {
    listingId: string;
    sellerId: string;
    buyerId: string;
    itemKey: string;
    qty: number;
    pricePerUnit: bigint;
    now?: Date;
  }): Promise<void> {
    const now = args.now ?? new Date();
    const windowKey1h = buildMarketAbuseWindowKey('1h', now);
    const windowKey24h = buildMarketAbuseWindowKey('24h', now);

    // 1. Price extreme (per listing).
    const classify = classifyListingPriceBand({
      itemKey: args.itemKey,
      unitPrice: args.pricePerUnit,
    });
    if (
      classify.type === 'PRICE_EXTREME_LOW' ||
      classify.type === 'PRICE_EXTREME_HIGH'
    ) {
      await this.upsertAnomaly({
        type: classify.type,
        source: 'LISTING_BUY',
        severity: classify.severity,
        listingId: args.listingId,
        sellerCharacterId: args.sellerId,
        buyerCharacterId: args.buyerId,
        itemKey: args.itemKey,
        quantity: args.qty,
        unitPrice: args.pricePerUnit,
        referencePrice: classify.referencePrice,
        deviationRatio: classify.deviationRatio,
        windowKey: windowKey1h,
        details: {
          hook: 'recordListingBuy',
          listingStage: 'POST',
        },
      });
    }

    // 2. Repeated pair — count SOLD listing 24h cho cặp này (kể cả
    // trade hiện tại). Đếm Listing thay vì CurrencyLedger để align
    // với scanner.
    const cutoff = new Date(now.getTime() - ONE_DAY_MS);
    const pairCount = await this.prisma.listing.count({
      where: {
        status: ListingStatus.SOLD,
        sellerId: args.sellerId,
        buyerId: args.buyerId,
        soldAt: { gte: cutoff },
      },
    });
    const pairResult = classifyMarketTradeAbuseCount({
      count: pairCount,
      warnThreshold: MARKET_REPEATED_PAIR_24H_WARN,
      criticalThreshold: MARKET_REPEATED_PAIR_24H_CRITICAL,
    });
    if (pairResult.hit) {
      const scopedKey = `${windowKey24h}#${args.sellerId}>${args.buyerId}`;
      await this.upsertAnomaly({
        type: 'REPEATED_BUYER_SELLER_PAIR',
        source: 'LISTING_BUY',
        severity: pairResult.severity,
        listingId: '',
        sellerCharacterId: args.sellerId,
        buyerCharacterId: args.buyerId,
        itemKey: null,
        quantity: null,
        unitPrice: null,
        referencePrice: null,
        deviationRatio: null,
        windowKey: scopedKey,
        details: {
          hook: 'recordListingBuy',
          tradeCount: pairCount,
          warnThreshold: pairResult.threshold.warn,
          criticalThreshold: pairResult.threshold.critical,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Admin API helpers
  // -------------------------------------------------------------------------

  async summary(): Promise<{
    openCount: number;
    openCriticalCount: number;
    openWarnCount: number;
    openInfoCount: number;
    totalCount: number;
    latestCreatedAt: string | null;
    latestResolvedAt: string | null;
  }> {
    const [openCritical, openWarn, openInfo, total, latest, latestRes] =
      await Promise.all([
        this.prisma.marketTradeAnomaly.count({
          where: { status: 'OPEN', severity: 'CRITICAL' },
        }),
        this.prisma.marketTradeAnomaly.count({
          where: { status: 'OPEN', severity: 'WARN' },
        }),
        this.prisma.marketTradeAnomaly.count({
          where: { status: 'OPEN', severity: 'INFO' },
        }),
        this.prisma.marketTradeAnomaly.count(),
        this.prisma.marketTradeAnomaly.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.marketTradeAnomaly.findFirst({
          where: { resolvedAt: { not: null } },
          orderBy: { resolvedAt: 'desc' },
          select: { resolvedAt: true },
        }),
      ]);

    return {
      openCount: openCritical + openWarn + openInfo,
      openCriticalCount: openCritical,
      openWarnCount: openWarn,
      openInfoCount: openInfo,
      totalCount: total,
      latestCreatedAt: latest?.createdAt?.toISOString() ?? null,
      latestResolvedAt: latestRes?.resolvedAt?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /**
   * Try create row — duplicate (cùng `(type, listingId, windowKey)`)
   * raise P2002 unique violation → return `false` thay vì throw.
   * Caller increment `skipped`.
   *
   * **KHÔNG** throw — exception phía duy nhất được catch là DB error
   * runtime (logger warn). Schema validation đã pass ở caller.
   */
  private async upsertAnomaly(args: {
    type: MarketAbuseType;
    source: MarketAbuseSource | string;
    severity: MarketAbuseSeverity;
    listingId: string;
    sellerCharacterId: string | null;
    buyerCharacterId: string | null;
    itemKey: string | null;
    quantity: number | null;
    unitPrice: bigint | null;
    referencePrice: bigint | null;
    deviationRatio: number | null;
    windowKey: string;
    details: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.prisma.marketTradeAnomaly.create({
        data: {
          type: args.type,
          source: coerceMarketAbuseSource(args.source),
          severity: args.severity,
          status: 'OPEN',
          listingId: args.listingId,
          sellerCharacterId: args.sellerCharacterId,
          buyerCharacterId: args.buyerCharacterId,
          itemKey: args.itemKey,
          quantity: args.quantity,
          unitPrice: args.unitPrice,
          referencePrice: args.referencePrice,
          deviationRatio: args.deviationRatio,
          windowKey: args.windowKey,
          detailsJson: args.details as never,
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}
