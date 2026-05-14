-- Phase 45.0 — Feature Flags & Remote Config Center V1.
--
-- Additive only:
--   1. ALTER `FeatureFlag` ADD COLUMN `environment` (nullable) + index.
--   2. CREATE TABLE `RemoteConfig` + unique key + indexes + FK to User
--      (ON DELETE SET NULL — admin xóa thì row config giữ history).
--
-- Rollback: DROP TABLE RemoteConfig; ALTER FeatureFlag DROP COLUMN environment.

-- ---------------------------------------------------------------------------
-- 1) FeatureFlag.environment (nullable string for admin tag/filter).
-- ---------------------------------------------------------------------------
ALTER TABLE "FeatureFlag" ADD COLUMN "environment" TEXT;
CREATE INDEX "FeatureFlag_environment_idx" ON "FeatureFlag"("environment");

-- ---------------------------------------------------------------------------
-- 2) RemoteConfig — runtime key/value config.
-- ---------------------------------------------------------------------------
CREATE TABLE "RemoteConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueString" TEXT NOT NULL,
    "environment" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemoteConfig_key_key" ON "RemoteConfig"("key");
CREATE INDEX "RemoteConfig_environment_idx" ON "RemoteConfig"("environment");

ALTER TABLE "RemoteConfig"
    ADD CONSTRAINT "RemoteConfig_updatedByAdminId_fkey"
    FOREIGN KEY ("updatedByAdminId")
    REFERENCES "User"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
