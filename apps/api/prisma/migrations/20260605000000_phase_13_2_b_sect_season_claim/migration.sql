-- Phase 13.2.B — Sect Season Milestone claim log.
-- Idempotency dedupe: UNIQUE (characterId, seasonKey, milestoneKey).
-- CAS guard: insert trước, currency/inventory grant sau cùng tx — fail bất
-- kỳ bước nào sẽ rollback toàn bộ (Postgres tx atomic).
CREATE TABLE "SectSeasonClaim" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "milestoneKey" TEXT NOT NULL,
    "pointsAtClaim" INTEGER NOT NULL,
    "rewardSnapshot" JSONB NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectSeasonClaim_pkey" PRIMARY KEY ("id")
);

-- UNIQUE constraint — race-safe + double-claim prevention.
CREATE UNIQUE INDEX "SectSeasonClaim_characterId_seasonKey_milestoneKey_key" ON "SectSeasonClaim"("characterId", "seasonKey", "milestoneKey");

-- Index: per-character timeline (recent claims dashboard).
CREATE INDEX "SectSeasonClaim_characterId_claimedAt_idx" ON "SectSeasonClaim"("characterId", "claimedAt");

-- Index: per-season aggregate (admin analytics, claim rate per milestone).
CREATE INDEX "SectSeasonClaim_seasonKey_milestoneKey_idx" ON "SectSeasonClaim"("seasonKey", "milestoneKey");

-- FK với onDelete CASCADE — match Character.sectSeasonClaims relation.
ALTER TABLE "SectSeasonClaim" ADD CONSTRAINT "SectSeasonClaim_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
