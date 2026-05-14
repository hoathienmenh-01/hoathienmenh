-- Phase 38.0 — Roguelike Bí Cảnh / Random Adventure V1

CREATE TYPE "RoguelikeRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED', 'CLAIMED');

CREATE TABLE "RoguelikeRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "status" "RoguelikeRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "seed" TEXT NOT NULL,
    "currentFloor" INTEGER NOT NULL DEFAULT 0,
    "hp" INTEGER NOT NULL,
    "hpMax" INTEGER NOT NULL,
    "resource" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rewardMul" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "activeBuffs" JSONB NOT NULL DEFAULT '[]',
    "floorHistory" JSONB NOT NULL DEFAULT '[]',
    "rewardPreview" JSONB NOT NULL DEFAULT '{}',
    "lastChoiceKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoguelikeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoguelikeLeaderboard" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "bestFloor" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "fastestClearMs" INTEGER,
    "bestRunId" TEXT,
    "weekBucket" TEXT NOT NULL,
    "monthBucket" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoguelikeLeaderboard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoguelikeRun_characterId_status_idx" ON "RoguelikeRun"("characterId", "status");
CREATE INDEX "RoguelikeRun_characterId_startedAt_idx" ON "RoguelikeRun"("characterId", "startedAt");
CREATE INDEX "RoguelikeRun_realmKey_status_idx" ON "RoguelikeRun"("realmKey", "status");

CREATE UNIQUE INDEX "RoguelikeLeaderboard_characterId_key" ON "RoguelikeLeaderboard"("characterId");
CREATE INDEX "RoguelikeLeaderboard_weekBucket_bestFloor_bestScore_idx" ON "RoguelikeLeaderboard"("weekBucket", "bestFloor", "bestScore");
CREATE INDEX "RoguelikeLeaderboard_monthBucket_bestFloor_bestScore_idx" ON "RoguelikeLeaderboard"("monthBucket", "bestFloor", "bestScore");

ALTER TABLE "RoguelikeRun"
    ADD CONSTRAINT "RoguelikeRun_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoguelikeLeaderboard"
    ADD CONSTRAINT "RoguelikeLeaderboard_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
