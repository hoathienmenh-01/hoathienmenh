-- Phase 35.2 — Mentor Milestone Progress + Reward Claim audit.
-- Soft-ref to MentorRelation.id (no FK cascade), mirror Phase 31.0/35.1 style.

CREATE TABLE "MentorMilestoneProgress" (
  "id"               TEXT NOT NULL,
  "mentorRelationId" TEXT NOT NULL,
  "mentorUserId"     TEXT NOT NULL,
  "studentUserId"    TEXT NOT NULL,
  "milestoneKey"     TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'LOCKED',
  "reachedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MentorMilestoneProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MentorMilestoneProgress_relation_milestone_key"
  ON "MentorMilestoneProgress"("mentorRelationId", "milestoneKey");
CREATE INDEX "MentorMilestoneProgress_student_status_idx"
  ON "MentorMilestoneProgress"("studentUserId", "status");
CREATE INDEX "MentorMilestoneProgress_mentor_status_idx"
  ON "MentorMilestoneProgress"("mentorUserId", "status");

CREATE TABLE "MentorRewardClaim" (
  "id"                 TEXT NOT NULL,
  "mentorRelationId"   TEXT NOT NULL,
  "milestoneKey"       TEXT NOT NULL,
  "claimerUserId"      TEXT NOT NULL,
  "role"               TEXT NOT NULL,
  "mailId"             TEXT,
  "rewardSnapshotJson" JSONB NOT NULL DEFAULT '{}',
  "claimedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MentorRewardClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MentorRewardClaim_relation_milestone_role_key"
  ON "MentorRewardClaim"("mentorRelationId", "milestoneKey", "role");
CREATE INDEX "MentorRewardClaim_claimer_claimedAt_idx"
  ON "MentorRewardClaim"("claimerUserId", "claimedAt");
