-- Repair: the previous migration dropped a table CONSTRAINT, but Prisma
-- materializes @unique as a UNIQUE INDEX named Store_userId_key. Drop it
-- so owners can create more than one store.
DROP INDEX IF EXISTS "Store_userId_key";
ALTER TABLE "Store" DROP CONSTRAINT IF EXISTS "Store_userId_key";
