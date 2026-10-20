BEGIN;

-- CreateTable
CREATE TABLE "ExpenseCreateRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCreateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCreateRequest_expenseId_key" ON "ExpenseCreateRequest"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCreateRequest_storeId_idempotencyKey_key" ON "ExpenseCreateRequest"("storeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ExpenseCreateRequest" ADD CONSTRAINT "ExpenseCreateRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCreateRequest" ADD CONSTRAINT "ExpenseCreateRequest_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
