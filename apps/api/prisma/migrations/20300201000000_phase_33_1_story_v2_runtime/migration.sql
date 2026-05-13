-- Phase 33.1 — Story V2 Runtime (Phase 33 catalog) (additive).
--
-- 3 new tables for runtime wire của Phase 33 catalog
-- (`STORY_QUEST_EXPANSION` + `STORY_QUEST_DIALOGUES` đã ship qua PR A #567).
--
-- Hoàn toàn tách bạch với Phase 12 `QuestProgress` (Phase 12 dùng catalog
-- `QUESTS`). KHÔNG ALTER `QuestProgress` hoặc `Character`. Chỉ ADD relation
-- backrefs trên `Character` (Prisma client-only; không tạo SQL constraint).
--
-- Models:
--   - CharacterStoryV2ChapterProgress  — per-character per-chapter status.
--   - CharacterStoryV2QuestProgress    — per-character per-quest progress.
--   - CharacterStoryV2RewardClaim      — idempotent claim audit ledger.

-- CreateTable CharacterStoryV2ChapterProgress
CREATE TABLE "CharacterStoryV2ChapterProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "chapKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "mainQuestsCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "storyFlags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterStoryV2ChapterProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterStoryV2ChapterProgress_characterId_chapKey_key"
    ON "CharacterStoryV2ChapterProgress"("characterId", "chapKey");

CREATE INDEX "CharacterStoryV2ChapterProgress_characterId_status_idx"
    ON "CharacterStoryV2ChapterProgress"("characterId", "status");

ALTER TABLE "CharacterStoryV2ChapterProgress"
    ADD CONSTRAINT "CharacterStoryV2ChapterProgress_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CharacterStoryV2QuestProgress
CREATE TABLE "CharacterStoryV2QuestProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "questKey" TEXT NOT NULL,
    "chapKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "stepProgress" JSONB NOT NULL DEFAULT '{}',
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterStoryV2QuestProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterStoryV2QuestProgress_characterId_questKey_key"
    ON "CharacterStoryV2QuestProgress"("characterId", "questKey");

CREATE INDEX "CharacterStoryV2QuestProgress_characterId_chapKey_status_idx"
    ON "CharacterStoryV2QuestProgress"("characterId", "chapKey", "status");

CREATE INDEX "CharacterStoryV2QuestProgress_status_completedAt_idx"
    ON "CharacterStoryV2QuestProgress"("status", "completedAt");

ALTER TABLE "CharacterStoryV2QuestProgress"
    ADD CONSTRAINT "CharacterStoryV2QuestProgress_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CharacterStoryV2RewardClaim
CREATE TABLE "CharacterStoryV2RewardClaim" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "questKey" TEXT NOT NULL,
    "linhThachGranted" BIGINT NOT NULL DEFAULT 0,
    "tienNgocGranted" INTEGER NOT NULL DEFAULT 0,
    "expGranted" BIGINT NOT NULL DEFAULT 0,
    "congHienGranted" INTEGER NOT NULL DEFAULT 0,
    "itemsGranted" JSONB NOT NULL DEFAULT '[]',
    "affinityGranted" JSONB NOT NULL DEFAULT '[]',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterStoryV2RewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterStoryV2RewardClaim_characterId_questKey_key"
    ON "CharacterStoryV2RewardClaim"("characterId", "questKey");

CREATE INDEX "CharacterStoryV2RewardClaim_characterId_claimedAt_idx"
    ON "CharacterStoryV2RewardClaim"("characterId", "claimedAt");

ALTER TABLE "CharacterStoryV2RewardClaim"
    ADD CONSTRAINT "CharacterStoryV2RewardClaim_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
