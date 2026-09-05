/*
  NOTE (2026-09-06): This migration originally also dropped the `Product`,
  `ProductImage`, `ProductListing`, and `ProductVariant` tables. Those drops
  were NOT part of this feature — Prisma generated them automatically because
  those models had been removed from schema.prisma in an earlier commit
  without a migration, and `prisma migrate dev` reconciled that drift here.

  They have been removed from this migration deliberately. Those four tables
  were created in production by 20260728092500_add_missing_ecommerce_models,
  and code that wrote to them (`prisma.product.create`, `productListing`,
  `productVariant`) was live in main and deployed to production between
  2026-07-27 and 2026-08-09 — so they may contain real production rows. No
  one has verified prod's actual row counts for them yet.

  The tables are inert: nothing in the current codebase reads or writes them,
  so leaving them in place costs nothing but a small amount of storage. This
  leaves schema.prisma intentionally drifted from the database by those four
  removals, which the CI drift check tolerates (removal-only drift warns, it
  does not fail).

  To actually drop them later: follow docs/destructive-migrations.md — verify
  prod's row counts first, then add a dedicated migration that does only that,
  with a REVIEWED.md alongside it.
*/
-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('OPERATIONAL', 'PURCHASES', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'TIKTOK', 'GOOGLE', 'SNAPCHAT', 'OTHER');

-- DropIndex
DROP INDEX "EcommerceOrderLine_sku_idx";

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
