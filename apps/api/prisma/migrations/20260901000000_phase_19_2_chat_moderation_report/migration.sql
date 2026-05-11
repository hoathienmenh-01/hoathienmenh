-- Phase 19.2 — Chat Moderation & Report System.
--
-- Adds:
--   - 4 enums: ChatMessageReportType / ChatMessageReportStatus /
--     ChatMessageReportReason / ChatMuteScope.
--   - ChatMessageReport: user-submitted report về tin nhắn private hoặc
--     group. Soft-ref pointer (privateMessageId hoặc groupMessageId).
--     Unique partial: (reporterUserId, privateMessageId) và
--     (reporterUserId, groupMessageId) chống duplicate report.
--   - ChatMute: admin câm user trong 1 hoặc nhiều kênh chat
--     (PRIVATE_CHAT / GROUP_CHAT / WORLD_SECT_CHAT / ALL_CHAT). Có
--     `revokedAt` cho early unmute + `expiresAt` cho time-bound mute.
--   - Soft-hide nullable fields trên PrivateChatMessage / GroupChatMessage
--     (`hiddenAt` + `hiddenByAdminId` + `hideReason`) — render placeholder
--     thay vì hard-delete để giữ audit trail.
--   - Lock + dissolve nullable fields trên GroupChat (`lockedAt` +
--     `lockedByAdminId` + `lockReason` + `dissolvedAt` +
--     `dissolvedByAdminId` + `dissolveReason`) — soft-delete + lock
--     state cho admin moderation.
--
-- Soft-ref pattern (KHÔNG FK constraint, đồng nhất với Phase 16.3 /
-- 16.4 / 18.x / 19.1). Service enforce invariant ở layer trên.
--
-- Indexes phục vụ query:
--   - ChatMessageReport: (status, createdAt desc) cho admin list filter
--     open; (reporterUserId, createdAt desc) cho user xem self report;
--     (targetUserId, createdAt desc) cho admin filter theo offender;
--     (reason, status) + (messageType, status) cho summary stats.
--   - ChatMute: (userId, revokedAt, expiresAt) cho enforcement lookup
--     khi send message; (scope, revokedAt, expiresAt) cho admin filter;
--     (createdAt desc) cho admin list newest-first.
--   - Soft-hide partial index: (hiddenAt) cho admin filter "hidden
--     messages this week".
--
-- Migration additive — không touch row dữ liệu cũ. Rollback an toàn:
-- DROP TABLE ChatMessageReport + ChatMute; DROP COLUMN soft-hide /
-- lock / dissolve trên 3 bảng cũ; DROP TYPE 4 enum.

-- CreateEnum
CREATE TYPE "ChatMessageReportType" AS ENUM ('PRIVATE', 'GROUP');

-- CreateEnum
CREATE TYPE "ChatMessageReportStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChatMessageReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'SCAM', 'OFFENSIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatMuteScope" AS ENUM ('PRIVATE_CHAT', 'GROUP_CHAT', 'WORLD_SECT_CHAT', 'ALL_CHAT');

-- AlterTable PrivateChatMessage — additive soft-hide fields.
ALTER TABLE "PrivateChatMessage"
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "hiddenByAdminId" TEXT,
  ADD COLUMN "hideReason" TEXT;

-- CreateIndex
CREATE INDEX "PrivateChatMessage_hiddenAt_idx" ON "PrivateChatMessage"("hiddenAt");

-- AlterTable GroupChatMessage — additive soft-hide fields.
ALTER TABLE "GroupChatMessage"
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "hiddenByAdminId" TEXT,
  ADD COLUMN "hideReason" TEXT;

-- CreateIndex
CREATE INDEX "GroupChatMessage_hiddenAt_idx" ON "GroupChatMessage"("hiddenAt");

-- AlterTable GroupChat — additive lock + dissolve fields.
ALTER TABLE "GroupChat"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByAdminId" TEXT,
  ADD COLUMN "lockReason" TEXT,
  ADD COLUMN "dissolvedAt" TIMESTAMP(3),
  ADD COLUMN "dissolvedByAdminId" TEXT,
  ADD COLUMN "dissolveReason" TEXT;

-- CreateIndex
CREATE INDEX "GroupChat_lockedAt_idx" ON "GroupChat"("lockedAt");
CREATE INDEX "GroupChat_dissolvedAt_idx" ON "GroupChat"("dissolvedAt");

-- CreateTable
CREATE TABLE "ChatMessageReport" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "messageType" "ChatMessageReportType" NOT NULL,
    "privateMessageId" TEXT,
    "groupMessageId" TEXT,
    "groupId" TEXT,
    "reason" "ChatMessageReportReason" NOT NULL,
    "detailsText" TEXT,
    "status" "ChatMessageReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "ChatMessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique: ngăn duplicate report cùng reporter + cùng
-- message). NULL values trong Postgres không xung đột UNIQUE → phù
-- hợp với pattern privateMessageId XOR groupMessageId.
CREATE UNIQUE INDEX "ChatMessageReport_reporterUserId_privateMessageId_key"
  ON "ChatMessageReport"("reporterUserId", "privateMessageId");

CREATE UNIQUE INDEX "ChatMessageReport_reporterUserId_groupMessageId_key"
  ON "ChatMessageReport"("reporterUserId", "groupMessageId");

-- CreateIndex
CREATE INDEX "ChatMessageReport_status_createdAt_idx"
  ON "ChatMessageReport"("status", "createdAt" DESC);

CREATE INDEX "ChatMessageReport_reporterUserId_createdAt_idx"
  ON "ChatMessageReport"("reporterUserId", "createdAt" DESC);

CREATE INDEX "ChatMessageReport_targetUserId_createdAt_idx"
  ON "ChatMessageReport"("targetUserId", "createdAt" DESC);

CREATE INDEX "ChatMessageReport_reason_status_idx"
  ON "ChatMessageReport"("reason", "status");

CREATE INDEX "ChatMessageReport_messageType_status_idx"
  ON "ChatMessageReport"("messageType", "status");

-- CreateTable
CREATE TABLE "ChatMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mutedByAdminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "ChatMuteScope" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMute_userId_revokedAt_expiresAt_idx"
  ON "ChatMute"("userId", "revokedAt", "expiresAt");

CREATE INDEX "ChatMute_scope_revokedAt_expiresAt_idx"
  ON "ChatMute"("scope", "revokedAt", "expiresAt");

CREATE INDEX "ChatMute_createdAt_idx"
  ON "ChatMute"("createdAt" DESC);
