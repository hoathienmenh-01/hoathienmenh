# Market V2 — Auction House (Phase 30.0)

This document describes the **Phase 30.0 Auction House V2** subsystem: how
listings + auctions are created, how bids escrow currency safely, how the
**Claim Box** delivers rewards atomically, and how the 5% tax / anti-abuse
policies are enforced.

> **Scope**: Phase 30.0 covers **AUCTION listings** + **Claim Box** only.
> Fixed-price market (`/market` legacy) is untouched. Personal Stall + Sect
> Internal Auction tables are migrated but UI/services for those modes are
> deferred to Phase 30.1+.

## 1. Components

- `apps/api/src/modules/market-v2/auction.service.ts` — auction lifecycle.
- `apps/api/src/modules/market-v2/claim-box.service.ts` — idempotent reward box.
- `apps/api/src/modules/market-v2/market-v2.player.controller.ts` — player HTTP API.
- `apps/api/src/modules/market-v2/market-v2.admin.controller.ts` — admin HTTP API.
- `packages/shared/src/market-v2.ts` — types + validators.
- Prisma models: `MarketAuction`, `MarketBid`, `MarketClaimBoxEntry`,
  `MarketPriceSnapshot`, `MarketItemPolicy`, `MarketAnomaly`.

## 2. Auction Lifecycle

```
   ┌────────────┐  create   ┌─────────┐  bid ≥ buyout  ┌───────────┐
   │ inventory  │──────────▶│ ACTIVE  │───────────────▶│ FINALIZED │
   └────────────┘           └────┬────┘                └───────────┘
                                 │
                          time ▶ │ endsAt < now           ┌───────────┐
                                 ├────────────────────────│ EXPIRED   │ (no bid → seller claim box)
                                 │                        └───────────┘
                                 │  cancelBySeller        ┌───────────┐
                                 └──── (only if no bid) ──│ CANCELLED │
                                                          └───────────┘
```

### 2.1 Create
- `AuctionService.create(input)` locks item from inventory atomically:
  - Checks `MarketItemPolicy.tradability` (rejects bind/account_bound items).
  - Validates currency NOT `TIEN_NGOC` (paid premium — Phase 30 forbids direct trade).
  - Decrements `Inventory.quantity` via `inventoryLedger` reason `MARKET_AUCTION_LOCK`.
  - Inserts `MarketAuction { status: 'ACTIVE', startPrice, minBidStep, ... }`.
- Duration clamped to 1h–168h (7 days).

### 2.2 Place Bid
- `AuctionService.placeBid(input)` is fully atomic:
  1. Verify auction status `ACTIVE` and `now < endsAt`.
  2. Verify `bidAmount >= currentBid + minBidStep` (or `>= startPrice` if first bid).
  3. **Escrow buyer currency** via `CurrencyService.applyTx(reason='MARKET_AUCTION_BID_ESCROW', delta=-bidAmount)`.
  4. **Refund previous bidder** (if any) via `ClaimBoxService.deposit(source='AUCTION_REFUND', currency=prevCurrency, amount=prevBid)`. This is **idempotent** by `source+sourceRefId`.
  5. Update `MarketAuction.currentBid` and `currentBidderId`.
  6. Insert `MarketBid { bidder, amount, refundedTo: prevBidder }`.
  7. If `bidAmount >= buyoutPrice` → **inline finalize** (see 2.3).
- **Self-bid blocked**: `sellerCharacterId === bidderCharacterId` throws.
- **Insufficient funds**: `CurrencyService` throws before mutation.

### 2.3 Finalize
Two paths:
1. **Buyout** (in `placeBid`): same transaction.
2. **Cron / admin trigger** (`AuctionService.finalizeExpired`):
   - Scans `MarketAuction WHERE status='ACTIVE' AND endsAt < now`.
   - For each, runs `finalizeInner(tx, auctionId)`:
     - No bid → `EXPIRED`, item returned to seller's claim box (source=`LISTING_EXPIRED`).
     - Has winner →
       - Item to winner's claim box (source=`AUCTION_WON`).
       - Seller payout = `currentBid * 0.95` (5% tax). Tax recorded in `MarketAuction.taxAmount`.
       - Currency to seller's claim box (source=`AUCTION_SELLER_PAYOUT`).

### 2.4 Cancel by Seller
- Only allowed if **no bid has been placed**.
- If `currentBidderId IS NOT NULL` → throws `BID_EXISTS`.
- Returns item to seller's claim box (source=`LISTING_EXPIRED`, reason=cancel).

## 3. Claim Box

`MarketClaimBoxEntry { status: PENDING | CLAIMED | EXPIRED }` is an
**append-only idempotent reward box**:

- `deposit(input)` is idempotent by `(characterId, source, sourceRefId)`.
  Re-running with same key returns the existing row.
