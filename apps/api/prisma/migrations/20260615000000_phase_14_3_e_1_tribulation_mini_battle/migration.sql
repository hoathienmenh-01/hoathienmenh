-- CreateTable
CREATE TABLE "TribulationMiniBattle" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "encounterId" TEXT,
    "tribulationKey" TEXT NOT NULL,
    "realmKey" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "currentPhase" INTEGER NOT NULL DEFAULT 1,
    "phaseCount" INTEGER NOT NULL,
    "playerHp" INTEGER NOT NULL,
    "playerHpMax" INTEGER NOT NULL,
    "tribulationHp" INTEGER NOT NULL,
    "tribulationHpMax" INTEGER NOT NULL,
    "shield" INTEGER NOT NULL DEFAULT 0,
    "dotStacks" INTEGER NOT NULL DEFAULT 0,
    "focusCharge" INTEGER NOT NULL DEFAULT 0,
    "seed" INTEGER NOT NULL,
    "actionLogJson" JSONB NOT NULL DEFAULT '[]',
    "resultJson" JSONB,
    "lastClientNonce" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TribulationMiniBattle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TribulationMiniBattle_characterId_state_idx" ON "TribulationMiniBattle"("characterId", "state");

-- CreateIndex
CREATE INDEX "TribulationMiniBattle_characterId_startedAt_idx" ON "TribulationMiniBattle"("characterId", "startedAt");

-- CreateIndex
CREATE INDEX "TribulationMiniBattle_encounterId_idx" ON "TribulationMiniBattle"("encounterId");

-- AddForeignKey
ALTER TABLE "TribulationMiniBattle" ADD CONSTRAINT "TribulationMiniBattle_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
