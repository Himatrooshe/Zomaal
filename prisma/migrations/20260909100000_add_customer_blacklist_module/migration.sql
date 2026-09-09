-- CreateTable: Customer — one per (store, phone), resolved from Shopify/
-- YouCan/Lightfunnels order sync, manual orders, or Zomaal courier shipments.
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "city" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "returnsCount" INTEGER NOT NULL DEFAULT 0,
    "cancellationsCount" INTEGER NOT NULL DEFAULT 0,
    "refusalsCount" INTEGER NOT NULL DEFAULT 0,
    "noAnswerCount" INTEGER NOT NULL DEFAULT 0,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistReason" TEXT,
    "blacklistedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_storeId_phone_key" ON "Customer"("storeId", "phone");
CREATE INDEX "Customer_storeId_isBlacklisted_idx" ON "Customer"("storeId", "isBlacklisted");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: BlacklistSettings — one per store, the Blacklist Settings screen.
CREATE TABLE "BlacklistSettings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "returnsLimit" INTEGER NOT NULL DEFAULT 0,
    "cancellationsLimit" INTEGER NOT NULL DEFAULT 0,
    "refusalsLimit" INTEGER NOT NULL DEFAULT 0,
    "noAnswerLimit" INTEGER NOT NULL DEFAULT 0,
    "useCombinedLimit" BOOLEAN NOT NULL DEFAULT false,
    "combinedLimit" INTEGER NOT NULL DEFAULT 0,
    "warnOnNewOrder" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlacklistSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlacklistSettings_storeId_key" ON "BlacklistSettings"("storeId");

ALTER TABLE "BlacklistSettings" ADD CONSTRAINT "BlacklistSettings_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: link EcommerceOrder to the resolved Customer. SetNull (not
-- Cascade) — deleting a Customer (e.g. a GDPR redact) must never delete the
-- order/financial history with it.
ALTER TABLE "EcommerceOrder" ADD COLUMN "customerId" TEXT;
CREATE INDEX "EcommerceOrder_customerId_idx" ON "EcommerceOrder"("customerId");

ALTER TABLE "EcommerceOrder" ADD CONSTRAINT "EcommerceOrder_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
