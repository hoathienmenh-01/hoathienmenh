-- Phase 17.2 — Backup / Restore Weekly Verification tracking.
--
-- 2 bảng độc lập (no FK):
--   - "BackupRun"        — 1 row = 1 lần pg_dump (cron weekly + admin manual).
--   - "BackupVerifyRun"  — 1 row = 1 lần verify-restore.sh chạy.
--
-- Status flow: RUNNING → SUCCESS|FAILED. Row created với
-- status=RUNNING trước khi spawn shell, update khi shell exit.
--
-- Index pattern khớp `LiveOpsCronRunLog` (Phase 15.8) để admin status
-- endpoint query "last success / last error" tối ưu:
--   - (status, startedAt DESC) — list theo status.
--   - (startedAt DESC) — list mới nhất theo lifetime.
--   - (finishedAt DESC) — list "ai vừa xong xong".
--
-- Rollback: DROP TABLE "BackupVerifyRun"; DROP TABLE "BackupRun";

CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fileName" TEXT,
    "fileSizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "storage" TEXT NOT NULL DEFAULT 'LOCAL',
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "actorUserId" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupRun_status_startedAt_idx"
    ON "BackupRun"("status", "startedAt" DESC);

CREATE INDEX "BackupRun_startedAt_idx"
    ON "BackupRun"("startedAt" DESC);

CREATE INDEX "BackupRun_finishedAt_idx"
    ON "BackupRun"("finishedAt" DESC);

CREATE TABLE "BackupVerifyRun" (
    "id" TEXT NOT NULL,
    "backupRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checkedTables" INTEGER,
    "latestMigration" TEXT,
    "errorMessage" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "actorUserId" TEXT,

    CONSTRAINT "BackupVerifyRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupVerifyRun_status_startedAt_idx"
    ON "BackupVerifyRun"("status", "startedAt" DESC);

CREATE INDEX "BackupVerifyRun_startedAt_idx"
    ON "BackupVerifyRun"("startedAt" DESC);

CREATE INDEX "BackupVerifyRun_finishedAt_idx"
    ON "BackupVerifyRun"("finishedAt" DESC);

CREATE INDEX "BackupVerifyRun_backupRunId_idx"
    ON "BackupVerifyRun"("backupRunId");
