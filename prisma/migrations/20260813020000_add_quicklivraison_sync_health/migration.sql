ALTER TABLE "QuickLivraisonConnection"
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT;

ALTER TABLE "QuickLivraisonShipment"
  ALTER COLUMN "recipientName" DROP NOT NULL,
  ALTER COLUMN "recipientPhone" DROP NOT NULL,
  ALTER COLUMN "address" DROP NOT NULL,
  ALTER COLUMN "codAmount" DROP NOT NULL;
