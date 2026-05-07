-- CreateEnum
CREATE TYPE "StoryDungeonRunStatus" AS ENUM ('ACTIVE', 'CLEARED', 'CLAIMED', 'FAILED');

-- CreateTable
CREATE TABLE "StoryDungeonRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" "StoryDungeonRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "killedMonsters" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryDungeonRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryDungeonRun_characterId_status_idx" ON "StoryDungeonRun"("characterId", "status");

-- CreateIndex
CREATE INDEX "StoryDungeonRun_characterId_templateKey_status_idx" ON "StoryDungeonRun"("characterId", "templateKey", "status");

-- CreateIndex
CREATE INDEX "StoryDungeonRun_characterId_startedAt_idx" ON "StoryDungeonRun"("characterId", "startedAt");
