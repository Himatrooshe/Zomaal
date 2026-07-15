CREATE TABLE "SenditConnection" (
    "id" TEXT NOT NULL,
    "encryptedPublicKey" TEXT NOT NULL,
    "encryptedSecretKey" TEXT NOT NULL,
    "accountName" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SenditConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SenditConnection_userId_key" ON "SenditConnection"("userId");

ALTER TABLE "SenditConnection" ADD CONSTRAINT "SenditConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
