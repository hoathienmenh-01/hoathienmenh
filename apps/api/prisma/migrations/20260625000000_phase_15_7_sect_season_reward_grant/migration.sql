-- Phase 15.7 — Sect Season Champion / MVP reward grant audit table.
--
-- 1 row = 1 (seasonKey, rewardType, characterId). UNIQUE composite
-- enforces idempotency: cron / admin manual run cùng season KHÔNG gửi
-- mail trùng. rewardType in ('CHAMPION', 'MVP').
--
-- Rollback: DROP TABLE "SectSeasonRewardGrant" — bảng độc lập (không FK
-- runtime). Caller cleanup mail + ledger nếu rollback grant batch.

CREATE TABLE "SectSeasonRewardGrant" (
    "id" TEXT NOT NULL,
    "seasonKey" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sectId" TEXT,
    "mailId" TEXT,
    "rewardJson" JSONB NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectSeasonRewardGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectSeasonRewardGrant_seasonKey_rewardType_characterId_key"
    ON "SectSeasonRewardGrant"("seasonKey", "rewardType", "characterId");

CREATE INDEX "SectSeasonRewardGrant_seasonKey_idx"
    ON "SectSeasonRewardGrant"("seasonKey");

CREATE INDEX "SectSeasonRewardGrant_rewardType_idx"
    ON "SectSeasonRewardGrant"("rewardType");

CREATE INDEX "SectSeasonRewardGrant_characterId_idx"
    ON "SectSeasonRewardGrant"("characterId");

CREATE INDEX "SectSeasonRewardGrant_sectId_idx"
    ON "SectSeasonRewardGrant"("sectId");
