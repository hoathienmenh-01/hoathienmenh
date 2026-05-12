-- Phase 26.3 — Cultivation Method V2: progression fields + upgrade log.
--
-- 1) Mở rộng CharacterCultivationMethod cho hệ V2 (level/star/methodExp/
--    equippedSlot). Field cũ `equippedCultivationMethodKey` trên
--    Character giữ nguyên để backward compatible — service Phase 26.3
--    sẽ mirror slot QI_MAIN sang field cũ.
-- 2) Bảng MethodUpgradeLog mới — audit từng lần unlock/upgrade/star-up.

ALTER TABLE "CharacterCultivationMethod"
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "star" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "methodExp" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "equippedSlot" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CharacterCultivationMethod_characterId_equippedSlot_idx"
  ON "CharacterCultivationMethod" ("characterId", "equippedSlot");

-- Partial unique index: 1 slot per character (chỉ áp dụng khi
-- equippedSlot khác NULL — character có thể có nhiều method
-- "chưa equip"). Postgres hỗ trợ WHERE clause cho unique index.
CREATE UNIQUE INDEX "CharacterCultivationMethod_characterId_equippedSlot_unique"
  ON "CharacterCultivationMethod" ("characterId", "equippedSlot")
  WHERE "equippedSlot" IS NOT NULL;

CREATE TABLE "MethodUpgradeLog" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "methodKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromLevel" INTEGER NOT NULL,
  "toLevel" INTEGER NOT NULL,
  "fromStar" INTEGER NOT NULL,
  "toStar" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "materialsJson" JSONB NOT NULL,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MethodUpgradeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MethodUpgradeLog_characterId_methodKey_idx"
  ON "MethodUpgradeLog" ("characterId", "methodKey");

CREATE INDEX "MethodUpgradeLog_characterId_createdAt_idx"
  ON "MethodUpgradeLog" ("characterId", "createdAt");

ALTER TABLE "MethodUpgradeLog"
  ADD CONSTRAINT "MethodUpgradeLog_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
