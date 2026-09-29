-- Additive: preserve existing payments/expenses and do not reinterpret them.
ALTER TABLE "StaffSalaryPayment"
  ADD COLUMN "expenseHandling" "SalaryExpenseHandling" NOT NULL DEFAULT 'AUTOMATIC',
  ADD COLUMN "frequency" "SalaryFrequency",
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "paidByUserId" TEXT;

-- Historical frequency is unknown, so keep it NULL rather than invent it.
CREATE UNIQUE INDEX "StaffSalaryPayment_staffMemberId_scheduledFor_key"
  ON "StaffSalaryPayment"("staffMemberId", "scheduledFor");
CREATE UNIQUE INDEX "StaffSalaryPayment_staffMemberId_idempotencyKey_key"
  ON "StaffSalaryPayment"("staffMemberId", "idempotencyKey");

-- Previous MANUAL profiles did not have a schedule; all profiles now accrue
-- obligations. Start those at rollout day, never fabricate historical debt.
UPDATE "StaffSalaryProfile"
SET "nextPaymentDate" = GREATEST("startDate", date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
WHERE "nextPaymentDate" IS NULL;
