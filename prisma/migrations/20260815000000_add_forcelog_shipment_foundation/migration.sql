ALTER TABLE "ForceLogConnection"
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;

CREATE TABLE "ForceLogShipment" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "situation" TEXT,
    "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
    "reference" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "codAmount" DECIMAL(20,4),
    "fee" DECIMAL(20,4),
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "canOpen" BOOLEAN,
    "comment" TEXT,
    "productNature" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "dispatchId" TEXT,
    CONSTRAINT "ForceLogShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ForceLogTrackingEvent" (
    "id" TEXT NOT NULL,
    "providerEventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
    "message" TEXT,
    "actor" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipmentId" TEXT NOT NULL,
    CONSTRAINT "ForceLogTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForceLogShipment_dispatchId_key" ON "ForceLogShipment"("dispatchId");
CREATE UNIQUE INDEX "ForceLogShipment_userId_providerCode_key" ON "ForceLogShipment"("userId", "providerCode");
CREATE INDEX "ForceLogShipment_userId_normalizedStatus_updatedAt_idx" ON "ForceLogShipment"("userId", "normalizedStatus", "updatedAt");
CREATE INDEX "ForceLogShipment_connectionId_updatedAt_idx" ON "ForceLogShipment"("connectionId", "updatedAt");
CREATE INDEX "ForceLogShipment_reference_idx" ON "ForceLogShipment"("reference");
CREATE UNIQUE INDEX "ForceLogTrackingEvent_shipmentId_providerEventKey_key" ON "ForceLogTrackingEvent"("shipmentId", "providerEventKey");
CREATE INDEX "ForceLogTrackingEvent_shipmentId_eventAt_idx" ON "ForceLogTrackingEvent"("shipmentId", "eventAt");

ALTER TABLE "ForceLogShipment" ADD CONSTRAINT "ForceLogShipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ForceLogShipment" ADD CONSTRAINT "ForceLogShipment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ForceLogConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForceLogShipment" ADD CONSTRAINT "ForceLogShipment_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "EcommerceOrderDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ForceLogTrackingEvent" ADD CONSTRAINT "ForceLogTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ForceLogShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
