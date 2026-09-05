-- CreateIndex
CREATE INDEX "EcommerceOrderEvent_metadata_idx" ON "EcommerceOrderEvent" USING GIN ("metadata");
