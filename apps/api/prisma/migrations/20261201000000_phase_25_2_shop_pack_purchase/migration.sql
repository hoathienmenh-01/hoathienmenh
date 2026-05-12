-- Phase 25.2 — Limited Resource Shop Pack purchase history (additive).

CREATE TABLE "ShopPackPurchase" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purchaseWindowKey" TEXT NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "rewardsJson" JSONB NOT NULL DEFAULT '[]',
    "idempotencyKey" TEXT,
    "paymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopPackPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopPackPurchase_characterId_packId_purchaseWindowKey_key" ON "ShopPackPurchase"("characterId", "packId", "purchaseWindowKey");
CREATE UNIQUE INDEX "ShopPackPurchase_idempotencyKey_key" ON "ShopPackPurchase"("idempotencyKey");
CREATE INDEX "ShopPackPurchase_characterId_packId_createdAt_idx" ON "ShopPackPurchase"("characterId", "packId", "createdAt");

ALTER TABLE "ShopPackPurchase" ADD CONSTRAINT "ShopPackPurchase_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
