-- Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2 (additive).
--
-- Thêm 14 model additive cho event-builder. KHÔNG ALTER table cũ.
-- LiveOpsScheduledEvent (Phase 15.1) giữ nguyên — vẫn dùng cho event
-- runtime multiplier (boost / discount / festival gift).
--
-- Models:
--   - EventDef                — root catalog 1 event.
--   - EventBracket            — bracket per event.
--   - EventBalancePolicy      — cap & policy 1-1 với EventDef.
--   - EventItemConfig         — item event (token / chest / ticket / cosmetic).
--   - EventMissionDef         — nhiệm vụ event.
--   - EventMissionProgress    — tiến độ per character per mission.
--   - EventShopDef            — shop event group.
--   - EventShopItemDef        — item trong shop event.
--   - EventShopPurchase       — lịch sử mua shop event.
--   - EventTokenWallet        — số dư token event per character.
--   - EventBossDef            — boss event runtime spec.
--   - EventRankingDef         — bảng ranking event.
--   - EventRankingEntry       — score per character per ranking.
--   - PersonalEventProgress   — instance event cá nhân (auto trigger).
--
-- AdminAuditLog Phase 18.x giữ nguyên — meta JSON extend ở application layer.

CREATE TABLE "EventDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "bannerUrl" TEXT,
    "iconUrl" TEXT,
    "adminNote" TEXT,
    "playerNotice" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "bracketMode" TEXT NOT NULL DEFAULT 'NONE',
    "tokenKey" TEXT,
    "eventShopKey" TEXT,
    "missionGroupKey" TEXT,
    "bossGroupKey" TEXT,
    "rankingGroupKey" TEXT,
    "rewardProfileKey" TEXT,
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventDef_key_key" ON "EventDef"("key");
CREATE INDEX "EventDef_status_startsAt_idx" ON "EventDef"("status", "startsAt");
CREATE INDEX "EventDef_status_endsAt_idx" ON "EventDef"("status", "endsAt");
CREATE INDEX "EventDef_eventType_status_idx" ON "EventDef"("eventType", "status");
CREATE INDEX "EventDef_enabled_status_idx" ON "EventDef"("enabled", "status");

ALTER TABLE "EventDef" ADD CONSTRAINT "EventDef_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventDef" ADD CONSTRAINT "EventDef_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventBracket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minRealmOrder" INTEGER NOT NULL,
    "maxRealmOrder" INTEGER NOT NULL,
    "minBodyRealmOrder" INTEGER,
    "maxBodyRealmOrder" INTEGER,
    "bracketTier" INTEGER NOT NULL,
    "rewardTierMin" INTEGER NOT NULL,
    "rewardTierMax" INTEGER NOT NULL,
    "eventMaxTier" INTEGER NOT NULL,
    "rankingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "shopFilterTier" INTEGER NOT NULL DEFAULT 9,
    "bossPowerMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "missionScalingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBracket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventBracket_key_key" ON "EventBracket"("key");
CREATE UNIQUE INDEX "EventBracket_eventKey_key_key" ON "EventBracket"("eventKey", "key");
CREATE INDEX "EventBracket_eventKey_enabled_idx" ON "EventBracket"("eventKey", "enabled");
CREATE INDEX "EventBracket_minRealmOrder_maxRealmOrder_idx" ON "EventBracket"("minRealmOrder", "maxRealmOrder");

ALTER TABLE "EventBracket" ADD CONSTRAINT "EventBracket_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventBalancePolicy" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "maxTokenPerDay" INTEGER NOT NULL,
    "maxTokenPerWeek" INTEGER NOT NULL,
    "maxTokenPerEvent" INTEGER NOT NULL,
    "maxRareRewardPerDay" INTEGER NOT NULL DEFAULT 2,
    "maxRareRewardPerWeek" INTEGER NOT NULL DEFAULT 5,
    "maxShopRareExchangePerEvent" INTEGER NOT NULL DEFAULT 10,
    "allowHighLevelEnterLowBracket" BOOLEAN NOT NULL DEFAULT true,
    "highLevelLowBracketTokenPenaltyPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "highLevelLowBracketRankingDisabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceTierRewardCap" INTEGER NOT NULL DEFAULT 9,
    "maxAllowedRewardTierDelta" INTEGER NOT NULL DEFAULT 1,
    "paidRewardPolicy" TEXT NOT NULL DEFAULT 'FREE_ONLY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBalancePolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventBalancePolicy_eventKey_key" ON "EventBalancePolicy"("eventKey");
CREATE INDEX "EventBalancePolicy_enabled_idx" ON "EventBalancePolicy"("enabled");

