BEGIN;

-- AlterTable
ALTER TABLE "MerchantPurchase" ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "supplierName" TEXT;

-- AlterTable
ALTER TABLE "PackagingMaterial" ADD COLUMN     "supplierNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WarehouseProduct" ADD COLUMN     "supplierNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Receipt/packaging purposes were added after the original product-only
-- CHECK constraints. Detached ATTACHED assets are allowed temporarily during
-- replacement / ON DELETE SET NULL, then removed by media cleanup. Every
-- attached owner must still match the asset purpose, with at most one owner.
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_attachment_check";
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_purpose_check";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_attachment_check" CHECK (
  ("status" = 'TEMPORARY' AND num_nonnulls("productId", "variantId", "expenseId", "salaryPaymentId", "packagingMaterialId") = 0)
  OR
  ("status" = 'ATTACHED' AND num_nonnulls("productId", "variantId", "expenseId", "salaryPaymentId", "packagingMaterialId") <= 1)
);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_purpose_check" CHECK (
  ("purpose" IN ('PRODUCT_MAIN', 'PRODUCT_GALLERY') AND num_nonnulls("variantId", "expenseId", "salaryPaymentId", "packagingMaterialId") = 0)
  OR ("purpose" = 'VARIANT' AND num_nonnulls("productId", "expenseId", "salaryPaymentId", "packagingMaterialId") = 0)
  OR ("purpose" = 'RECEIPT' AND num_nonnulls("productId", "variantId", "packagingMaterialId") = 0)
  OR ("purpose" = 'PACKAGING' AND num_nonnulls("productId", "variantId", "expenseId", "salaryPaymentId") = 0)
);

COMMIT;
