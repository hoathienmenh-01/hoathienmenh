-- Phase 19.3 — Social Presence & Notification Center.
--
-- Adds:
--   - 1 enum `NotificationType`: 7 type cho friend request / chat / group /
--     report resolved / security alert.
--   - Model `Notification`: persistent inbox per user. Server fanout
--     realtime nếu user online qua `RealtimeService.emitToUser`; REST
--     fallback nếu offline (poll `/notifications`).
--   - Model `UserPresence`: persist `lastSeenAt` per user. `online`
--     boolean được tính ở runtime từ `RealtimeService.userSockets`
--     (in-memory). DB chỉ giữ lastSeenAt cho audit + fallback display
--     khi user offline. Phase 19.3+ cross-shard Redis presence là
--     follow-up scope (xem RUNBOOK §2.x).
--
-- Soft-ref pattern (KHÔNG FK constraint, đồng nhất với Phase 19.1 /
-- 19.2). Service enforce ownership ở layer trên (user chỉ list/mark
-- read notification của chính mình).
--
-- Indexes phục vụ query:
--   - Notification: (userId, readAt, createdAt desc) cho list inbox +
--     unread count; (userId, type, createdAt desc) cho future filter
--     theo type; (createdAt) cho admin debug + cleanup expired.
--   - UserPresence: PK = userId (1-row-per-user). (lastSeenAt) cho
--     "ai online gần đây nhất" query future.
--
-- Migration additive — không touch row dữ liệu cũ. Rollback an toàn:
-- DROP TABLE Notification + UserPresence; DROP TYPE NotificationType.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'FRIEND_REQUEST_RECEIVED',
  'FRIEND_REQUEST_ACCEPTED',
  'PRIVATE_MESSAGE_RECEIVED',
  'GROUP_MESSAGE_RECEIVED',
  'GROUP_INVITE_RECEIVED',
  'GROUP_MEMBER_ADDED',
  'CHAT_REPORT_RESOLVED',
  'SECURITY_ALERT_USER'
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "titleKey" TEXT NOT NULL,
    "bodyKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification"("userId", "readAt", "createdAt" DESC);

CREATE INDEX "Notification_userId_type_createdAt_idx"
  ON "Notification"("userId", "type", "createdAt" DESC);

CREATE INDEX "Notification_createdAt_idx"
  ON "Notification"("createdAt");

CREATE INDEX "Notification_expiresAt_idx"
  ON "Notification"("expiresAt");

-- CreateTable
CREATE TABLE "UserPresence" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPresence_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "UserPresence_lastSeenAt_idx"
  ON "UserPresence"("lastSeenAt" DESC);
