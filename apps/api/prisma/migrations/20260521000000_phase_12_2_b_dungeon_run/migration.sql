-- CreateEnum
CREATE TYPE "DungeonRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CLAIMED', 'ABANDONED');

-- CreateTable
CREATE TABLE "DungeonRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "DungeonRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "encounterIndex" INTEGER NOT NULL DEFAULT 0,
    "killedMonsters" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DungeonRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DungeonRun_characterId_status_idx" ON "DungeonRun"("characterId", "status");

-- CreateIndex
CREATE INDEX "DungeonRun_characterId_startedAt_idx" ON "DungeonRun"("characterId", "startedAt");

-- CreateIndex
CREATE INDEX "DungeonRun_characterId_templateKey_startedAt_idx" ON "DungeonRun"("characterId", "templateKey", "startedAt");
