-- Phase 12.10.A — NPC Affinity & Relationship Foundation.
-- Add `CharacterNpcAffinity` table: per-(character, npcKey) affinity score.

CREATE TABLE "CharacterNpcAffinity" (
  "id"          TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "npcKey"      TEXT NOT NULL,
  "score"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CharacterNpcAffinity_pkey" PRIMARY KEY ("id")
);

-- Composite UNIQUE for idempotent upsert per (characterId, npcKey).
CREATE UNIQUE INDEX "CharacterNpcAffinity_characterId_npcKey_key"
  ON "CharacterNpcAffinity" ("characterId", "npcKey");

-- Per-character listing index (NpcAffinityService.listForCharacter).
CREATE INDEX "CharacterNpcAffinity_characterId_idx"
  ON "CharacterNpcAffinity" ("characterId");

ALTER TABLE "CharacterNpcAffinity"
  ADD CONSTRAINT "CharacterNpcAffinity_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
