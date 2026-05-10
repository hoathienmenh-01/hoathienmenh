-- Phase 14.1.D — Arena Anti-Wintrade Detection
--
-- Adds 1 table:
--   1. ArenaWintradeAlert — detection-only audit row tạo bởi
--      `ArenaAntiWintradeService` khi scan phát hiện pattern bất thường.
--
-- Forward-compat. KHÔNG drop column / không đổi schema cũ. KHÔNG có FK
-- tới Character/ArenaSeason — giữ row audit nếu character/season bị
-- xoá (giống pattern `EconomyAnomaly`).
--
-- Idempotency: UNIQUE `(type, windowKey, attackerCharacterId,
-- defenderCharacterId)` — scanner gọi lại cùng cửa sổ KHÔNG tạo duplicate.

-- CreateTable ArenaWintradeAlert
CREATE TABLE "ArenaWintradeAlert" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT,
    "attackerCharacterId" TEXT,
    "defenderCharacterId" TEXT,
    "relatedCharacterIdsJson" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "windowKey" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArenaWintradeAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArenaWintradeAlert_type_windowKey_attackerCharacterId_defenderCharacterId_key"
    ON "ArenaWintradeAlert"("type", "windowKey", "attackerCharacterId", "defenderCharacterId");

CREATE INDEX "ArenaWintradeAlert_status_severity_createdAt_idx"
    ON "ArenaWintradeAlert"("status", "severity", "createdAt");

CREATE INDEX "ArenaWintradeAlert_type_createdAt_idx"
    ON "ArenaWintradeAlert"("type", "createdAt");

CREATE INDEX "ArenaWintradeAlert_seasonId_severity_idx"
    ON "ArenaWintradeAlert"("seasonId", "severity");

CREATE INDEX "ArenaWintradeAlert_attackerCharacterId_createdAt_idx"
    ON "ArenaWintradeAlert"("attackerCharacterId", "createdAt");

CREATE INDEX "ArenaWintradeAlert_defenderCharacterId_createdAt_idx"
    ON "ArenaWintradeAlert"("defenderCharacterId", "createdAt");
