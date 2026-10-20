-- Additive expression index for finding existing formatted phones in one store.
-- Prisma cannot represent expression indexes in schema.prisma; keep this SQL.
-- No customer, order, risk, or legacy product data is rewritten or removed.
BEGIN;
CREATE INDEX "Customer_storeId_phoneDigits_idx" ON "Customer"
  ("storeId", (regexp_replace("phone", '[^0-9]', '', 'g')));
COMMIT;
