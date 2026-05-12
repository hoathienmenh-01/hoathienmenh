-- Phase 26.0 — Production Body Cultivation / Luyện Thể Core.

ALTER TABLE "Character"
  ADD COLUMN "bodyRealmKey" TEXT NOT NULL DEFAULT 'pham_than',
  ADD COLUMN "bodyStage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "bodyExp" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "bodyCultivating" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bodyInjuryUntil" TIMESTAMP(3),
  ADD COLUMN "physiqueKey" TEXT,
  ADD COLUMN "bodyBreakthroughCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Character_bodyCultivating_idx"
  ON "Character"("bodyCultivating");

CREATE TABLE "BodyBreakthroughAttemptLog" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "fromBodyRealmKey" TEXT NOT NULL,
  "fromBodyStage" INTEGER NOT NULL,
  "toBodyRealmKey" TEXT NOT NULL,
  "toBodyStage" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "successRate" DOUBLE PRECISION NOT NULL,
  "materialsJson" JSONB NOT NULL DEFAULT '[]',
  "pillItemKey" TEXT,
  "injuryUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BodyBreakthroughAttemptLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BodyBreakthroughAttemptLog_characterId_createdAt_idx"
  ON "BodyBreakthroughAttemptLog"("characterId", "createdAt");

ALTER TABLE "BodyBreakthroughAttemptLog"
  ADD CONSTRAINT "BodyBreakthroughAttemptLog_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
