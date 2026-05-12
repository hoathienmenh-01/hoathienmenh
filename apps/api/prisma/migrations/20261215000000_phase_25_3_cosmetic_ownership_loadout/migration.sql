-- Phase 25.3 — Code-only Cosmetic Effects (additive, non-destructive).
--
-- Adds two character-scoped tables:
--   * CosmeticOwnership — per (characterId, cosmeticId) unique row,
--                         optional expiresAt for time-bound cosmetics.
--   * CosmeticLoadout   — one row per character, six nullable slot ids
--                         (one per CosmeticType). Loadout never touches
--                         power / stat fields.

CREATE TABLE "CosmeticOwnership" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "cosmeticId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ownedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantReason" TEXT,
    "grantRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CosmeticOwnership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CosmeticOwnership_characterId_cosmeticId_key" ON "CosmeticOwnership"("characterId", "cosmeticId");
CREATE INDEX "CosmeticOwnership_characterId_expiresAt_idx" ON "CosmeticOwnership"("characterId", "expiresAt");
CREATE INDEX "CosmeticOwnership_cosmeticId_idx" ON "CosmeticOwnership"("cosmeticId");

ALTER TABLE "CosmeticOwnership"
    ADD CONSTRAINT "CosmeticOwnership_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "CosmeticLoadout" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "activeAuraId" TEXT,
    "activeTitleId" TEXT,
    "activeAvatarFrameId" TEXT,
    "activeChatBadgeId" TEXT,
    "activeProfileDecorationId" TEXT,
    "activeElementAuraId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CosmeticLoadout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CosmeticLoadout_characterId_key" ON "CosmeticLoadout"("characterId");

ALTER TABLE "CosmeticLoadout"
    ADD CONSTRAINT "CosmeticLoadout_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
