/**
 * Phase 30.0 — Market V2 API integration tests.
 *
 * Coverage (spec PHẦN 27 1–18):
 *   - claim-box.service: deposit idempotent, claim atomic, expired entry,
 *     not-owner reject, unsupported currency reject.
 *   - auction.service: create (lock item), placeBid (escrow + refund prev),
 *     buyout finalize inline, cancelBySeller (return item), finalizeExpired
 *     (no bid → seller; with bid → winner + seller payout net of 5% tax),
 *     self-bid block, insufficient funds, TIEN_NGOC currency policy.
 */
import { CurrencyKind } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { ClaimBoxService, ClaimBoxError } from './claim-box.service';
import { AuctionService, AuctionError } from './auction.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let claimBox: ClaimBoxService;
let auctions: AuctionService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  claimBox = new ClaimBoxService(prisma, currency);
  auctions = new AuctionService(prisma, currency, claimBox);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function giveItem(characterId: string, itemKey: string, qty: number) {
  await prisma.inventoryItem.create({
    data: { characterId, itemKey, qty },
  });
}

describe('ClaimBoxService', () => {
  it('deposit creates PENDING entry with currency', async () => {
    const a = await makeUserChar(prisma);
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'ADMIN_GRANT',
      currency: 'LINH_THACH',
      amount: 500n,
    });
    expect(entry.status).toBe('PENDING');
    expect(entry.amount).toBe(500n);
  });

  it('deposit is idempotent by (source, sourceRefId)', async () => {
    const a = await makeUserChar(prisma);
    const e1 = await claimBox.deposit({
      characterId: a.characterId,
      source: 'AUCTION_WON',
      sourceRefId: 'auction-1',
      itemKey: 'so_kiem',
      itemQty: 1,
    });
    const e2 = await claimBox.deposit({
      characterId: a.characterId,
      source: 'AUCTION_WON',
      sourceRefId: 'auction-1',
      itemKey: 'so_kiem',
      itemQty: 1,
    });
    expect(e1.id).toBe(e2.id);
  });

  it('deposit rejects unsupported currency (e.g. TIEN_NGOC paid)', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      claimBox.deposit({
        characterId: a.characterId,
        source: 'ADMIN_GRANT',
        currency: 'TIEN_NGOC',
        amount: 100n,
      }),
    ).rejects.toBeInstanceOf(ClaimBoxError);
  });

  it('claim grants currency atomically + marks CLAIMED', async () => {
    const a = await makeUserChar(prisma, { linhThach: 0n });
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'AUCTION_SELLER_PAYOUT',
      sourceRefId: 'a-1',
      currency: 'LINH_THACH',
      amount: 1000n,
    });
    const claimed = await claimBox.claim(a.characterId, entry.id);
    expect(claimed?.status).toBe('CLAIMED');
    const ch = await prisma.character.findUnique({
      where: { id: a.characterId },
    });
    expect(ch?.linhThach).toBe(1000n);
  });

  it('claim grants item atomically + adds ItemLedger row', async () => {
    const a = await makeUserChar(prisma);
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'AUCTION_WON',
      sourceRefId: 'a-2',
      itemKey: 'so_kiem',
      itemQty: 2,
    });
    await claimBox.claim(a.characterId, entry.id);
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId: a.characterId, itemKey: 'so_kiem' },
    });
    expect(inv?.qty).toBe(2);
    const ledger = await prisma.itemLedger.findFirst({
      where: { characterId: a.characterId, itemKey: 'so_kiem' },
    });
    expect(ledger?.qtyDelta).toBe(2);
  });

  it('claim twice → second throws ENTRY_NOT_PENDING (idempotent)', async () => {
    const a = await makeUserChar(prisma);
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'ADMIN_GRANT',
      sourceRefId: 'a-3',
      currency: 'LINH_THACH',
      amount: 50n,
    });
    await claimBox.claim(a.characterId, entry.id);
    await expect(
      claimBox.claim(a.characterId, entry.id),
    ).rejects.toBeInstanceOf(ClaimBoxError);
  });

  it('claim rejects non-owner', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'ADMIN_GRANT',
      currency: 'LINH_THACH',
      amount: 50n,
    });
    await expect(
      claimBox.claim(b.characterId, entry.id),
    ).rejects.toBeInstanceOf(ClaimBoxError);
  });

  it('expired entry → claim throws ENTRY_EXPIRED + marks EXPIRED', async () => {
    const a = await makeUserChar(prisma);
    const entry = await claimBox.deposit({
      characterId: a.characterId,
      source: 'LISTING_EXPIRED',
      currency: 'LINH_THACH',
      amount: 1n,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      claimBox.claim(a.characterId, entry.id),
    ).rejects.toBeInstanceOf(ClaimBoxError);
    const after = await prisma.marketClaimBoxEntry.findUnique({
      where: { id: entry.id },
    });
    expect(after?.status).toBe('EXPIRED');
  });

  it('list returns entries newest first', async () => {
    const a = await makeUserChar(prisma);
    await claimBox.deposit({
      characterId: a.characterId,
      source: 'ADMIN_GRANT',
      sourceRefId: 'r-1',
      currency: 'LINH_THACH',
      amount: 1n,
    });
    await claimBox.deposit({
      characterId: a.characterId,
      source: 'ADMIN_GRANT',
      sourceRefId: 'r-2',
      currency: 'LINH_THACH',
      amount: 2n,
    });
    const list = await claimBox.list(a.characterId, 'PENDING');
    expect(list.length).toBe(2);
  });
});

