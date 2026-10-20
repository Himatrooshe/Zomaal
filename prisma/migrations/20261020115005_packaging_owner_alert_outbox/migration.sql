BEGIN;

-- CreateTable
CREATE TABLE "PackagingOwnerAlert" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingOwnerAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackagingOwnerAlert_notificationId_key" ON "PackagingOwnerAlert"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "PackagingOwnerAlert_providerMessageId_key" ON "PackagingOwnerAlert"("providerMessageId");

-- CreateIndex
CREATE INDEX "PackagingOwnerAlert_status_nextAttemptAt_idx" ON "PackagingOwnerAlert"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "PackagingOwnerAlert" ADD CONSTRAINT "PackagingOwnerAlert_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
