-- Adds product-condition tracking to EcommerceOrderLine, recorded by the
-- warehouse scan-and-condition workflow when a shipment comes back
-- (GOOD | DAMAGED | LOST | RETURNED | MISSING), plus an optional damage cost.

-- AlterTable
ALTER TABLE "EcommerceOrderLine" ADD COLUMN     "condition" TEXT,
ADD COLUMN     "damageCost" DECIMAL(20,4),
ADD COLUMN     "conditionNotes" TEXT,
ADD COLUMN     "conditionRecordedAt" TIMESTAMP(3);
