/**
 * Phase 16.4 — Integration test cho MarketTradeAbuseService.
 *
 * Bao phủ:
 *   - clean state → 0 anomaly created (no listing / no trade).
 *   - listing normal price → KHÔNG tạo anomaly.
 *   - listing underpriced WARN/CRITICAL → PRICE_EXTREME_LOW.
 *   - listing overpriced WARN/CRITICAL → PRICE_EXTREME_HIGH.
 *   - repeated buyer/seller pair 24h → REPEATED_BUYER_SELLER_PAIR.
 *   - listing spam 1h → LISTING_SPAM.
 *   - volume spike 24h (seller side) → MARKET_VOLUME_SPIKE.
 *   - unknown reference price → UNKNOWN_REFERENCE_PRICE.
 *   - idempotent: scan lần 2 cùng window KHÔNG double anomaly.
 *   - detection-only: completed trade (SOLD) KHÔNG bị rollback —
 *     listing data vẫn nguyên, Inventory/Character/CurrencyLedger
 *     không bị scanner mutate.
 *   - hook recordListingCreate post-mutation flag underpriced.
 *   - hook recordListingBuy post-mutation flag repeated pair.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ListingStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { MarketTradeAbuseService } from './market-trade-abuse.service';

let prisma: PrismaService;
let svc: MarketTradeAbuseService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new MarketTradeAbuseService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date('2026-08-01T12:00:00.000Z');

// tien_huyen_kiem TIEN-rarity band [1_000, 500_000] → ref ~ 22_360 LT.
const REF_ITEM = 'tien_huyen_kiem';
const REF_ITEM_KIND = 'WEAPON';

async function createListing(
  prisma: PrismaService,
  args: {
    sellerId: string;
    itemKey?: string;
    itemKind?: string;
    qty?: number;
    pricePerUnit?: bigint;
    status?: ListingStatus;
    buyerId?: string | null;
    createdAt?: Date;
    soldAt?: Date | null;
  },
): Promise<string> {
  const row = await prisma.listing.create({
    data: {
      sellerId: args.sellerId,
      itemKey: args.itemKey ?? REF_ITEM,
      itemKind: args.itemKind ?? REF_ITEM_KIND,
      qty: args.qty ?? 1,
      pricePerUnit: args.pricePerUnit ?? 22_000n,
      status: args.status ?? ListingStatus.ACTIVE,
      buyerId: args.buyerId ?? null,
      createdAt: args.createdAt ?? new Date(NOW.getTime() - 10 * 60 * 1000),
      soldAt: args.soldAt ?? null,
    },
  });
  return row.id;
}

describe('MarketTradeAbuseService.scanAll — empty state', () => {
  it('clean DB → 0 anomalies', async () => {
    const r = await svc.scanAll({ now: NOW });
    expect(r.totalCreated).toBe(0);
    expect(r.totalSkipped).toBe(0);
    expect(r.totalErrored).toBe(0);
    expect(r.rules.length).toBe(6);
    for (const rule of r.rules) {
      expect(rule.created).toBe(0);
      expect(rule.errored).toBe(false);
    }
    const all = await prisma.marketTradeAnomaly.count();
    expect(all).toBe(0);
  });
});

describe('MarketTradeAbuseService — PRICE_EXTREME', () => {
  it('normal listing KHÔNG tạo anomaly', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 22_000n,
    });
    const r = await svc.scanAll({ now: NOW });
    const anomalies = await prisma.marketTradeAnomaly.findMany();
    const price = anomalies.filter(
      (a) =>
        a.type === 'PRICE_EXTREME_LOW' || a.type === 'PRICE_EXTREME_HIGH',
    );
    expect(price.length).toBe(0);
    expect(r.totalErrored).toBe(0);
  });

  it('underpriced WARN → PRICE_EXTREME_LOW WARN', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 3_000n, // ratio ~ 0.134 → WARN low
    });
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'PRICE_EXTREME_LOW' },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('WARN');
    expect(a?.status).toBe('OPEN');
    expect(a?.deviationRatio).not.toBeNull();
    expect(a?.deviationRatio).toBeLessThanOrEqual(0.2);
  });

  it('underpriced CRITICAL → PRICE_EXTREME_LOW CRITICAL', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 1_000n, // ratio ~ 0.0447 → CRITICAL low
    });
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'PRICE_EXTREME_LOW' },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('CRITICAL');
  });

  it('overpriced WARN → PRICE_EXTREME_HIGH WARN', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 200_000n, // ratio ~ 8.94 → WARN high
    });
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'PRICE_EXTREME_HIGH' },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('WARN');
  });

  it('overpriced CRITICAL → PRICE_EXTREME_HIGH CRITICAL', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 500_000n, // ratio ~ 22.4 → CRITICAL high
    });
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'PRICE_EXTREME_HIGH' },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('CRITICAL');
  });
});

describe('MarketTradeAbuseService — REPEATED_BUYER_SELLER_PAIR', () => {
  it('seller-buyer trade ≥ 3 lần 24h → WARN', async () => {
    const seller = await makeUserChar(prisma);
    const buyer = await makeUserChar(prisma);
    const soldAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    for (let i = 0; i < 4; i += 1) {
      await createListing(prisma, {
        sellerId: seller.characterId,
        buyerId: buyer.characterId,
        status: ListingStatus.SOLD,
        soldAt,
        pricePerUnit: 22_000n,
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: {
        type: 'REPEATED_BUYER_SELLER_PAIR',
        sellerCharacterId: seller.characterId,
        buyerCharacterId: buyer.characterId,
      },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('WARN');
  });
});

describe('MarketTradeAbuseService — LISTING_SPAM', () => {
  it('seller post ≥ 30 listing 1h → WARN', async () => {
    const seller = await makeUserChar(prisma);
    const createdAt = new Date(NOW.getTime() - 30 * 60 * 1000);
    for (let i = 0; i < 32; i += 1) {
      await createListing(prisma, {
        sellerId: seller.characterId,
        pricePerUnit: 22_000n,
        createdAt,
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'LISTING_SPAM', sellerCharacterId: seller.characterId },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('WARN');
  });
});

describe('MarketTradeAbuseService — MARKET_VOLUME_SPIKE', () => {
  it('seller Σ value 24h ≥ 500k LT → WARN', async () => {
    const seller = await makeUserChar(prisma);
    const buyer = await makeUserChar(prisma);
    const soldAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    // 25 trade × 25k = 625k LT > 500k WARN.
    for (let i = 0; i < 25; i += 1) {
      await createListing(prisma, {
        sellerId: seller.characterId,
        buyerId: buyer.characterId,
        status: ListingStatus.SOLD,
        soldAt,
        pricePerUnit: 25_000n,
        qty: 1,
      });
    }
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: {
        type: 'MARKET_VOLUME_SPIKE',
        sellerCharacterId: seller.characterId,
      },
    });
    expect(a).not.toBeNull();
    expect(['WARN', 'CRITICAL']).toContain(a?.severity);
  });
});

describe('MarketTradeAbuseService — UNKNOWN_REFERENCE_PRICE', () => {
  it('listing item không có ItemDef → INFO', async () => {
    const seller = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: seller.characterId,
      itemKey: 'phantom_item_unknown_xyz',
      itemKind: 'MISC',
      pricePerUnit: 100n,
    });
    await svc.scanAll({ now: NOW });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { type: 'UNKNOWN_REFERENCE_PRICE' },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('INFO');
    expect(a?.itemKey).toBe('phantom_item_unknown_xyz');
  });
});

describe('MarketTradeAbuseService — idempotency', () => {
  it('scan 2 lần cùng window KHÔNG double anomaly', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 1_000n,
    });

    await svc.scanAll({ now: NOW });
    const count1 = await prisma.marketTradeAnomaly.count();
    expect(count1).toBe(1);

    const r2 = await svc.scanAll({ now: NOW });
    const count2 = await prisma.marketTradeAnomaly.count();
    expect(count2).toBe(1); // not 2
    expect(r2.totalSkipped).toBeGreaterThanOrEqual(1);
  });
});

describe('MarketTradeAbuseService — detection-only invariants', () => {
  it('scan KHÔNG mutate Listing rows', async () => {
    const seller = await makeUserChar(prisma);
    const buyer = await makeUserChar(prisma);
    const before = await prisma.listing.create({
      data: {
        sellerId: seller.characterId,
        itemKey: REF_ITEM,
        itemKind: REF_ITEM_KIND,
        qty: 1,
        pricePerUnit: 1_000n,
        status: ListingStatus.SOLD,
        buyerId: buyer.characterId,
        soldAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
    });
    await svc.scanAll({ now: NOW });
    const after = await prisma.listing.findUnique({ where: { id: before.id } });
    expect(after?.status).toBe(ListingStatus.SOLD);
    expect(after?.pricePerUnit).toBe(1_000n);
    expect(after?.qty).toBe(1);
    expect(after?.buyerId).toBe(buyer.characterId);
    expect(after?.soldAt?.getTime()).toBe(before.soldAt?.getTime());
  });

  it('scan KHÔNG ghi CurrencyLedger / ItemLedger', async () => {
    const f = await makeUserChar(prisma);
    await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 1_000n,
    });
    const beforeCurrency = await prisma.currencyLedger.count();
    const beforeItem = await prisma.itemLedger.count();
    await svc.scanAll({ now: NOW });
    const afterCurrency = await prisma.currencyLedger.count();
    const afterItem = await prisma.itemLedger.count();
    expect(afterCurrency).toBe(beforeCurrency);
    expect(afterItem).toBe(beforeItem);
  });
});

describe('MarketTradeAbuseService — hooks (real-time)', () => {
  it('recordListingCreate flag PRICE_EXTREME_LOW underpriced', async () => {
    const f = await makeUserChar(prisma);
    const listingId = await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 1_000n,
    });
    await svc.recordListingCreate({
      listingId,
      sellerId: f.characterId,
      itemKey: REF_ITEM,
      qty: 1,
      pricePerUnit: 1_000n,
      now: NOW,
    });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: {
        type: 'PRICE_EXTREME_LOW',
        listingId,
        source: 'LISTING_CREATE',
      },
    });
    expect(a).not.toBeNull();
    expect(a?.severity).toBe('CRITICAL');
  });

  it('recordListingCreate normal price KHÔNG tạo anomaly', async () => {
    const f = await makeUserChar(prisma);
    const listingId = await createListing(prisma, {
      sellerId: f.characterId,
      pricePerUnit: 22_000n,
    });
    await svc.recordListingCreate({
      listingId,
      sellerId: f.characterId,
      itemKey: REF_ITEM,
      qty: 1,
      pricePerUnit: 22_000n,
      now: NOW,
    });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: { listingId, source: 'LISTING_CREATE' },
    });
    expect(a).toBeNull();
  });

  it('recordListingBuy flag REPEATED_BUYER_SELLER_PAIR khi pair 24h', async () => {
    const seller = await makeUserChar(prisma);
    const buyer = await makeUserChar(prisma);
    const soldAt = new Date(NOW.getTime() - 30 * 60 * 1000);
    // tạo 4 trade SOLD trước (đếm vào pair count).
    for (let i = 0; i < 4; i += 1) {
      await createListing(prisma, {
        sellerId: seller.characterId,
        buyerId: buyer.characterId,
        status: ListingStatus.SOLD,
        soldAt,
        pricePerUnit: 22_000n,
      });
    }
    const newListingId = await createListing(prisma, {
      sellerId: seller.characterId,
      buyerId: buyer.characterId,
      status: ListingStatus.SOLD,
      soldAt: NOW,
      pricePerUnit: 22_000n,
    });
    await svc.recordListingBuy({
      listingId: newListingId,
      sellerId: seller.characterId,
      buyerId: buyer.characterId,
      itemKey: REF_ITEM,
      qty: 1,
      pricePerUnit: 22_000n,
      now: NOW,
    });
    const a = await prisma.marketTradeAnomaly.findFirst({
      where: {
        type: 'REPEATED_BUYER_SELLER_PAIR',
        source: 'LISTING_BUY',
      },
    });
    expect(a).not.toBeNull();
    expect(a?.sellerCharacterId).toBe(seller.characterId);
    expect(a?.buyerCharacterId).toBe(buyer.characterId);
  });
});
