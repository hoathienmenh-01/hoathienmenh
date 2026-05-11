-- Phase 16.4 — Market Price Band / Trade Abuse Hardening
-- Adds:
--   - MarketTradeAnomaly: detection-only tracking row cho price band
--     deviation extreme, repeated buyer/seller pair, listing spam,
--     market volume spike, unknown reference price. Phase 16.4
--     bổ sung Phase 16.6 (band reject) bằng cách quan sát PATTERN
--     thay vì single-shot band threshold.
--
-- Tách khỏi `EconomyAnomaly` (Phase 16.6 — economy aggregate) và
-- `GameplayAnomaly` (Phase 16.3 — gameplay farm pattern) để admin
-- filter sạch theo domain market trade.
--
-- Indexes:
--   - UNIQUE (type, listingId, windowKey): idempotency per listing
--     per window cho per-listing rule (PRICE_EXTREME_*). Multi-
--     instance race → second writer hit P2002 + skip.
--     listingId = '' (empty string) cho rule không gắn 1 listing cụ
--     thể (REPEATED_BUYER_SELLER_PAIR / LISTING_SPAM /
--     MARKET_VOLUME_SPIKE / UNKNOWN_REFERENCE_PRICE per scan) —
--     dùng key tổng hợp ở windowKey để dedupe.
--   - (status, severity, createdAt DESC): dashboard query.
--   - (type, createdAt DESC): FE filter theo rule.
--   - (sellerCharacterId, createdAt DESC): drill-down seller.
--   - (buyerCharacterId, createdAt DESC): drill-down buyer.
--   - (itemKey, createdAt DESC): drill-down item key.
--
-- Privacy: detailsJson đã sanitize ở caller. KHÔNG lưu raw IP /
-- token. Migration additive — không backfill row cũ. KHÔNG đụng
-- bảng Listing / CurrencyLedger.

CREATE TABLE "MarketTradeAnomaly" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "listingId" TEXT NOT NULL DEFAULT '',
    "sellerCharacterId" TEXT,
    "buyerCharacterId" TEXT,
    "itemKey" TEXT,
    "quantity" INTEGER,
    "unitPrice" BIGINT,
    "referencePrice" BIGINT,
    "deviationRatio" DOUBLE PRECISION,
    "windowKey" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "MarketTradeAnomaly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketTradeAnomaly_type_listingId_windowKey_key"
    ON "MarketTradeAnomaly"("type", "listingId", "windowKey");

CREATE INDEX "MarketTradeAnomaly_status_severity_createdAt_idx"
    ON "MarketTradeAnomaly"("status", "severity", "createdAt");

CREATE INDEX "MarketTradeAnomaly_type_createdAt_idx"
    ON "MarketTradeAnomaly"("type", "createdAt");

CREATE INDEX "MarketTradeAnomaly_sellerCharacterId_createdAt_idx"
    ON "MarketTradeAnomaly"("sellerCharacterId", "createdAt");

CREATE INDEX "MarketTradeAnomaly_buyerCharacterId_createdAt_idx"
    ON "MarketTradeAnomaly"("buyerCharacterId", "createdAt");

CREATE INDEX "MarketTradeAnomaly_itemKey_createdAt_idx"
    ON "MarketTradeAnomaly"("itemKey", "createdAt");
