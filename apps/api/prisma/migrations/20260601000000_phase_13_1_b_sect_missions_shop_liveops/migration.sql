-- Phase 13.1.B — Sect Missions, Sect Shop & Admin LiveOps Controls.
--
-- Adds:
--   1. `Character.sectContribBalance` / `sectContribLifetime` — sect
--      contribution currency cho Sect Shop. Default 0 (legacy character
--      backfill via DEFAULT). Phân biệt với `congHien` legacy treasury
--      (KHÔNG đổi).
--   2. `SectMissionClaim` — log claim nhiệm vụ Tông Môn (DAILY/WEEKLY)
--      với UNIQUE `(characterId, missionKey, periodKey)` đảm bảo idempotency
--      / không double claim. `periodKey` đổi mỗi reset (DAILY=YYYY-MM-DD
--      theo MISSION_RESET_TZ, WEEKLY=YYYY-Www ISO week).
--   3. `SectShopPurchase` — log buy Sect Shop (mỗi buy = 1 row). Daily/weekly
--      limit compute từ SUM(qty) trong window. `contributionSpent` snapshot
--      tại commit time (catalog đổi giá tương lai không ảnh hưởng audit).
--   4. `SectContributionLedger` — ledger mutate `Character.sectContribBalance`.
--      `delta` ký dương=earn, âm=spend. Reason whitelist:
--        SECT_MISSION_CLAIM, SECT_SHOP_BUY, SECT_CONTRIBUTION_SPEND,
--        ADMIN_GRANT, SECT_WAR_REWARD.
--   5. `LiveOpsEventOverride` — admin override cho LIVE_OPS_EVENTS catalog
--      (toggle enabled, optional window). UNIQUE `key` → upsert pattern.
--      Audit `updatedBy` (User.id) + `reason`.
--
-- Atomicity / race safety:
--   - Mission claim: UNIQUE `(characterId, missionKey, periodKey)` →
--     P2002 = idempotent skip / "ALREADY_CLAIMED".
--   - Sect shop buy: Prisma tx `updateMany` CAS guard `sectContribBalance >=
--     cost` đảm bảo non-negative race-safe (mirror linhThach pattern).
--     Inventory grant qua `InventoryService` cùng tx.
--   - LiveOps override: UNIQUE `key` → race-safe upsert.
--
-- Rollback:
--   - DROP các bảng mới + DROP COLUMN cho 2 field Character → không ảnh hưởng
--     module khác. SectWar Phase 13.1.A độc lập (không FK đến các bảng này).
--   - Sect Mission/Shop/LiveOps Override stale data sau rollback chỉ là log,
--     không ảnh hưởng integrity.

ALTER TABLE "Character"
  ADD COLUMN "sectContribBalance"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sectContribLifetime" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SectMissionClaim" (
  "id"                        TEXT         NOT NULL,
  "characterId"               TEXT         NOT NULL,
  "missionKey"                TEXT         NOT NULL,
  "periodKey"                 TEXT         NOT NULL,
  "rewardContributionGranted" INTEGER      NOT NULL,
  "claimedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectMissionClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectMissionClaim_characterId_missionKey_periodKey_key"
  ON "SectMissionClaim" ("characterId", "missionKey", "periodKey");

CREATE INDEX "SectMissionClaim_characterId_claimedAt_idx"
  ON "SectMissionClaim" ("characterId", "claimedAt");

CREATE INDEX "SectMissionClaim_missionKey_periodKey_idx"
  ON "SectMissionClaim" ("missionKey", "periodKey");

ALTER TABLE "SectMissionClaim"
  ADD CONSTRAINT "SectMissionClaim_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SectShopPurchase" (
  "id"                TEXT         NOT NULL,
  "characterId"       TEXT         NOT NULL,
  "entryKey"          TEXT         NOT NULL,
  "itemKey"           TEXT         NOT NULL,
  "qty"               INTEGER      NOT NULL,
  "contributionSpent" INTEGER      NOT NULL,
  "dailyPeriodKey"    TEXT         NOT NULL,
  "weeklyPeriodKey"   TEXT         NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectShopPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SectShopPurchase_characterId_entryKey_dailyPeriodKey_idx"
  ON "SectShopPurchase" ("characterId", "entryKey", "dailyPeriodKey");

CREATE INDEX "SectShopPurchase_characterId_entryKey_weeklyPeriodKey_idx"
  ON "SectShopPurchase" ("characterId", "entryKey", "weeklyPeriodKey");

CREATE INDEX "SectShopPurchase_characterId_createdAt_idx"
  ON "SectShopPurchase" ("characterId", "createdAt");

ALTER TABLE "SectShopPurchase"
  ADD CONSTRAINT "SectShopPurchase_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SectContributionLedger" (
  "id"          TEXT         NOT NULL,
  "characterId" TEXT         NOT NULL,
  "delta"       INTEGER      NOT NULL,
  "reason"      TEXT         NOT NULL,
  "refType"     TEXT,
  "refId"       TEXT,
  "meta"        JSONB        NOT NULL DEFAULT '{}',
  "actorUserId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectContributionLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SectContributionLedger_characterId_createdAt_idx"
  ON "SectContributionLedger" ("characterId", "createdAt");

CREATE INDEX "SectContributionLedger_reason_createdAt_idx"
  ON "SectContributionLedger" ("reason", "createdAt");

ALTER TABLE "SectContributionLedger"
  ADD CONSTRAINT "SectContributionLedger_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LiveOpsEventOverride" (
  "id"        TEXT         NOT NULL,
  "key"       TEXT         NOT NULL,
  "enabled"   BOOLEAN      NOT NULL,
  "startsAt"  TIMESTAMP(3),
  "endsAt"    TIMESTAMP(3),
  "reason"    TEXT,
  "updatedBy" TEXT         NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveOpsEventOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveOpsEventOverride_key_key"
  ON "LiveOpsEventOverride" ("key");

CREATE INDEX "LiveOpsEventOverride_enabled_updatedAt_idx"
  ON "LiveOpsEventOverride" ("enabled", "updatedAt");
