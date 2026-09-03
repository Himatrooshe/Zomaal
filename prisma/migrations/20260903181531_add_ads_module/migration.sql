-- CreateEnum
CREATE TYPE "AdsPlatform" AS ENUM ('TIKTOK', 'META', 'GOOGLE', 'SNAPCHAT');

-- CreateEnum
CREATE TYPE "AdsConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'REAUTHORIZATION_REQUIRED');

-- CreateTable
CREATE TABLE "AdsConnection" (
    "id" TEXT NOT NULL,
    "platform" "AdsPlatform" NOT NULL,
    "status" "AdsConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalAdvertiserId" TEXT NOT NULL,
    "displayName" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "syncStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "AdsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "platform" "AdsPlatform" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdsOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsCampaign" (
    "id" TEXT NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objective" TEXT,
    "budget" DECIMAL(20,4),
    "currency" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "tracked" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "AdsCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsMetricSnapshot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(20,4) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER,
    "frequency" DECIMAL(10,4),
    "cpm" DECIMAL(20,4),
    "ctr" DECIMAL(10,4),
    "costPerResult" DECIMAL(20,4),
    "conversionRate" DECIMAL(10,4),
    "currency" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,

    CONSTRAINT "AdsMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdsConnection_storeId_platform_idx" ON "AdsConnection"("storeId", "platform");

-- CreateIndex
CREATE INDEX "AdsConnection_platform_status_idx" ON "AdsConnection"("platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdsConnection_storeId_platform_externalAdvertiserId_key" ON "AdsConnection"("storeId", "platform", "externalAdvertiserId");

-- CreateIndex
CREATE UNIQUE INDEX "AdsOAuthState_stateHash_key" ON "AdsOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "AdsOAuthState_storeId_platform_idx" ON "AdsOAuthState"("storeId", "platform");

-- CreateIndex
CREATE INDEX "AdsCampaign_connectionId_tracked_idx" ON "AdsCampaign"("connectionId", "tracked");

-- CreateIndex
CREATE UNIQUE INDEX "AdsCampaign_connectionId_externalCampaignId_key" ON "AdsCampaign"("connectionId", "externalCampaignId");

-- CreateIndex
CREATE INDEX "AdsMetricSnapshot_campaignId_date_idx" ON "AdsMetricSnapshot"("campaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdsMetricSnapshot_campaignId_date_key" ON "AdsMetricSnapshot"("campaignId", "date");

-- AddForeignKey
ALTER TABLE "AdsConnection" ADD CONSTRAINT "AdsConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsCampaign" ADD CONSTRAINT "AdsCampaign_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsMetricSnapshot" ADD CONSTRAINT "AdsMetricSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdsCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
