/*
  Warnings:

  - You are about to drop the `Product` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductImage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductListing` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductVariant` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('OPERATIONAL', 'PURCHASES', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'TIKTOK', 'GOOGLE', 'SNAPCHAT', 'OTHER');

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_storeId_fkey";

-- DropForeignKey
ALTER TABLE "ProductImage" DROP CONSTRAINT "ProductImage_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductListing" DROP CONSTRAINT "ProductListing_connectionId_fkey";

-- DropForeignKey
ALTER TABLE "ProductListing" DROP CONSTRAINT "ProductListing_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_productId_fkey";

-- DropIndex
DROP INDEX "EcommerceOrderLine_sku_idx";

-- DropTable
DROP TABLE "Product";

-- DropTable
DROP TABLE "ProductImage";

-- DropTable
DROP TABLE "ProductListing";

-- DropTable
DROP TABLE "ProductVariant";

-- CreateTable
CREATE TABLE "ExpenseEntry" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "quantity" INTEGER,
    "description" TEXT,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "ExpenseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpendEntry" (
    "id" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "results" INTEGER,
    "description" TEXT,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "AdSpendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseEntry_storeId_incurredAt_idx" ON "ExpenseEntry"("storeId", "incurredAt");

-- CreateIndex
CREATE INDEX "ExpenseEntry_storeId_category_idx" ON "ExpenseEntry"("storeId", "category");

-- CreateIndex
CREATE INDEX "AdSpendEntry_storeId_spentAt_idx" ON "AdSpendEntry"("storeId", "spentAt");

-- CreateIndex
CREATE INDEX "AdSpendEntry_storeId_platform_idx" ON "AdSpendEntry"("storeId", "platform");

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpendEntry" ADD CONSTRAINT "AdSpendEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
