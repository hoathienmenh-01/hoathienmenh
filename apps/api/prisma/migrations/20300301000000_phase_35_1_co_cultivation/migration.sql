-- Phase 35.1 — Co-Cultivation / Hợp Luyện schema (additive-only).
-- Adds CoCultivationSession + CoCultivationDailyUsage + enum.

-- CreateEnum
CREATE TYPE "CoCultivationStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);

-- CreateTable
CREATE TABLE "CoCultivationSession" (
    "id" TEXT NOT NULL,
    "initiatorUserId" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "initiatorCharacterId" TEXT NOT NULL,
    "partnerCharacterId" TEXT NOT NULL,
    "status" "CoCultivationStatus" NOT NULL DEFAULT 'PENDING',
    "durationSec" INTEGER NOT NULL DEFAULT 600,
    "buffPercent" INTEGER NOT NULL DEFAULT 3,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rewardApplied" BOOLEAN NOT NULL DEFAULT false,
    "bonusExpGranted" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoCultivationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoCultivationSession_initiatorUserId_status_createdAt_idx"
  ON "CoCultivationSession"("initiatorUserId", "status", "createdAt");

CREATE INDEX "CoCultivationSession_partnerUserId_status_createdAt_idx"
  ON "CoCultivationSession"("partnerUserId", "status", "createdAt");

CREATE INDEX "CoCultivationSession_status_createdAt_idx"
  ON "CoCultivationSession"("status", "createdAt");

-- CreateTable
CREATE TABLE "CoCultivationDailyUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "sessionsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalBuffSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalBonusExp" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoCultivationDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoCultivationDailyUsage_userId_dateKey_key"
  ON "CoCultivationDailyUsage"("userId", "dateKey");

CREATE INDEX "CoCultivationDailyUsage_dateKey_idx"
  ON "CoCultivationDailyUsage"("dateKey");
