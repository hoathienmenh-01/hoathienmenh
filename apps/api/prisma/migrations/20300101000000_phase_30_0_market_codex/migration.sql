-- Phase 30.0 + 32.0 — Auction House V2 + Tu Tiên Bách Khoa migration.
-- Additive-only: KHÔNG drop/alter any existing column/table.
--
-- 16 model mới:
--   Phase 30.0: MarketAuction, MarketBid, MarketClaimBoxEntry, MarketPriceSnapshot,
--               MarketItemPolicy, PersonalStall, SectTreasuryItem, SectTreasuryLog,
--               SectInternalAuction, SectInternalAuctionBid.
--   Phase 32.0: CodexEntry, CharacterCodexProgress, CodexAuditIssue,
--               CodexReindexLog.

-- =========================================================================
-- Phase 30.0 — Market V2 / Auction House
-- =========================================================================

CREATE TABLE "MarketAuction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sellerCharacterId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "startPrice" BIGINT NOT NULL,
  "buyoutPrice" BIGINT,
  "minBidStep" BIGINT NOT NULL,
  "currentBid" BIGINT,
  "currentBidderId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "finalizedAt" TIMESTAMP(3),
  "feeAmount" BIGINT NOT NULL DEFAULT 0,
  "taxAmount" BIGINT NOT NULL DEFAULT 0,
  "lockedBy" TEXT,
  "lockedReason" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MarketAuction_status_endsAt_idx" ON "MarketAuction"("status", "endsAt");