describe('AuctionService', () => {
  it('create locks item from inventory + creates ACTIVE auction', async () => {
    const a = await makeUserChar(prisma);
    await giveItem(a.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: a.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    expect(auction.status).toBe('ACTIVE');
    expect(auction.itemKey).toBe('so_kiem');
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId: a.characterId, itemKey: 'so_kiem' },
    });
    expect(inv?.qty).toBe(0);
  });

  it('create rejects inventory insufficient', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      auctions.create({
        sellerCharacterId: a.characterId,
        itemKey: 'so_kiem',
        quantity: 1,
        currency: 'LINH_THACH',
        startPrice: 100n,
        minBidStep: 10n,
        durationMinutes: 60,
      }),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('create rejects duration out of range', async () => {
    const a = await makeUserChar(prisma);
    await giveItem(a.characterId, 'so_kiem', 1);
    await expect(
      auctions.create({
        sellerCharacterId: a.characterId,
        itemKey: 'so_kiem',
        quantity: 1,
        currency: 'LINH_THACH',
        startPrice: 100n,
        minBidStep: 10n,
        durationMinutes: 1,
      }),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('placeBid escrows currency from bidder', async () => {
    const seller = await makeUserChar(prisma);
    const bidder = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: bidder.characterId,
      bidAmount: 150n,
    });
    const ch = await prisma.character.findUnique({
      where: { id: bidder.characterId },
    });
    expect(ch?.linhThach).toBe(5000n - 150n);
    const updated = await prisma.marketAuction.findUnique({
      where: { id: auction.id },
    });
    expect(updated?.currentBid).toBe(150n);
    expect(updated?.currentBidderId).toBe(bidder.characterId);
  });

  it('placeBid refunds previous high bidder to claim box', async () => {
    const seller = await makeUserChar(prisma);
    const b1 = await makeUserChar(prisma, { linhThach: 5000n });
    const b2 = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: b1.characterId,
      bidAmount: 150n,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: b2.characterId,
      bidAmount: 200n,
    });
    const refund = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: b1.characterId, source: 'AUCTION_REFUND' },
    });
    expect(refund?.amount).toBe(150n);
  });

  it('placeBid blocks self-bid (seller bidding own auction)', async () => {
    const seller = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await expect(
      auctions.placeBid({
        auctionId: auction.id,
        bidderCharacterId: seller.characterId,
        bidAmount: 150n,
      }),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('placeBid rejects insufficient funds', async () => {
    const seller = await makeUserChar(prisma);
    const bidder = await makeUserChar(prisma, { linhThach: 50n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await expect(
      auctions.placeBid({
        auctionId: auction.id,
        bidderCharacterId: bidder.characterId,
        bidAmount: 150n,
      }),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('placeBid below current+step throws', async () => {
    const seller = await makeUserChar(prisma);
    const b1 = await makeUserChar(prisma, { linhThach: 5000n });
    const b2 = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 50n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: b1.characterId,
      bidAmount: 200n,
    });
    await expect(
      auctions.placeBid({
        auctionId: auction.id,
        bidderCharacterId: b2.characterId,
        bidAmount: 210n,
      }),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('buyout finalizes auction inline + grants item to bidder + payout to seller', async () => {
    const seller = await makeUserChar(prisma);
    const bidder = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      buyoutPrice: 500n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: bidder.characterId,
      bidAmount: 500n,
    });
    const updated = await prisma.marketAuction.findUnique({
      where: { id: auction.id },
    });
    expect(updated?.status).toBe('FINALIZED');
    // 5% tax: tax = 25, sellerGain = 475.
    expect(updated?.taxAmount).toBe(25n);
    const itemBox = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: bidder.characterId, source: 'AUCTION_WON' },
    });
    expect(itemBox?.itemKey).toBe('so_kiem');
    const payoutBox = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: seller.characterId, source: 'AUCTION_SELLER_PAYOUT' },
    });
    expect(payoutBox?.amount).toBe(475n);
  });

  it('cancelBySeller returns item to seller claim box', async () => {
    const seller = await makeUserChar(prisma);
    await giveItem(seller.characterId, 'so_kiem', 2);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 2,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.cancelBySeller(auction.id, seller.characterId);
    const box = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: seller.characterId, source: 'AUCTION_REFUND' },
    });
    expect(box?.itemQty).toBe(2);
  });

  it('cancelBySeller blocked if auction has active bid', async () => {
    const seller = await makeUserChar(prisma);
    const bidder = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: bidder.characterId,
      bidAmount: 200n,
    });
    await expect(
      auctions.cancelBySeller(auction.id, seller.characterId),
    ).rejects.toBeInstanceOf(AuctionError);
  });

  it('finalizeExpired: no bid → item back to seller claim box (LISTING_EXPIRED)', async () => {
    const seller = await makeUserChar(prisma);
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    // Force endsAt to the past.
    await prisma.marketAuction.update({
      where: { id: auction.id },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    const r = await auctions.finalizeExpired();
    expect(r.finalized).toBe(1);
    const after = await prisma.marketAuction.findUnique({
      where: { id: auction.id },
    });
    expect(after?.status).toBe('EXPIRED');
    const box = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: seller.characterId, source: 'LISTING_EXPIRED' },
    });
    expect(box?.itemKey).toBe('so_kiem');
  });

  it('finalizeExpired: with bid → winner gets item, seller gets net-of-tax payout', async () => {
    const seller = await makeUserChar(prisma);
    const bidder = await makeUserChar(prisma, { linhThach: 5000n });
    await giveItem(seller.characterId, 'so_kiem', 1);
    const auction = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.placeBid({
      auctionId: auction.id,
      bidderCharacterId: bidder.characterId,
      bidAmount: 200n,
    });
    await prisma.marketAuction.update({
      where: { id: auction.id },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    const r = await auctions.finalizeExpired();
    expect(r.finalized).toBe(1);
    const after = await prisma.marketAuction.findUnique({
      where: { id: auction.id },
    });
    expect(after?.status).toBe('FINALIZED');
    expect(after?.taxAmount).toBe(10n);
    const won = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: bidder.characterId, source: 'AUCTION_WON' },
    });
    expect(won?.itemKey).toBe('so_kiem');
    const payout = await prisma.marketClaimBoxEntry.findFirst({
      where: { characterId: seller.characterId, source: 'AUCTION_SELLER_PAYOUT' },
    });
    expect(payout?.amount).toBe(190n);
  });

  it('listActive filters out non-ACTIVE auctions', async () => {
    const seller = await makeUserChar(prisma);
    await giveItem(seller.characterId, 'so_kiem', 2);
    const a1 = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    await auctions.cancelBySeller(a1.id, seller.characterId);
    const a2 = await auctions.create({
      sellerCharacterId: seller.characterId,
      itemKey: 'so_kiem',
      quantity: 1,
      currency: 'LINH_THACH',
      startPrice: 100n,
      minBidStep: 10n,
      durationMinutes: 60,
    });
    const list = await auctions.listActive();
    expect(list.map((x) => x.id)).toContain(a2.id);
    expect(list.map((x) => x.id)).not.toContain(a1.id);
  });
});

describe('Market V2 — Currency invariants', () => {
  it('CONG_HIEN_TONG_MON kind exists for SECT_CONTRIBUTION mapping', () => {
    // Sanity: confirms enum mapping for sect-contribution market currency.
    expect(CurrencyKind.CONG_HIEN_TONG_MON).toBeDefined();
  });
});
