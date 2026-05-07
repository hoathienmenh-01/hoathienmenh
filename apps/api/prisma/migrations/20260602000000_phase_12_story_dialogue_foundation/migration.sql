-- Phase 12 Story Dialogue Foundation
-- Add `storyDialogueSeen` (Json array) + `storyFlags` (Json map) to Character.
ALTER TABLE "Character"
  ADD COLUMN "storyDialogueSeen" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "storyFlags" JSONB NOT NULL DEFAULT '{}';
