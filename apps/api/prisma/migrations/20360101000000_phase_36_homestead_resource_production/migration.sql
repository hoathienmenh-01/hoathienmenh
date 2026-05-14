-- Phase 36.0 — Động Phủ, Linh Điền, Dược Viên & Resource Production Foundation V1

CREATE TABLE "Homestead" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "spiritualEnergy" INTEGER NOT NULL DEFAULT 40,
    "spiritualEnergyUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Homestead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomesteadField" (
    "id" TEXT NOT NULL,
    "homesteadId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "cropKey" TEXT NOT NULL,
    "outputItemKey" TEXT NOT NULL,
    "expectedYield" INTEGER NOT NULL,
    "plantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3) NOT NULL,
    "harvestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomesteadField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomesteadGardenPlot" (
    "id" TEXT NOT NULL,
    "homesteadId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "productionKey" TEXT NOT NULL,
    "outputItemKey" TEXT NOT NULL,
    "expectedYield" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomesteadGardenPlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Homestead_characterId_key" ON "Homestead"("characterId");
CREATE INDEX "Homestead_characterId_level_idx" ON "Homestead"("characterId", "level");

CREATE UNIQUE INDEX "HomesteadField_homesteadId_slotIndex_key" ON "HomesteadField"("homesteadId", "slotIndex");
CREATE INDEX "HomesteadField_homesteadId_harvestedAt_idx" ON "HomesteadField"("homesteadId", "harvestedAt");
CREATE INDEX "HomesteadField_readyAt_idx" ON "HomesteadField"("readyAt");

CREATE UNIQUE INDEX "HomesteadGardenPlot_homesteadId_slotIndex_key" ON "HomesteadGardenPlot"("homesteadId", "slotIndex");
CREATE INDEX "HomesteadGardenPlot_homesteadId_claimedAt_idx" ON "HomesteadGardenPlot"("homesteadId", "claimedAt");
CREATE INDEX "HomesteadGardenPlot_readyAt_idx" ON "HomesteadGardenPlot"("readyAt");

ALTER TABLE "Homestead"
    ADD CONSTRAINT "Homestead_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomesteadField"
    ADD CONSTRAINT "HomesteadField_homesteadId_fkey"
    FOREIGN KEY ("homesteadId") REFERENCES "Homestead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomesteadGardenPlot"
    ADD CONSTRAINT "HomesteadGardenPlot_homesteadId_fkey"
    FOREIGN KEY ("homesteadId") REFERENCES "Homestead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
