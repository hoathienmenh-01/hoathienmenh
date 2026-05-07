-- Phase 13.1.A — Sect War (Tông Môn Chiến) tuần lễ contribution & weekly
-- reward claim persistence. Thêm 2 model:
--   1. `SectWarContribution` — log mỗi activity (dungeon clear, boss
--      participation, daily login, quest claim, ...) → cộng `points` cho
--      `sectId` trong `weekKey`.
--   2. `SectWarWeeklyRewardClaim` — log mỗi character đã claim reward tuần
--      với rank/tier snapshot tại claim time.
--
-- Contribution idempotency:
--   UNIQUE `(weekKey, characterId, activityKey, sourceType, sourceId)`
--   — retry endpoint cùng entity (vd cùng dungeonRunId) chỉ ghi 1 row,
--   không double điểm. PostgreSQL NULL ≠ NULL ⇒ row có sourceId NULL không
--   chạm UNIQUE. Hooks hiện tại luôn truyền non-null sourceId.
--
-- Weekly reward claim atomicity:
--   UNIQUE `(weekKey, characterId)` — race-safe: 2 concurrent POST
--   `/sect-war/claim` chỉ 1 thắng (P2002 → SECT_WAR_ALREADY_CLAIMED).
--
-- Indexes:
--   - `SectWarContribution_weekKey_sectId_idx` cho leaderboard sum query
--     (`SUM(points) GROUP BY sectId WHERE weekKey=...`).
--   - `SectWarContribution_weekKey_characterId_idx` cho personal status
--     (`SUM(points) WHERE weekKey=... AND characterId=...` + breakdown).
--   - `SectWarContribution_weekKey_createdAt_idx` cho admin replay/audit.
--   - `SectWarWeeklyRewardClaim_weekKey_sectId_idx` cho admin tổng hợp
--     theo sect.
--   - `SectWarWeeklyRewardClaim_characterId_claimedAt_idx` cho personal
--     history.
--
-- Rollback: DROP cả 2 bảng — không ảnh hưởng các bảng khác (no FK ngoài).
-- Phase 13.0 LiveOps + boss/dungeon/daily/quest module không phụ thuộc 2
-- bảng này; nếu rollback giữa phase, hooks sẽ no-op (best-effort try/catch
-- bao quanh `addContributionTx` không throw).

CREATE TABLE "SectWarContribution" (
  "id"          TEXT       NOT NULL,
  "weekKey"     TEXT       NOT NULL,
  "sectId"      TEXT       NOT NULL,
  "characterId" TEXT       NOT NULL,
  "activityKey" TEXT       NOT NULL,
  "sourceType"  TEXT       NOT NULL,
  "sourceId"    TEXT,
  "points"      INTEGER    NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectWarContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectWarContribution_weekKey_characterId_activityKey_sourceType_sourceId_key"
  ON "SectWarContribution" ("weekKey", "characterId", "activityKey", "sourceType", "sourceId");

CREATE INDEX "SectWarContribution_weekKey_sectId_idx"
  ON "SectWarContribution" ("weekKey", "sectId");

CREATE INDEX "SectWarContribution_weekKey_characterId_idx"
  ON "SectWarContribution" ("weekKey", "characterId");

CREATE INDEX "SectWarContribution_weekKey_createdAt_idx"
  ON "SectWarContribution" ("weekKey", "createdAt");

CREATE TABLE "SectWarWeeklyRewardClaim" (
  "id"                TEXT         NOT NULL,
  "weekKey"           TEXT         NOT NULL,
  "sectId"            TEXT         NOT NULL,
  "characterId"       TEXT         NOT NULL,
  "rewardTierKey"     TEXT         NOT NULL,
  "pointsAtClaim"     INTEGER      NOT NULL,
  "sectRankAtClaim"   INTEGER      NOT NULL,
  "sectPointsAtClaim" INTEGER      NOT NULL,
  "claimedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectWarWeeklyRewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectWarWeeklyRewardClaim_weekKey_characterId_key"
  ON "SectWarWeeklyRewardClaim" ("weekKey", "characterId");

CREATE INDEX "SectWarWeeklyRewardClaim_weekKey_sectId_idx"
  ON "SectWarWeeklyRewardClaim" ("weekKey", "sectId");

CREATE INDEX "SectWarWeeklyRewardClaim_characterId_claimedAt_idx"
  ON "SectWarWeeklyRewardClaim" ("characterId", "claimedAt");
