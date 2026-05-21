-- CreateTable
CREATE TABLE "SectAuditLog" (
    "id" TEXT NOT NULL,
    "sectId" TEXT NOT NULL,
    "actorCharId" TEXT NOT NULL,
    "targetCharId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromRole" "SectRole",
    "toRole" "SectRole",
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectAuditLog_sectId_createdAt_idx" ON "SectAuditLog"("sectId", "createdAt");
CREATE INDEX "SectAuditLog_actorCharId_createdAt_idx" ON "SectAuditLog"("actorCharId", "createdAt");
