-- Phase 27.6 — Admin Control Center V2 / Config-Driven LiveOps Admin (additive).
--
-- Thêm 3 model `additive`:
--   - RewardProfile  — config reward set theo contentType+contentKey, versioning, anti-P2W validator.
--   - DropProfile    — config drop table theo sourceType+sourceTier, anti-tier-leak validator.
--   - ContentStatus  — per-content enable/pause/disableReward/disableClaim.
--
-- KHÔNG ALTER table cũ. AdminAuditLog Phase 18.x giữ nguyên — meta JSON extend
-- (permissionKey/riskLevel/reason/targetType/targetId/beforeJson/afterJson) ở
-- application layer.

CREATE TABLE "RewardProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contentType" TEXT NOT NULL,
    "contentKey" TEXT,
    "sourceTier" INTEGER NOT NULL,
    "rewardsJson" JSONB NOT NULL DEFAULT '[]',
    "capRuleJson" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardProfile_key_key" ON "RewardProfile"("key");
CREATE INDEX "RewardProfile_contentType_active_idx" ON "RewardProfile"("contentType", "active");
CREATE INDEX "RewardProfile_contentType_contentKey_active_idx" ON "RewardProfile"("contentType", "contentKey", "active");
CREATE INDEX "RewardProfile_sourceTier_idx" ON "RewardProfile"("sourceTier");

ALTER TABLE "RewardProfile" ADD CONSTRAINT "RewardProfile_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DropProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceTier" INTEGER NOT NULL,
    "materialCategory" TEXT,
    "baseRate" DOUBLE PRECISION NOT NULL,
    "rareRate" DOUBLE PRECISION NOT NULL,
    "weightsJson" JSONB NOT NULL DEFAULT '[]',
    "capsJson" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DropProfile_key_key" ON "DropProfile"("key");
CREATE INDEX "DropProfile_sourceType_active_idx" ON "DropProfile"("sourceType", "active");
CREATE INDEX "DropProfile_sourceType_sourceTier_active_idx" ON "DropProfile"("sourceType", "sourceTier", "active");
CREATE INDEX "DropProfile_materialCategory_idx" ON "DropProfile"("materialCategory");

ALTER TABLE "DropProfile" ADD CONSTRAINT "DropProfile_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContentStatus" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "disableReward" BOOLEAN NOT NULL DEFAULT false,
    "disableClaim" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentStatus_contentType_contentKey_key" ON "ContentStatus"("contentType", "contentKey");
CREATE INDEX "ContentStatus_contentType_enabled_idx" ON "ContentStatus"("contentType", "enabled");
CREATE INDEX "ContentStatus_enabled_paused_idx" ON "ContentStatus"("enabled", "paused");

ALTER TABLE "ContentStatus" ADD CONSTRAINT "ContentStatus_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
