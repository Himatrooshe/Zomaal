-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'ORDER_DELIVERED';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_LOST';

-- CreateEnum
CREATE TYPE "OrderLineStockStatus" AS ENUM ('RESERVED', 'RELEASED', 'DELIVERED');

-- AlterTable
ALTER TABLE "EcommerceOrderLine" ADD COLUMN "stockStatus" "OrderLineStockStatus";
