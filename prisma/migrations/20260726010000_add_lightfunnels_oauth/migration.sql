-- AlterEnum
ALTER TYPE "EcommercePlatform" ADD VALUE 'LIGHTFUNNELS';

-- CreateEnum
CREATE TYPE "LightfunnelsConnectionStatus" AS ENUM (
  'ACTIVE',
  'DISCONNECTED',
  'REAUTHORIZATION_REQUIRED'
);

-- CreateTable
CREATE TABLE "LightfunnelsConnection" (
  "id" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "storeDomain" TEXT,
  "status" "LightfunnelsConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encryptedAccessToken" TEXT,
  "grantedScopes" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "storeId" TEXT NOT NULL,
  "ecommerceConnectionId" TEXT NOT NULL,

  CONSTRAINT "LightfunnelsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LightfunnelsOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "requestedScopes" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,

  CONSTRAINT "LightfunnelsOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LightfunnelsConnection_externalAccountId_key"
  ON "LightfunnelsConnection"("externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LightfunnelsConnection_storeId_key"
  ON "LightfunnelsConnection"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "LightfunnelsConnection_ecommerceConnectionId_key"
  ON "LightfunnelsConnection"("ecommerceConnectionId");

-- CreateIndex
CREATE INDEX "LightfunnelsConnection_status_idx"
  ON "LightfunnelsConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LightfunnelsOAuthState_stateHash_key"
  ON "LightfunnelsOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "LightfunnelsOAuthState_expiresAt_idx"
  ON "LightfunnelsOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "LightfunnelsOAuthState_userId_storeId_idx"
  ON "LightfunnelsOAuthState"("userId", "storeId");

-- AddForeignKey
ALTER TABLE "LightfunnelsConnection"
  ADD CONSTRAINT "LightfunnelsConnection_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightfunnelsConnection"
  ADD CONSTRAINT "LightfunnelsConnection_ecommerceConnectionId_fkey"
  FOREIGN KEY ("ecommerceConnectionId") REFERENCES "EcommerceConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightfunnelsOAuthState"
  ADD CONSTRAINT "LightfunnelsOAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightfunnelsOAuthState"
  ADD CONSTRAINT "LightfunnelsOAuthState_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
