-- Phase 26.2 — Drop Economy V2: DailyMaterialCap + WeeklyMaterialCap.

-- CreateTable
CREATE TABLE "DailyMaterialCap" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "materialCategory" TEXT NOT NULL,
    "materialTier" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "qtyAccum" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMaterialCap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyMaterialCap" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "weekBucket" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "materialCategory" TEXT NOT NULL,
    "materialTier" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "qtyAccum" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyMaterialCap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyMaterialCap_dayBucket_idx" ON "DailyMaterialCap"("dayBucket");

-- CreateIndex
CREATE INDEX "DailyMaterialCap_characterId_dayBucket_idx" ON "DailyMaterialCap"("characterId", "dayBucket");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMaterialCap_characterId_dayBucket_ruleKey_key" ON "DailyMaterialCap"("characterId", "dayBucket", "ruleKey");

-- CreateIndex
CREATE INDEX "WeeklyMaterialCap_weekBucket_idx" ON "WeeklyMaterialCap"("weekBucket");

-- CreateIndex
CREATE INDEX "WeeklyMaterialCap_characterId_weekBucket_idx" ON "WeeklyMaterialCap"("characterId", "weekBucket");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyMaterialCap_characterId_weekBucket_ruleKey_key" ON "WeeklyMaterialCap"("characterId", "weekBucket", "ruleKey");

-- AddForeignKey
ALTER TABLE "DailyMaterialCap" ADD CONSTRAINT "DailyMaterialCap_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyMaterialCap" ADD CONSTRAINT "WeeklyMaterialCap_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
