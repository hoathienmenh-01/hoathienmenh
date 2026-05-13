-- Phase QOL-2 — Loadout Preset PvE/PvP/Boss.
-- Mỗi character có thể lưu nhiều preset; apply(presetId) atomic.

CREATE TABLE "CharacterLoadoutPreset" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "equipmentSlotJson" JSONB NOT NULL DEFAULT '{}',
    "skillSlotJson" JSONB,
    "artifactSlotJson" JSONB,
    "isDefaultForPve" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultForPvp" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultForBoss" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterLoadoutPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterLoadoutPreset_characterId_name_key"
    ON "CharacterLoadoutPreset"("characterId", "name");
CREATE INDEX "CharacterLoadoutPreset_characterId_idx"
    ON "CharacterLoadoutPreset"("characterId");
CREATE INDEX "CharacterLoadoutPreset_characterId_mode_idx"
    ON "CharacterLoadoutPreset"("characterId", "mode");
CREATE INDEX "CharacterLoadoutPreset_characterId_isDefaultForPve_idx"
    ON "CharacterLoadoutPreset"("characterId", "isDefaultForPve");
CREATE INDEX "CharacterLoadoutPreset_characterId_isDefaultForPvp_idx"
    ON "CharacterLoadoutPreset"("characterId", "isDefaultForPvp");
CREATE INDEX "CharacterLoadoutPreset_characterId_isDefaultForBoss_idx"
    ON "CharacterLoadoutPreset"("characterId", "isDefaultForBoss");

ALTER TABLE "CharacterLoadoutPreset"
    ADD CONSTRAINT "CharacterLoadoutPreset_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
