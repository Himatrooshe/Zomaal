-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'REAUTHORIZATION_REQUIRED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WhatsAppBalanceEntryType" AS ENUM ('TOP_UP', 'MESSAGE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "encryptedAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "encryptedRegistrationPin" TEXT,
    "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "trigger" "ShippingShipmentStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "metaTemplateId" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppStatusSetting" (
    "id" TEXT NOT NULL,
    "trigger" "ShippingShipmentStatus" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "WhatsAppStatusSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "trigger" "ShippingShipmentStatus" NOT NULL,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sendAfter" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "cost" DECIMAL(20,4),
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppBalanceEntry" (
    "id" TEXT NOT NULL,
    "type" "WhatsAppBalanceEntryType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storeId" TEXT NOT NULL,
    "messageId" TEXT,

    CONSTRAINT "WhatsAppBalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppPricing" (
    "currency" TEXT NOT NULL,
    "pricePerMessage" DECIMAL(20,4) NOT NULL,
    "updatedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppPricing_pkey" PRIMARY KEY ("currency")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_storeId_key" ON "WhatsAppConnection"("storeId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_phoneNumberId_idx" ON "WhatsAppConnection"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_wabaId_idx" ON "WhatsAppConnection"("wabaId");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_metaTemplateId_idx" ON "WhatsAppTemplate"("metaTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_storeId_name_language_key" ON "WhatsAppTemplate"("storeId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppStatusSetting_storeId_trigger_key" ON "WhatsAppStatusSetting"("storeId", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_sendAfter_idx" ON "WhatsAppMessage"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_storeId_createdAt_idx" ON "WhatsAppMessage"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_storeId_status_createdAt_idx" ON "WhatsAppMessage"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_storeId_idempotencyKey_key" ON "WhatsAppMessage"("storeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppBalanceEntry_storeId_createdAt_idx" ON "WhatsAppBalanceEntry"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppBalanceEntry_storeId_idempotencyKey_key" ON "WhatsAppBalanceEntry"("storeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppStatusSetting" ADD CONSTRAINT "WhatsAppStatusSetting_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EcommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppBalanceEntry" ADD CONSTRAINT "WhatsAppBalanceEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

