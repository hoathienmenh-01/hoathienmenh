-- Phase 27.1–27.5 — Monetization Systems V1
-- Additive: 2 new models for battle pass missions + limited periodic shop.
-- KHÔNG sửa table cũ; chỉ thêm bảng mới + index.

-- 1. BattlePassMissionProgress
CREATE TABLE "BattlePassMissionProgress" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "missionKey" TEXT NOT NULL,
  "scopeBucket" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "target" INTEGER NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BattlePassMissionProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BattlePassMissionProgress_characterId_seasonId_missionKey_scopeBucket_key"
  ON "BattlePassMissionProgress"("characterId", "seasonId", "missionKey", "scopeBucket");
CREATE INDEX "BattlePassMissionProgress_characterId_seasonId_idx"
  ON "BattlePassMissionProgress"("characterId", "seasonId");
CREATE INDEX "BattlePassMissionProgress_characterId_completed_claimedAt_idx"
  ON "BattlePassMissionProgress"("characterId", "completed", "claimedAt");

ALTER TABLE "BattlePassMissionProgress"
  ADD CONSTRAINT "BattlePassMissionProgress_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. LimitedShopPurchase
CREATE TABLE "LimitedShopPurchase" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "shopKey" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "priceCurrency" TEXT NOT NULL,
  "priceAmount" INTEGER NOT NULL,
  "rewardJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LimitedShopPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LimitedShopPurchase_characterId_shopKey_itemKey_periodKey_key"
  ON "LimitedShopPurchase"("characterId", "shopKey", "itemKey", "periodKey");
CREATE INDEX "LimitedShopPurchase_characterId_shopKey_periodKey_idx"
  ON "LimitedShopPurchase"("characterId", "shopKey", "periodKey");

ALTER TABLE "LimitedShopPurchase"
  ADD CONSTRAINT "LimitedShopPurchase_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
