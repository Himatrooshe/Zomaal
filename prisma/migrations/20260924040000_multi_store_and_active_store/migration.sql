-- Multi-store: one User may own many Stores. activeStoreId picks the current one.
-- Prisma models @unique as a UNIQUE INDEX named Store_userId_key (not always a table constraint).
DROP INDEX IF EXISTS "Store_userId_key";
ALTER TABLE "Store" DROP CONSTRAINT IF EXISTS "Store_userId_key";

CREATE INDEX IF NOT EXISTS "Store_userId_idx" ON "Store"("userId");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeStoreId" TEXT;

-- Backfill: each owner’s existing (previously sole) store becomes active.
UPDATE "User" AS u
SET "activeStoreId" = s.id
FROM "Store" AS s
WHERE s."userId" = u.id
  AND u."activeStoreId" IS NULL;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeStoreId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_activeStoreId_fkey"
  FOREIGN KEY ("activeStoreId") REFERENCES "Store"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
