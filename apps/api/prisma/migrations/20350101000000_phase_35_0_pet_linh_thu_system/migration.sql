-- CreateTable
CREATE TABLE "CharacterPet" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "petKey" TEXT NOT NULL,
    "customName" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "exp" INTEGER NOT NULL DEFAULT 0,
    "star" INTEGER NOT NULL DEFAULT 1,
    "quality" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "evolutionStage" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isEquipped" BOOLEAN NOT NULL DEFAULT false,
    "equippedSlot" INTEGER,
    "skillLevelsJson" JSONB NOT NULL DEFAULT '{}',
    "sourceType" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterPet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterPetShard" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "petKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterPetShard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterPetBoxPityCounter" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "boxKey" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "totalOpens" INTEGER NOT NULL DEFAULT 0,
    "opensSinceRare" INTEGER NOT NULL DEFAULT 0,
    "opensSinceEpic" INTEGER NOT NULL DEFAULT 0,
    "opensSinceLegendary" INTEGER NOT NULL DEFAULT 0,
    "opensSinceMythic" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterPetBoxPityCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetBoxOpenLog" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "boxKey" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "costType" TEXT NOT NULL,
    "costAmount" BIGINT NOT NULL DEFAULT 0,
    "resultType" TEXT NOT NULL,
    "resultKey" TEXT NOT NULL,
    "resultAmount" INTEGER NOT NULL DEFAULT 1,
    "resultRarity" TEXT NOT NULL,
    "resultQuality" TEXT NOT NULL,
    "pityTriggered" BOOLEAN NOT NULL DEFAULT false,
    "pityRuleVersion" TEXT,
    "rateVersion" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetBoxOpenLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharacterPet_characterId_idx" ON "CharacterPet"("characterId");

-- CreateIndex
CREATE INDEX "CharacterPet_petKey_idx" ON "CharacterPet"("petKey");

-- CreateIndex
CREATE INDEX "CharacterPet_characterId_isEquipped_idx" ON "CharacterPet"("characterId", "isEquipped");

-- CreateIndex
CREATE INDEX "CharacterPet_characterId_quality_idx" ON "CharacterPet"("characterId", "quality");

-- CreateIndex
CREATE INDEX "CharacterPetShard_characterId_idx" ON "CharacterPetShard"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterPetShard_characterId_petKey_key" ON "CharacterPetShard"("characterId", "petKey");

-- CreateIndex
CREATE INDEX "CharacterPetBoxPityCounter_characterId_idx" ON "CharacterPetBoxPityCounter"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterPetBoxPityCounter_characterId_boxKey_poolKey_key" ON "CharacterPetBoxPityCounter"("characterId", "boxKey", "poolKey");

-- CreateIndex
CREATE INDEX "PetBoxOpenLog_characterId_createdAt_idx" ON "PetBoxOpenLog"("characterId", "createdAt");

-- CreateIndex
CREATE INDEX "PetBoxOpenLog_boxKey_createdAt_idx" ON "PetBoxOpenLog"("boxKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PetBoxOpenLog_characterId_boxKey_requestId_key" ON "PetBoxOpenLog"("characterId", "boxKey", "requestId");

-- AddForeignKey
ALTER TABLE "CharacterPet" ADD CONSTRAINT "CharacterPet_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterPetShard" ADD CONSTRAINT "CharacterPetShard_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterPetBoxPityCounter" ADD CONSTRAINT "CharacterPetBoxPityCounter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetBoxOpenLog" ADD CONSTRAINT "PetBoxOpenLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

