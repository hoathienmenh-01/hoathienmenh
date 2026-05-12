CREATE TABLE "BattlePassSeason" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattlePassSeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BattlePassProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "premiumUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "claimedFreeLevels" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "claimedPremiumLevels" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattlePassProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonthlyCardSubscription" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "activeUntil" TIMESTAMP(3) NOT NULL,
    "lastClaimAt" TIMESTAMP(3),
    "totalClaimedDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyCardSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VipProfile" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "vipLevel" INTEGER NOT NULL DEFAULT 0,
    "lifetimeTopupAmount" INTEGER NOT NULL DEFAULT 0,
    "grantedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VipProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BattlePassSeason_seasonId_key" ON "BattlePassSeason"("seasonId");
CREATE INDEX "BattlePassSeason_active_startAt_endAt_idx" ON "BattlePassSeason"("active", "startAt", "endAt");
CREATE UNIQUE INDEX "BattlePassProgress_characterId_seasonId_key" ON "BattlePassProgress"("characterId", "seasonId");
CREATE INDEX "BattlePassProgress_seasonId_level_idx" ON "BattlePassProgress"("seasonId", "level");
CREATE UNIQUE INDEX "MonthlyCardSubscription_characterId_key" ON "MonthlyCardSubscription"("characterId");
CREATE INDEX "MonthlyCardSubscription_activeUntil_idx" ON "MonthlyCardSubscription"("activeUntil");
CREATE UNIQUE INDEX "VipProfile_characterId_key" ON "VipProfile"("characterId");
CREATE INDEX "VipProfile_vipLevel_idx" ON "VipProfile"("vipLevel");

ALTER TABLE "BattlePassProgress" ADD CONSTRAINT "BattlePassProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BattlePassProgress" ADD CONSTRAINT "BattlePassProgress_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "BattlePassSeason"("seasonId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonthlyCardSubscription" ADD CONSTRAINT "MonthlyCardSubscription_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VipProfile" ADD CONSTRAINT "VipProfile_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
