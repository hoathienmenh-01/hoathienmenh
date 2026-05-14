-- Phase 39.0 — Seasonal Server Progression foundation.

CREATE TYPE "SeasonStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'ENDED', 'ARCHIVED');

CREATE TYPE "SeasonLeaderboardKind" AS ENUM ('POINTS', 'ROGUELIKE_FLOOR', 'BOSS_DEFEATS', 'DUNGEON_CLEARS');

CREATE TABLE "ServerSeason" (
    "id" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "SeasonStatus" NOT NULL DEFAULT 'UPCOMING',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "pointConfig" JSONB NOT NULL DEFAULT '{}',
    "rewardConfig" JSONB NOT NULL DEFAULT '[]',
    "milestoneConfig" JSONB NOT NULL DEFAULT '[]',
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerSeason_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonProgress" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "bestRoguelikeFloor" INTEGER NOT NULL DEFAULT 0,
    "bossDefeats" INTEGER NOT NULL DEFAULT 0,
    "dungeonClears" INTEGER NOT NULL DEFAULT 0,
    "craftCount" INTEGER NOT NULL DEFAULT 0,
    "breakthroughCount" INTEGER NOT NULL DEFAULT 0,
    "lastPointAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonLeaderboardEntry" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" "SeasonLeaderboardKind" NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "tieBreaker" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonLeaderboardEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonRewardClaim" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rewardKey" TEXT NOT NULL,
    "grantJson" JSONB NOT NULL DEFAULT '{}',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonRewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonServerMilestone" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "milestoneKey" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "effectKey" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonServerMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServerSeason_seasonKey_key" ON "ServerSeason"("seasonKey");
CREATE INDEX "ServerSeason_status_startAt_endAt_idx" ON "ServerSeason"("status", "startAt", "endAt");
CREATE INDEX "ServerSeason_startAt_endAt_idx" ON "ServerSeason"("startAt", "endAt");

CREATE UNIQUE INDEX "SeasonProgress_seasonId_characterId_key" ON "SeasonProgress"("seasonId", "characterId");
CREATE INDEX "SeasonProgress_seasonId_points_idx" ON "SeasonProgress"("seasonId", "points");
CREATE INDEX "SeasonProgress_characterId_updatedAt_idx" ON "SeasonProgress"("characterId", "updatedAt");

CREATE UNIQUE INDEX "SeasonLeaderboardEntry_seasonId_kind_characterId_key" ON "SeasonLeaderboardEntry"("seasonId", "kind", "characterId");
CREATE INDEX "SeasonLeaderboardEntry_seasonId_kind_score_tieBreaker_idx" ON "SeasonLeaderboardEntry"("seasonId", "kind", "score", "tieBreaker");

CREATE UNIQUE INDEX "SeasonRewardClaim_seasonId_characterId_rewardKey_key" ON "SeasonRewardClaim"("seasonId", "characterId", "rewardKey");
CREATE INDEX "SeasonRewardClaim_characterId_claimedAt_idx" ON "SeasonRewardClaim"("characterId", "claimedAt");
CREATE INDEX "SeasonRewardClaim_seasonId_rewardKey_idx" ON "SeasonRewardClaim"("seasonId", "rewardKey");

CREATE UNIQUE INDEX "SeasonServerMilestone_seasonId_milestoneKey_key" ON "SeasonServerMilestone"("seasonId", "milestoneKey");
CREATE INDEX "SeasonServerMilestone_seasonId_metric_idx" ON "SeasonServerMilestone"("seasonId", "metric");
CREATE INDEX "SeasonServerMilestone_seasonId_unlockedAt_idx" ON "SeasonServerMilestone"("seasonId", "unlockedAt");

ALTER TABLE "SeasonProgress" ADD CONSTRAINT "SeasonProgress_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ServerSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonProgress" ADD CONSTRAINT "SeasonProgress_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeasonLeaderboardEntry" ADD CONSTRAINT "SeasonLeaderboardEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ServerSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonLeaderboardEntry" ADD CONSTRAINT "SeasonLeaderboardEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeasonRewardClaim" ADD CONSTRAINT "SeasonRewardClaim_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ServerSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonRewardClaim" ADD CONSTRAINT "SeasonRewardClaim_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeasonServerMilestone" ADD CONSTRAINT "SeasonServerMilestone_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ServerSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
