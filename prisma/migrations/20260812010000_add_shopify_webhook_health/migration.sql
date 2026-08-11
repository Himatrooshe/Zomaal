ALTER TABLE "ShopifyConnection"
ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN "lastWebhookError" TEXT;
