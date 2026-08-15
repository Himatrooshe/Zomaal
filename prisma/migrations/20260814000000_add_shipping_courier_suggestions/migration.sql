CREATE TABLE "ShippingCourierSuggestion" (
  "id" TEXT NOT NULL,
  "courierName" TEXT NOT NULL,
  "website" TEXT,
  "countryCode" TEXT NOT NULL,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "ShippingCourierSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShippingCourierSuggestion_userId_createdAt_idx"
  ON "ShippingCourierSuggestion"("userId", "createdAt");
CREATE INDEX "ShippingCourierSuggestion_status_createdAt_idx"
  ON "ShippingCourierSuggestion"("status", "createdAt");
CREATE INDEX "ShippingCourierSuggestion_countryCode_createdAt_idx"
  ON "ShippingCourierSuggestion"("countryCode", "createdAt");

ALTER TABLE "ShippingCourierSuggestion"
  ADD CONSTRAINT "ShippingCourierSuggestion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
