-- Partial unique index: at most one NEED_VERIFICATION ReturnRequest per
-- order. Not expressible via Prisma's schema DSL (no filtered/partial
-- index support), hand-written here. Guards against two concurrent scans
-- of the same order (POST /ecommerce/returns/detect) both racing past the
-- findFirst check and creating duplicate open return requests.
CREATE UNIQUE INDEX "ReturnRequest_orderId_open_unique"
ON "ReturnRequest" ("orderId")
WHERE "status" = 'NEED_VERIFICATION';
