-- Phase 27.0 — Monetization Foundation
-- Additive: extend CurrencyKind enum + 5 new models + alter MonthlyCardSubscription
-- to composite unique key (characterId, cardKey) to support multiple card variants
-- per character.

-- 1. Extend CurrencyKind enum (additive).
ALTER TYPE "CurrencyKind" ADD VALUE IF NOT EXISTS 'TIEN_NGOC_KHOA';
ALTER TYPE "CurrencyKind" ADD VALUE IF NOT EXISTS 'CONG_HIEN_TONG_MON';
ALTER TYPE "CurrencyKind" ADD VALUE IF NOT EXISTS 'TRIAL_POINT';
ALTER TYPE "CurrencyKind" ADD VALUE IF NOT EXISTS 'EVENT_TOKEN';

-- 1b. Character — add trialPoint + eventToken columns (additive).
ALTER TABLE "Character"
  ADD COLUMN "trialPoint" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eventToken" INTEGER NOT NULL DEFAULT 0;

-- 2. MonthlyCardSubscription — drop single-character unique, add cardKey,
--    add composite unique (characterId, cardKey).
ALTER TABLE "MonthlyCardSubscription"
  ADD COLUMN "cardKey" TEXT NOT NULL DEFAULT 'tieu_nguyet_tap';

DROP INDEX IF EXISTS "MonthlyCardSubscription_characterId_key";

ALTER TABLE "MonthlyCardSubscription"
  ADD CONSTRAINT "MonthlyCardSubscription_characterId_cardKey_key"
  UNIQUE ("characterId", "cardKey");

-- 3. PremiumEntitlement
CREATE TABLE "PremiumEntitlement" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "entitlementKey" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "valueJson" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PremiumEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PremiumEntitlement_characterId_entitlementKey_key"
  ON "PremiumEntitlement"("characterId", "entitlementKey");
CREATE INDEX "PremiumEntitlement_characterId_active_expiresAt_idx"
  ON "PremiumEntitlement"("characterId", "active", "expiresAt");
CREATE INDEX "PremiumEntitlement_entitlementKey_idx"
  ON "PremiumEntitlement"("entitlementKey");

ALTER TABLE "PremiumEntitlement"
  ADD CONSTRAINT "PremiumEntitlement_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. MonetizationShopPurchase
CREATE TABLE "MonetizationShopPurchase" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "productKey" TEXT NOT NULL,
  "productType" TEXT NOT NULL,
  "priceCurrency" "CurrencyKind" NOT NULL,
  "priceAmount" INTEGER NOT NULL,
  "rewardJson" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "periodKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonetizationShopPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MonetizationShopPurchase_characterId_productKey_periodKey_idx"
  ON "MonetizationShopPurchase"("characterId", "productKey", "periodKey");
CREATE INDEX "MonetizationShopPurchase_characterId_productKey_createdAt_idx"
  ON "MonetizationShopPurchase"("characterId", "productKey", "createdAt");
CREATE INDEX "MonetizationShopPurchase_productKey_createdAt_idx"
  ON "MonetizationShopPurchase"("productKey", "createdAt");

ALTER TABLE "MonetizationShopPurchase"
  ADD CONSTRAINT "MonetizationShopPurchase_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. PaidLimitPurchase
CREATE TABLE "PaidLimitPurchase" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "limitKey" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "maxCount" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaidLimitPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaidLimitPurchase_characterId_limitKey_periodKey_key"
  ON "PaidLimitPurchase"("characterId", "limitKey", "periodKey");
CREATE INDEX "PaidLimitPurchase_characterId_limitKey_idx"
  ON "PaidLimitPurchase"("characterId", "limitKey");

ALTER TABLE "PaidLimitPurchase"
  ADD CONSTRAINT "PaidLimitPurchase_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. SweepTicketLog
CREATE TABLE "SweepTicketLog" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "ticketKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "contentKey" TEXT NOT NULL,
  "rewardJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SweepTicketLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SweepTicketLog_characterId_createdAt_idx"
  ON "SweepTicketLog"("characterId", "createdAt");
CREATE INDEX "SweepTicketLog_characterId_contentType_contentKey_createdAt_idx"
  ON "SweepTicketLog"("characterId", "contentType", "contentKey", "createdAt");

ALTER TABLE "SweepTicketLog"
  ADD CONSTRAINT "SweepTicketLog_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. GrowthFundState
CREATE TABLE "GrowthFundState" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "fundKey" TEXT NOT NULL,
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedMilestonesJson" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthFundState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrowthFundState_characterId_fundKey_key"
  ON "GrowthFundState"("characterId", "fundKey");
CREATE INDEX "GrowthFundState_characterId_idx"
  ON "GrowthFundState"("characterId");

ALTER TABLE "GrowthFundState"
  ADD CONSTRAINT "GrowthFundState_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
