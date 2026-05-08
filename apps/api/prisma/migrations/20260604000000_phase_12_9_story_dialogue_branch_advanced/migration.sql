-- Phase 12.9 Story Dialogue Branch Advanced
-- Add `storyDialogueChoices` (Json map nodeId -> choiceKey) to Character
-- to support `choice_made` condition + multi-step branching memory.
ALTER TABLE "Character"
  ADD COLUMN "storyDialogueChoices" JSONB NOT NULL DEFAULT '{}';
