-- Phase 14.3.D — Tribulation Encounter session (2-phase commit cho mini
-- encounter system). Mỗi character có ≤ 1 row state='pending' tại 1 thời
-- điểm (service-layer enforced). Resolve atomic transition pending→resolved.

-- CreateTable
CREATE TABLE "TribulationEncounter" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "tribulationKey" TEXT NOT NULL,
    "fromRealmKey" TEXT NOT NULL,
    "toRealmKey" TEXT NOT NULL,
    "encounterKey" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "selectedSupportItemKeys" TEXT[],
    "state" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedAttemptLogId" TEXT,

    CONSTRAINT "TribulationEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TribulationEncounter_characterId_state_idx" ON "TribulationEncounter"("characterId", "state");

-- CreateIndex
CREATE INDEX "TribulationEncounter_characterId_startedAt_idx" ON "TribulationEncounter"("characterId", "startedAt");

-- AddForeignKey
ALTER TABLE "TribulationEncounter" ADD CONSTRAINT "TribulationEncounter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
