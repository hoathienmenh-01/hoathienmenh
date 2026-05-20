-- CreateEnum
CREATE TYPE "SectRole" AS ENUM ('LEADER', 'ELDER', 'MEMBER');

-- CreateTable
CREATE TABLE "SectMember" (
    "id" TEXT NOT NULL,
    "sectId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "role" "SectRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SectMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SectMember_characterId_key" ON "SectMember"("characterId");
CREATE INDEX "SectMember_sectId_role_idx" ON "SectMember"("sectId", "role");
CREATE INDEX "SectMember_sectId_joinedAt_idx" ON "SectMember"("sectId", "joinedAt");

-- Backfill: all characters with sectId get a MEMBER row
INSERT INTO "SectMember" ("id", "sectId", "characterId", "role", "joinedAt")
SELECT gen_random_uuid(), c."sectId", c.id, 'MEMBER'::"SectRole", CURRENT_TIMESTAMP
FROM "Character" c
WHERE c."sectId" IS NOT NULL
ON CONFLICT ("characterId") DO NOTHING;

-- Backfill: leaders get LEADER role
UPDATE "SectMember" m
SET role = 'LEADER'::"SectRole"
FROM "Sect" s
WHERE m."characterId" = s."leaderId"
  AND m."sectId" = s.id;
