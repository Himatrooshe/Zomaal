-- CreateEnum
CREATE TYPE "ShopifyConnectionStatus" AS ENUM (
  'ACTIVE',
  'DISCONNECTED',
  'REAUTHORIZATION_REQUIRED'
);

-- CreateTable
CREATE TABLE "ShopifyConnection" (
  "id" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "status" "ShopifyConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encryptedAccessToken" TEXT,
  "encryptedRefreshToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "grantedScopes" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "storeId" TEXT NOT NULL,

  CONSTRAINT "ShopifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,

  CONSTRAINT "ShopifyOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyWebhookReceipt" (
  "webhookId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ShopifyWebhookReceipt_pkey" PRIMARY KEY ("webhookId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyConnection_shopDomain_key"
  ON "ShopifyConnection"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyConnection_storeId_key"
  ON "ShopifyConnection"("storeId");

-- CreateIndex
CREATE INDEX "ShopifyConnection_status_idx"
  ON "ShopifyConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOAuthState_stateHash_key"
  ON "ShopifyOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "ShopifyOAuthState_expiresAt_idx"
  ON "ShopifyOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "ShopifyOAuthState_userId_storeId_idx"
  ON "ShopifyOAuthState"("userId", "storeId");

-- CreateIndex
CREATE INDEX "ShopifyWebhookReceipt_shopDomain_idx"
  ON "ShopifyWebhookReceipt"("shopDomain");

-- CreateIndex
CREATE INDEX "ShopifyWebhookReceipt_processedAt_idx"
  ON "ShopifyWebhookReceipt"("processedAt");

-- AddForeignKey
ALTER TABLE "ShopifyConnection"
  ADD CONSTRAINT "ShopifyConnection_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOAuthState"
  ADD CONSTRAINT "ShopifyOAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOAuthState"
  ADD CONSTRAINT "ShopifyOAuthState_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
