-- Adds the internal Product Tracking Code to WarehouseVariant (e.g. "DH564BJ0"),
-- printed on shipping tickets/QR labels instead of the full product title, and
-- indexes EcommerceOrderDispatch.providerTracking for fast barcode-scan lookups
-- (shipping tracking number -> order -> product).
--
-- productCode is nullable at the database level to stay safe for existing rows;
-- application code always generates one for every variant created going forward.
-- Postgres unique indexes ignore NULLs, so legacy rows without a code do not
-- collide with each other or block new codes from being issued.

-- AlterTable
ALTER TABLE "WarehouseVariant" ADD COLUMN     "productCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseVariant_storeId_productCode_key" ON "WarehouseVariant"("storeId", "productCode");

-- CreateIndex
CREATE INDEX "EcommerceOrderDispatch_providerTracking_idx" ON "EcommerceOrderDispatch"("providerTracking");
