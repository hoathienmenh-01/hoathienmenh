# Phase 25.2 — Limited Resource Shop Packs — Plan

> Phase 25.2 extends the monetization layer with purchasable resource packs
> (daily/weekly/monthly/lifetime limits, server-authoritative, ledger-backed,
> anti-duplicate, idempotent).

## Scope

1. **Shared catalog** `packages/shared/src/shop-packs.ts` — pack definitions,
   reward validators, purchase-limit window helpers.
2. **Prisma schema** — additive `ShopPackPurchase` model for purchase history /
   idempotency / limit accounting.
3. **API runtime** — `ShopPackService` + `ShopPackController` +
   `ShopPackAdminController` in `apps/api/src/modules/shop-packs/`.
4. **Web UI** — Shop tab in `MonetizationView` or standalone `ShopPacksView`
   with category filter, pack list, limit indicator, confirm modal, i18n.
5. **Tests** — shared validators, API purchase flow, UI render/state.
6. **Docs** — plan, design bible, balance, economy, API, changelog, handoff,
   admin runbook.

## Shop Design Rules

### Allowed rewards
- Đá luyện khí, tinh thiết, linh tinh, bảo hộ phù, tẩy luyện phù, tách ngọc phù.
- Ngọc cấp thấp/trung, mảnh pháp bảo (same-tier hoặc thấp hơn player tier).
- Vé bí cảnh giới hạn, gói linh thạch (capped), cosmetic token.

### Forbidden rewards
- Top-tier equipment, max-star/max-awaken pháp bảo, realm-bypass items,
  unlimited dungeon/material, direct damage buffs, 100% upgrade tickets.

### Fairness
- Spender advantage capped 20–40% speed boost.
- F2P always has farm path.

## Pack Catalog (8 sample packs)

| # | Pack | Category | Price (tienNgoc) | Limit | Window |
|---|------|----------|-----------------|-------|--------|
| 1 | Daily Cultivation Support | DAILY | 50 | 1 | DAY |
| 2 | Weekly Equipment Forge | WEEKLY | 200 | 1 | WEEK |
| 3 | Weekly Gem Socket | WEEKLY | 150 | 1 | WEEK |
| 4 | Weekly Reforge | WEEKLY | 180 | 1 | WEEK |
| 5 | Weekly Pháp Bảo Essence | WEEKLY | 250 | 1 | WEEK |
| 6 | Monthly Protection Charm | MONTHLY | 400 | 1 | MONTH |
| 7 | Starter Growth (lifetime) | STARTER | 100 | 1 | LIFETIME |
| 8 | Event Ngũ Hành Material | EVENT | 300 | 2 | WEEK |

## Purchase Flow

1. Client `POST /shop-packs/purchase` with `{ packId, idempotencyKey? }`.
2. Server validates: pack active, time window, realm gate, purchase limit,
   currency balance.
3. Transaction: deduct currency → grant rewards → write ledger → write
   `ShopPackPurchase` row.
4. Idempotency: `ShopPackPurchase` UNIQUE on `(characterId, packId,
   purchaseWindowKey)` or `idempotencyKey` prevents double-grant on retry.

## Schema Addition (additive only)

```prisma
model ShopPackPurchase {
  id                String   @id @default(cuid())
  characterId       String
  character         Character @relation(...)
  packId            String
  quantity          Int      @default(1)
  purchaseWindowKey String
  idempotencyKey    String?
  paymentRef        String?
  createdAt         DateTime @default(now())

  @@unique([characterId, packId, purchaseWindowKey])
  @@unique([idempotencyKey])
  @@index([characterId, packId, createdAt])
}
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /shop-packs | Player | List active packs + remaining limits |
| GET | /shop-packs/purchases | Player | Purchase history |
| POST | /shop-packs/purchase | Player | Buy a pack |
| POST | /admin/shop-packs/grant | Admin | Grant pack for testing |

## Ledger Reasons

- `SHOP_PACK_PURCHASE` — currency spend (negative delta).
- `SHOP_PACK_REWARD` — item/currency grant from pack.

## UI Additions

- New "Shop" tab in MonetizationView.
- Category filter (daily/weekly/monthly/event/starter).
- Pack card: name, price, rewards preview, remaining limit, buy button.
- Confirm modal before purchase.
- Disabled states: sold out, insufficient funds, realm locked.
- i18n vi/en parity.

## Risk / Rollback

🟡 medium — additive schema, economy-facing. Rollback = revert PR.
All purchase paths are server-authoritative with transaction + idempotency.

## Implementation Status

- Shared catalog/helper source: `packages/shared/src/shop-packs.ts`.
- API runtime: `apps/api/src/modules/shop-packs/*` plus additive `ShopPackPurchase` Prisma migration.
- Player endpoints: `GET /shop-packs`, `GET /shop-packs/purchases`, `POST /shop-packs/purchase`.
- Admin endpoints: `POST /admin/shop-packs/users/:id/grant` and compatibility `POST /admin/shop/grant-pack`.
- Web UI: `/shop-packs` route and AppShell nav entry.
- Tests: shared catalog/window/validator tests, API purchase/idempotency/ledger/admin tests, web UI state/confirm/i18n tests.
