-- Phase 34.0 — 7-Day Onboarding Questline runtime tables.
--
-- Additive only — no ALTER on Phase 12 (QuestProgress) or Phase 33
-- (CharacterStoryV2*) tables. Rollback = DROP TABLE both.

-- CharacterOnboardingProgress — day-level progress per character.
CREATE TABLE "CharacterOnboardingProgress" (
    "id"          TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "dayNumber"   INTEGER NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'LOCKED',
    "unlockedAt"  TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterOnboardingProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterOnboardingProgress_characterId_dayNumber_key"
    ON "CharacterOnboardingProgress"("characterId", "dayNumber");

CREATE INDEX "CharacterOnboardingProgress_characterId_status_idx"
    ON "CharacterOnboardingProgress"("characterId", "status");

ALTER TABLE "CharacterOnboardingProgress"
    ADD CONSTRAINT "CharacterOnboardingProgress_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CharacterOnboardingTaskProgress — task-level progress per character.
CREATE TABLE "CharacterOnboardingTaskProgress" (
    "id"               TEXT NOT NULL,
    "characterId"      TEXT NOT NULL,
    "taskKey"          TEXT NOT NULL,
    "dayNumber"        INTEGER NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'AVAILABLE',
    "completedAt"      TIMESTAMP(3),
    "claimedAt"        TIMESTAMP(3),
    "linhThachGranted" INTEGER NOT NULL DEFAULT 0,
    "expGranted"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterOnboardingTaskProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterOnboardingTaskProgress_characterId_taskKey_key"
    ON "CharacterOnboardingTaskProgress"("characterId", "taskKey");

CREATE INDEX "CharacterOnboardingTaskProgress_characterId_dayNumber_status_idx"
    ON "CharacterOnboardingTaskProgress"("characterId", "dayNumber", "status");

ALTER TABLE "CharacterOnboardingTaskProgress"
    ADD CONSTRAINT "CharacterOnboardingTaskProgress_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
