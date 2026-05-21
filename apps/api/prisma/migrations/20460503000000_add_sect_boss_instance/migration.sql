-- CreateTable
CREATE TABLE "SectBossInstance" (
    "id" TEXT NOT NULL,
    "sectId" TEXT NOT NULL,
    "bossKey" TEXT NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "currentHp" INTEGER NOT NULL,
    "defeated" BOOLEAN NOT NULL DEFAULT false,
    "spawnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defeatedAt" TIMESTAMP(3),
    CONSTRAINT "SectBossInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectBossParticipant" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectBossParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectBossInstance_sectId_defeated_idx" ON "SectBossInstance"("sectId", "defeated");

-- CreateIndex
CREATE INDEX "SectBossInstance_sectId_bossKey_spawnedAt_idx" ON "SectBossInstance"("sectId", "bossKey", "spawnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SectBossParticipant_instanceId_characterId_key" ON "SectBossParticipant"("instanceId", "characterId");

-- CreateIndex
CREATE INDEX "SectBossParticipant_characterId_createdAt_idx" ON "SectBossParticipant"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "SectBossInstance" ADD CONSTRAINT "SectBossInstance_sectId_fkey" FOREIGN KEY ("sectId") REFERENCES "Sect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectBossParticipant" ADD CONSTRAINT "SectBossParticipant_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "SectBossInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectBossParticipant" ADD CONSTRAINT "SectBossParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
