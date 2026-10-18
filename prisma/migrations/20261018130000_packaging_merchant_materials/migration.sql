-- CreateEnum
CREATE TYPE "PackagingUnit" AS ENUM ('PIECES', 'ROLLS', 'METERS', 'SHEETS');

-- AlterEnum
ALTER TYPE "MediaAssetPurpose" ADD VALUE 'PACKAGING';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "packagingMaterialId" TEXT;

-- AlterTable
ALTER TABLE "PackagingMaterial" ADD COLUMN     "lowStockAlert" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minimumLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unit" "PackagingUnit" NOT NULL DEFAULT 'PIECES',
ALTER COLUMN "zomaalShopVariantId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_packagingMaterialId_key" ON "MediaAsset"("packagingMaterialId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_packagingMaterialId_fkey" FOREIGN KEY ("packagingMaterialId") REFERENCES "PackagingMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
