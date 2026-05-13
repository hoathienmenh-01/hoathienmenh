-- Phase 26.5 — World Content V2 (Farm Maps / Dungeons / Bosses / Sect / Trial Towers).
--
-- Additive migration:
--   1) FarmSession         — auto farm session (server-authoritative).
--   2) FarmEncounter       — cơ duyên + elite/mini-boss spawn trong farm.
--   3) DailyContentCap     — daily usage counter (anti-P2W).
--   4) WeeklyContentCap    — weekly usage counter (RARE/EPIC/world boss).
--   5) TrialTowerProgress  — highest floor cleared (lifetime + seasonal).
--   6) TrialTowerAttemptLog — per-attempt audit + ranking input.
--   7) SectBossAttemptLog  — damage contribution log cho sect boss ranking.
--
-- Tất cả model bám Character qua FK Cascade. Không sửa table cũ — purely
-- additive. Anti-P2W: premium KHÔNG bypass DailyContentCap/WeeklyContentCap;
-- repeat reward floor = 0 (enforce trong service runtime).

-- CreateTable
CREATE TABLE "FarmSession" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "farmMapKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutesProcessed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "rewardsJson" JSONB NOT NULL DEFAULT '{}',
    "encountersJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmEncounter" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "farmSessionId" TEXT,
    "encounterKey" TEXT NOT NULL,
    "encounterType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "rewardPreviewJson" JSONB NOT NULL DEFAULT '{}',
    "resolutionJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FarmEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyContentCap" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "capKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyContentCap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyContentCap" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "capKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "weekBucket" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyContentCap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialTowerProgress" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "towerKey" TEXT NOT NULL,
    "highestFloorCleared" INTEGER NOT NULL DEFAULT 0,
    "seasonHighestFloor" INTEGER NOT NULL DEFAULT 0,
    "claimedMilestonesJson" JSONB NOT NULL DEFAULT '[]',
    "lastAttemptAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialTowerProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialTowerAttemptLog" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "towerKey" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "battlePowerSnapshot" INTEGER NOT NULL DEFAULT 0,
    "clearTimeSeconds" INTEGER,
    "rewardJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialTowerAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectBossAttemptLog" (
    "id" TEXT NOT NULL,
    "sectId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "bossKey" TEXT NOT NULL,
    "damage" BIGINT NOT NULL DEFAULT 0,
    "rewardJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectBossAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FarmSession_characterId_status_idx" ON "FarmSession"("characterId", "status");

-- CreateIndex
CREATE INDEX "FarmSession_farmMapKey_startedAt_idx" ON "FarmSession"("farmMapKey", "startedAt");

-- CreateIndex
CREATE INDEX "FarmEncounter_characterId_status_idx" ON "FarmEncounter"("characterId", "status");

-- CreateIndex
CREATE INDEX "FarmEncounter_farmSessionId_idx" ON "FarmEncounter"("farmSessionId");

-- CreateIndex
CREATE INDEX "FarmEncounter_expiresAt_idx" ON "FarmEncounter"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyContentCap_characterId_dayBucket_capKey_key" ON "DailyContentCap"("characterId", "dayBucket", "capKey");

-- CreateIndex
CREATE INDEX "DailyContentCap_dayBucket_idx" ON "DailyContentCap"("dayBucket");

-- CreateIndex
CREATE INDEX "DailyContentCap_characterId_dayBucket_idx" ON "DailyContentCap"("characterId", "dayBucket");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyContentCap_characterId_weekBucket_capKey_key" ON "WeeklyContentCap"("characterId", "weekBucket", "capKey");

-- CreateIndex
CREATE INDEX "WeeklyContentCap_weekBucket_idx" ON "WeeklyContentCap"("weekBucket");

-- CreateIndex
CREATE INDEX "WeeklyContentCap_characterId_weekBucket_idx" ON "WeeklyContentCap"("characterId", "weekBucket");

-- CreateIndex
CREATE UNIQUE INDEX "TrialTowerProgress_characterId_towerKey_key" ON "TrialTowerProgress"("characterId", "towerKey");

-- CreateIndex
CREATE INDEX "TrialTowerProgress_towerKey_highestFloorCleared_idx" ON "TrialTowerProgress"("towerKey", "highestFloorCleared");

-- CreateIndex
CREATE INDEX "TrialTowerProgress_towerKey_seasonHighestFloor_idx" ON "TrialTowerProgress"("towerKey", "seasonHighestFloor");

-- CreateIndex
CREATE INDEX "TrialTowerAttemptLog_characterId_towerKey_floor_idx" ON "TrialTowerAttemptLog"("characterId", "towerKey", "floor");

-- CreateIndex
CREATE INDEX "TrialTowerAttemptLog_towerKey_success_createdAt_idx" ON "TrialTowerAttemptLog"("towerKey", "success", "createdAt");

-- CreateIndex
CREATE INDEX "TrialTowerAttemptLog_createdAt_idx" ON "TrialTowerAttemptLog"("createdAt");

-- CreateIndex
CREATE INDEX "SectBossAttemptLog_sectId_bossKey_createdAt_idx" ON "SectBossAttemptLog"("sectId", "bossKey", "createdAt");

-- CreateIndex
CREATE INDEX "SectBossAttemptLog_characterId_bossKey_createdAt_idx" ON "SectBossAttemptLog"("characterId", "bossKey", "createdAt");

-- CreateIndex
CREATE INDEX "SectBossAttemptLog_bossKey_damage_idx" ON "SectBossAttemptLog"("bossKey", "damage");

-- AddForeignKey
ALTER TABLE "FarmSession" ADD CONSTRAINT "FarmSession_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmEncounter" ADD CONSTRAINT "FarmEncounter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmEncounter" ADD CONSTRAINT "FarmEncounter_farmSessionId_fkey" FOREIGN KEY ("farmSessionId") REFERENCES "FarmSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyContentCap" ADD CONSTRAINT "DailyContentCap_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyContentCap" ADD CONSTRAINT "WeeklyContentCap_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialTowerProgress" ADD CONSTRAINT "TrialTowerProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialTowerAttemptLog" ADD CONSTRAINT "TrialTowerAttemptLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectBossAttemptLog" ADD CONSTRAINT "SectBossAttemptLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
