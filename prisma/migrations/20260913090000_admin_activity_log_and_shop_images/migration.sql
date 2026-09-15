-- CreateTable: SuperAdminActivityLog — audit trail of super admin writes.
-- No FK to the target entity on purpose: the log must outlive deletions.
CREATE TABLE "SuperAdminActivityLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "adminUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdminActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SuperAdminActivityLog_createdAt_idx" ON "SuperAdminActivityLog"("createdAt");
CREATE INDEX "SuperAdminActivityLog_entityType_createdAt_idx" ON "SuperAdminActivityLog"("entityType", "createdAt");

-- AlterTable: ShopProduct photo (GCS object in PRODUCT_IMAGE_BUCKET)
ALTER TABLE "ShopProduct" ADD COLUMN "imageObjectName" TEXT,
ADD COLUMN "imageContentType" TEXT,
ADD COLUMN "imageUpdatedAt" TIMESTAMP(3);