CREATE INDEX "MarketAuction_sellerCharacterId_status_idx" ON "MarketAuction"("sellerCharacterId", "status");
CREATE INDEX "MarketAuction_itemKey_status_idx" ON "MarketAuction"("itemKey", "status");
ALTER TABLE "MarketAuction" ADD CONSTRAINT "MarketAuction_sellerCharacterId_fkey" FOREIGN KEY ("sellerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE;
ALTER TABLE "MarketAuction" ADD CONSTRAINT "MarketAuction_currentBidderId_fkey" FOREIGN KEY ("currentBidderId") REFERENCES "Character"("id") ON DELETE SET NULL;

CREATE TABLE "MarketBid" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "auctionId" TEXT NOT NULL,
  "bidderCharacterId" TEXT NOT NULL,
  "bidAmount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "wasBuyout" BOOLEAN NOT NULL DEFAULT false,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MarketBid_auctionId_createdAt_idx" ON "MarketBid"("auctionId", "createdAt");
CREATE INDEX "MarketBid_bidderCharacterId_createdAt_idx" ON "MarketBid"("bidderCharacterId", "createdAt");
CREATE INDEX "MarketBid_status_createdAt_idx" ON "MarketBid"("status", "createdAt");
ALTER TABLE "MarketBid" ADD CONSTRAINT "MarketBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "MarketAuction"("id") ON DELETE CASCADE;
ALTER TABLE "MarketBid" ADD CONSTRAINT "MarketBid_bidderCharacterId_fkey" FOREIGN KEY ("bidderCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE;

CREATE TABLE "MarketClaimBoxEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRefId" TEXT,
  "itemKey" TEXT,
  "itemQty" INTEGER,
  "currency" TEXT,
  "amount" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MarketClaimBoxEntry_characterId_status_idx" ON "MarketClaimBoxEntry"("characterId", "status");
CREATE INDEX "MarketClaimBoxEntry_source_sourceRefId_idx" ON "MarketClaimBoxEntry"("source", "sourceRefId");
CREATE INDEX "MarketClaimBoxEntry_status_expiresAt_idx" ON "MarketClaimBoxEntry"("status", "expiresAt");
ALTER TABLE "MarketClaimBoxEntry" ADD CONSTRAINT "MarketClaimBoxEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE;

CREATE TABLE "MarketPriceSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "itemKey" TEXT NOT NULL,
  "avgPrice24h" BIGINT NOT NULL DEFAULT 0,
  "avgPrice7d" BIGINT NOT NULL DEFAULT 0,
  "avgPrice30d" BIGINT NOT NULL DEFAULT 0,
  "minPrice" BIGINT NOT NULL DEFAULT 0,
  "maxPrice" BIGINT NOT NULL DEFAULT 0,
  "volume24h" BIGINT NOT NULL DEFAULT 0,
  "volume7d" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MarketPriceSnapshot_itemKey_key" ON "MarketPriceSnapshot"("itemKey");
CREATE INDEX "MarketPriceSnapshot_updatedAt_idx" ON "MarketPriceSnapshot"("updatedAt");

CREATE TABLE "MarketItemPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "itemKey" TEXT NOT NULL,
  "tradability" TEXT NOT NULL,
  "minPrice" BIGINT,
  "maxPrice" BIGINT,
  "maxListingsPerDay" INTEGER,
  "maxQtyPerListing" INTEGER,
  "taxRatePctOverride" DOUBLE PRECISION,
  "listingFeeFlatOverride" BIGINT,
  "reason" TEXT,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MarketItemPolicy_itemKey_key" ON "MarketItemPolicy"("itemKey");
CREATE INDEX "MarketItemPolicy_tradability_idx" ON "MarketItemPolicy"("tradability");

CREATE TABLE "PersonalStall" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "stallName" TEXT NOT NULL,
  "description" TEXT,
  "slotLimit" INTEGER NOT NULL DEFAULT 6,
  "autoRenewEnabled" BOOLEAN NOT NULL DEFAULT false,
  "themeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PersonalStall_characterId_key" ON "PersonalStall"("characterId");
ALTER TABLE "PersonalStall" ADD CONSTRAINT "PersonalStall_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE;

CREATE TABLE "SectTreasuryItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sectId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "lockedQty" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SectTreasuryItem_sectId_itemKey_key" ON "SectTreasuryItem"("sectId", "itemKey");
CREATE INDEX "SectTreasuryItem_sectId_idx" ON "SectTreasuryItem"("sectId");
ALTER TABLE "SectTreasuryItem" ADD CONSTRAINT "SectTreasuryItem_sectId_fkey" FOREIGN KEY ("sectId") REFERENCES "Sect"("id") ON DELETE CASCADE;

CREATE TABLE "SectTreasuryLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sectId" TEXT NOT NULL,
  "actorCharacterId" TEXT,
  "actorAdminId" TEXT,
  "action" TEXT NOT NULL,
  "itemKey" TEXT,
  "quantity" INTEGER,
  "reason" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SectTreasuryLog_sectId_createdAt_idx" ON "SectTreasuryLog"("sectId", "createdAt");
CREATE INDEX "SectTreasuryLog_action_createdAt_idx" ON "SectTreasuryLog"("action", "createdAt");
ALTER TABLE "SectTreasuryLog" ADD CONSTRAINT "SectTreasuryLog_sectId_fkey" FOREIGN KEY ("sectId") REFERENCES "Sect"("id") ON DELETE CASCADE;

CREATE TABLE "SectInternalAuction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sectId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "startPrice" BIGINT NOT NULL,
  "minBidStep" BIGINT NOT NULL,
  "currentBid" BIGINT,
  "currentBidderId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "finalizedAt" TIMESTAMP(3),
  "createdByCharacterId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SectInternalAuction_sectId_status_idx" ON "SectInternalAuction"("sectId", "status");
CREATE INDEX "SectInternalAuction_status_endsAt_idx" ON "SectInternalAuction"("status", "endsAt");
ALTER TABLE "SectInternalAuction" ADD CONSTRAINT "SectInternalAuction_sectId_fkey" FOREIGN KEY ("sectId") REFERENCES "Sect"("id") ON DELETE CASCADE;

CREATE TABLE "SectInternalAuctionBid" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sectAuctionId" TEXT NOT NULL,
  "bidderCharacterId" TEXT NOT NULL,
  "bidAmount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SectInternalAuctionBid_sectAuctionId_createdAt_idx" ON "SectInternalAuctionBid"("sectAuctionId", "createdAt");
CREATE INDEX "SectInternalAuctionBid_bidderCharacterId_createdAt_idx" ON "SectInternalAuctionBid"("bidderCharacterId", "createdAt");
ALTER TABLE "SectInternalAuctionBid" ADD CONSTRAINT "SectInternalAuctionBid_sectAuctionId_fkey" FOREIGN KEY ("sectAuctionId") REFERENCES "SectInternalAuction"("id") ON DELETE CASCADE;
ALTER TABLE "SectInternalAuctionBid" ADD CONSTRAINT "SectInternalAuctionBid_bidderCharacterId_fkey" FOREIGN KEY ("bidderCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE;

-- =========================================================================
-- Phase 32.0 — Tu Tiên Bách Khoa / Content Codex
-- =========================================================================

CREATE TABLE "CodexEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entryKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "refKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "iconKey" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
  "tagsJson" JSONB NOT NULL DEFAULT '[]',
  "sourceHintsJson" JSONB NOT NULL DEFAULT '[]',
  "usageHintsJson" JSONB NOT NULL DEFAULT '[]',
  "relatedEntryKeysJson" JSONB NOT NULL DEFAULT '[]',
  "realmRequired" TEXT,
  "quality" TEXT,
  "tier" INTEGER,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CodexEntry_entryKey_key" ON "CodexEntry"("entryKey");
CREATE INDEX "CodexEntry_type_idx" ON "CodexEntry"("type");
CREATE INDEX "CodexEntry_refKey_idx" ON "CodexEntry"("refKey");
CREATE INDEX "CodexEntry_visibility_idx" ON "CodexEntry"("visibility");

CREATE TABLE "CharacterCodexProgress" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "entryKey" TEXT NOT NULL,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "context" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "CharacterCodexProgress_characterId_entryKey_key" ON "CharacterCodexProgress"("characterId", "entryKey");
CREATE INDEX "CharacterCodexProgress_characterId_idx" ON "CharacterCodexProgress"("characterId");
CREATE INDEX "CharacterCodexProgress_entryKey_idx" ON "CharacterCodexProgress"("entryKey");
ALTER TABLE "CharacterCodexProgress" ADD CONSTRAINT "CharacterCodexProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE;

CREATE TABLE "CodexAuditIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issueKey" TEXT NOT NULL,
  "entryKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CodexAuditIssue_issueKey_key" ON "CodexAuditIssue"("issueKey");
CREATE INDEX "CodexAuditIssue_entryKey_idx" ON "CodexAuditIssue"("entryKey");
CREATE INDEX "CodexAuditIssue_severity_resolved_idx" ON "CodexAuditIssue"("severity", "resolved");

CREATE TABLE "CodexReindexLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "triggeredBy" TEXT NOT NULL,
  "entriesUpserted" INTEGER NOT NULL DEFAULT 0,
  "entriesRemoved" INTEGER NOT NULL DEFAULT 0,
  "issuesFound" INTEGER NOT NULL DEFAULT 0,
  "summaryJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CodexReindexLog_createdAt_idx" ON "CodexReindexLog"("createdAt");

-- =========================================================================
-- Phase 30.0 — MarketAnomaly (V2 broader than Phase 16.4 MarketTradeAnomaly)
-- =========================================================================

CREATE TABLE "MarketAnomaly" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "anomalyType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "sellerCharacterId" TEXT,
  "buyerCharacterId" TEXT,
  "listingId" TEXT,
  "auctionId" TEXT,
  "totalValue" BIGINT,
  "detailJson" JSONB NOT NULL DEFAULT '{}',
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MarketAnomaly_anomalyType_createdAt_idx" ON "MarketAnomaly"("anomalyType", "createdAt");
CREATE INDEX "MarketAnomaly_severity_resolvedAt_idx" ON "MarketAnomaly"("severity", "resolvedAt");
CREATE INDEX "MarketAnomaly_sellerCharacterId_idx" ON "MarketAnomaly"("sellerCharacterId");
CREATE INDEX "MarketAnomaly_buyerCharacterId_idx" ON "MarketAnomaly"("buyerCharacterId");
