-- Phase 14.1.B — Async Arena Foundation
--
-- Adds two tables:
--   1. ArenaProfile  — 1-1 với Character, lưu rating + counter daily limit.
--   2. ArenaMatch    — lịch sử trận PvP async + snapshot/seed deterministic.
--
-- Forward-compat. KHÔNG drop column / không đổi schema cũ.

-- CreateTable ArenaProfile
CREATE TABLE "ArenaProfile" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "attacksToday" INTEGER NOT NULL DEFAULT 0,
    "lastAttackDayBucket" TEXT,
    "defenseSnapshotJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ArenaProfile
CREATE UNIQUE INDEX "ArenaProfile_characterId_key" ON "ArenaProfile"("characterId");

CREATE INDEX "ArenaProfile_rating_idx" ON "ArenaProfile"("rating");

CREATE INDEX "ArenaProfile_updatedAt_idx" ON "ArenaProfile"("updatedAt");

-- AddForeignKey ArenaProfile
ALTER TABLE "ArenaProfile" ADD CONSTRAINT "ArenaProfile_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ArenaMatch
CREATE TABLE "ArenaMatch" (
    "id" TEXT NOT NULL,
    "attackerCharacterId" TEXT NOT NULL,
    "defenderCharacterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "winnerCharacterId" TEXT,
    "attackerSnapshotJson" JSONB NOT NULL,
    "defenderSnapshotJson" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "battleLogJson" JSONB NOT NULL,
    "ratingDeltaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ArenaMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex ArenaMatch
CREATE INDEX "ArenaMatch_attackerCharacterId_createdAt_idx" ON "ArenaMatch"("attackerCharacterId", "createdAt");

CREATE INDEX "ArenaMatch_defenderCharacterId_createdAt_idx" ON "ArenaMatch"("defenderCharacterId", "createdAt");

CREATE INDEX "ArenaMatch_status_createdAt_idx" ON "ArenaMatch"("status", "createdAt");

-- AddForeignKey ArenaMatch
ALTER TABLE "ArenaMatch" ADD CONSTRAINT "ArenaMatch_attackerCharacterId_fkey" FOREIGN KEY ("attackerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArenaMatch" ADD CONSTRAINT "ArenaMatch_defenderCharacterId_fkey" FOREIGN KEY ("defenderCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
