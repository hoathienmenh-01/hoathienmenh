-- Phase 20.3 — Co-op Reward Cap / Anti-leech / Weekly Contribution Season.
--
-- Additive migration. Soft-ref pattern (mirror Phase 19.4 / 20.1 / 20.2):
-- KHÔNG FK constraint tới User / Character để tránh cross-shard issues +
-- cho phép prune row mà không cascade. Service `CoopRewardCapService`
-- enforce business invariants.
--
-- KHÔNG drop / alter table cũ. KHÔNG đụng Phase 20.1 / 20.2 flow hiện có.

-- CreateEnum
CREATE TYPE "CoopWeeklySeasonStatus" AS ENUM ('ACTIVE', 'CLOSED', 'SETTLED');

-- CreateEnum
CREATE TYPE "CoopWeeklyRewardClaimStatus" AS ENUM ('PENDING', 'CLAIMED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "CoopRewardCapCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "rewardValueApprox" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopRewardCapCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopRewardCapCounter_userId_source_dayKey_key" ON "CoopRewardCapCounter"("userId", "source", "dayKey");

-- CreateIndex
CREATE INDEX "CoopRewardCapCounter_userId_source_weekKey_idx" ON "CoopRewardCapCounter"("userId", "source", "weekKey");

-- CreateIndex
CREATE INDEX "CoopRewardCapCounter_source_dayKey_idx" ON "CoopRewardCapCounter"("source", "dayKey");

-- CreateTable
CREATE TABLE "CoopWeeklyContributionSeason" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "CoopWeeklySeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "settledByAdminId" TEXT,

    CONSTRAINT "CoopWeeklyContributionSeason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopWeeklyContributionSeason_weekKey_key" ON "CoopWeeklyContributionSeason"("weekKey");

-- CreateIndex
CREATE INDEX "CoopWeeklyContributionSeason_status_endsAt_idx" ON "CoopWeeklyContributionSeason"("status", "endsAt");

-- CreateTable
CREATE TABLE "CoopWeeklyContributionEntry" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "bossContributionPoints" INTEGER NOT NULL DEFAULT 0,
    "dungeonContributionPoints" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "rewardTier" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopWeeklyContributionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopWeeklyContributionEntry_seasonId_userId_key" ON "CoopWeeklyContributionEntry"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "CoopWeeklyContributionEntry_seasonId_totalPoints_idx" ON "CoopWeeklyContributionEntry"("seasonId", "totalPoints");

-- CreateIndex
CREATE INDEX "CoopWeeklyContributionEntry_userId_idx" ON "CoopWeeklyContributionEntry"("userId");

-- AddForeignKey
ALTER TABLE "CoopWeeklyContributionEntry" ADD CONSTRAINT "CoopWeeklyContributionEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CoopWeeklyContributionSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CoopWeeklyRewardClaim" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rewardTier" TEXT NOT NULL,
    "rewardJson" JSONB NOT NULL,
    "status" "CoopWeeklyRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopWeeklyRewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopWeeklyRewardClaim_seasonId_userId_key" ON "CoopWeeklyRewardClaim"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "CoopWeeklyRewardClaim_userId_status_idx" ON "CoopWeeklyRewardClaim"("userId", "status");

-- CreateIndex
CREATE INDEX "CoopWeeklyRewardClaim_seasonId_status_idx" ON "CoopWeeklyRewardClaim"("seasonId", "status");

-- AddForeignKey
ALTER TABLE "CoopWeeklyRewardClaim" ADD CONSTRAINT "CoopWeeklyRewardClaim_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CoopWeeklyContributionSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
