-- Phase 18.1 — Security Rate Limit + Abuse Protection
-- Adds:
--   - SecurityEvent: audit trail mọi tín hiệu abuse (rate limit
--     violation, login failed, admin forbidden, etc.).
--   - SecurityBlock: fail2ban-style temporary block subject (IP/USER).
-- Indexes optimized cho query type+createdAt, severity+createdAt,
-- ipHash+type+createdAt, userId+type+createdAt, policy+createdAt.
-- SecurityBlock có index (type, subjectHash, liftedAt, expiresAt) cho
-- fast lookup active block trong RateLimitGuard.

-- CreateTable SecurityEvent
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ipHash" TEXT,
    "userId" TEXT,
    "characterId" TEXT,
    "policy" TEXT,
    "detailJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable SecurityBlock
CREATE TABLE "SecurityBlock" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,

    CONSTRAINT "SecurityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex SecurityEvent
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");
CREATE INDEX "SecurityEvent_severity_createdAt_idx" ON "SecurityEvent"("severity", "createdAt");
CREATE INDEX "SecurityEvent_ipHash_type_createdAt_idx" ON "SecurityEvent"("ipHash", "type", "createdAt");
CREATE INDEX "SecurityEvent_userId_type_createdAt_idx" ON "SecurityEvent"("userId", "type", "createdAt");
CREATE INDEX "SecurityEvent_policy_createdAt_idx" ON "SecurityEvent"("policy", "createdAt");

-- CreateIndex SecurityBlock
CREATE INDEX "SecurityBlock_type_subjectHash_liftedAt_expiresAt_idx" ON "SecurityBlock"("type", "subjectHash", "liftedAt", "expiresAt");
CREATE INDEX "SecurityBlock_type_expiresAt_idx" ON "SecurityBlock"("type", "expiresAt");
CREATE INDEX "SecurityBlock_createdAt_idx" ON "SecurityBlock"("createdAt");
