-- The retired cross-platform publishing tables are intentionally left untouched
-- during this rollout so deploying the replacement cannot destroy existing data.
-- They are no longer present in the Prisma schema or reachable by application code.

CREATE TYPE "WarehouseProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "InventoryItemKind" AS ENUM ('PRODUCT_VARIANT', 'PACKAGING_MATERIAL');
CREATE TYPE "InventoryBarcodeType" AS ENUM ('INTERNAL_CODE_128', 'GTIN', 'EAN_13', 'UPC_A', 'OTHER');
CREATE TYPE "InventoryBucket" AS ENUM ('ON_HAND', 'RESERVED', 'DAMAGED', 'INCOMING');
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'ORDER_RESERVED', 'ORDER_RELEASED', 'ORDER_SHIPPED', 'RETURN_GOOD', 'RETURN_DAMAGED', 'PACKAGING_RECEIVED', 'PACKAGING_CONSUMED');
CREATE TYPE "MediaAssetStatus" AS ENUM ('TEMPORARY', 'ATTACHED');
CREATE TYPE "MediaAssetPurpose" AS ENUM ('PRODUCT_MAIN', 'PRODUCT_GALLERY', 'VARIANT');

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "parentId" TEXT,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WarehouseProductStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT,
    "idempotencyFingerprint" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "WarehouseProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductOptionValue" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "optionId" TEXT NOT NULL,
    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseVariant" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(20,4) NOT NULL,
    "costPrice" DECIMAL(20,4) NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    CONSTRAINT "WarehouseVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseVariantOptionValue" (
    "variantId" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    CONSTRAINT "WarehouseVariantOptionValue_pkey" PRIMARY KEY ("variantId", "valueId")
);

CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "kind" "InventoryItemKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT,
    "packagingMaterialId" TEXT,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBarcode" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "InventoryBarcodeType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'ZOMAAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    CONSTRAINT "InventoryBarcode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "bucket" "InventoryBucket" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "resultingQuantity" INTEGER NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'TEMPORARY',
    "purpose" "MediaAssetPurpose" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductGift" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT NOT NULL,
    "giftVariantId" TEXT NOT NULL,
    CONSTRAINT "ProductGift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackagingMaterial" (
    "id" TEXT NOT NULL,
    "zomaalShopVariantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "imageObjectName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    CONSTRAINT "PackagingMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPackagingRequirement" (
    "id" TEXT NOT NULL,
    "quantityPerUnit" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "packagingMaterialId" TEXT NOT NULL,
    CONSTRAINT "ProductPackagingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductCategory_storeId_isActive_position_idx" ON "ProductCategory"("storeId", "isActive", "position");
CREATE INDEX "ProductCategory_parentId_idx" ON "ProductCategory"("parentId");
CREATE UNIQUE INDEX "ProductCategory_storeId_slug_key" ON "ProductCategory"("storeId", "slug");
CREATE INDEX "WarehouseProduct_storeId_status_createdAt_idx" ON "WarehouseProduct"("storeId", "status", "createdAt");
CREATE INDEX "WarehouseProduct_categoryId_idx" ON "WarehouseProduct"("categoryId");
CREATE UNIQUE INDEX "WarehouseProduct_storeId_idempotencyKey_key" ON "WarehouseProduct"("storeId", "idempotencyKey");
CREATE UNIQUE INDEX "ProductOption_productId_position_key" ON "ProductOption"("productId", "position");
CREATE UNIQUE INDEX "ProductOption_productId_name_key" ON "ProductOption"("productId", "name");
CREATE UNIQUE INDEX "ProductOptionValue_optionId_value_key" ON "ProductOptionValue"("optionId", "value");
CREATE UNIQUE INDEX "ProductOptionValue_optionId_position_key" ON "ProductOptionValue"("optionId", "position");
CREATE INDEX "WarehouseVariant_productId_position_idx" ON "WarehouseVariant"("productId", "position");
CREATE UNIQUE INDEX "WarehouseVariant_storeId_sku_key" ON "WarehouseVariant"("storeId", "sku");
CREATE UNIQUE INDEX "WarehouseVariant_one_default_per_product_key" ON "WarehouseVariant"("productId") WHERE "isDefault" = true;
CREATE INDEX "WarehouseVariantOptionValue_valueId_idx" ON "WarehouseVariantOptionValue"("valueId");
CREATE UNIQUE INDEX "InventoryItem_variantId_key" ON "InventoryItem"("variantId");
CREATE UNIQUE INDEX "InventoryItem_packagingMaterialId_key" ON "InventoryItem"("packagingMaterialId");
CREATE INDEX "InventoryItem_storeId_kind_idx" ON "InventoryItem"("storeId", "kind");
CREATE INDEX "InventoryBarcode_inventoryItemId_isPrimary_idx" ON "InventoryBarcode"("inventoryItemId", "isPrimary");
CREATE UNIQUE INDEX "InventoryBarcode_storeId_value_key" ON "InventoryBarcode"("storeId", "value");
CREATE UNIQUE INDEX "InventoryBarcode_one_primary_per_item_key" ON "InventoryBarcode"("inventoryItemId") WHERE "isPrimary" = true;
CREATE INDEX "WarehouseLocation_storeId_isDefault_idx" ON "WarehouseLocation"("storeId", "isDefault");
CREATE UNIQUE INDEX "WarehouseLocation_storeId_code_key" ON "WarehouseLocation"("storeId", "code");
CREATE UNIQUE INDEX "WarehouseLocation_one_default_per_store_key" ON "WarehouseLocation"("storeId") WHERE "isDefault" = true;
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");
CREATE UNIQUE INDEX "InventoryBalance_inventoryItemId_locationId_key" ON "InventoryBalance"("inventoryItemId", "locationId");
CREATE INDEX "InventoryMovement_inventoryItemId_createdAt_idx" ON "InventoryMovement"("inventoryItemId", "createdAt");
CREATE INDEX "InventoryMovement_locationId_createdAt_idx" ON "InventoryMovement"("locationId", "createdAt");
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx" ON "InventoryMovement"("referenceType", "referenceId");
CREATE UNIQUE INDEX "InventoryMovement_inventoryItemId_idempotencyKey_key" ON "InventoryMovement"("inventoryItemId", "idempotencyKey");
CREATE UNIQUE INDEX "MediaAsset_objectName_key" ON "MediaAsset"("objectName");
CREATE INDEX "MediaAsset_storeId_status_expiresAt_idx" ON "MediaAsset"("storeId", "status", "expiresAt");
CREATE INDEX "MediaAsset_productId_position_idx" ON "MediaAsset"("productId", "position");
CREATE INDEX "MediaAsset_variantId_position_idx" ON "MediaAsset"("variantId", "position");
CREATE UNIQUE INDEX "ProductGift_productId_key" ON "ProductGift"("productId");
CREATE INDEX "ProductGift_giftVariantId_idx" ON "ProductGift"("giftVariantId");
CREATE INDEX "PackagingMaterial_storeId_isActive_idx" ON "PackagingMaterial"("storeId", "isActive");
CREATE UNIQUE INDEX "PackagingMaterial_storeId_zomaalShopVariantId_key" ON "PackagingMaterial"("storeId", "zomaalShopVariantId");
CREATE INDEX "ProductPackagingRequirement_packagingMaterialId_idx" ON "ProductPackagingRequirement"("packagingMaterialId");
CREATE UNIQUE INDEX "ProductPackagingRequirement_productId_variantId_packagingMa_key" ON "ProductPackagingRequirement"("productId", "variantId", "packagingMaterialId");
CREATE UNIQUE INDEX "ProductPackagingRequirement_product_material_key" ON "ProductPackagingRequirement"("productId", "packagingMaterialId") WHERE "variantId" IS NULL;

ALTER TABLE "WarehouseVariant" ADD CONSTRAINT "WarehouseVariant_values_check" CHECK ("price" >= 0 AND "costPrice" >= 0 AND "lowStockThreshold" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_owner_check" CHECK (
  ("kind" = 'PRODUCT_VARIANT' AND "variantId" IS NOT NULL AND "packagingMaterialId" IS NULL)
  OR
  ("kind" = 'PACKAGING_MATERIAL' AND "variantId" IS NULL AND "packagingMaterialId" IS NOT NULL)
);
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_quantities_check" CHECK (
  "onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "incoming" >= 0
  AND "reserved" + "damaged" <= "onHand"
);
ALTER TABLE "ProductGift" ADD CONSTRAINT "ProductGift_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "ProductPackagingRequirement" ADD CONSTRAINT "ProductPackagingRequirement_quantity_check" CHECK ("quantityPerUnit" > 0);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_attachment_check" CHECK (
  ("status" = 'TEMPORARY' AND "productId" IS NULL AND "variantId" IS NULL)
  OR
  ("status" = 'ATTACHED' AND num_nonnulls("productId", "variantId") = 1)
);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_purpose_check" CHECK (
  ("purpose" IN ('PRODUCT_MAIN', 'PRODUCT_GALLERY') AND "variantId" IS NULL)
  OR
  ("purpose" = 'VARIANT' AND "productId" IS NULL)
);

ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseProduct" ADD CONSTRAINT "WarehouseProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseProduct" ADD CONSTRAINT "WarehouseProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseVariant" ADD CONSTRAINT "WarehouseVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseVariant" ADD CONSTRAINT "WarehouseVariant_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseVariantOptionValue" ADD CONSTRAINT "WarehouseVariantOptionValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "WarehouseVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseVariantOptionValue" ADD CONSTRAINT "WarehouseVariantOptionValue_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "ProductOptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "WarehouseVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_packagingMaterialId_fkey" FOREIGN KEY ("packagingMaterialId") REFERENCES "PackagingMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBarcode" ADD CONSTRAINT "InventoryBarcode_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBarcode" ADD CONSTRAINT "InventoryBarcode_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "WarehouseVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductGift" ADD CONSTRAINT "ProductGift_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductGift" ADD CONSTRAINT "ProductGift_giftVariantId_fkey" FOREIGN KEY ("giftVariantId") REFERENCES "WarehouseVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagingMaterial" ADD CONSTRAINT "PackagingMaterial_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductPackagingRequirement" ADD CONSTRAINT "ProductPackagingRequirement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductPackagingRequirement" ADD CONSTRAINT "ProductPackagingRequirement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "WarehouseVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductPackagingRequirement" ADD CONSTRAINT "ProductPackagingRequirement_packagingMaterialId_fkey" FOREIGN KEY ("packagingMaterialId") REFERENCES "PackagingMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
