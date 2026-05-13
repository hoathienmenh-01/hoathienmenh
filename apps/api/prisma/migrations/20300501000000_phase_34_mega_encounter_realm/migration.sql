-- Phase 34 mega — additive migration for 34.1 Daily Encounter + 34.2 Secret Realm +
-- 34.4 Loadout Preset.
--
-- Pure additive — no ALTER on existing tables. Three new tables, each scoped to
-- the new feature. Rollback: DROP TABLE the three tables in reverse order.

-- ── Phase 34.1 — Daily Random Encounter / Kỳ Ngộ ─────────────────────────────
CREATE TABLE "CharacterDailyEncounter" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "encounterKey" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "dateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "choiceKey" TEXT,
    "linhThachGranted" INTEGER NOT NULL DEFAULT 0,
    "expGranted" INTEGER NOT NULL DEFAULT 0,
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterDailyEncounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterDailyEncounter_characterId_dateKey_key"
    ON "CharacterDailyEncounter"("characterId", "dateKey");

CREATE INDEX "CharacterDailyEncounter_characterId_status_idx"
    ON "CharacterDailyEncounter"("characterId", "status");

CREATE INDEX "CharacterDailyEncounter_dateKey_status_idx"
    ON "CharacterDailyEncounter"("dateKey", "status");

ALTER TABLE "CharacterDailyEncounter"
    ADD CONSTRAINT "CharacterDailyEncounter_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Phase 34.2 — Secret Realm / Bí Cảnh Runtime ──────────────────────────────
CREATE TABLE "CharacterSecretRealmRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "secretRealmKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENTERED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "objectiveProgressJson" JSONB NOT NULL DEFAULT '{}',
    "linhThachGranted" INTEGER NOT NULL DEFAULT 0,
    "expGranted" INTEGER NOT NULL DEFAULT 0,
    "rewardHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterSecretRealmRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CharacterSecretRealmRun_characterId_secretRealmKey_status_idx"
    ON "CharacterSecretRealmRun"("characterId", "secretRealmKey", "status");

CREATE INDEX "CharacterSecretRealmRun_secretRealmKey_status_idx"
    ON "CharacterSecretRealmRun"("secretRealmKey", "status");

ALTER TABLE "CharacterSecretRealmRun"
    ADD CONSTRAINT "CharacterSecretRealmRun_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
