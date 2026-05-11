-- Phase 20.1 — Party Dungeon / Co-op PvE Foundation.
--
-- Adds:
--   - 3 enum: `PartyDungeonRoomStatus`, `PartyDungeonRunResult`,
--     `PartyDungeonRewardClaimStatus`.
--   - 4 model: `PartyDungeonRoom`, `PartyDungeonParticipant`,
--     `PartyDungeonRun`, `PartyDungeonRewardClaim`.
--
-- Soft-ref pattern (KHÔNG FK constraint, mirror Phase 19.4 Party
-- system). Service `PartyDungeonService` enforce ownership / role /
-- party-membership invariants.
--
-- UNIQUE indexes phục vụ idempotency + race-safety:
--   - PartyDungeonParticipant UNIQUE (roomId, userId) → 1 user 1
--     slot trong cùng room.
--   - PartyDungeonRewardClaim UNIQUE (runId, characterId) → 1
--     character 1 claim row / run. CAS guard chống duplicate claim.
--   - PartyDungeonRewardClaim UNIQUE (runId, userId) → defense
--     in-depth: nếu user đổi character giữa join và claim, vẫn chỉ
--     1 claim row / user / run.
--
-- Indexes phục vụ query:
--   - PartyDungeonRoom: (partyId, status) để check active room per
--     party; (leaderUserId, status, createdAt) cho admin debug;
--     (status, createdAt) cho prune cron.
--   - PartyDungeonParticipant: (userId, leftAt) để find active
--     participation; (roomId, leftAt) cho list active members.
--   - PartyDungeonRun: (roomId) để find run by room; (partyId,
--     startedAt DESC) cho per-party history; (dungeonKey, startedAt
--     DESC) cho per-dungeon stats.
--   - PartyDungeonRewardClaim: (userId, status) cho user's pending
--     rewards inbox; (runId, status) cho run-level summary.
--
-- Migration additive — không touch row dữ liệu cũ. Rollback an
-- toàn: DROP TABLE 4 models + DROP TYPE 3 enums.

-- CreateEnum
CREATE TYPE "PartyDungeonRoomStatus" AS ENUM ('LOBBY', 'READY_CHECK', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PartyDungeonRunResult" AS ENUM ('CLEAR', 'FAIL', 'CANCELED');

-- CreateEnum
CREATE TYPE "PartyDungeonRewardClaimStatus" AS ENUM ('PENDING', 'CLAIMED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "PartyDungeonRoom" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "leaderUserId" TEXT NOT NULL,
    "dungeonKey" TEXT NOT NULL,
    "status" "PartyDungeonRoomStatus" NOT NULL DEFAULT 'LOBBY',
    "minMembers" INTEGER NOT NULL DEFAULT 2,
    "maxMembers" INTEGER NOT NULL DEFAULT 5,
    "currentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyDungeonRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyDungeonParticipant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT,
    "readyAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "resultStatus" "PartyDungeonRunResult",

    CONSTRAINT "PartyDungeonParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyDungeonRun" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "dungeonKey" TEXT NOT NULL,
    "result" "PartyDungeonRunResult" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "combatSummaryJson" JSONB,
    "rewardSummaryJson" JSONB,

    CONSTRAINT "PartyDungeonRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyDungeonRewardClaim" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "PartyDungeonRewardClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rewardJson" JSONB NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyDungeonRewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyDungeonRoom_partyId_status_idx" ON "PartyDungeonRoom"("partyId", "status");

-- CreateIndex
CREATE INDEX "PartyDungeonRoom_leaderUserId_status_createdAt_idx" ON "PartyDungeonRoom"("leaderUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PartyDungeonRoom_status_createdAt_idx" ON "PartyDungeonRoom"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartyDungeonParticipant_roomId_userId_key" ON "PartyDungeonParticipant"("roomId", "userId");

-- CreateIndex
CREATE INDEX "PartyDungeonParticipant_userId_leftAt_idx" ON "PartyDungeonParticipant"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "PartyDungeonParticipant_roomId_leftAt_idx" ON "PartyDungeonParticipant"("roomId", "leftAt");

-- CreateIndex
CREATE INDEX "PartyDungeonRun_roomId_idx" ON "PartyDungeonRun"("roomId");

-- CreateIndex
CREATE INDEX "PartyDungeonRun_partyId_startedAt_idx" ON "PartyDungeonRun"("partyId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "PartyDungeonRun_dungeonKey_startedAt_idx" ON "PartyDungeonRun"("dungeonKey", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PartyDungeonRewardClaim_runId_characterId_key" ON "PartyDungeonRewardClaim"("runId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyDungeonRewardClaim_runId_userId_key" ON "PartyDungeonRewardClaim"("runId", "userId");

-- CreateIndex
CREATE INDEX "PartyDungeonRewardClaim_userId_status_idx" ON "PartyDungeonRewardClaim"("userId", "status");

-- CreateIndex
CREATE INDEX "PartyDungeonRewardClaim_runId_status_idx" ON "PartyDungeonRewardClaim"("runId", "status");
