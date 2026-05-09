-- Phase 14.0.E — Territory Owner Reward Mail Grant audit row.
--
-- Một bảng mới (independent, no FK ngoài):
--   - `TerritoryOwnerRewardGrant`: 1 row / (periodKey, regionKey, characterId)
--     tuple. UNIQUE composite cho idempotency — admin gọi
--     `POST /admin/territory/rewards/grant-weekly` nhiều lần cùng
--     `periodKey` KHÔNG gửi mail trùng. `mailId` nullable
--     cho dryRun hoặc race recover sequence.
--
-- Rollback: DROP bảng — independent, no FK. Mail/Character row giữ nguyên
-- (FK nullable không enforce). Caller cleanup mail + ledger thủ công nếu
-- cần unwind 1 grant batch (CHƯA có endpoint rollback).

CREATE TABLE "TerritoryOwnerRewardGrant" (
  "id"          TEXT         NOT NULL,
  "periodKey"   TEXT         NOT NULL,
  "regionKey"   TEXT         NOT NULL,
  "sectId"      TEXT         NOT NULL,
  "characterId" TEXT         NOT NULL,
  "mailId"      TEXT,
  "rewardJson"  JSONB        NOT NULL,
  "grantedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TerritoryOwnerRewardGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TerritoryOwnerRewardGrant_periodKey_regionKey_characterId_key"
  ON "TerritoryOwnerRewardGrant" ("periodKey", "regionKey", "characterId");

CREATE INDEX "TerritoryOwnerRewardGrant_periodKey_idx"
  ON "TerritoryOwnerRewardGrant" ("periodKey");

CREATE INDEX "TerritoryOwnerRewardGrant_regionKey_idx"
  ON "TerritoryOwnerRewardGrant" ("regionKey");

CREATE INDEX "TerritoryOwnerRewardGrant_sectId_idx"
  ON "TerritoryOwnerRewardGrant" ("sectId");

CREATE INDEX "TerritoryOwnerRewardGrant_characterId_idx"
  ON "TerritoryOwnerRewardGrant" ("characterId");
