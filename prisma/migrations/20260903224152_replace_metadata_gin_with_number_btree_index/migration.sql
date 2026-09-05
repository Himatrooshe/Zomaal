-- DropIndex
DROP INDEX "EcommerceOrderEvent_metadata_idx";

-- CreateIndex
-- Matches the EXACT expression Prisma compiles `metadata: { path: ['number'], equals: X }`
-- to (verified via query logging): ("metadata" #> ARRAY['number']::text[])::jsonb — a GIN
-- index on the raw column does not accelerate this (GIN needs @>/?/?|/?&, this uses #>), so
-- this is a btree index on the exact extraction expression instead.
CREATE INDEX "EcommerceOrderEvent_metadata_number_idx"
ON "EcommerceOrderEvent" ((("metadata" #> ARRAY['number']::text[])::jsonb));
