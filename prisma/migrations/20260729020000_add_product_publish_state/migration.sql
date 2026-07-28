-- Make cross-platform publishing retry-safe without modifying existing products.
ALTER TABLE "Product"
ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "ProductListing"
ALTER COLUMN "externalProductId" DROP NOT NULL;

ALTER TABLE "ProductListing"
ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "ProductListing"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Product_storeId_idempotencyKey_key"
ON "Product"("storeId", "idempotencyKey");
