ALTER TABLE "Character" ADD COLUMN "alchemyLevel" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD COLUMN "alchemyExp" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "alchemyMastery" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AlchemyAttemptLog" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "recipeKey" TEXT NOT NULL,
  "recipeTier" INTEGER NOT NULL,
  "recipeCategory" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "successRate" DOUBLE PRECISION NOT NULL,
  "rollValue" DOUBLE PRECISION NOT NULL,
  "pillGrade" TEXT,
  "outputItem" TEXT,
  "outputQty" INTEGER NOT NULL,
  "inputsJson" JSONB NOT NULL,
  "linhThachConsumed" INTEGER NOT NULL,
  "alchemyExpGained" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlchemyAttemptLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlchemyAttemptLog_characterId_createdAt_idx" ON "AlchemyAttemptLog"("characterId", "createdAt");
CREATE INDEX "AlchemyAttemptLog_recipeKey_createdAt_idx" ON "AlchemyAttemptLog"("recipeKey", "createdAt");

ALTER TABLE "AlchemyAttemptLog" ADD CONSTRAINT "AlchemyAttemptLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
