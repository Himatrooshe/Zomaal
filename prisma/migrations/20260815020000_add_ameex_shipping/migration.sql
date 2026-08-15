CREATE TABLE "AmeexConnection" (
    "id" TEXT NOT NULL,
    "encryptedApiId" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "AmeexConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmeexShipment" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "providerSubStatus" TEXT,
    "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
    "reference" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "cityId" INTEGER,
    "codAmount" DECIMAL(20,4),
    "fee" DECIMAL(20,4),
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "note" TEXT,
    "nature" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    CONSTRAINT "AmeexShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmeexTrackingEvent" (
    "id" TEXT NOT NULL,
    "providerEventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "providerSubStatus" TEXT,
    "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
    "message" TEXT,
    "actor" TEXT,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shipmentId" TEXT NOT NULL,
    CONSTRAINT "AmeexTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmeexConnection_userId_key" ON "AmeexConnection"("userId");
CREATE UNIQUE INDEX "AmeexShipment_userId_providerCode_key" ON "AmeexShipment"("userId", "providerCode");
CREATE INDEX "AmeexShipment_providerCode_idx" ON "AmeexShipment"("providerCode");
CREATE INDEX "AmeexShipment_userId_normalizedStatus_updatedAt_idx" ON "AmeexShipment"("userId", "normalizedStatus", "updatedAt");
CREATE INDEX "AmeexShipment_connectionId_updatedAt_idx" ON "AmeexShipment"("connectionId", "updatedAt");
CREATE INDEX "AmeexShipment_reference_idx" ON "AmeexShipment"("reference");
CREATE UNIQUE INDEX "AmeexTrackingEvent_shipmentId_providerEventKey_key" ON "AmeexTrackingEvent"("shipmentId", "providerEventKey");
CREATE INDEX "AmeexTrackingEvent_shipmentId_eventAt_idx" ON "AmeexTrackingEvent"("shipmentId", "eventAt");

ALTER TABLE "AmeexConnection" ADD CONSTRAINT "AmeexConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AmeexShipment" ADD CONSTRAINT "AmeexShipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AmeexShipment" ADD CONSTRAINT "AmeexShipment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AmeexConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AmeexTrackingEvent" ADD CONSTRAINT "AmeexTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "AmeexShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
