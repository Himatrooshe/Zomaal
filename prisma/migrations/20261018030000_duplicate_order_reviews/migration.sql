-- CreateEnum
CREATE TYPE "DuplicateOrderDecision" AS ENUM ('KEPT', 'CANCELLED');

-- CreateTable
CREATE TABLE "DuplicateOrderReview" (
    "id" TEXT NOT NULL,
    "decision" "DuplicateOrderDecision" NOT NULL,
    "mainOrderId" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "DuplicateOrderReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateOrderReview_orderId_key" ON "DuplicateOrderReview"("orderId");

-- CreateIndex
CREATE INDEX "DuplicateOrderReview_storeId_decision_idx" ON "DuplicateOrderReview"("storeId", "decision");

-- AddForeignKey
ALTER TABLE "DuplicateOrderReview" ADD CONSTRAINT "DuplicateOrderReview_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateOrderReview" ADD CONSTRAINT "DuplicateOrderReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
