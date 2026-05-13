-- Phase 26.4 — Artifact / Pháp Bảo Crafting V2.
--
-- Additive migration:
--   1) Bảng CharacterArtifactV2 — instance pháp bảo V2 (1 row/instance).
--      Sống song song với hệ pháp bảo cũ (`InventoryItem` slot ARTIFACT_1..3
--      của Phase 23.5/23.7). Slot V2 mới: MAIN_ARTIFACT_V2,
--      DEFENSE_ARTIFACT_V2, SUPPORT_ARTIFACT_V2, ALCHEMY_ARTIFACT_V2,
--      SPECIAL_ARTIFACT_V2 — KHÔNG đụng enum EquipSlot Prisma (slot V2
--      lưu dưới dạng String).
--   2) Bảng ArtifactCraftAttemptLog — audit từng craft attempt (success/fail).
--   3) Bảng ArtifactUpgradeLogV2 — audit từng level/star/refine/awaken.

CREATE TABLE "CharacterArtifactV2" (
  "id"            TEXT          NOT NULL,
  "characterId"   TEXT          NOT NULL,
  "artifactKey"   TEXT          NOT NULL,
  "name"          TEXT          NOT NULL,
  "type"          TEXT          NOT NULL,
  "element"       TEXT          NOT NULL,
  "tier"          INTEGER       NOT NULL,
  "grade"         TEXT          NOT NULL,
  "level"         INTEGER       NOT NULL DEFAULT 1,
  "star"          INTEGER       NOT NULL DEFAULT 0,
  "refineLevel"   INTEGER       NOT NULL DEFAULT 0,
  "awakenLevel"   INTEGER       NOT NULL DEFAULT 0,
  "spiritExp"     BIGINT        NOT NULL DEFAULT 0,
  "spiritLevel"   INTEGER       NOT NULL DEFAULT 0,
  "locked"        BOOLEAN       NOT NULL DEFAULT false,
  "equippedSlot"  TEXT,
  "statsJson"     JSONB         NOT NULL,
  "subStatsJson"  JSONB,
  "skillsJson"    JSONB,
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CharacterArtifactV2_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CharacterArtifactV2_characterId_idx"
  ON "CharacterArtifactV2" ("characterId");

CREATE INDEX "CharacterArtifactV2_characterId_artifactKey_idx"
  ON "CharacterArtifactV2" ("characterId", "artifactKey");

CREATE INDEX "CharacterArtifactV2_characterId_equippedSlot_idx"
  ON "CharacterArtifactV2" ("characterId", "equippedSlot");

-- Partial unique: mỗi (characterId, equippedSlot) chỉ 1 row khi
-- equippedSlot khác NULL. Postgres hỗ trợ WHERE clause cho unique index.
CREATE UNIQUE INDEX "CharacterArtifactV2_characterId_equippedSlot_unique"
  ON "CharacterArtifactV2" ("characterId", "equippedSlot")
  WHERE "equippedSlot" IS NOT NULL;

ALTER TABLE "CharacterArtifactV2"
  ADD CONSTRAINT "CharacterArtifactV2_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ArtifactCraftAttemptLog" (
  "id"                TEXT          NOT NULL,
  "characterId"       TEXT          NOT NULL,
  "blueprintKey"      TEXT          NOT NULL,
  "success"           BOOLEAN       NOT NULL,
  "successRate"       DOUBLE PRECISION NOT NULL,
  "rollValue"         DOUBLE PRECISION NOT NULL,
  "artifactKey"       TEXT,
  "artifactTier"      INTEGER       NOT NULL,
  "artifactGrade"     TEXT,
  "materialsJson"     JSONB         NOT NULL,
  "linhThachConsumed" INTEGER       NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ArtifactCraftAttemptLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArtifactCraftAttemptLog_characterId_idx"
  ON "ArtifactCraftAttemptLog" ("characterId");

CREATE INDEX "ArtifactCraftAttemptLog_characterId_createdAt_idx"
  ON "ArtifactCraftAttemptLog" ("characterId", "createdAt");

ALTER TABLE "ArtifactCraftAttemptLog"
  ADD CONSTRAINT "ArtifactCraftAttemptLog_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ArtifactUpgradeLogV2" (
  "id"               TEXT          NOT NULL,
  "characterId"      TEXT          NOT NULL,
  "artifactId"       TEXT          NOT NULL,
  "action"           TEXT          NOT NULL,
  "fromLevel"        INTEGER,
  "toLevel"          INTEGER,
  "fromStar"         INTEGER,
  "toStar"           INTEGER,
  "fromRefineLevel"  INTEGER,
  "toRefineLevel"    INTEGER,
  "fromAwakenLevel"  INTEGER,
  "toAwakenLevel"    INTEGER,
  "success"          BOOLEAN       NOT NULL,
  "materialsJson"    JSONB         NOT NULL,
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ArtifactUpgradeLogV2_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArtifactUpgradeLogV2_characterId_idx"
  ON "ArtifactUpgradeLogV2" ("characterId");

CREATE INDEX "ArtifactUpgradeLogV2_characterId_artifactId_idx"
  ON "ArtifactUpgradeLogV2" ("characterId", "artifactId");

CREATE INDEX "ArtifactUpgradeLogV2_characterId_createdAt_idx"
  ON "ArtifactUpgradeLogV2" ("characterId", "createdAt");

ALTER TABLE "ArtifactUpgradeLogV2"
  ADD CONSTRAINT "ArtifactUpgradeLogV2_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
