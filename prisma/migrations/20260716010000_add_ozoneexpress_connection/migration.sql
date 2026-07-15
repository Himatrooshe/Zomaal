CREATE TABLE "OzoneExpressConnection" (
    "id" TEXT NOT NULL,
    "encryptedCustomerId" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "OzoneExpressConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OzoneExpressConnection_userId_key"
ON "OzoneExpressConnection"("userId");

ALTER TABLE "OzoneExpressConnection"
ADD CONSTRAINT "OzoneExpressConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
