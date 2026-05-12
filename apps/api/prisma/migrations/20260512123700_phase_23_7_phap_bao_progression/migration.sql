-- Phase 23.7 — Pháp Bảo Star-up + Awaken Persistence.
-- Additive only: existing InventoryItem rows keep safe defaults.

ALTER TABLE "InventoryItem"
  ADD COLUMN "phapBaoStarLevel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "phapBaoAwakenStage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "InventoryItem_characterId_itemKey_phapBaoStarLevel_idx"
  ON "InventoryItem"("characterId", "itemKey", "phapBaoStarLevel");
