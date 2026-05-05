-- Phase 12 Story PR-2 — Quest runtime persistence.
--
-- 1. Character.storyChapter — server-authoritative story cursor.
-- 2. QuestProgress table — quest state (LOCKED/AVAILABLE/ACCEPTED/COMPLETED/CLAIMED)
--    với unique (characterId, questKey) + JSON stepProgress map.

-- Character.storyChapter
ALTER TABLE "Character" ADD COLUMN "storyChapter" INTEGER NOT NULL DEFAULT 0;

-- QuestProgress
CREATE TABLE "QuestProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "questKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "stepProgress" JSONB NOT NULL DEFAULT '{}',
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestProgress_characterId_questKey_key" ON "QuestProgress"("characterId", "questKey");
CREATE INDEX "QuestProgress_characterId_status_idx" ON "QuestProgress"("characterId", "status");
CREATE INDEX "QuestProgress_status_completedAt_idx" ON "QuestProgress"("status", "completedAt");

ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
