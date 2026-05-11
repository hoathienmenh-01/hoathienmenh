-- Phase 19.4 — Group / Party System Upgrade.
--
-- Adds:
--   - 3 enum: `PartyStatus`, `PartyRole`, `PartyInviteStatus`.
--   - 3 model: `Party`, `PartyMember`, `PartyInvite`.
--
-- Soft-ref pattern (KHÔNG FK constraint, đồng nhất với Phase 19.1 /
-- 19.2 / 19.3). Service enforce ownership / role / membership.
--
-- Indexes phục vụ query:
--   - Party: (leaderUserId, status) để find-by-leader; (status,
--     createdAt) cho admin debug.
--   - PartyMember: UNIQUE (partyId, userId) chống duplicate; (userId,
--     leftAt) để check active membership của user; (partyId, leftAt)
--     cho list active members.
--   - PartyInvite: (inviteeUserId, status, createdAt DESC) cho inbox
--     invite; (partyId, status, createdAt DESC) cho leader xem pending;
--     (inviterUserId, status, createdAt DESC) cho outgoing list.
--
-- Migration additive — không touch row dữ liệu cũ. Rollback an toàn:
-- DROP TABLE PartyInvite + PartyMember + Party; DROP TYPE PartyStatus,
-- PartyRole, PartyInviteStatus.

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'DISBANDED');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "PartyInviteStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELED',
  'EXPIRED'
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "leaderUserId" TEXT NOT NULL,
    "name" TEXT,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxMembers" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disbandedAt" TIMESTAMP(3),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_leaderUserId_status_idx"
  ON "Party"("leaderUserId", "status");

CREATE INDEX "Party_status_createdAt_idx"
  ON "Party"("status", "createdAt");

-- CreateTable
CREATE TABLE "PartyMember" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PartyRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartyMember_partyId_userId_key"
  ON "PartyMember"("partyId", "userId");

CREATE INDEX "PartyMember_userId_leftAt_idx"
  ON "PartyMember"("userId", "leftAt");

CREATE INDEX "PartyMember_partyId_leftAt_idx"
  ON "PartyMember"("partyId", "leftAt");

-- CreateTable
CREATE TABLE "PartyInvite" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "inviteeUserId" TEXT NOT NULL,
    "status" "PartyInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "PartyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyInvite_inviteeUserId_status_createdAt_idx"
  ON "PartyInvite"("inviteeUserId", "status", "createdAt" DESC);

CREATE INDEX "PartyInvite_partyId_status_createdAt_idx"
  ON "PartyInvite"("partyId", "status", "createdAt" DESC);

CREATE INDEX "PartyInvite_inviterUserId_status_createdAt_idx"
  ON "PartyInvite"("inviterUserId", "status", "createdAt" DESC);
