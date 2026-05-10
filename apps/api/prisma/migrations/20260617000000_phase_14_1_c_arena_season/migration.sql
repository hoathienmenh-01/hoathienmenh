-- Phase 14.1.C — Arena Season + ELO + Reward
--
-- Adds three tables:
--   1. ArenaSeason            — 1 row per seasonKey (`arena_<isoWeekKey>`).
--   2. ArenaStanding          — per-character rating/wins/losses scoped per season.
--   3. ArenaSeasonRewardGrant — idempotency guard cho mail reward khi settle.
--
-- Forward-compat. KHÔNG drop column / không đổi schema cũ (ArenaProfile +
-- ArenaMatch Phase 14.1.B giữ nguyên).

-- CreateTable ArenaSeason
CREATE TABLE "ArenaSeason" (
    "id" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArenaSeason_seasonKey_key" ON "ArenaSeason"("seasonKey");
CREATE INDEX "ArenaSeason_status_endsAt_idx" ON "ArenaSeason"("status", "endsAt");

-- CreateTable ArenaStanding
CREATE TABLE "ArenaStanding" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "tier" TEXT NOT NULL DEFAULT 'SILVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaStanding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArenaStanding_seasonId_characterId_key" ON "ArenaStanding"("seasonId", "characterId");
CREATE INDEX "ArenaStanding_seasonId_rating_idx" ON "ArenaStanding"("seasonId", "rating");
CREATE INDEX "ArenaStanding_characterId_idx" ON "ArenaStanding"("characterId");

ALTER TABLE "ArenaStanding" ADD CONSTRAINT "ArenaStanding_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ArenaSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArenaStanding" ADD CONSTRAINT "ArenaStanding_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ArenaSeasonRewardGrant
CREATE TABLE "ArenaSeasonRewardGrant" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "rewardJson" JSONB NOT NULL,
    "mailId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaSeasonRewardGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArenaSeasonRewardGrant_seasonId_characterId_key" ON "ArenaSeasonRewardGrant"("seasonId", "characterId");
CREATE INDEX "ArenaSeasonRewardGrant_seasonId_idx" ON "ArenaSeasonRewardGrant"("seasonId");
CREATE INDEX "ArenaSeasonRewardGrant_characterId_idx" ON "ArenaSeasonRewardGrant"("characterId");

ALTER TABLE "ArenaSeasonRewardGrant" ADD CONSTRAINT "ArenaSeasonRewardGrant_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ArenaSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArenaSeasonRewardGrant" ADD CONSTRAINT "ArenaSeasonRewardGrant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
