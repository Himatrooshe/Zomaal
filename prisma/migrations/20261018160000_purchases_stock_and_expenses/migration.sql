-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'PURCHASE_RECEIVED';

-- AlterTable
ALTER TABLE "MerchantPurchase" ADD COLUMN     "expenseId" TEXT,
ADD COLUMN     "packagingMaterialId" TEXT,
ADD COLUMN     "stockAdded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warehouseVariantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPurchase_expenseId_key" ON "MerchantPurchase"("expenseId");

-- CreateIndex
CREATE INDEX "MerchantPurchase_packagingMaterialId_purchaseDate_idx" ON "MerchantPurchase"("packagingMaterialId", "purchaseDate");

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_warehouseVariantId_fkey" FOREIGN KEY ("warehouseVariantId") REFERENCES "WarehouseVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_packagingMaterialId_fkey" FOREIGN KEY ("packagingMaterialId") REFERENCES "PackagingMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPurchase" ADD CONSTRAINT "MerchantPurchase_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing purchase gets its "Purchase costs" expense. Stock
-- is left alone — those purchases never changed stock.
INSERT INTO "ExpenseCategory" ("id", "name", "group", "isSystem", "createdAt", "updatedAt", "storeId")
SELECT gen_random_uuid()::text, 'Purchases', 'PURCHASES', true, now(), now(), s."storeId"
FROM (SELECT DISTINCT "storeId" FROM "MerchantPurchase") s
WHERE NOT EXISTS (
  SELECT 1 FROM "ExpenseCategory" c
  WHERE c."storeId" = s."storeId" AND c."group" = 'PURCHASES'
)
ON CONFLICT ("storeId", "name") DO NOTHING;

WITH "backfill" AS MATERIALIZED (
SELECT
  mp."id" AS "purchaseId",
  gen_random_uuid()::text AS "expenseId",
  mp."storeId",
  'Purchase — ' || mp."productName" AS "title",
  mp."totalCost" AS "amount",
  (CASE WHEN so."paymentMethod" = 'ONLINE' THEN 'BANK' ELSE 'CASH' END)::"ExpensePaymentMethod" AS "paymentMethod",
  mp."purchaseDate" AS "spentAt",
  mp."notes",
  mp."createdByUserId",
  (
    SELECT c."id" FROM "ExpenseCategory" c
    WHERE c."storeId" = mp."storeId" AND c."group" = 'PURCHASES'
    ORDER BY c."isSystem" DESC, c."createdAt" ASC
    LIMIT 1
  ) AS "categoryId"
FROM "MerchantPurchase" mp
LEFT JOIN "ShopOrderItem" soi ON soi."id" = mp."shopOrderItemId"
LEFT JOIN "ShopOrder" so ON so."id" = soi."orderId"
WHERE mp."expenseId" IS NULL
),
"inserted" AS (
INSERT INTO "Expense" ("id", "title", "amount", "paymentMethod", "spentAt", "notes", "createdAt", "updatedAt", "storeId", "categoryId", "createdByUserId")
SELECT "expenseId", "title", "amount", "paymentMethod", "spentAt", "notes", now(), now(), "storeId", "categoryId", "createdByUserId"
FROM "backfill"
WHERE "categoryId" IS NOT NULL
RETURNING "id"
)
UPDATE "MerchantPurchase" mp
SET "expenseId" = i."id"
FROM "inserted" i
JOIN "backfill" b ON b."expenseId" = i."id"
WHERE mp."id" = b."purchaseId";
