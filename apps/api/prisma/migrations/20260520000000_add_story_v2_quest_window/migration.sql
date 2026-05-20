-- Phase 33.4 — Add daily/weekly reset window to Story V2 quest progress.
-- Additive: nullable columns, no data loss, existing rows get NULL (non-repeatable).

ALTER TABLE "CharacterStoryV2QuestProgress" ADD COLUMN "windowStart" TIMESTAMP(3);
ALTER TABLE "CharacterStoryV2QuestProgress" ADD COLUMN "windowEnd" TIMESTAMP(3);

-- Index for reset scheduler: find CLAIMED quests with windowEnd <= now.
CREATE INDEX "CharacterStoryV2QuestProgress_status_windowEnd_idx"
  ON "CharacterStoryV2QuestProgress"("status", "windowEnd");
