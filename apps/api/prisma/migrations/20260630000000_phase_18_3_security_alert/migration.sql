-- Phase 18.3 — Security Audit / Alert Polish
-- Adds:
--   - SecurityAlert: workflow row cho admin theo dõi sự kiện bảo mật
--     (OPEN → ACKNOWLEDGED → RESOLVED). Khác `SecurityEvent` ở chỗ
--     mutable status + lưu resolutionNote.
--
-- Indexes:
--   - (status, severity, createdAt DESC): dashboard query "alert OPEN
--     CRITICAL gần nhất".
--   - (source, createdAt DESC): FE filter theo source.
--   - (type, createdAt DESC): FE filter theo alert type.
--   - (relatedUserId, createdAt DESC): drill-down user.
--   - (eventId): query alert theo SecurityEvent gốc (idempotency check).
--   - (createdAt DESC): list mới nhất.
--
-- Privacy: không lưu raw IP / token / cookie. detailsJson đã sanitize
-- ở caller. Migration additive — không backfill row cũ.

CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "eventId" TEXT,
    "relatedUserId" TEXT,
    "relatedCharacterId" TEXT,
    "relatedSessionId" TEXT,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityAlert_status_severity_createdAt_idx" ON "SecurityAlert"("status", "severity", "createdAt" DESC);
CREATE INDEX "SecurityAlert_source_createdAt_idx" ON "SecurityAlert"("source", "createdAt" DESC);
CREATE INDEX "SecurityAlert_type_createdAt_idx" ON "SecurityAlert"("type", "createdAt" DESC);
CREATE INDEX "SecurityAlert_relatedUserId_createdAt_idx" ON "SecurityAlert"("relatedUserId", "createdAt" DESC);
CREATE INDEX "SecurityAlert_eventId_idx" ON "SecurityAlert"("eventId");
CREATE INDEX "SecurityAlert_createdAt_idx" ON "SecurityAlert"("createdAt" DESC);
