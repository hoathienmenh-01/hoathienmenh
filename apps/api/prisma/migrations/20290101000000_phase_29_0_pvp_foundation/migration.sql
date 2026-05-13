-- CreateTable
CREATE TABLE "PvpBattle" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "attackerCharacterId" TEXT NOT NULL,
    "defenderCharacterId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "attackerSnapshotJson" JSONB NOT NULL,
    "defenderSnapshotJson" JSONB NOT NULL,
    "seed" INTEGER NOT NULL DEFAULT 0,
    "roundsJson" JSONB NOT NULL,
    "rewardJson" JSONB,
    "ratingChangeJson" JSONB,
    "sourceModuleKey" TEXT,
    "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PvpBattle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvpDefenseProfile" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvpDefenseProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PvpAnomalyLog" (
    "id" TEXT NOT NULL,
    "anomalyType" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "characterId" TEXT,
    "sectId" TEXT,
    "relatedBattleId" TEXT,
    "detailJson" JSONB NOT NULL,
    "blockedReward" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PvpAnomalyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PvpBattle_attackerCharacterId_mode_createdAt_idx" ON "PvpBattle"("attackerCharacterId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "PvpBattle_defenderCharacterId_mode_createdAt_idx" ON "PvpBattle"("defenderCharacterId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "PvpBattle_mode_status_createdAt_idx" ON "PvpBattle"("mode", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PvpBattle_sourceModuleKey_mode_idx" ON "PvpBattle"("sourceModuleKey", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "PvpBattle_idempotencyKey_key" ON "PvpBattle"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PvpDefenseProfile_characterId_key" ON "PvpDefenseProfile"("characterId");

-- CreateIndex
CREATE INDEX "PvpDefenseProfile_updatedAt_idx" ON "PvpDefenseProfile"("updatedAt");

-- CreateIndex
CREATE INDEX "PvpAnomalyLog_anomalyType_createdAt_idx" ON "PvpAnomalyLog"("anomalyType", "createdAt");

-- CreateIndex
CREATE INDEX "PvpAnomalyLog_characterId_createdAt_idx" ON "PvpAnomalyLog"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "PvpAnomalyLog_sectId_createdAt_idx" ON "PvpAnomalyLog"("sectId", "createdAt");

-- CreateIndex
CREATE INDEX "PvpAnomalyLog_resolution_createdAt_idx" ON "PvpAnomalyLog"("resolution", "createdAt");

-- AddForeignKey
ALTER TABLE "PvpBattle" ADD CONSTRAINT "PvpBattle_attackerCharacterId_fkey" FOREIGN KEY ("attackerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvpBattle" ADD CONSTRAINT "PvpBattle_defenderCharacterId_fkey" FOREIGN KEY ("defenderCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvpDefenseProfile" ADD CONSTRAINT "PvpDefenseProfile_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvpAnomalyLog" ADD CONSTRAINT "PvpAnomalyLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PvpAnomalyLog" ADD CONSTRAINT "PvpAnomalyLog_sectId_fkey" FOREIGN KEY ("sectId") REFERENCES "Sect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
