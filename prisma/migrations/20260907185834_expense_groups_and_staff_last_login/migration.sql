-- CreateEnum
CREATE TYPE "ExpenseGroup" AS ENUM ('SHIPPING', 'ADS', 'SALARY', 'PURCHASES', 'OTHER');

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "group" "ExpenseGroup" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "StaffMember" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);
