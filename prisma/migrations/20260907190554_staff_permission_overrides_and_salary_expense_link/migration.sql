-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "staffMemberId" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN     "permissionOverrides" TEXT[];

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
