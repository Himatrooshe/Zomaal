-- CreateEnum
CREATE TYPE "ShopProductStatus" AS ENUM ('ACTIVE', 'DRAFT');

-- CreateTable: ShopCategory — the Zomaal Shop catalog is global (one
-- platform-owned catalog, not per-merchant), managed by the SuperAdmin.
CREATE TABLE "ShopCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopCategory_slug_key" ON "ShopCategory"("slug");
CREATE INDEX "ShopCategory_isActive_idx" ON "ShopCategory"("isActive");

-- CreateTable: ShopProduct
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "price" DECIMAL(20,4) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "status" "ShopProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopProduct_slug_key" ON "ShopProduct"("slug");
CREATE UNIQUE INDEX "ShopProduct_sku_key" ON "ShopProduct"("sku");
CREATE INDEX "ShopProduct_categoryId_idx" ON "ShopProduct"("categoryId");
CREATE INDEX "ShopProduct_status_idx" ON "ShopProduct"("status");

ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "ShopCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
