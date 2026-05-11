-- Phase 15.8 — LiveOps cron run audit / health tracking.
--
-- 1 row = 1 cron run (territory / sect-season / weekly). status endpoint
-- đọc row mới nhất theo cronKey để compute health (OK/STALE/DEGRADED).
--
-- Rollback: DROP TABLE "LiveOpsCronRunLog" — bảng độc lập (no FK).

CREATE TABLE "LiveOpsCronRunLog" (
    "id" TEXT NOT NULL,
    "cronKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "triggeredBy" TEXT,
    "summaryJson" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "LiveOpsCronRunLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveOpsCronRunLog_cronKey_finishedAt_idx"
    ON "LiveOpsCronRunLog"("cronKey", "finishedAt" DESC);

CREATE INDEX "LiveOpsCronRunLog_cronKey_success_finishedAt_idx"
    ON "LiveOpsCronRunLog"("cronKey", "success", "finishedAt" DESC);

CREATE INDEX "LiveOpsCronRunLog_cronKey_startedAt_idx"
    ON "LiveOpsCronRunLog"("cronKey", "startedAt" DESC);
