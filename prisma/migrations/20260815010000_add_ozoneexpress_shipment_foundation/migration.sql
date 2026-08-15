ALTER TABLE "OzoneExpressConnection"
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncError" TEXT;

CREATE TABLE "OzoneExpressShipment" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
    "reference" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "cityId" INTEGER,
    "codAmount" DECIMAL(20,4),
    "deliveredPrice" DECIMAL(20,4),
    "returnedPrice" DECIMAL(20,4),
    "refusedPrice" DECIMAL(20,4),
    "fee" DECIMAL(20,4),
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "note" TEXT,
    "nature" TEXT,
    "stock" INTEGER,
    "canOpen" INTEGER,
    "fragile" INTEGER,
    "replacement" INTEGER,
    "lastActionAt" TIMESTAMP(3),
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "dispatchId" TEXT,
    CONSTRAINT "OzoneExpressShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OzoneExpressTrackingEvent" (
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
    CONSTRAINT "OzoneExpressTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OzoneExpressShipment_dispatchId_key" ON "OzoneExpressShipment"("dispatchId");
CREATE UNIQUE INDEX "OzoneExpressShipment_userId_providerCode_key" ON "OzoneExpressShipment"("userId", "providerCode");
CREATE INDEX "OzoneExpressShipment_userId_normalizedStatus_updatedAt_idx" ON "OzoneExpressShipment"("userId", "normalizedStatus", "updatedAt");
CREATE INDEX "OzoneExpressShipment_connectionId_updatedAt_idx" ON "OzoneExpressShipment"("connectionId", "updatedAt");
CREATE INDEX "OzoneExpressShipment_reference_idx" ON "OzoneExpressShipment"("reference");
CREATE UNIQUE INDEX "OzoneExpressTrackingEvent_shipmentId_providerEventKey_key" ON "OzoneExpressTrackingEvent"("shipmentId", "providerEventKey");
CREATE INDEX "OzoneExpressTrackingEvent_shipmentId_eventAt_idx" ON "OzoneExpressTrackingEvent"("shipmentId", "eventAt");

ALTER TABLE "OzoneExpressShipment" ADD CONSTRAINT "OzoneExpressShipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OzoneExpressShipment" ADD CONSTRAINT "OzoneExpressShipment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OzoneExpressConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OzoneExpressShipment" ADD CONSTRAINT "OzoneExpressShipment_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "EcommerceOrderDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OzoneExpressTrackingEvent" ADD CONSTRAINT "OzoneExpressTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "OzoneExpressShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
