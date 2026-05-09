import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ListingStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { MarketService, MARKET_FEE_PCT } from './market.service';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let market: MarketService;
let realtime: RealtimeService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const missions = makeMissionService(prisma);
  market = new MarketService(prisma, realtime, chars, currency, missions);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const PILL = 'huyet_chi_dan'; // stackable PILL_HP

async function giveItem(characterId: string, qty: number) {
  return prisma.inventoryItem.create({
    data: { characterId, itemKey: PILL, qty },
  });
}

describe('MarketService', () => {
  it('post: trừ inventory + tạo listing ACTIVE', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 5);

    const view = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 3,
      pricePerUnit: 100n,
    });
    expect(view.qty).toBe(3);
    expect(view.status).toBe('ACTIVE');

    const remaining = await prisma.inventoryItem.findUnique({ where: { id: inv.id } });
    expect(remaining?.qty).toBe(2);
  });

  it('post: qty = inventory.qty → xoá row inventory', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 4);
    await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 4,
      pricePerUnit: 50n,
    });
    const remaining = await prisma.inventoryItem.findUnique({ where: { id: inv.id } });
    expect(remaining).toBeNull();
  });

  it('buy: trừ buyer + cộng seller (đã trừ phí 5%) + grant item + ghi 2 dòng ledger', async () => {
    const seller = await makeUserChar(prisma, { linhThach: 0n });
    const buyer = await makeUserChar(prisma, { linhThach: 5000n });
    const inv = await giveItem(seller.characterId, 2);

    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 2,
      pricePerUnit: 100n,
    });
    const total = 200n; // 2 * 100
    const fee = (total * BigInt(Math.round(MARKET_FEE_PCT * 1000))) / 1000n;
    const sellerGain = total - fee;

    await market.buy(buyer.userId, listing.id);

    const sChar = await prisma.character.findUniqueOrThrow({ where: { id: seller.characterId } });
    const bChar = await prisma.character.findUniqueOrThrow({ where: { id: buyer.characterId } });
    expect(sChar.linhThach).toBe(sellerGain);
    expect(bChar.linhThach).toBe(5000n - total);

    const buyerInv = await prisma.inventoryItem.findFirst({
      where: { characterId: buyer.characterId, itemKey: PILL },
    });
    expect(buyerInv?.qty).toBe(2);

    const ledger = await prisma.currencyLedger.findMany({
      where: { refType: 'Listing', refId: listing.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(2);
    const buyRow = ledger.find((r) => r.reason === 'MARKET_BUY')!;
    const sellRow = ledger.find((r) => r.reason === 'MARKET_SELL')!;
    expect(buyRow.delta).toBe(-total);
    expect(buyRow.characterId).toBe(buyer.characterId);
    expect(sellRow.delta).toBe(sellerGain);
    expect(sellRow.characterId).toBe(seller.characterId);

    const finalListing = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(finalListing.status).toBe(ListingStatus.SOLD);
    expect(finalListing.buyerId).toBe(buyer.characterId);
  });

  it('buy: thiếu linh thạch → INSUFFICIENT_LINH_THACH, listing vẫn ACTIVE, không ghi ledger', async () => {
    const seller = await makeUserChar(prisma);
    const buyer = await makeUserChar(prisma, { linhThach: 50n });
    const inv = await giveItem(seller.characterId, 1);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 100n,
    });

    await expect(market.buy(buyer.userId, listing.id)).rejects.toMatchObject({
      code: 'INSUFFICIENT_LINH_THACH',
    });
    const finalListing = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(finalListing.status).toBe(ListingStatus.ACTIVE);
    const ledger = await prisma.currencyLedger.findMany({
      where: { refId: listing.id },
    });
    expect(ledger).toHaveLength(0);
  });

  it('buy: tự mua listing của mình → CANNOT_BUY_OWN', async () => {
    const seller = await makeUserChar(prisma, { linhThach: 5000n });
    const inv = await giveItem(seller.characterId, 1);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 100n,
    });
    await expect(market.buy(seller.userId, listing.id)).rejects.toMatchObject({
      code: 'CANNOT_BUY_OWN',
    });
  });

  it('buy 2 lần đồng thời → 1 thắng / 1 fail (LISTING_INACTIVE), không double-grant', async () => {
    const seller = await makeUserChar(prisma);
    const buyer1 = await makeUserChar(prisma, { linhThach: 5000n });
    const buyer2 = await makeUserChar(prisma, { linhThach: 5000n });
    const inv = await giveItem(seller.characterId, 1);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 100n,
    });

    const results = await Promise.allSettled([
      market.buy(buyer1.userId, listing.id),
      market.buy(buyer2.userId, listing.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('LISTING_INACTIVE');

    // Chỉ 1 buyer được item
    const inv1 = await prisma.inventoryItem.findFirst({
      where: { characterId: buyer1.characterId, itemKey: PILL },
    });
    const inv2 = await prisma.inventoryItem.findFirst({
      where: { characterId: buyer2.characterId, itemKey: PILL },
    });
    const got1 = inv1?.qty ?? 0;
    const got2 = inv2?.qty ?? 0;
    expect(got1 + got2).toBe(1);
  });

  it('cancel: trả item về túi + flip status CANCELLED, double-cancel fail LISTING_INACTIVE', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 5);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 5,
      pricePerUnit: 50n,
    });
    await market.cancel(seller.userId, listing.id);
    const final = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(final.status).toBe(ListingStatus.CANCELLED);
    const back = await prisma.inventoryItem.findFirst({
      where: { characterId: seller.characterId, itemKey: PILL },
    });
    expect(back?.qty).toBe(5);

    await expect(market.cancel(seller.userId, listing.id)).rejects.toMatchObject({
      code: 'LISTING_INACTIVE',
    });
  });

  it('ItemLedger: post → MARKET_SELL POST -qty, buy → MARKET_BUY +qty cho buyer', async () => {
    const seller = await makeUserChar(prisma, { linhThach: 0n });
    const buyer = await makeUserChar(prisma, { linhThach: 5_000n });
    const inv = await giveItem(seller.characterId, 5);

    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 3,
      pricePerUnit: 100n,
    });

    // Sau post: 1 dòng ledger MARKET_SELL POST cho seller.
    const sellerLedgerAfterPost = await prisma.itemLedger.findMany({
      where: { characterId: seller.characterId },
    });
    expect(sellerLedgerAfterPost).toHaveLength(1);
    expect(sellerLedgerAfterPost[0]?.qtyDelta).toBe(-3);
    expect(sellerLedgerAfterPost[0]?.reason).toBe('MARKET_SELL');
    expect(sellerLedgerAfterPost[0]?.refType).toBe('Listing');
    expect(sellerLedgerAfterPost[0]?.refId).toBe(listing.id);
    expect(sellerLedgerAfterPost[0]?.meta).toMatchObject({ stage: 'POST' });

    await market.buy(buyer.userId, listing.id);

    // Sau buy: thêm 1 dòng MARKET_BUY +3 cho buyer.
    const buyerLedger = await prisma.itemLedger.findMany({
      where: { characterId: buyer.characterId },
    });
    expect(buyerLedger).toHaveLength(1);
    expect(buyerLedger[0]?.qtyDelta).toBe(3);
    expect(buyerLedger[0]?.reason).toBe('MARKET_BUY');
    expect(buyerLedger[0]?.refType).toBe('Listing');
    expect(buyerLedger[0]?.refId).toBe(listing.id);
  });

  it('ItemLedger: cancel → MARKET_SELL CANCEL +qty (refund cho seller)', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 5);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 3,
      pricePerUnit: 100n,
    });
    await market.cancel(seller.userId, listing.id);
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: seller.characterId },
      orderBy: { createdAt: 'asc' },
    });
    // 2 dòng: POST -3 + CANCEL +3.
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.qtyDelta).toBe(3);
    expect(ledger[1]?.reason).toBe('MARKET_SELL');
    expect(ledger[1]?.meta).toMatchObject({ stage: 'CANCEL' });
    // Sum = 0 (item đã về túi).
    const sum = ledger.reduce((acc, r) => acc + r.qtyDelta, 0);
    expect(sum).toBe(0);
  });

  it('cancel: không phải owner → NOT_OWNER', async () => {
    const seller = await makeUserChar(prisma);
    const stranger = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 1);
    const listing = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 50n,
    });
    await expect(market.cancel(stranger.userId, listing.id)).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
  });

  // -----------------------------------------------------------------
  // Phase 16.6 — Market Price Band tests
  // -----------------------------------------------------------------

  it('post: pricePerUnit < band.minPrice (PHAM 10) → PRICE_TOO_LOW', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 5);
    await expect(
      market.post(seller.userId, {
        inventoryItemId: inv.id,
        qty: 1,
        pricePerUnit: 1n, // band PHAM = [10, 1000]
      }),
    ).rejects.toMatchObject({ code: 'PRICE_TOO_LOW' });

    // Inventory KHÔNG bị trừ vì throw trong transaction → rollback.
    const remaining = await prisma.inventoryItem.findUnique({
      where: { id: inv.id },
    });
    expect(remaining?.qty).toBe(5);
  });

  it('post: pricePerUnit > band.maxPrice (PHAM 1000) → PRICE_TOO_HIGH', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 5);
    await expect(
      market.post(seller.userId, {
        inventoryItemId: inv.id,
        qty: 1,
        pricePerUnit: 999_999_999n,
      }),
    ).rejects.toMatchObject({ code: 'PRICE_TOO_HIGH' });

    // Inventory rollback intact.
    const remaining = await prisma.inventoryItem.findUnique({
      where: { id: inv.id },
    });
    expect(remaining?.qty).toBe(5);
  });

  it('post: pricePerUnit = band.minPrice (boundary) → success', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 1);
    const view = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 10n, // = band.minPrice
    });
    expect(view.status).toBe('ACTIVE');
  });

  it('post: pricePerUnit = band.maxPrice (boundary) → success', async () => {
    const seller = await makeUserChar(prisma);
    const inv = await giveItem(seller.characterId, 1);
    const view = await market.post(seller.userId, {
      inventoryItemId: inv.id,
      qty: 1,
      pricePerUnit: 1000n, // = band.maxPrice
    });
    expect(view.status).toBe('ACTIVE');
  });

  it('post: existing ACTIVE listings KHÔNG bị mutate khi band check áp dụng cho post mới', async () => {
    // Setup: tạo listing trước (price 100 PHAM trong band).
    const seller = await makeUserChar(prisma);
    const inv1 = await giveItem(seller.characterId, 1);
    const before = await market.post(seller.userId, {
      inventoryItemId: inv1.id,
      qty: 1,
      pricePerUnit: 100n,
    });

    // Post listing thứ 2 ngoài band → reject.
    const inv2 = await giveItem(seller.characterId, 1);
    await expect(
      market.post(seller.userId, {
        inventoryItemId: inv2.id,
        qty: 1,
        pricePerUnit: 5n,
      }),
    ).rejects.toMatchObject({ code: 'PRICE_TOO_LOW' });

    // Listing cũ vẫn ACTIVE, qty = 1, price 100.
    const stillActive = await prisma.listing.findUnique({
      where: { id: before.id },
    });
    expect(stillActive?.status).toBe('ACTIVE');
    expect(stillActive?.qty).toBe(1);
    expect(stillActive?.pricePerUnit).toBe(100n);
  });
});
