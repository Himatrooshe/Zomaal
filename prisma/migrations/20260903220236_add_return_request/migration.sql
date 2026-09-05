-- CreateEnum
CREATE TYPE "ReturnRequestStatus" AS ENUM ('NEED_VERIFICATION', 'PROCESSED');

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "status" "ReturnRequestStatus" NOT NULL DEFAULT 'NEED_VERIFICATION',
    "reason" TEXT,
    "detectedVia" TEXT NOT NULL,
    "scannedValue" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequestLine" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,

    CONSTRAINT "ReturnRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequestLine_returnRequestId_orderLineId_key" ON "ReturnRequestLine"("returnRequestId", "orderLineId");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestLine" ADD CONSTRAINT "ReturnRequestLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "EcommerceOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
