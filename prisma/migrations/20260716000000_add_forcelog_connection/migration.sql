CREATE TABLE "ForceLogConnection" (
    "id" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ForceLogConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForceLogConnection_userId_key"
ON "ForceLogConnection"("userId");

ALTER TABLE "ForceLogConnection"
ADD CONSTRAINT "ForceLogConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
