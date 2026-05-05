-- CreateTable
CREATE TABLE "BreakthroughAttemptLog" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "fromRealmKey" TEXT NOT NULL,
    "fromRealmStage" INTEGER NOT NULL,
    "toRealmKey" TEXT NOT NULL,
    "toRealmStage" INTEGER NOT NULL,
    "chance" DOUBLE PRECISION NOT NULL,
    "baseChance" DOUBLE PRECISION NOT NULL,
    "rootPurityBonus" DOUBLE PRECISION NOT NULL,
    "methodAffinityBonus" DOUBLE PRECISION NOT NULL,
    "itemBonus" DOUBLE PRECISION NOT NULL,
    "rawChance" DOUBLE PRECISION NOT NULL,
    "rngRoll" DOUBLE PRECISION NOT NULL,
    "success" BOOLEAN NOT NULL,
    "expBefore" BIGINT NOT NULL,
    "expAfter" BIGINT NOT NULL,
    "tamMaActive" BOOLEAN NOT NULL DEFAULT false,
    "tamMaExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "attemptIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakthroughAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BreakthroughAttemptLog_characterId_createdAt_idx" ON "BreakthroughAttemptLog"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "BreakthroughAttemptLog_characterId_success_idx" ON "BreakthroughAttemptLog"("characterId", "success");

-- CreateIndex
CREATE UNIQUE INDEX "BreakthroughAttemptLog_characterId_idempotencyKey_key" ON "BreakthroughAttemptLog"("characterId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BreakthroughAttemptLog" ADD CONSTRAINT "BreakthroughAttemptLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
