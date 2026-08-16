-- Product bundles are warehouse products whose sellable unit is composed of
-- one or more existing warehouse variants.
CREATE TYPE "WarehouseProductKind" AS ENUM ('STANDARD', 'BUNDLE');

ALTER TABLE "WarehouseProduct"
ADD COLUMN "kind" "WarehouseProductKind" NOT NULL DEFAULT 'STANDARD';

CREATE TABLE "ProductBundleComponent" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,

    CONSTRAINT "ProductBundleComponent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductBundleComponent_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "ProductBundleComponent_bundleProductId_componentVariantId_key"
ON "ProductBundleComponent"("bundleProductId", "componentVariantId");
CREATE INDEX "ProductBundleComponent_componentVariantId_idx"
ON "ProductBundleComponent"("componentVariantId");

ALTER TABLE "ProductBundleComponent"
ADD CONSTRAINT "ProductBundleComponent_bundleProductId_fkey"
FOREIGN KEY ("bundleProductId") REFERENCES "WarehouseProduct"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductBundleComponent"
ADD CONSTRAINT "ProductBundleComponent_componentVariantId_fkey"
FOREIGN KEY ("componentVariantId") REFERENCES "WarehouseVariant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Persist normalized order lines so product-level revenue, delivery, return,
-- cost, and city analytics can be calculated without provider round trips.
ALTER TABLE "EcommerceOrder" ADD COLUMN "shippingCity" TEXT;

CREATE TABLE "EcommerceOrderLine" (
    "id" TEXT NOT NULL,
    "externalLineId" TEXT NOT NULL,
    "externalProductId" TEXT,
    "externalVariantId" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "totalPrice" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,
    "warehouseVariantId" TEXT,

    CONSTRAINT "EcommerceOrderLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EcommerceOrderLine_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "EcommerceOrderLine_orderId_externalLineId_key"
ON "EcommerceOrderLine"("orderId", "externalLineId");
CREATE INDEX "EcommerceOrderLine_orderId_idx" ON "EcommerceOrderLine"("orderId");
CREATE INDEX "EcommerceOrderLine_warehouseVariantId_idx"
ON "EcommerceOrderLine"("warehouseVariantId");
CREATE INDEX "EcommerceOrderLine_sku_idx" ON "EcommerceOrderLine"("sku");

ALTER TABLE "EcommerceOrderLine"
ADD CONSTRAINT "EcommerceOrderLine_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EcommerceOrderLine"
ADD CONSTRAINT "EcommerceOrderLine_warehouseVariantId_fkey"
FOREIGN KEY ("warehouseVariantId") REFERENCES "WarehouseVariant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
