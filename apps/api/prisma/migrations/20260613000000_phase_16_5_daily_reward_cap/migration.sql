-- Phase 16.5 — Daily Reward Cap.
-- Tạo 2 bảng mới cho cap accum + audit log:
--   1) CharacterDailyRewardBucket — accum tổng EXP/linhThach trong 1 ngày
--      cho 1 (characterId, dayBucket, source) tuple. UNIQUE composite +
--      index `(dayBucket)` cho ops query.
--   2) RewardCapEvent — log mỗi lần wasCapped=true với requested/granted/
--      cappedAmount. Index theo character + ngày + source cho admin truy vấn.

CREATE TABLE "CharacterDailyRewardBucket" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "expAccum" BIGINT NOT NULL DEFAULT 0,
    "linhThachAccum" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterDailyRewardBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterDailyRewardBucket_characterId_dayBucket_source_key"
    ON "CharacterDailyRewardBucket"("characterId", "dayBucket", "source");

CREATE INDEX "CharacterDailyRewardBucket_dayBucket_idx"
    ON "CharacterDailyRewardBucket"("dayBucket");

ALTER TABLE "CharacterDailyRewardBucket"
    ADD CONSTRAINT "CharacterDailyRewardBucket_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RewardCapEvent" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "requestedExp" BIGINT NOT NULL,
    "requestedLinhThach" BIGINT NOT NULL,
    "grantedExp" BIGINT NOT NULL,
    "grantedLinhThach" BIGINT NOT NULL,
    "cappedExp" BIGINT NOT NULL,
    "cappedLinhThach" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardCapEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RewardCapEvent_characterId_dayBucket_idx"
    ON "RewardCapEvent"("characterId", "dayBucket");

CREATE INDEX "RewardCapEvent_dayBucket_source_idx"
    ON "RewardCapEvent"("dayBucket", "source");

CREATE INDEX "RewardCapEvent_createdAt_idx"
    ON "RewardCapEvent"("createdAt");

ALTER TABLE "RewardCapEvent"
    ADD CONSTRAINT "RewardCapEvent_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
