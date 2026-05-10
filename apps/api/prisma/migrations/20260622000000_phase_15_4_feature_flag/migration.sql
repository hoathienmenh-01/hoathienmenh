-- Phase 15.4 — Feature Flag DB-backed.
--
-- Mục tiêu: cho admin bật/tắt các chức năng quan trọng (Arena, Tribulation
-- Mini-Battle, Reforge/Enchant, LiveOps event/festival/announcement,
-- Territory War, Market, Shop/Sect Shop discount runtime) mà không cần
-- redeploy code. Catalog hardcode shared (`feature-flags.ts`); migration
-- chỉ tạo bảng `FeatureFlag` — service ensure-default lazy seed khi cần.
--
-- Cache: Redis TTL 30s (fallback in-memory). Admin update → clear cache
-- → flag effect runtime trong ≤ 30s.
--
-- Audit: reuse `AdminAuditLog` action `ADMIN_FEATURE_FLAG_UPDATE` —
-- KHÔNG tạo bảng audit riêng.
--
-- Index strategy:
--   - `key` UNIQUE — service lookup `findUnique` O(1).
--   - `category` — admin filter UI / telemetry phân loại.
--   - `enabled` — service `getManyFlags` filter active.

-- CreateTable FeatureFlag
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL DEFAULT 'GAMEPLAY',
    "description" TEXT NOT NULL DEFAULT '',
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- Unique key per flag (1 row / FeatureFlagKey).
CREATE UNIQUE INDEX "FeatureFlag_key_key"
  ON "FeatureFlag"("key");

-- Admin filter UI / telemetry.
CREATE INDEX "FeatureFlag_category_idx"
  ON "FeatureFlag"("category");

-- Service `getManyFlags` filter active.
CREATE INDEX "FeatureFlag_enabled_idx"
  ON "FeatureFlag"("enabled");

-- AddForeignKey — updated by admin (User), nullable (admin có thể bị xoá).
ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT "FeatureFlag_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
