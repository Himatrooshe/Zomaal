CREATE TABLE "QuickLivraisonConnection" (
    "id" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QuickLivraisonConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuickLivraisonConnection_userId_key"
ON "QuickLivraisonConnection"("userId");

ALTER TABLE "QuickLivraisonConnection"
ADD CONSTRAINT "QuickLivraisonConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