ALTER TABLE "EventBalancePolicy" ADD CONSTRAINT "EventBalancePolicy_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventBalancePolicy" ADD CONSTRAINT "EventBalancePolicy_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventItemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "itemKind" TEXT NOT NULL,
    "itemTier" INTEGER NOT NULL DEFAULT 1,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "category" TEXT NOT NULL DEFAULT 'event',
    "expiresAt" TIMESTAMP(3),
    "tradeable" BOOLEAN NOT NULL DEFAULT false,
    "bindOnPickup" BOOLEAN NOT NULL DEFAULT true,
    "maxStack" INTEGER NOT NULL DEFAULT 99999,
    "dailyGainCap" INTEGER,
    "weeklyGainCap" INTEGER,
    "eventGainCap" INTEGER,
    "allowedSourcesJson" JSONB NOT NULL DEFAULT '[]',
    "forbiddenSourcesJson" JSONB NOT NULL DEFAULT '[]',
    "sourceHint" TEXT,
    "lootTableJson" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventItemConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventItemConfig_key_key" ON "EventItemConfig"("key");
CREATE INDEX "EventItemConfig_eventKey_enabled_idx" ON "EventItemConfig"("eventKey", "enabled");
CREATE INDEX "EventItemConfig_itemKind_enabled_idx" ON "EventItemConfig"("itemKind", "enabled");

ALTER TABLE "EventItemConfig" ADD CONSTRAINT "EventItemConfig_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventMissionDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "bracketKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "missionType" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "resetType" TEXT NOT NULL DEFAULT 'EVENT_ONCE',
    "rewardProfileKey" TEXT,
    "scoreAmount" INTEGER NOT NULL DEFAULT 0,
    "tokenReward" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMissionDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventMissionDef_key_key" ON "EventMissionDef"("key");
CREATE INDEX "EventMissionDef_eventKey_enabled_idx" ON "EventMissionDef"("eventKey", "enabled");
CREATE INDEX "EventMissionDef_bracketKey_enabled_idx" ON "EventMissionDef"("bracketKey", "enabled");

ALTER TABLE "EventMissionDef" ADD CONSTRAINT "EventMissionDef_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventMissionProgress" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "missionKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "bracketKey" TEXT,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "resetCycleId" TEXT NOT NULL DEFAULT 'EVENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMissionProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventMissionProgress_missionKey_characterId_resetCycleId_key" ON "EventMissionProgress"("missionKey", "characterId", "resetCycleId");
CREATE INDEX "EventMissionProgress_characterId_eventKey_idx" ON "EventMissionProgress"("characterId", "eventKey");
CREATE INDEX "EventMissionProgress_eventKey_missionKey_idx" ON "EventMissionProgress"("eventKey", "missionKey");

ALTER TABLE "EventMissionProgress" ADD CONSTRAINT "EventMissionProgress_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventMissionProgress" ADD CONSTRAINT "EventMissionProgress_missionKey_fkey" FOREIGN KEY ("missionKey") REFERENCES "EventMissionDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventMissionProgress" ADD CONSTRAINT "EventMissionProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventShopDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenCurrencyKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventShopDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventShopDef_key_key" ON "EventShopDef"("key");
CREATE INDEX "EventShopDef_eventKey_enabled_idx" ON "EventShopDef"("eventKey", "enabled");

ALTER TABLE "EventShopDef" ADD CONSTRAINT "EventShopDef_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventShopItemDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "shopKey" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "rewardsJson" JSONB NOT NULL DEFAULT '[]',
    "priceTokenAmount" INTEGER NOT NULL,
    "requiredBracketKey" TEXT,
    "minRealmOrder" INTEGER,
    "maxRealmOrder" INTEGER,
    "purchaseLimitDaily" INTEGER,
    "purchaseLimitWeekly" INTEGER,
    "purchaseLimitEvent" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventShopItemDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventShopItemDef_key_key" ON "EventShopItemDef"("key");
CREATE INDEX "EventShopItemDef_shopKey_enabled_idx" ON "EventShopItemDef"("shopKey", "enabled");

ALTER TABLE "EventShopItemDef" ADD CONSTRAINT "EventShopItemDef_shopKey_fkey" FOREIGN KEY ("shopKey") REFERENCES "EventShopDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventShopPurchase" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "shopItemKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "pricePaid" INTEGER NOT NULL,
    "resetDay" TEXT NOT NULL,
    "resetWeek" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventShopPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventShopPurchase_characterId_eventKey_createdAt_idx" ON "EventShopPurchase"("characterId", "eventKey", "createdAt" DESC);
