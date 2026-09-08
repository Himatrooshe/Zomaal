-- Lets a MediaAsset (existing private Cloud Storage upload/attach pipeline,
-- previously product/variant only) be a receipt photo attached to an Expense
-- or a StaffSalaryPayment. Nullable + SetNull on both new FKs so deleting the
-- expense/payment never fails on a still-attached receipt — the receipt row
-- itself is cleaned up explicitly by the service (see ExpensesService).
ALTER TYPE "MediaAssetPurpose" ADD VALUE 'RECEIPT';

ALTER TABLE "MediaAsset" ADD COLUMN "expenseId" TEXT,
ADD COLUMN "salaryPaymentId" TEXT;

CREATE UNIQUE INDEX "MediaAsset_expenseId_key" ON "MediaAsset"("expenseId");
CREATE UNIQUE INDEX "MediaAsset_salaryPaymentId_key" ON "MediaAsset"("salaryPaymentId");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_salaryPaymentId_fkey" FOREIGN KEY ("salaryPaymentId") REFERENCES "StaffSalaryPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
