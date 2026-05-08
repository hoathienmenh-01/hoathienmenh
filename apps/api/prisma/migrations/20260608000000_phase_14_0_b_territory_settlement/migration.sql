-- Phase 14.0.B — Territory Settlement and Region Ownership.
--
-- Hai bảng mới (independent, no FK ngoài):
--   - `SectTerritoryRegionState`: 1 row / regionKey, lưu ownerSectId hiện
--     tại + settledAt + periodKey gần nhất. Updated atomically khi
--     settlement chốt.
--   - `SectTerritorySettlementSnapshot`: lịch sử settlement, mỗi row =
--     1 region × 1 periodKey. UNIQUE (regionKey, periodKey) cho idempotency
--     — gọi settlement nhiều lần cùng period chỉ ghi 1 row (P2002 swallow).
--     `winnerSectName` denormalized snapshot — audit trail không đổi khi
--     sect rename / ownerSect bị xoá sau này.
--
-- Rollback: DROP cả 2 bảng — không ảnh hưởng influence rows (Phase 14.0.A)
-- và không có FK ngoài. Hooks đọc owner sẽ no-op khi bảng vắng mặt.

CREATE TABLE "SectTerritoryRegionState" (
  "regionKey"     TEXT          NOT NULL,
  "ownerSectId"   TEXT,
  "ownerSectName" TEXT,
  "periodKey"     TEXT,
  "settledAt"     TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectTerritoryRegionState_pkey" PRIMARY KEY ("regionKey")
);

CREATE INDEX "SectTerritoryRegionState_ownerSectId_idx"
  ON "SectTerritoryRegionState" ("ownerSectId");

CREATE TABLE "SectTerritorySettlementSnapshot" (
  "id"               TEXT         NOT NULL,
  "regionKey"        TEXT         NOT NULL,
  "periodKey"        TEXT         NOT NULL,
  "winnerSectId"     TEXT,
  "winnerSectName"   TEXT,
  "winnerPoints"     INTEGER      NOT NULL DEFAULT 0,
  "runnerUpSectId"   TEXT,
  "runnerUpSectName" TEXT,
  "runnerUpPoints"   INTEGER      NOT NULL DEFAULT 0,
  "totalSects"       INTEGER      NOT NULL DEFAULT 0,
  "totalPoints"      INTEGER      NOT NULL DEFAULT 0,
  "settledAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledBy"        TEXT,

  CONSTRAINT "SectTerritorySettlementSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectTerritorySettlementSnapshot_regionKey_periodKey_key"
  ON "SectTerritorySettlementSnapshot" ("regionKey", "periodKey");

CREATE INDEX "SectTerritorySettlementSnapshot_periodKey_idx"
  ON "SectTerritorySettlementSnapshot" ("periodKey");

CREATE INDEX "SectTerritorySettlementSnapshot_regionKey_settledAt_idx"
  ON "SectTerritorySettlementSnapshot" ("regionKey", "settledAt");
