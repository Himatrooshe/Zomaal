-- CreateEnum
CREATE TYPE "EcommercePlatform" AS ENUM ('SHOPIFY');

CREATE TYPE "EcommerceConnectionStatus" AS ENUM (
  'ACTIVE',
  'DISCONNECTED',
  'REAUTHORIZATION_REQUIRED'
);

CREATE TYPE "EcommerceOrderStatus" AS ENUM (
  'OPEN',
  'CLOSED',
  'CANCELLED',
  'UNKNOWN'
);

CREATE TYPE "EcommercePaymentStatus" AS ENUM (
  'PENDING',
  'AUTHORIZED',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'VOIDED',
  'EXPIRED',
  'UNKNOWN'
);

-- CreateTable
CREATE TABLE "EcommerceConnection" (
  "id" TEXT NOT NULL,
  "platform" "EcommercePlatform" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "status" "EcommerceConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "includeInRevenue" BOOLEAN NOT NULL DEFAULT true,
  "syncCursor" TEXT,
  "syncFrom" TIMESTAMP(3),
  "syncStartedAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "storeId" TEXT NOT NULL,

  CONSTRAINT "EcommerceConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EcommerceOrder" (
  "id" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "orderName" TEXT,
  "status" "EcommerceOrderStatus" NOT NULL,
  "financialStatus" "EcommercePaymentStatus" NOT NULL,
  "fulfillmentStatus" TEXT,
  "currency" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "grossSales" DECIMAL(20,4) NOT NULL,
  "discounts" DECIMAL(20,4) NOT NULL,
  "refunds" DECIMAL(20,4) NOT NULL,
  "netSales" DECIMAL(20,4) NOT NULL,
  "shipping" DECIMAL(20,4) NOT NULL,
  "tax" DECIMAL(20,4) NOT NULL,
  "totalCollected" DECIMAL(20,4) NOT NULL,
  "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "providerUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "connectionId" TEXT NOT NULL,

  CONSTRAINT "EcommerceOrder_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ShopifyConnection"
  ADD COLUMN "ecommerceConnectionId" TEXT;

-- Backfill generic connections for existing Shopify installations.
INSERT INTO "EcommerceConnection" (
  "id",
  "platform",
  "externalAccountId",
  "displayName",
  "status",
  "createdAt",
  "updatedAt",
  "storeId"
)
SELECT
  substr(md5('ecommerce:' || "id"), 1, 8) || '-' ||
  substr(md5('ecommerce:' || "id"), 9, 4) || '-' ||
  substr(md5('ecommerce:' || "id"), 13, 4) || '-' ||
  substr(md5('ecommerce:' || "id"), 17, 4) || '-' ||
  substr(md5('ecommerce:' || "id"), 21, 12),
  'SHOPIFY'::"EcommercePlatform",
  "shopDomain",
  "shopDomain",
  "status"::text::"EcommerceConnectionStatus",
  "createdAt",
  "updatedAt",
  "storeId"
FROM "ShopifyConnection";

UPDATE "ShopifyConnection" AS shopify
SET "ecommerceConnectionId" = ecommerce."id"
FROM "EcommerceConnection" AS ecommerce
WHERE ecommerce."storeId" = shopify."storeId"
  AND ecommerce."platform" = 'SHOPIFY';

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceConnection_storeId_platform_key"
  ON "EcommerceConnection"("storeId", "platform");

CREATE UNIQUE INDEX "EcommerceConnection_platform_externalAccountId_key"
  ON "EcommerceConnection"("platform", "externalAccountId");

CREATE INDEX "EcommerceConnection_storeId_status_idx"
  ON "EcommerceConnection"("storeId", "status");

CREATE INDEX "EcommerceConnection_platform_status_idx"
  ON "EcommerceConnection"("platform", "status");

CREATE UNIQUE INDEX "EcommerceOrder_connectionId_externalOrderId_key"
  ON "EcommerceOrder"("connectionId", "externalOrderId");

CREATE INDEX "EcommerceOrder_connectionId_processedAt_idx"
  ON "EcommerceOrder"("connectionId", "processedAt");

CREATE INDEX "EcommerceOrder_connectionId_providerUpdatedAt_idx"
  ON "EcommerceOrder"("connectionId", "providerUpdatedAt");

CREATE INDEX "EcommerceOrder_financialStatus_processedAt_idx"
  ON "EcommerceOrder"("financialStatus", "processedAt");

CREATE UNIQUE INDEX "ShopifyConnection_ecommerceConnectionId_key"
  ON "ShopifyConnection"("ecommerceConnectionId");

-- AddForeignKey
ALTER TABLE "EcommerceConnection"
  ADD CONSTRAINT "EcommerceConnection_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EcommerceOrder"
  ADD CONSTRAINT "EcommerceOrder_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "EcommerceConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShopifyConnection"
  ADD CONSTRAINT "ShopifyConnection_ecommerceConnectionId_fkey"
  FOREIGN KEY ("ecommerceConnectionId") REFERENCES "EcommerceConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
