-- CreateTable
CREATE TABLE "EconomyLedgerCheckRun" (
    "id" TEXT NOT NULL,
    "dayBucket" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summaryJson" JSONB NOT NULL DEFAULT '{}',
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyLedgerCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomyLedgerCheckIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "characterId" TEXT,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomyLedgerCheckIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomyAnomaly" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "characterId" TEXT,
    "userId" TEXT,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "windowKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomyAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EconomyLedgerCheckRun_dayBucket_key" ON "EconomyLedgerCheckRun"("dayBucket");

-- CreateIndex
CREATE INDEX "EconomyLedgerCheckRun_startedAt_idx" ON "EconomyLedgerCheckRun"("startedAt");

-- CreateIndex
CREATE INDEX "EconomyLedgerCheckIssue_runId_severity_idx" ON "EconomyLedgerCheckIssue"("runId", "severity");

-- CreateIndex
CREATE INDEX "EconomyLedgerCheckIssue_status_severity_createdAt_idx" ON "EconomyLedgerCheckIssue"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "EconomyLedgerCheckIssue_type_status_idx" ON "EconomyLedgerCheckIssue"("type", "status");

-- CreateIndex
CREATE INDEX "EconomyAnomaly_status_severity_createdAt_idx" ON "EconomyAnomaly"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "EconomyAnomaly_source_createdAt_idx" ON "EconomyAnomaly"("source", "createdAt");

-- CreateIndex
CREATE INDEX "EconomyAnomaly_characterId_createdAt_idx" ON "EconomyAnomaly"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "EconomyAnomaly_userId_createdAt_idx" ON "EconomyAnomaly"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EconomyAnomaly_source_characterId_windowKey_key" ON "EconomyAnomaly"("source", "characterId", "windowKey");

-- AddForeignKey
ALTER TABLE "EconomyLedgerCheckIssue" ADD CONSTRAINT "EconomyLedgerCheckIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EconomyLedgerCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "SectTerritoryInfluence_regionKey_characterId_sourceKey_sourceTy" RENAME TO "SectTerritoryInfluence_regionKey_characterId_sourceKey_sour_key";

-- RenameIndex
ALTER INDEX "SectWarContribution_weekKey_characterId_activityKey_sourceType_" RENAME TO "SectWarContribution_weekKey_characterId_activityKey_sourceT_key";
