-- AlterTable
ALTER TABLE "EcommerceOrderFinancialEvent" ADD COLUMN     "giftCost" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "packagingCost" DECIMAL(20,4) NOT NULL DEFAULT 0;
