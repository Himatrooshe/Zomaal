CREATE TABLE "QuickLivraisonShipment" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "providerSecondaryStatus" TEXT,
  "situation" TEXT,
  "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
  "reference" TEXT,
  "recipientName" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "city" TEXT,
  "destinationDistrictId" INTEGER,
  "codAmount" DECIMAL(20,4) NOT NULL,
  "fee" DECIMAL(20,4),
  "currency" TEXT NOT NULL DEFAULT 'MAD',
  "storeName" TEXT,
  "lastActionAt" TIMESTAMP(3),
  "providerCreatedAt" TIMESTAMP(3),
  "providerUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT,
  "dispatchId" TEXT,
  CONSTRAINT "QuickLivraisonShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuickLivraisonTrackingEvent" (
  "id" TEXT NOT NULL,
  "providerEventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "providerSecondaryStatus" TEXT,
  "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
  "message" TEXT,
  "actor" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shipmentId" TEXT NOT NULL,
  CONSTRAINT "QuickLivraisonTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuickLivraisonShipment_dispatchId_key"
  ON "QuickLivraisonShipment"("dispatchId");
CREATE UNIQUE INDEX "QuickLivraisonShipment_userId_providerCode_key"
  ON "QuickLivraisonShipment"("userId", "providerCode");
CREATE INDEX "QuickLivraisonShipment_userId_normalizedStatus_updatedAt_idx"
  ON "QuickLivraisonShipment"("userId", "normalizedStatus", "updatedAt");
CREATE INDEX "QuickLivraisonShipment_connectionId_updatedAt_idx"
  ON "QuickLivraisonShipment"("connectionId", "updatedAt");
CREATE INDEX "QuickLivraisonShipment_reference_idx"
  ON "QuickLivraisonShipment"("reference");
CREATE UNIQUE INDEX "QuickLivraisonTrackingEvent_shipmentId_providerEventKey_key"
  ON "QuickLivraisonTrackingEvent"("shipmentId", "providerEventKey");
CREATE INDEX "QuickLivraisonTrackingEvent_shipmentId_eventAt_idx"
  ON "QuickLivraisonTrackingEvent"("shipmentId", "eventAt");

ALTER TABLE "QuickLivraisonShipment" ADD CONSTRAINT "QuickLivraisonShipment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickLivraisonShipment" ADD CONSTRAINT "QuickLivraisonShipment_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "QuickLivraisonConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuickLivraisonShipment" ADD CONSTRAINT "QuickLivraisonShipment_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "EcommerceOrderDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuickLivraisonTrackingEvent" ADD CONSTRAINT "QuickLivraisonTrackingEvent_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "QuickLivraisonShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
