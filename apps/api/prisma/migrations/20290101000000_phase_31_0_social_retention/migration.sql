-- Phase 31.0 — Social & Retention Foundation V1 (additive).
--
-- Thêm 7 model additive cho social/retention/mail. KHÔNG ALTER hard
-- table cũ. Chỉ ADD COLUMN trên `Mail` (mailType / deletedAt) — backfill
-- mailType cho row cũ bằng DEFAULT 'SYSTEM'.
--
-- Models:
--   - MailType (enum)                   — taxonomy 10 reason (SYSTEM..PVP).
--   - Mail.mailType / Mail.deletedAt    — additive columns + indexes.
--   - AdminMailLog                      — audit log mọi admin mail send.
--   - SystemGift                        — template quà hệ thống.
--   - SystemGiftClaim                   — idempotency claim (giftKey, characterId).
--   - CharacterReturnerState            — flag returner per character.
--   - MentorProfile                     — đăng ký làm mentor.
--   - MentorRelation                    — mentor↔student relation.
--   - MailAttachmentClaim               — ledger claim (mailId, characterId).

-- CreateEnum
CREATE TYPE "MailType" AS ENUM (
    'SYSTEM', 'ADMIN', 'REWARD', 'EVENT', 'MAINTENANCE',
    'PURCHASE', 'SECT', 'FRIEND', 'RETURNER', 'PVP'
);

-- AlterTable Mail — additive columns
ALTER TABLE "Mail" ADD COLUMN "mailType" "MailType" NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "Mail" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex Mail.mailType
CREATE INDEX "Mail_recipientId_mailType_createdAt_idx"
    ON "Mail"("recipientId", "mailType", "createdAt");

-- CreateTable AdminMailLog
CREATE TABLE "AdminMailLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mailType" "MailType" NOT NULL DEFAULT 'ADMIN',
    "subject" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mailCount" INTEGER NOT NULL DEFAULT 0,
    "recipientsSnapshot" JSONB NOT NULL DEFAULT '[]',
    "targetRuleSnapshot" JSONB,
    "mailIdsSnapshot" JSONB NOT NULL DEFAULT '[]',
    "previewOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminMailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminMailLog_adminUserId_createdAt_idx"
    ON "AdminMailLog"("adminUserId", "createdAt");
CREATE INDEX "AdminMailLog_kind_createdAt_idx"
    ON "AdminMailLog"("kind", "createdAt");

-- CreateTable SystemGift
CREATE TABLE "SystemGift" (
    "id" TEXT NOT NULL,
    "giftKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rewardJson" JSONB NOT NULL DEFAULT '{}',
    "targetRuleJson" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemGift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemGift_giftKey_key" ON "SystemGift"("giftKey");
CREATE INDEX "SystemGift_createdAt_idx" ON "SystemGift"("createdAt");
CREATE INDEX "SystemGift_expiresAt_idx" ON "SystemGift"("expiresAt");

-- CreateTable SystemGiftClaim
CREATE TABLE "SystemGiftClaim" (
    "id" TEXT NOT NULL,
    "giftKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "mailId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemGiftClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemGiftClaim_giftKey_characterId_key"
    ON "SystemGiftClaim"("giftKey", "characterId");
CREATE INDEX "SystemGiftClaim_characterId_idx" ON "SystemGiftClaim"("characterId");
CREATE INDEX "SystemGiftClaim_giftKey_idx" ON "SystemGiftClaim"("giftKey");

-- CreateTable CharacterReturnerState
CREATE TABLE "CharacterReturnerState" (
    "characterId" TEXT NOT NULL,
    "prevLoginAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "inactiveDays" INTEGER NOT NULL DEFAULT 0,
    "currentTier" TEXT,
    "lastCycleKey" TEXT,
    "lastTriggerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterReturnerState_pkey" PRIMARY KEY ("characterId")
);

CREATE INDEX "CharacterReturnerState_currentTier_idx"
    ON "CharacterReturnerState"("currentTier");
CREATE INDEX "CharacterReturnerState_lastTriggerAt_idx"
    ON "CharacterReturnerState"("lastTriggerAt");

-- CreateTable MentorProfile
CREATE TABLE "MentorProfile" (
    "mentorUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "realmTier" INTEGER NOT NULL DEFAULT 0,
    "intro" TEXT,
    "acceptingStudents" BOOLEAN NOT NULL DEFAULT true,
    "activeStudentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MentorProfile_pkey" PRIMARY KEY ("mentorUserId")
);

CREATE INDEX "MentorProfile_realmTier_idx" ON "MentorProfile"("realmTier");
CREATE INDEX "MentorProfile_acceptingStudents_idx"
    ON "MentorProfile"("acceptingStudents");

-- CreateTable MentorRelation
CREATE TABLE "MentorRelation" (
    "id" TEXT NOT NULL,
    "mentorUserId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "mentorDisplayName" TEXT,
    "studentDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "MentorRelation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MentorRelation_mentorUserId_status_createdAt_idx"
    ON "MentorRelation"("mentorUserId", "status", "createdAt");
CREATE INDEX "MentorRelation_studentUserId_status_createdAt_idx"
    ON "MentorRelation"("studentUserId", "status", "createdAt");
CREATE INDEX "MentorRelation_status_createdAt_idx"
    ON "MentorRelation"("status", "createdAt");

-- CreateTable MailAttachmentClaim
CREATE TABLE "MailAttachmentClaim" (
    "id" TEXT NOT NULL,
    "mailId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rewardSnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAttachmentClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailAttachmentClaim_mailId_characterId_key"
    ON "MailAttachmentClaim"("mailId", "characterId");
CREATE INDEX "MailAttachmentClaim_characterId_claimedAt_idx"
    ON "MailAttachmentClaim"("characterId", "claimedAt");
