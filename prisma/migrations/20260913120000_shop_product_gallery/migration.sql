-- Replace the single product photo with an ordered gallery. The dropped
-- columns held no data: uploads had never succeeded (storage unavailable),
-- verified before this migration was written.
ALTER TABLE "ShopProduct" DROP COLUMN "imageObjectName",
DROP COLUMN "imageContentType",
DROP COLUMN "imageUpdatedAt";

-- CreateTable: ShopProductImage — lowest sortOrder is the cover image.
CREATE TABLE "ShopProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopProductImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShopProductImage_productId_sortOrder_idx" ON "ShopProductImage"("productId", "sortOrder");

ALTER TABLE "ShopProductImage" ADD CONSTRAINT "ShopProductImage_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
