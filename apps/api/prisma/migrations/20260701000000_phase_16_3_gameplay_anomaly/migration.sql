-- Phase 16.3 — Gameplay Anti-cheat Deep Detection
-- Adds:
--   - GameplayAnomaly: detection-only tracking row cho hành vi farm
--     bất thường ở từng module gameplay (dungeon / boss / mission /
--     arena / territory) + EXP gain bất thường + item gain bất thường
--     + combat result mismatch.
--
-- Tách khỏi `EconomyAnomaly` (Phase 16.6) để admin filter sạch theo
-- domain + audit history không trộn semantic.
--
-- Indexes:
--   - UNIQUE (type, characterId, windowKey): idempotency per scan
--     window. Multi-instance race → second writer hit P2002 + skip.
--   - (status, severity, createdAt DESC): dashboard query "anomaly
--     OPEN CRITICAL gần nhất".
--   - (source, createdAt DESC): FE filter theo module.
--   - (type, createdAt DESC): FE filter theo rule.
--   - (characterId, createdAt DESC): drill-down character.
--   - (userId, createdAt DESC): drill-down account-level.
--
-- Privacy: không lưu raw IP / token / cookie / refresh hash.
-- detailsJson đã sanitize ở caller. Migration additive — không backfill
-- row cũ. KHÔNG tạo bảng trùng với EconomyAnomaly.

CREATE TABLE "GameplayAnomaly" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "characterId" TEXT,
    "userId" TEXT,
    "windowKey" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "GameplayAnomaly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameplayAnomaly_type_characterId_windowKey_key"
    ON "GameplayAnomaly"("type", "characterId", "windowKey");

CREATE INDEX "GameplayAnomaly_status_severity_createdAt_idx"
    ON "GameplayAnomaly"("status", "severity", "createdAt");

CREATE INDEX "GameplayAnomaly_source_createdAt_idx"
    ON "GameplayAnomaly"("source", "createdAt");

CREATE INDEX "GameplayAnomaly_type_createdAt_idx"
    ON "GameplayAnomaly"("type", "createdAt");

CREATE INDEX "GameplayAnomaly_characterId_createdAt_idx"
    ON "GameplayAnomaly"("characterId", "createdAt");

CREATE INDEX "GameplayAnomaly_userId_createdAt_idx"
    ON "GameplayAnomaly"("userId", "createdAt");
