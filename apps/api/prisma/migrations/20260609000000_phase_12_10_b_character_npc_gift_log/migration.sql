-- Phase 12.10.B — NPC Gift audit log + daily limit enforcement.
-- Add `CharacterNpcGiftLog` table: per-(character, npcKey, dayBucket, sequence) gift row.

CREATE TABLE "CharacterNpcGiftLog" (
  "id"            TEXT NOT NULL,
  "characterId"   TEXT NOT NULL,
  "npcKey"        TEXT NOT NULL,
  "itemKey"       TEXT NOT NULL,
  "affinityDelta" INTEGER NOT NULL,
  "previousScore" INTEGER NOT NULL,
  "newScore"      INTEGER NOT NULL,
  "dayBucket"     TEXT NOT NULL,
  "sequence"      INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CharacterNpcGiftLog_pkey" PRIMARY KEY ("id")
);

-- Composite UNIQUE for CAS-style insert per (characterId, npcKey, dayBucket, sequence).
-- Service retries `sequence+1` on P2002 race; cap is `dailyLimit` of catalog.
CREATE UNIQUE INDEX "CharacterNpcGiftLog_characterId_npcKey_dayBucket_sequence_key"
  ON "CharacterNpcGiftLog" ("characterId", "npcKey", "dayBucket", "sequence");

-- Per-(character, npc, day) lookup index — daily limit count query.
CREATE INDEX "CharacterNpcGiftLog_characterId_npcKey_dayBucket_idx"
  ON "CharacterNpcGiftLog" ("characterId", "npcKey", "dayBucket");

-- Per-(character, day) audit / telemetry index — global daily gift report.
CREATE INDEX "CharacterNpcGiftLog_characterId_dayBucket_idx"
  ON "CharacterNpcGiftLog" ("characterId", "dayBucket");

ALTER TABLE "CharacterNpcGiftLog"
  ADD CONSTRAINT "CharacterNpcGiftLog_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
