-- CreateTable: SuperAdmin — the single platform-level operator identity for
-- the Zomaal Shop admin panel. Separate from "User" (always a phone+OTP
-- merchant). Upserted at boot from SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD.
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "hashedRefreshToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuperAdmin_username_key" ON "SuperAdmin"("username");