CREATE INDEX "EventShopPurchase_eventKey_shopItemKey_idx" ON "EventShopPurchase"("eventKey", "shopItemKey");
CREATE INDEX "EventShopPurchase_shopItemKey_characterId_resetDay_idx" ON "EventShopPurchase"("shopItemKey", "characterId", "resetDay");
CREATE INDEX "EventShopPurchase_shopItemKey_characterId_resetWeek_idx" ON "EventShopPurchase"("shopItemKey", "characterId", "resetWeek");

ALTER TABLE "EventShopPurchase" ADD CONSTRAINT "EventShopPurchase_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventShopPurchase" ADD CONSTRAINT "EventShopPurchase_shopItemKey_fkey" FOREIGN KEY ("shopItemKey") REFERENCES "EventShopItemDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventShopPurchase" ADD CONSTRAINT "EventShopPurchase_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventTokenWallet" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "tokenKey" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "dailyEarned" INTEGER NOT NULL DEFAULT 0,
    "weeklyEarned" INTEGER NOT NULL DEFAULT 0,
    "eventEarned" INTEGER NOT NULL DEFAULT 0,
    "resetDay" TEXT NOT NULL DEFAULT '',
    "resetWeek" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTokenWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventTokenWallet_eventKey_characterId_tokenKey_key" ON "EventTokenWallet"("eventKey", "characterId", "tokenKey");
CREATE INDEX "EventTokenWallet_characterId_eventKey_idx" ON "EventTokenWallet"("characterId", "eventKey");

ALTER TABLE "EventTokenWallet" ADD CONSTRAINT "EventTokenWallet_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTokenWallet" ADD CONSTRAINT "EventTokenWallet_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventBossDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "bracketKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "bossType" TEXT NOT NULL,
    "sourceTier" INTEGER NOT NULL,
    "bossTier" INTEGER NOT NULL,
    "recommendedPower" INTEGER NOT NULL DEFAULT 0,
    "hpFormulaKey" TEXT,
    "scheduleKey" TEXT,
    "participationRewardProfileKey" TEXT,
    "damageRankingRewardProfileKey" TEXT,
    "lastHitRewardProfileKey" TEXT,
    "sectRewardProfileKey" TEXT,
    "dailyAttempts" INTEGER NOT NULL DEFAULT 3,
    "weeklyAttempts" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBossDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventBossDef_key_key" ON "EventBossDef"("key");
CREATE INDEX "EventBossDef_eventKey_enabled_idx" ON "EventBossDef"("eventKey", "enabled");
CREATE INDEX "EventBossDef_bracketKey_enabled_idx" ON "EventBossDef"("bracketKey", "enabled");

ALTER TABLE "EventBossDef" ADD CONSTRAINT "EventBossDef_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventRankingDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "rankingType" TEXT NOT NULL,
    "bracketMode" TEXT NOT NULL,
    "bracketKey" TEXT,
    "scoreFormulaKey" TEXT NOT NULL,
    "rewardProfileKey" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRankingDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventRankingDef_key_key" ON "EventRankingDef"("key");
CREATE INDEX "EventRankingDef_eventKey_enabled_idx" ON "EventRankingDef"("eventKey", "enabled");

ALTER TABLE "EventRankingDef" ADD CONSTRAINT "EventRankingDef_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventRankingEntry" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "rankingKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "bracketKey" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "rewardClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRankingEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventRankingEntry_rankingKey_characterId_key" ON "EventRankingEntry"("rankingKey", "characterId");
CREATE INDEX "EventRankingEntry_rankingKey_bracketKey_score_idx" ON "EventRankingEntry"("rankingKey", "bracketKey", "score" DESC);
CREATE INDEX "EventRankingEntry_characterId_eventKey_idx" ON "EventRankingEntry"("characterId", "eventKey");

ALTER TABLE "EventRankingEntry" ADD CONSTRAINT "EventRankingEntry_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventRankingEntry" ADD CONSTRAINT "EventRankingEntry_rankingKey_fkey" FOREIGN KEY ("rankingKey") REFERENCES "EventRankingDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventRankingEntry" ADD CONSTRAINT "EventRankingEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonalEventProgress" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerValue" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "bracketTier" INTEGER NOT NULL DEFAULT 1,
    "rewardSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalEventProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalEventProgress_eventKey_characterId_key" ON "PersonalEventProgress"("eventKey", "characterId");
CREATE INDEX "PersonalEventProgress_characterId_expiresAt_idx" ON "PersonalEventProgress"("characterId", "expiresAt");
CREATE INDEX "PersonalEventProgress_eventKey_triggerType_idx" ON "PersonalEventProgress"("eventKey", "triggerType");

ALTER TABLE "PersonalEventProgress" ADD CONSTRAINT "PersonalEventProgress_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "EventDef"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalEventProgress" ADD CONSTRAINT "PersonalEventProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
