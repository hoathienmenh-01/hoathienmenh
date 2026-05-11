-- Phase 19.1 — Social System Foundation
-- Adds:
--   - FriendRequestStatus enum: PENDING / ACCEPTED / DECLINED / CANCELLED.
--   - ChatThreadType enum: PRIVATE / GROUP.
--   - FriendRequest: lời mời kết bạn giữa 2 user. Soft-ref (no FK),
--     unique constraint enforce ở service-level (chỉ 1 PENDING giữa
--     (sender, receiver) tại 1 thời điểm).
--   - Friendship: relationship 2 chiều giữa 2 user, invariant
--     `userAId < userBId` (lexicographic) chống duplicate (A,B) vs (B,A).
--   - PlayerBlock: 1 chiều (blocker -> blocked). UNIQUE
--     (blockerUserId, blockedUserId) chống duplicate.
--   - PrivateChatThread: thread 1-1 giữa 2 user, cùng invariant
--     `userAId < userBId`.
--   - PrivateChatMessage: message trong thread riêng.
--   - GroupChat: nhóm chat có owner.
--   - GroupChatMember: thành viên nhóm. UNIQUE (groupId, userId).
--   - GroupChatMessage: message trong nhóm.
--
-- Indexes phục vụ query:
--   - FriendRequest: filter (receiver, PENDING, time desc) cho UI
--     incoming list; (sender, PENDING, time desc) cho UI outgoing list.
--   - Friendship/PrivateChatThread: 2 index 1-cột userA/userB cho
--     lookup theo 1 phía bất kỳ.
--   - PrivateChatMessage / GroupChatMessage: (threadId/groupId,
--     createdAt) cho infinite-scroll lịch sử.
--   - PlayerBlock: (blockedUserId) cho check inverse-block khi gửi
--     request.
--
-- Privacy / safety:
--   - Soft-ref pattern (no FK) đồng nhất với Phase 16.3 / 16.4 / 18.x.
--   - Không lưu raw IP / token / cookie trong `message` / `body`.
--   - Server cap message length ở service-level (shared validators):
--     friendRequest.message ≤140, privateMessage.body ≤500,
--     groupMessage.body ≤500, group.name ≤60.
--   - Block kiểm tra ở service (cả friendRequest lẫn message).
--
-- Migration additive — không touch bảng cũ. Rollback an toàn:
-- DROP TABLE 7 bảng + DROP TYPE 2 enum.

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChatThreadType" AS ENUM ('PRIVATE', 'GROUP');

-- CreateTable
CREATE TABLE "FriendRequest" (
    "id" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "receiverUserId" TEXT NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FriendRequest_receiverUserId_status_createdAt_idx"
    ON "FriendRequest"("receiverUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FriendRequest_senderUserId_status_createdAt_idx"
    ON "FriendRequest"("senderUserId", "status", "createdAt");

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key"
    ON "Friendship"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "Friendship_userAId_idx" ON "Friendship"("userAId");

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- CreateTable
CREATE TABLE "PlayerBlock" (
    "id" TEXT NOT NULL,
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerBlock_blockerUserId_blockedUserId_key"
    ON "PlayerBlock"("blockerUserId", "blockedUserId");

-- CreateIndex
CREATE INDEX "PlayerBlock_blockedUserId_idx" ON "PlayerBlock"("blockedUserId");

-- CreateTable
CREATE TABLE "PrivateChatThread" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrivateChatThread_userAId_userBId_key"
    ON "PrivateChatThread"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "PrivateChatThread_userAId_idx" ON "PrivateChatThread"("userAId");

-- CreateIndex
CREATE INDEX "PrivateChatThread_userBId_idx" ON "PrivateChatThread"("userBId");

-- CreateTable
CREATE TABLE "PrivateChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivateChatMessage_threadId_createdAt_idx"
    ON "PrivateChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivateChatMessage_senderUserId_createdAt_idx"
    ON "PrivateChatMessage"("senderUserId", "createdAt");

-- CreateTable
CREATE TABLE "GroupChat" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupChat_ownerUserId_idx" ON "GroupChat"("ownerUserId");

-- CreateTable
CREATE TABLE "GroupChatMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupChatMember_groupId_userId_key"
    ON "GroupChatMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "GroupChatMember_userId_idx" ON "GroupChatMember"("userId");

-- CreateTable
CREATE TABLE "GroupChatMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupChatMessage_groupId_createdAt_idx"
    ON "GroupChatMessage"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupChatMessage_senderUserId_createdAt_idx"
    ON "GroupChatMessage"("senderUserId", "createdAt");
