CREATE TYPE "ShippingShipmentStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'PICKUP_PENDING',
  'PICKED_UP',
  'AT_WAREHOUSE',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'POSTPONED',
  'UNREACHABLE',
  'DELIVERED',
  'CANCELLED',
  'REFUSED',
  'RETURN_PENDING',
  'RETURN_IN_TRANSIT',
  'RETURNED_TO_WAREHOUSE',
  'RETURN_INSPECTION',
  'RETURNED_TO_STOCK',
  'RETURNED_TO_SELLER',
  'UNKNOWN'
);

CREATE TABLE "SenditShipment" (
  "id" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "providerReturnStatus" TEXT,
  "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
  "reference" TEXT,
  "recipientName" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "city" TEXT,
  "pickupDistrictId" INTEGER,
  "destinationDistrictId" INTEGER,
  "codAmount" DECIMAL(20,4) NOT NULL,
  "fee" DECIMAL(20,4),
  "currency" TEXT NOT NULL DEFAULT 'MAD',
  "lastActionAt" TIMESTAMP(3),
  "providerCreatedAt" TIMESTAMP(3),
  "providerUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "connectionId" TEXT,
  "dispatchId" TEXT,
  CONSTRAINT "SenditShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SenditTrackingEvent" (
  "id" TEXT NOT NULL,
  "providerEventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerStatus" TEXT NOT NULL,
  "normalizedStatus" "ShippingShipmentStatus" NOT NULL,
  "message" TEXT,
  "proofImageUrl" TEXT,
  "deliverBy" TIMESTAMP(3),
  "unreachableCount" INTEGER,
  "actor" TEXT,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shipmentId" TEXT NOT NULL,
  CONSTRAINT "SenditTrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SenditShipment_dispatchId_key" ON "SenditShipment"("dispatchId");
CREATE UNIQUE INDEX "SenditShipment_userId_providerCode_key" ON "SenditShipment"("userId", "providerCode");
CREATE INDEX "SenditShipment_userId_normalizedStatus_updatedAt_idx" ON "SenditShipment"("userId", "normalizedStatus", "updatedAt");
CREATE INDEX "SenditShipment_connectionId_updatedAt_idx" ON "SenditShipment"("connectionId", "updatedAt");
CREATE INDEX "SenditShipment_reference_idx" ON "SenditShipment"("reference");
CREATE UNIQUE INDEX "SenditTrackingEvent_shipmentId_providerEventKey_key" ON "SenditTrackingEvent"("shipmentId", "providerEventKey");
CREATE INDEX "SenditTrackingEvent_shipmentId_eventAt_idx" ON "SenditTrackingEvent"("shipmentId", "eventAt");

ALTER TABLE "SenditShipment" ADD CONSTRAINT "SenditShipment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SenditShipment" ADD CONSTRAINT "SenditShipment_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "SenditConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SenditShipment" ADD CONSTRAINT "SenditShipment_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "EcommerceOrderDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SenditTrackingEvent" ADD CONSTRAINT "SenditTrackingEvent_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "SenditShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
