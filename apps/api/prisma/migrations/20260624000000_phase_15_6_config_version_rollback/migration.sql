-- Phase 15.6 — Config Version + Rollback.
--
-- Migration additive: thêm 2 bảng `ConfigVersion` + `ConfigRollbackRun`,
-- KHÔNG sửa bảng cũ. Snapshot before/after cho 4 entity admin-managed
-- (LIVEOPS_EVENT, LIVEOPS_ANNOUNCEMENT, FEATURE_FLAG, MAINTENANCE_WINDOW).
--
-- Audit: reuse `AdminAuditLog` action `ADMIN_CONFIG_*` cho admin
-- view/dry-run/rollback. KHÔNG tạo bảng audit riêng (ConfigRollbackRun
-- là rollback-specific record, không phải audit thay thế).
--
-- Index strategy:
--   - ConfigVersion `[entityType, entityId, version]` UNIQUE — version
--     tăng tuần tự per entity. Service tính `max(version)+1` và rely
--     trên unique constraint chống race (P2002 retry).
--   - ConfigVersion `[entityType, entityId, createdAt]` — list version
--     newest first cho admin UI.
--   - ConfigVersion `[action, createdAt]` — admin filter theo action.
--   - ConfigRollbackRun `[entityType, entityId, createdAt]` — list
--     rollback history per entity.
--   - ConfigRollbackRun `[performedByAdminId, createdAt]` — audit per admin.
--   - ConfigRollbackRun `[status, createdAt]` — filter BLOCKED/FAILED.

-- CreateTable ConfigVersion
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB NOT NULL,
    "changedByAdminId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("id")
);

-- Unique (entityType, entityId, version) → atomic version sequence per entity.
CREATE UNIQUE INDEX "ConfigVersion_entityType_entityId_version_key"
  ON "ConfigVersion"("entityType", "entityId", "version");

-- Admin UI: list versions per entity newest first.
CREATE INDEX "ConfigVersion_entityType_entityId_createdAt_idx"
  ON "ConfigVersion"("entityType", "entityId", "createdAt");

-- Admin UI: filter theo action (CREATE/UPDATE/DISABLE/...).
CREATE INDEX "ConfigVersion_action_createdAt_idx"
  ON "ConfigVersion"("action", "createdAt");

-- AddForeignKey changedByAdminId → User.id (SET NULL khi admin bị xoá).
ALTER TABLE "ConfigVersion"
  ADD CONSTRAINT "ConfigVersion_changedByAdminId_fkey"
  FOREIGN KEY ("changedByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable ConfigRollbackRun
CREATE TABLE "ConfigRollbackRun" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "targetVersionId" TEXT,
    "status" TEXT NOT NULL,
    "safetyLevel" TEXT NOT NULL,
    "performedByAdminId" TEXT,
    "reason" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigRollbackRun_pkey" PRIMARY KEY ("id")
);

-- Admin UI: list rollback runs per entity newest first.
CREATE INDEX "ConfigRollbackRun_entityType_entityId_createdAt_idx"
  ON "ConfigRollbackRun"("entityType", "entityId", "createdAt");

-- Admin audit per admin user.
CREATE INDEX "ConfigRollbackRun_performedByAdminId_createdAt_idx"
  ON "ConfigRollbackRun"("performedByAdminId", "createdAt");

-- Filter BLOCKED/FAILED rollback runs.
CREATE INDEX "ConfigRollbackRun_status_createdAt_idx"
  ON "ConfigRollbackRun"("status", "createdAt");

-- AddForeignKey targetVersionId → ConfigVersion.id (SET NULL nếu version bị xoá).
ALTER TABLE "ConfigRollbackRun"
  ADD CONSTRAINT "ConfigRollbackRun_targetVersionId_fkey"
  FOREIGN KEY ("targetVersionId") REFERENCES "ConfigVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey performedByAdminId → User.id (SET NULL khi admin bị xoá).
ALTER TABLE "ConfigRollbackRun"
  ADD CONSTRAINT "ConfigRollbackRun_performedByAdminId_fkey"
  FOREIGN KEY ("performedByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
