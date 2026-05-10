-- Phase 15.5 — Maintenance Window.
--
-- Mục tiêu: cho admin tạo/lên lịch maintenance window. Middleware đọc
-- service (cache + DB) chặn player khi có window ACTIVE — vẫn giữ
-- healthcheck/metrics/maintenance-status pass-through cho admin và
-- observability tools.
--
-- Audit: reuse `AdminAuditLog` action `ADMIN_MAINTENANCE_*` — KHÔNG tạo
-- bảng audit riêng.
--
-- Index strategy:
--   - `key` UNIQUE — admin lookup + idempotent upsert.
--   - `[status, startsAt]` — cron `getActiveWindow` + transition SCHEDULED→ACTIVE.
--   - `[status, endsAt]`   — cron transition ACTIVE→ENDED.
--   - `[severity, status]` — admin filter UI.

-- CreateTable MaintenanceWindow
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "target" TEXT NOT NULL DEFAULT 'ALL_PLAYERS',
    "titleVi" TEXT NOT NULL,
    "titleEn" TEXT,
    "messageVi" TEXT NOT NULL,
    "messageEn" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allowAdminBypass" BOOLEAN NOT NULL DEFAULT true,
    "allowHealthcheck" BOOLEAN NOT NULL DEFAULT true,
    "allowMetrics" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- Unique key per maintenance window (1 row / key).
CREATE UNIQUE INDEX "MaintenanceWindow_key_key"
  ON "MaintenanceWindow"("key");

-- Cron `getActiveWindow` + transition SCHEDULED → ACTIVE.
CREATE INDEX "MaintenanceWindow_status_startsAt_idx"
  ON "MaintenanceWindow"("status", "startsAt");

-- Cron transition ACTIVE → ENDED.
CREATE INDEX "MaintenanceWindow_status_endsAt_idx"
  ON "MaintenanceWindow"("status", "endsAt");

-- Admin filter UI.
CREATE INDEX "MaintenanceWindow_severity_status_idx"
  ON "MaintenanceWindow"("severity", "status");

-- AddForeignKey — created by admin (User), nullable (admin có thể bị xoá).
ALTER TABLE "MaintenanceWindow"
  ADD CONSTRAINT "MaintenanceWindow_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
