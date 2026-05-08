-- Phase 13.2.C — Sect Season History + Hall of Fame snapshot persistence.
-- Thêm 3 model:
--   1. `SectSeasonSnapshot` — header per `seasonKey` đã chốt (1 row / season).
--      `finalizedAt` thời điểm tạo snapshot. `champion*` / `mvp*` snapshot
--      rank-1 sect + #1 cá nhân (denormalized cho list view nhanh).
--   2. `SectSeasonSectRank` — rank-row của Sect trong season đã chốt
--      (TOP N theo `LEADERBOARD_TOP`). UNIQUE `(seasonKey, sectId)` →
--      idempotent insert; UNIQUE `(seasonKey, rank)` → snapshot integrity
--      (không trùng rank cùng season).
--   3. `SectSeasonTopMember` — top contributor cá nhân trong season đã chốt
--      (TOP N theo `TOP_MEMBERS_PER_SEASON`). Snapshot tên + sect tại lúc
--      finalize — nếu character đổi sect/đổi tên về sau, hall of fame vẫn
--      reflect đúng season cũ.
--
-- Idempotency của snapshot:
--   `SectSeasonSnapshot.seasonKey` PRIMARY KEY → caller `snapshotSeason()`
--   chỉ insert được 1 lần / season; lần thứ 2 trở đi return existing.
--   `SectSeasonSectRank` & `SectSeasonTopMember` ghi trong cùng tx với
--   `SectSeasonSnapshot` insert — nếu rollback, không còn row mồ côi.
--
-- Indexes:
--   - `SectSeasonSectRank_seasonKey_idx` cho list rows theo season.
--   - `SectSeasonSectRank_sectId_idx` cho aggregate Hall of Fame
--     (`COUNT(*) WHERE rank=1 GROUP BY sectId`).
--   - `SectSeasonTopMember_seasonKey_idx` cho list theo season.
--   - `SectSeasonTopMember_characterId_idx` cho aggregate Hall of Fame cá nhân.
--
-- Rollback: DROP cả 3 bảng — không ảnh hưởng `SectWarContribution` (no FK).

CREATE TABLE "SectSeasonSnapshot" (
  "seasonKey"        TEXT         NOT NULL,
  "finalizedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalSects"       INTEGER      NOT NULL,
  "totalContributors" INTEGER     NOT NULL,
  "totalPoints"      INTEGER      NOT NULL,
  "championSectId"   TEXT,
  "championSectName" TEXT,
  "championPoints"   INTEGER,
  "mvpCharacterId"   TEXT,
  "mvpCharacterName" TEXT,
  "mvpSectId"        TEXT,
  "mvpSectName"      TEXT,
  "mvpPoints"        INTEGER,

  CONSTRAINT "SectSeasonSnapshot_pkey" PRIMARY KEY ("seasonKey")
);

CREATE INDEX "SectSeasonSnapshot_finalizedAt_idx"
  ON "SectSeasonSnapshot" ("finalizedAt" DESC);

CREATE TABLE "SectSeasonSectRank" (
  "id"               TEXT    NOT NULL,
  "seasonKey"        TEXT    NOT NULL,
  "sectId"           TEXT    NOT NULL,
  "sectName"         TEXT    NOT NULL,
  "rank"             INTEGER NOT NULL,
  "points"           INTEGER NOT NULL,
  "contributors"     INTEGER NOT NULL,
  "weeksContributed" INTEGER NOT NULL,

  CONSTRAINT "SectSeasonSectRank_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectSeasonSectRank_seasonKey_sectId_key"
  ON "SectSeasonSectRank" ("seasonKey", "sectId");

CREATE UNIQUE INDEX "SectSeasonSectRank_seasonKey_rank_key"
  ON "SectSeasonSectRank" ("seasonKey", "rank");

CREATE INDEX "SectSeasonSectRank_seasonKey_idx"
  ON "SectSeasonSectRank" ("seasonKey");

CREATE INDEX "SectSeasonSectRank_sectId_rank_idx"
  ON "SectSeasonSectRank" ("sectId", "rank");

CREATE TABLE "SectSeasonTopMember" (
  "id"            TEXT    NOT NULL,
  "seasonKey"     TEXT    NOT NULL,
  "characterId"   TEXT    NOT NULL,
  "characterName" TEXT    NOT NULL,
  "sectId"        TEXT,
  "sectName"      TEXT,
  "rank"          INTEGER NOT NULL,
  "points"        INTEGER NOT NULL,

  CONSTRAINT "SectSeasonTopMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectSeasonTopMember_seasonKey_characterId_key"
  ON "SectSeasonTopMember" ("seasonKey", "characterId");

CREATE UNIQUE INDEX "SectSeasonTopMember_seasonKey_rank_key"
  ON "SectSeasonTopMember" ("seasonKey", "rank");

CREATE INDEX "SectSeasonTopMember_seasonKey_idx"
  ON "SectSeasonTopMember" ("seasonKey");

CREATE INDEX "SectSeasonTopMember_characterId_rank_idx"
  ON "SectSeasonTopMember" ("characterId", "rank");
