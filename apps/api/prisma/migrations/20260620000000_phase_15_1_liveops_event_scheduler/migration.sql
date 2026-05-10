-- Phase 15.1–15.2 — LiveOps Event Scheduler Core.
--
-- Mục tiêu: cho admin tạo/schedule event runtime mà KHÔNG cần deploy code.
-- Khác `LiveOpsEventOverride` (override catalog tĩnh `LIVE_OPS_EVENTS`),
-- 2 model mới đây là event row động fully-defined-in-DB.
--
-- Adds 2 tables (forward-compat, additive only — không đụng schema cũ):
--   - `LiveOpsScheduledEvent` — 1 row per event (key UNIQUE).
--     Status lifecycle: DRAFT → SCHEDULED → ACTIVE → ENDED, hoặc DISABLED
--     bất cứ lúc nào (kill switch). Cron 5-phút recompute idempotent.
--   - `LiveOpsEventRewardClaim` — 1 row per (event, character) cho event
--     type `FESTIVAL_GIFT`. UNIQUE(eventId, characterId) — claim exactly once.
--
-- Status string-typed (không Prisma enum) để forward-compat: thêm status
-- mới trong code (vd PAUSED) không cần migration.
--
-- Type string-typed (không enum) — match shared `LiveOpsScheduledEventType`
-- catalog: validate ở shared `validateLiveOpsScheduledEventInput`.
--
-- Index strategy:
--   - `(status, startsAt)` — cron recompute pick SCHEDULED + startsAt ≤ now.
--   - `(status, endsAt)` — cron recompute pick ACTIVE + endsAt ≤ now.
--   - `(type, status)` — runtime modifier query "active by type".
--   - Reward claim `(characterId, claimedAt DESC)` — FE claim history.

-- CreateTable LiveOpsScheduledEvent
CREATE TABLE "LiveOpsScheduledEvent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveOpsScheduledEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable LiveOpsEventRewardClaim — Phase 15.1+ FESTIVAL_GIFT one-time claim.
CREATE TABLE "LiveOpsEventRewardClaim" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardJson" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "LiveOpsEventRewardClaim_pkey" PRIMARY KEY ("id")
);

-- Unique key per event.
CREATE UNIQUE INDEX "LiveOpsScheduledEvent_key_key"
  ON "LiveOpsScheduledEvent"("key");

-- Cron recompute pick — SCHEDULED + startsAt asc; ACTIVE + endsAt asc.
CREATE INDEX "LiveOpsScheduledEvent_status_startsAt_idx"
  ON "LiveOpsScheduledEvent"("status", "startsAt");
CREATE INDEX "LiveOpsScheduledEvent_status_endsAt_idx"
  ON "LiveOpsScheduledEvent"("status", "endsAt");

-- Runtime modifier query: "active events by type".
CREATE INDEX "LiveOpsScheduledEvent_type_status_idx"
  ON "LiveOpsScheduledEvent"("type", "status");

-- Reward claim — exactly-once per (event, character).
CREATE UNIQUE INDEX "LiveOpsEventRewardClaim_eventId_characterId_key"
  ON "LiveOpsEventRewardClaim"("eventId", "characterId");

-- Per-character claim history (FE list).
CREATE INDEX "LiveOpsEventRewardClaim_characterId_claimedAt_idx"
  ON "LiveOpsEventRewardClaim"("characterId", "claimedAt" DESC);

-- AddForeignKey — claim cascade với event delete + character delete.
ALTER TABLE "LiveOpsEventRewardClaim"
  ADD CONSTRAINT "LiveOpsEventRewardClaim_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "LiveOpsScheduledEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveOpsEventRewardClaim"
  ADD CONSTRAINT "LiveOpsEventRewardClaim_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — created by admin (User), nullable (admin có thể bị xoá).
ALTER TABLE "LiveOpsScheduledEvent"
  ADD CONSTRAINT "LiveOpsScheduledEvent_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
