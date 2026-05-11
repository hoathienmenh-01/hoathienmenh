-- Phase 15.8 — Sect Season Champion membership snapshot.
-- Audit-perfect: champion reward grant uses snapshot taken at finalize time
-- instead of current membership. Idempotent via UNIQUE (seasonKey, sectId, rank).

CREATE TABLE "SectSeasonChampionSnapshot" (
    "id" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "sectId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "memberCharacterIdsJson" JSONB NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectSeasonChampionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectSeasonChampionSnapshot_seasonKey_sectId_rank_key"
    ON "SectSeasonChampionSnapshot"("seasonKey", "sectId", "rank");

CREATE INDEX "SectSeasonChampionSnapshot_seasonKey_idx"
    ON "SectSeasonChampionSnapshot"("seasonKey");

CREATE INDEX "SectSeasonChampionSnapshot_sectId_idx"
    ON "SectSeasonChampionSnapshot"("sectId");
