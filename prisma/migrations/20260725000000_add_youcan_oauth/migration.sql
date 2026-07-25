-- AlterEnum
ALTER TYPE "EcommercePlatform" ADD VALUE 'YOUCAN';

-- CreateEnum
CREATE TYPE "YouCanConnectionStatus" AS ENUM (
  'ACTIVE',
  'DISCONNECTED',
  'REAUTHORIZATION_REQUIRED'
);

-- CreateTable
CREATE TABLE "YouCanConnection" (
  "id" TEXT NOT NULL,
  "externalStoreId" TEXT NOT NULL,
  "storeDomain" TEXT,
  "displayName" TEXT,
  "status" "YouCanConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encryptedAccessToken" TEXT,
  "encryptedRefreshToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
  "grantedScopes" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "storeId" TEXT NOT NULL,
  "ecommerceConnectionId" TEXT NOT NULL,

  CONSTRAINT "YouCanConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouCanOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "requestedScopes" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,

  CONSTRAINT "YouCanOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouCanConnection_externalStoreId_key"
  ON "YouCanConnection"("externalStoreId");

CREATE UNIQUE INDEX "YouCanConnection_storeId_key"
  ON "YouCanConnection"("storeId");

CREATE UNIQUE INDEX "YouCanConnection_ecommerceConnectionId_key"
  ON "YouCanConnection"("ecommerceConnectionId");

CREATE INDEX "YouCanConnection_status_idx"
  ON "YouCanConnection"("status");

CREATE UNIQUE INDEX "YouCanOAuthState_stateHash_key"
  ON "YouCanOAuthState"("stateHash");

CREATE INDEX "YouCanOAuthState_expiresAt_idx"
  ON "YouCanOAuthState"("expiresAt");

CREATE INDEX "YouCanOAuthState_userId_storeId_idx"
  ON "YouCanOAuthState"("userId", "storeId");

-- AddForeignKey
ALTER TABLE "YouCanConnection"
  ADD CONSTRAINT "YouCanConnection_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "YouCanConnection"
  ADD CONSTRAINT "YouCanConnection_ecommerceConnectionId_fkey"
  FOREIGN KEY ("ecommerceConnectionId") REFERENCES "EcommerceConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "YouCanOAuthState"
  ADD CONSTRAINT "YouCanOAuthState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "YouCanOAuthState"
  ADD CONSTRAINT "YouCanOAuthState_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
