-- Zomaal Shop storefront (variants, specs, banners, promo codes, settings,
-- favorites, cart, addresses, orders) and the merchant Purchases module.
-- Generated with `prisma migrate diff`, then filtered to only these objects:
-- the local database also carries unrelated legacy tables that a raw diff
-- would have dropped.
-- CreateEnum
CREATE TYPE "ShopBannerLinkType" AS ENUM ('NONE', 'PRODUCT', 'CATEGORY');

-- CreateEnum
CREATE TYPE "ShopPromoType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShopPaymentMethod" AS ENUM ('COD', 'ONLINE');

-- CreateEnum
CREATE TYPE "ShopPaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "ShopOrderCancelledBy" AS ENUM ('MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "MerchantPurchaseSource" AS ENUM ('MANUAL', 'SHOP');

-- AlterTable
ALTER TABLE "ShopProduct" ADD COLUMN     "compareAtPrice" DECIMAL(20,4),
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unitLabel" TEXT NOT NULL DEFAULT 'piece';

-- CreateTable
CREATE TABLE "ShopProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "colorHex" TEXT,
    "sku" TEXT,
    "price" DECIMAL(20,4),
    "compareAtPrice" DECIMAL(20,4),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopProductSpec" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShopProductSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopBanner" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "imageObjectName" TEXT,
    "imageContentType" TEXT,
    "linkType" "ShopBannerLinkType" NOT NULL DEFAULT 'NONE',
    "linkId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "ShopPromoType" NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "minSubtotal" DECIMAL(20,4),
    "maxDiscount" DECIMAL(20,4),
    "usageLimit" INTEGER,
    "perStoreLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "deliveryFee" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "freeDeliveryMinSubtotal" DECIMAL(20,4),
    "codEnabled" BOOLEAN NOT NULL DEFAULT true,
    "codCancellationLimit" INTEGER NOT NULL DEFAULT 3,
    "codCancellationWindowDays" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopFavorite" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopCartItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopAddress" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "address" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "storeId" TEXT NOT NULL,
    "placedByUserId" TEXT,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "ShopPaymentMethod" NOT NULL,
    "paymentStatus" "ShopPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(20,4) NOT NULL,
    "discount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "deliveryFee" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,4) NOT NULL,
    "promoCodeId" TEXT,
    "promoCode" TEXT,
    "shipLabel" TEXT NOT NULL,
    "shipName" TEXT NOT NULL,
    "shipPhone" TEXT NOT NULL,
    "shipCountry" TEXT NOT NULL,
    "shipCity" TEXT NOT NULL,
    "shipDistrict" TEXT,
    "shipAddress" TEXT NOT NULL,
    "note" TEXT,
    "trackingNumber" TEXT,
    "adminNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "ShopOrderCancelledBy",
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "variantLabel" TEXT,
    "unitLabel" TEXT NOT NULL,
    "imageUrl" TEXT,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPurchase" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "MerchantPurchaseSource" NOT NULL,
    "warehouseProductId" TEXT,
    "shopProductId" TEXT,
    "shopOrderItemId" TEXT,
    "productName" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "totalCost" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopProductVariant_sku_key" ON "ShopProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ShopProductVariant_productId_sortOrder_idx" ON "ShopProductVariant"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "ShopProductSpec_productId_sortOrder_idx" ON "ShopProductSpec"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "ShopBanner_isActive_sortOrder_idx" ON "ShopBanner"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ShopPromoCode_code_key" ON "ShopPromoCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShopFavorite_storeId_productId_key" ON "ShopFavorite"("storeId", "productId");

-- CreateIndex
CREATE INDEX "ShopCartItem_storeId_idx" ON "ShopCartItem"("storeId");

-- CreateIndex
CREATE INDEX "ShopAddress_storeId_idx" ON "ShopAddress"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_number_key" ON "ShopOrder"("number");

-- CreateIndex
CREATE INDEX "ShopOrder_storeId_createdAt_idx" ON "ShopOrder"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_status_createdAt_idx" ON "ShopOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_storeId_cancelledBy_cancelledAt_idx" ON "ShopOrder"("storeId", "cancelledBy", "cancelledAt");

-- CreateIndex
CREATE INDEX "ShopOrderItem_orderId_idx" ON "ShopOrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPurchase_shopOrderItemId_key" ON "MerchantPurchase"("shopOrderItemId");

-- CreateIndex
CREATE INDEX "MerchantPurchase_storeId_purchaseDate_idx" ON "MerchantPurchase"("storeId", "purchaseDate");

-- CreateIndex
CREATE INDEX "MerchantPurchase_storeId_source_idx" ON "MerchantPurchase"("storeId", "source");

-- AddForeignKey
ALTER TABLE "ShopProductVariant" ADD CONSTRAINT "ShopProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProductSpec" ADD CONSTRAINT "ShopProductSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFavorite" ADD CONSTRAINT "ShopFavorite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFavorite" ADD CONSTRAINT "ShopFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCartItem" ADD CONSTRAINT "ShopCartItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCartItem" ADD CONSTRAINT "ShopCartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopCartItem" ADD CONSTRAINT "ShopCartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopAddress" ADD CONSTRAINT "ShopAddress_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "ShopPromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ShopProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_warehouseProductId_fkey" FOREIGN KEY ("warehouseProductId") REFERENCES "WarehouseProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_shopProductId_fkey" FOREIGN KEY ("shopProductId") REFERENCES "ShopProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_shopOrderItemId_fkey" FOREIGN KEY ("shopOrderItemId") REFERENCES "ShopOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the single settings row with defaults.
INSERT INTO "ShopSettings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
