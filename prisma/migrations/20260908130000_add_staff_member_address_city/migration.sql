-- AlterTable: personal address for a staff member (Settings > Edit Profile
-- Address/City), distinct from Store.address/city, which is the store's
-- pickup address and stays owner-only via PUT /stores/me.
ALTER TABLE "StaffMember" ADD COLUMN "address" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "city" TEXT;
