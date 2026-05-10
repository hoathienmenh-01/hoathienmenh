-- Phase 15.3.B — LiveOps Announcement (banner / marquee + WS broadcast).
--
-- Mục tiêu: cho admin tạo announcement runtime hiển thị cho người chơi
-- (banner / marquee). Khác `LiveOpsScheduledEvent` (event runtime modifier),
-- model này chỉ là UX / communication layer (không tính reward, không
-- multiplier). Status lifecycle mirror `LiveOpsScheduledEvent`:
--
--   DRAFT → SCHEDULED → ACTIVE → ENDED, hoặc DISABLED bất kỳ lúc nào.
--
-- Cron 5-phút recompute idempotent (chia sẻ pattern với
-- `LiveOpsScheduledEvent`). Khi status thực sự transition, server
-- broadcast WS event `ANNOUNCEMENT_ACTIVE` / `ANNOUNCEMENT_ENDED` —
-- frontend listen update marquee + show toast.
--
-- Severity / target string-typed (không Prisma enum) để forward-compat:
-- thêm severity / target mới không cần migration. Validate ở shared
-- `validateLiveOpsAnnouncementInput`.
--
-- Index strategy:
--   - `(status, startsAt)` — cron recompute pick SCHEDULED + startsAt ≤ now.
--   - `(status, endsAt)` — cron recompute pick ACTIVE + endsAt ≤ now.
--   - `(severity, status)` — admin filter / FE marquee filter ACTIVE by severity.

-- CreateTable LiveOpsAnnouncement
CREATE TABLE "LiveOpsAnnouncement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "target" TEXT NOT NULL DEFAULT 'ALL',
    "titleVi" TEXT NOT NULL,
    "titleEn" TEXT,
    "messageVi" TEXT NOT NULL,
    "messageEn" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "LiveOpsAnnouncement_pkey" PRIMARY KEY ("id")
);

-- Unique key per announcement.
CREATE UNIQUE INDEX "LiveOpsAnnouncement_key_key"
  ON "LiveOpsAnnouncement"("key");

-- Cron recompute pick: SCHEDULED + startsAt asc; ACTIVE + endsAt asc.
CREATE INDEX "LiveOpsAnnouncement_status_startsAt_idx"
  ON "LiveOpsAnnouncement"("status", "startsAt");
CREATE INDEX "LiveOpsAnnouncement_status_endsAt_idx"
  ON "LiveOpsAnnouncement"("status", "endsAt");

-- Severity filter (admin list / FE marquee filter).
CREATE INDEX "LiveOpsAnnouncement_severity_status_idx"
  ON "LiveOpsAnnouncement"("severity", "status");

-- AddForeignKey — created by admin (User), nullable (admin có thể bị xoá).
ALTER TABLE "LiveOpsAnnouncement"
  ADD CONSTRAINT "LiveOpsAnnouncement_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
