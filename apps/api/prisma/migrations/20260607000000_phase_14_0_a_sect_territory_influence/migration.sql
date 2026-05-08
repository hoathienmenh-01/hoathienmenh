-- Phase 14.0.A — Sect Territory Influence Foundation persistence.
--
-- Mỗi row = 1 lần character contribute điểm influence cho `sectId` trong
-- `regionKey`. Hooks ghi: dungeon clear, boss participation, boss top
-- damage. Sect mission KHÔNG hook (mission không gắn region — defer).
--
-- Idempotency:
--   UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)`
--   — retry hook cùng entity (vd cùng dungeonRunId / `bossId:characterId`)
--   chỉ ghi 1 row, không double điểm. PostgreSQL NULL ≠ NULL ⇒ row có
--   sourceId NULL không chạm UNIQUE; hooks hiện tại luôn truyền non-null
--   sourceId.
--
-- `sectId` snapshot tại commit time — nếu character đổi sect, điểm cũ vẫn
-- ở sect cũ (history-true). Leaderboard aggregate sum theo `sectId` filter
-- `regionKey`.
--
-- Indexes:
--   - `[regionKey, sectId]` cho leaderboard sum (`SUM(points) GROUP BY
--     sectId WHERE regionKey=...`).
--   - `[regionKey, characterId]` cho personal contribution / cap check.
--   - `[regionKey, createdAt]` cho admin replay/audit.
--   - UNIQUE composite cho idempotency.
--
-- Rollback: DROP bảng — không ảnh hưởng các bảng khác (no FK ngoài).
-- Hooks ở dungeon-run/boss service có try/catch swallow → no-op khi bảng
-- vắng mặt giữa migration window.

CREATE TABLE "SectTerritoryInfluence" (
  "id"          TEXT       NOT NULL,
  "regionKey"   TEXT       NOT NULL,
  "sectId"      TEXT       NOT NULL,
  "characterId" TEXT       NOT NULL,
  "sourceKey"   TEXT       NOT NULL,
  "sourceType"  TEXT       NOT NULL,
  "sourceId"    TEXT,
  "points"      INTEGER    NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectTerritoryInfluence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectTerritoryInfluence_regionKey_characterId_sourceKey_sourceType_sourceId_key"
  ON "SectTerritoryInfluence" ("regionKey", "characterId", "sourceKey", "sourceType", "sourceId");

CREATE INDEX "SectTerritoryInfluence_regionKey_sectId_idx"
  ON "SectTerritoryInfluence" ("regionKey", "sectId");

CREATE INDEX "SectTerritoryInfluence_regionKey_characterId_idx"
  ON "SectTerritoryInfluence" ("regionKey", "characterId");

CREATE INDEX "SectTerritoryInfluence_regionKey_createdAt_idx"
  ON "SectTerritoryInfluence" ("regionKey", "createdAt");
