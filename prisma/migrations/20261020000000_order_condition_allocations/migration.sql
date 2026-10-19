-- AlterTable
ALTER TABLE "EcommerceOrderLine" ADD COLUMN     "conditionAllocations" JSONB,
ADD COLUMN     "conditionRevision" INTEGER NOT NULL DEFAULT 0;

