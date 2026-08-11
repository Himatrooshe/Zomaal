ALTER TABLE "EcommerceConnection"
  ADD COLUMN "productCount" INTEGER,
  ADD COLUMN "customerCount" INTEGER,
  ADD COLUMN "metricsSyncedAt" TIMESTAMP(3),
  ADD COLUMN "lastMetricsError" TEXT;