- `claim(characterId, entryId)`:
  1. **Pre-check expiry OUTSIDE transaction** — if `expiresAt < now`, marks
     `EXPIRED` via `updateMany WHERE status='PENDING'` and throws
     `ENTRY_EXPIRED`. The mark persists even if the throw rolls anything else.
  2. Open `$transaction`:
     - `updateMany WHERE id=… AND status='PENDING' → status='CLAIMED'`.
     - If `updateMany.count === 0` → already claimed/expired, throw.
     - If currency entry: `CurrencyService.applyTx(reason='CLAIM_BOX_…', delta=+amount)`.
     - If item entry: `inventoryLedger` increment + `ItemLedger` row.

## 4. Tax Model

| Event                         | Source / Tax            |
|-------------------------------|-------------------------|
| Listing creation              | Flat fee deducted from seller (configurable per `MarketItemPolicy.listingFeeFlatOverride`). |
| Successful auction win        | 5% of final bid kept by system. Seller receives 95%. |
| Refund of outbid currency     | 0% tax (full refund). |
| Cancellation                  | 0% tax (listing fee may still be lost — TBD config). |

Tax is recorded:
- In `MarketAuction.taxAmount` (BigInt).
- In `CurrencyLedger` as `MARKET_TRANSACTION_TAX` (delta=-tax on seller payout path).

## 5. Currency Whitelist

Permitted in Phase 30.0:
- `LINH_THACH` — primary trade currency.
- `CONG_HIEN_TONG_MON` — sect treasury (sect internal auction only).
- `EVENT_TOKEN` — event-bound listings.
- `TIEN_NGOC_KHOA` — earned tien ngoc (NOT paid premium).

**Hard reject**: `TIEN_NGOC` (paid premium) — enforced in
`packages/shared/src/market-v2.ts` `isMarketCurrencyAllowed()` AND in
`AuctionService.create` via the `MarketCurrency` enum.

## 6. Anti-Abuse

`MarketAnomaly` records:
- `SELF_BUY_DETECTED` — same user wins their own listing (via alt account).
- `WASH_TRADE_SUSPECT` — repeated trade between 2 IDs at non-market price.
- `BURST_REFUND` — refund frequency anomaly.

Admin resolves via `POST /admin/market-v2/anomalies/:id/resolve` with
`resolution ∈ ('DISMISSED', 'CONFIRMED', 'ESCALATED')`. Action is audited
with `MARKET_ANOMALY_RESOLVE` `AdminActionType`.

## 7. Endpoints

### Player
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/market-v2/auctions`         | List ACTIVE auctions (filter by `itemKey`). |
| GET    | `/market-v2/auctions/:id`     | Auction detail. |
| POST   | `/market-v2/auctions`         | Create auction (locks item). |
| POST   | `/market-v2/auctions/:id/bid` | Place bid (atomic escrow+refund). |
| POST   | `/market-v2/auctions/:id/cancel` | Cancel (only if no bid). |
| GET    | `/market-v2/claim-box`        | List entries (filter `status`). |
| POST   | `/market-v2/claim-box/:id/claim` | Atomic claim. |
| GET    | `/market-v2/prices/:itemKey`  | Market price snapshot. |

### Admin (`ADMIN_MANAGE_MARKET` permission)
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/admin/market-v2/auctions` | Admin list (any status). |
| POST   | `/admin/market-v2/auctions/:id/cancel` | Force cancel + refund. |
| GET    | `/admin/market-v2/item-policy` | List item policies. |
| POST   | `/admin/market-v2/item-policy` | Upsert policy. |
| GET    | `/admin/market-v2/anomalies` | List unresolved. |
| POST   | `/admin/market-v2/anomalies/:id/resolve` | Resolve + audit. |
| POST   | `/admin/market-v2/auctions/finalize-due` | Cron-style finalize. |
| POST   | `/admin/market-v2/refund` | Refund deposit into player claim box. |

All admin POSTs require `reason: string (≥ 3 chars)` and are audited via
`AdminAuditWriter.write` with the appropriate `AdminActionType`.

## 8. Bi-directional Linking (Market ↔ Codex)

- `MarketPriceSnapshot.itemKey` joined to `CodexEntry.refKey` (for ITEM-like types).
- `CodexService.getDetail` returns `marketPrice: MarketPriceSnapshot | null`.
- `MarketV2View` can be extended to show "Xem trong Tu Tiên Bách Khoa" link.

## 9. Runbook

- **Finalize stuck**: hit `POST /admin/market-v2/auctions/finalize-due`.
- **Wash trade alert**: review `MarketAnomaly` list, confirm/escalate, then
  cancel + refund affected auctions via admin endpoints.
- **Bind item shows up**: update `MarketItemPolicy` for that `itemKey` →
  `tradability='BIND_ON_PICKUP'`. New listings will be rejected; existing
  listings can be force-cancelled.
- **Player lost item / currency**: use `POST /admin/market-v2/refund` to
  deposit into their claim box. Audit log will record reason.
