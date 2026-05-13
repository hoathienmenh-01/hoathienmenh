-- Phase 41.0 — Player Experience, Settings, Feedback, Dashboard,
-- Navigation & UI Quality of Life V1 (additive).
--
-- Thêm 3 model additive:
--   - PlayerSettings (1-1 Character) — font / appearance / compact / …
--   - PlayerFeedback — bug report / balance / UI / lost item / …
--   - PlayerReport — player-→-player report foundation (KHÔNG auto-ban)
--
-- KHÔNG ALTER bảng cũ. KHÔNG đụng gameplay/story/quest/PvP. KHÔNG mint
-- reward / currency. Toàn bộ phase 41 là QoL lớp UI/UX + module support.

-- CreateTable PlayerSettings
CREATE TABLE "PlayerSettings" (
    "characterId" TEXT NOT NULL,
    "settingsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerSettings_pkey" PRIMARY KEY ("characterId")
);
CREATE INDEX "PlayerSettings_updatedAt_idx" ON "PlayerSettings"("updatedAt");
ALTER TABLE "PlayerSettings"
    ADD CONSTRAINT "PlayerSettings_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PlayerFeedback
CREATE TABLE "PlayerFeedback" (
    "id" TEXT NOT NULL,
    "reporterCharacterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "relatedFeature" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "targetCharacterId" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "PlayerFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlayerFeedback_reporterCharacterId_createdAt_idx"
    ON "PlayerFeedback"("reporterCharacterId", "createdAt");
CREATE INDEX "PlayerFeedback_status_createdAt_idx"
    ON "PlayerFeedback"("status", "createdAt");
CREATE INDEX "PlayerFeedback_type_status_createdAt_idx"
    ON "PlayerFeedback"("type", "status", "createdAt");
CREATE INDEX "PlayerFeedback_targetCharacterId_createdAt_idx"
    ON "PlayerFeedback"("targetCharacterId", "createdAt");
ALTER TABLE "PlayerFeedback"
    ADD CONSTRAINT "PlayerFeedback_reporterCharacterId_fkey"
    FOREIGN KEY ("reporterCharacterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerFeedback"
    ADD CONSTRAINT "PlayerFeedback_targetCharacterId_fkey"
    FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable PlayerReport
CREATE TABLE "PlayerReport" (
    "id" TEXT NOT NULL,
    "reporterCharacterId" TEXT NOT NULL,
    "targetCharacterId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "description" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "PlayerReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlayerReport_reporterCharacterId_createdAt_idx"
    ON "PlayerReport"("reporterCharacterId", "createdAt");
CREATE INDEX "PlayerReport_targetCharacterId_createdAt_idx"
    ON "PlayerReport"("targetCharacterId", "createdAt");
CREATE INDEX "PlayerReport_status_createdAt_idx"
    ON "PlayerReport"("status", "createdAt");
CREATE INDEX "PlayerReport_reportType_status_createdAt_idx"
    ON "PlayerReport"("reportType", "status", "createdAt");
ALTER TABLE "PlayerReport"
    ADD CONSTRAINT "PlayerReport_reporterCharacterId_fkey"
    FOREIGN KEY ("reporterCharacterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerReport"
    ADD CONSTRAINT "PlayerReport_targetCharacterId_fkey"
    FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
