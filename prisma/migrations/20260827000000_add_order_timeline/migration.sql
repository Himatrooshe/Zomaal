-- Adds COD tracking fields to EcommerceOrder and the EcommerceOrderEvent
-- table backing the order timeline feature. These columns/table were added
-- to prisma/schema.prisma in a prior commit but the migration file was never
-- generated, so production never had them (see the ColumnNotFound / P2022
-- errors on EcommerceOrder.codAmount).

-- AlterTable
ALTER TABLE "EcommerceOrder" ADD COLUMN     "codAmount" DECIMAL(20,4),
ADD COLUMN     "codStatus" TEXT;

-- CreateTable
CREATE TABLE "EcommerceOrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "actor" TEXT,
    "location" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcommerceOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcommerceOrderEvent_orderId_occurredAt_idx" ON "EcommerceOrderEvent"("orderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceOrderEvent_orderId_providerEventId_key" ON "EcommerceOrderEvent"("orderId", "providerEventId");

-- AddForeignKey
ALTER TABLE "EcommerceOrderEvent" ADD CONSTRAINT "EcommerceOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
