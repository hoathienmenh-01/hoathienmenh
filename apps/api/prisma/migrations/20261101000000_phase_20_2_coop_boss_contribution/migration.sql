-- Phase 20.2 — Co-op Boss / World Boss Party Contribution.
--
-- Additive migration. Soft-ref pattern (mirror Phase 19.4 Party +
-- Phase 20.1 Party Dungeon): KHÔNG FK constraint tới Party /
-- WorldBoss / User để tránh cross-shard issues + cho phép prune
-- row mà không cascade. Service `CoopBossService` enforce
-- invariants (xem `apps/api/src/modules/coop-boss/coop-boss.service.ts`).
--
-- KHÔNG drop / alter table cũ. KHÔNG đụng boss solo / sect / world
-- boss flow hiện có (Phase 7 / 12.6).

-- CreateEnum
CREATE TYPE "CoopBossStatus" AS ENUM ('LOBBY', 'IN_PROGRESS', 'CLEARED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CoopBossRewardClaimStatus" AS ENUM ('PENDING', 'CLAIMED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "CoopBossContributionTier" AS ENUM ('NONE', 'LOW', 'NORMAL', 'HIGH', 'MVP');

-- CreateTable
CREATE TABLE "CoopBossRun" (
    "id" TEXT NOT NULL,
    "bossKey" TEXT NOT NULL,
    "partyId" TEXT,
    "worldBossEventId" TEXT,
    "status" "CoopBossStatus" NOT NULL DEFAULT 'LOBBY',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "resultSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopBossRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoopBossRun_partyId_status_idx" ON "CoopBossRun"("partyId", "status");

-- CreateIndex
CREATE INDEX "CoopBossRun_bossKey_status_idx" ON "CoopBossRun"("bossKey", "status");

-- CreateIndex
CREATE INDEX "CoopBossRun_status_startedAt_idx" ON "CoopBossRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "CoopBossRun_worldBossEventId_status_idx" ON "CoopBossRun"("worldBossEventId", "status");

-- CreateTable
CREATE TABLE "CoopBossParticipant" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "partyId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "eligibleForReward" BOOLEAN NOT NULL DEFAULT true,
    "finalContributionScore" INTEGER,

    CONSTRAINT "CoopBossParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopBossParticipant_runId_userId_key" ON "CoopBossParticipant"("runId", "userId");

-- CreateIndex
CREATE INDEX "CoopBossParticipant_runId_leftAt_idx" ON "CoopBossParticipant"("runId", "leftAt");

-- CreateIndex
CREATE INDEX "CoopBossParticipant_userId_joinedAt_idx" ON "CoopBossParticipant"("userId", "joinedAt");

-- CreateTable
CREATE TABLE "CoopBossContribution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "damageDone" BIGINT NOT NULL DEFAULT 0,
    "supportScore" INTEGER NOT NULL DEFAULT 0,
    "survivalSeconds" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "contributionScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopBossContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopBossContribution_runId_participantId_key" ON "CoopBossContribution"("runId", "participantId");

-- CreateIndex
CREATE INDEX "CoopBossContribution_runId_contributionScore_idx" ON "CoopBossContribution"("runId", "contributionScore");

-- CreateTable
CREATE TABLE "CoopBossRewardClaim" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "CoopBossRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rewardTier" "CoopBossContributionTier" NOT NULL DEFAULT 'NONE',
    "rewardJson" JSONB NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopBossRewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoopBossRewardClaim_runId_userId_key" ON "CoopBossRewardClaim"("runId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CoopBossRewardClaim_runId_characterId_key" ON "CoopBossRewardClaim"("runId", "characterId");

-- CreateIndex
CREATE INDEX "CoopBossRewardClaim_userId_status_idx" ON "CoopBossRewardClaim"("userId", "status");

-- CreateIndex
CREATE INDEX "CoopBossRewardClaim_runId_status_idx" ON "CoopBossRewardClaim"("runId", "status");
