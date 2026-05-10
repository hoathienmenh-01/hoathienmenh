-- Phase 15.0.A — Equipment Reforge / Enchant Foundation.
--
-- Mục tiêu: 2 sink mới song song refine/gem cho late-game equipment power tuning.
--
-- Adds 3 columns to InventoryItem (forward-compat default):
--   - `substatsJson` JSONB NOT NULL DEFAULT '[]'
--     • Array of `{ kind, value }` rolled khi reforge. Default empty cho legacy
--       row + non-equipment item (pill/ore/skill book) vẫn giữ '[]'.
--   - `enchantElement` TEXT NULL
--     • Element key Ngũ Hành (`kim`/`moc`/`thuy`/`hoa`/`tho`). NULL = chưa
--       enchant. Lock element sau khi level >= 1 (tránh phá audit balance).
--   - `enchantLevel` INT NOT NULL DEFAULT 0
--     • Cấp enchant 0..MAX_ENCHANT_LEVEL (5). 0 = chưa enchant.
--
-- Adds 2 audit history tables (forward-compat, no FK changes to existing rows):
--   - `EquipmentReforgeHistory` — per-attempt log với before/after substats + cost.
--   - `EquipmentEnchantHistory` — per-level-up log với before/after enchant + cost.
--
-- Both tables FK Character với ON DELETE CASCADE — nếu character bị xoá,
-- history audit cũng đi theo (giống `RefineService` không có history table
-- riêng, mà Phase 15.0.A chủ động ghi audit để FE/admin replay được).
-- KHÔNG có FK tới `InventoryItem` (item có thể bị bán/transfer); giữ ID
-- string làm soft pointer.
--
-- Forward-compat. KHÔNG drop column / không đổi schema cũ. Migration safe
-- để rollback (drop 3 cột + 2 table không phá other migration).

-- AlterTable InventoryItem — Phase 15.0.A reforge/enchant columns.
ALTER TABLE "InventoryItem"
  ADD COLUMN "substatsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "enchantElement" TEXT,
  ADD COLUMN "enchantLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable EquipmentReforgeHistory
CREATE TABLE "EquipmentReforgeHistory" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL DEFAULT '[]',
    "afterJson" JSONB NOT NULL DEFAULT '[]',
    "costJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentReforgeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable EquipmentEnchantHistory
CREATE TABLE "EquipmentEnchantHistory" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "beforeElement" TEXT,
    "beforeLevel" INTEGER NOT NULL DEFAULT 0,
    "afterElement" TEXT,
    "afterLevel" INTEGER NOT NULL DEFAULT 0,
    "costJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentEnchantHistory_pkey" PRIMARY KEY ("id")
);

-- Indexes for query patterns: per-character DESC, per-item DESC.
CREATE INDEX "EquipmentReforgeHistory_characterId_createdAt_idx"
  ON "EquipmentReforgeHistory"("characterId", "createdAt" DESC);
CREATE INDEX "EquipmentReforgeHistory_inventoryItemId_createdAt_idx"
  ON "EquipmentReforgeHistory"("inventoryItemId", "createdAt" DESC);

CREATE INDEX "EquipmentEnchantHistory_characterId_createdAt_idx"
  ON "EquipmentEnchantHistory"("characterId", "createdAt" DESC);
CREATE INDEX "EquipmentEnchantHistory_inventoryItemId_createdAt_idx"
  ON "EquipmentEnchantHistory"("inventoryItemId", "createdAt" DESC);

-- AddForeignKey — character cascade.
ALTER TABLE "EquipmentReforgeHistory"
  ADD CONSTRAINT "EquipmentReforgeHistory_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquipmentEnchantHistory"
  ADD CONSTRAINT "EquipmentEnchantHistory_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
