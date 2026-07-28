-- CreateTable
CREATE TABLE "EcommerceOrderDispatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "merchantTracking" TEXT NOT NULL,
    "providerTracking" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "EcommerceOrderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "price" DECIMAL(20,4) NOT NULL,
    "compareAtPrice" DECIMAL(20,4),
    "inventoryQty" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductListing" (
    "id" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "errorMessage" TEXT,
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceOrderDispatch_orderId_key" ON "EcommerceOrderDispatch"("orderId");

-- CreateIndex
CREATE INDEX "EcommerceOrderDispatch_provider_status_idx" ON "EcommerceOrderDispatch"("provider", "status");

-- CreateIndex
CREATE INDEX "Product_storeId_status_idx" ON "Product"("storeId", "status");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductListing_productId_connectionId_key" ON "ProductListing"("productId", "connectionId");

-- CreateIndex
CREATE INDEX "ProductListing_connectionId_status_idx" ON "ProductListing"("connectionId", "status");

-- AddForeignKey
ALTER TABLE "EcommerceOrderDispatch" ADD CONSTRAINT "EcommerceOrderDispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "EcommerceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
