-- Phase 46.0 — Achievement/Title/Reputation/Long-term Goals foundation.

CREATE TABLE "CharacterReputation" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "reputationGroup" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "dailyGain" INTEGER NOT NULL DEFAULT 0,
    "dailyKey" TEXT,
    "lastGainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterReputation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharacterLongTermGoal" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "goalKey" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterLongTermGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterReputation_characterId_reputationGroup_key" ON "CharacterReputation"("characterId", "reputationGroup");
CREATE INDEX "CharacterReputation_characterId_score_idx" ON "CharacterReputation"("characterId", "score");
CREATE INDEX "CharacterReputation_reputationGroup_score_idx" ON "CharacterReputation"("reputationGroup", "score");
CREATE UNIQUE INDEX "CharacterLongTermGoal_characterId_goalKey_key" ON "CharacterLongTermGoal"("characterId", "goalKey");
CREATE INDEX "CharacterLongTermGoal_characterId_completedAt_idx" ON "CharacterLongTermGoal"("characterId", "completedAt");

ALTER TABLE "CharacterReputation" ADD CONSTRAINT "CharacterReputation_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterLongTermGoal" ADD CONSTRAINT "CharacterLongTermGoal_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
