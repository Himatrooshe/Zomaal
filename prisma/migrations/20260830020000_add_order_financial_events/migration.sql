-- Immutable append-only financial ledger for orders. Each row is one event
-- triggered by a carrier status reaching DELIVERED/CANCELLED-like, or by a
-- DAMAGED condition recorded on a return (see EcommerceOrderLine.condition).
-- Current totals for an order are the sum of its events, never a mutated
-- snapshot -- corrections add a new event rather than rewriting history.

-- CreateTable
CREATE TABLE "EcommerceOrderFinancialEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "revenue" DECIMAL(20,4) NOT NULL,
    "productCost" DECIMAL(20,4) NOT NULL,
    "shippingCost" DECIMAL(20,4) NOT NULL,
    "damageCost" DECIMAL(20,4) NOT NULL,
    "netProfitImpact" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcommerceOrderFinancialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcommerceOrderFinancialEvent_orderId_createdAt_idx" ON "EcommerceOrderFinancialEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EcommerceOrderFinancialEvent_orderId_idempotencyKey_key" ON "EcommerceOrderFinancialEvent"("orderId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "EcommerceOrderFinancialEvent" ADD CONSTRAINT "EcommerceOrderFinancialEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
