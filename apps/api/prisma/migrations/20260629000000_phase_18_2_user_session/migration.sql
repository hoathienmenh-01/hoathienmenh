-- Phase 18.2 — Session Management Hardening
-- Adds:
--   - UserSession: 1 row đại diện 1 phiên đăng nhập (device/browser).
--     Group nhiều RefreshToken theo chain rotation cùng family.
--     Lưu ipHash (privacy) + sanitized userAgent + createdAt/lastSeenAt
--     /expiresAt/revokedAt/revokedReason/revokedById/suspicious.
--   - RefreshToken.sessionId (nullable FK → UserSession): link refresh
--     token với session family. SET NULL khi UserSession bị xoá (giữ
--     history). Row cũ trước migration sẽ NULL — sẽ được replace ở lần
--     rotate tiếp theo (additive, không backfill cần thiết).
--
-- Indexes:
--   - UserSession(userId, revokedAt): list active session của user.
--   - UserSession(userId, lastSeenAt DESC): sort recent first cho FE.
--   - UserSession(expiresAt, revokedAt): cron sweep expired.
--   - UserSession(revokedAt, createdAt DESC): admin filter REVOKED.
--   - RefreshToken(sessionId, revokedAt): revoke-all-children query.
--
-- Privacy: KHÔNG migrate raw IP / UA cũ — column mới NULL cho row cũ.

-- CreateTable UserSession
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedById" TEXT,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey UserSession → User (cascade — xoá user → xoá session).
ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex UserSession
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");
CREATE INDEX "UserSession_userId_lastSeenAt_idx" ON "UserSession"("userId", "lastSeenAt" DESC);
CREATE INDEX "UserSession_expiresAt_revokedAt_idx" ON "UserSession"("expiresAt", "revokedAt");
CREATE INDEX "UserSession_revokedAt_createdAt_idx" ON "UserSession"("revokedAt", "createdAt" DESC);

-- AlterTable RefreshToken: thêm sessionId (nullable).
ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" TEXT;

-- AddForeignKey RefreshToken.sessionId → UserSession (SET NULL on delete).
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex RefreshToken sessionId
CREATE INDEX "RefreshToken_sessionId_revokedAt_idx" ON "RefreshToken"("sessionId", "revokedAt");
