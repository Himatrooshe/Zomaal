-- Every Staff list/details screen needs a display name; the User model only
-- carries `phone` (the login identifier). Backfill existing rows with a
-- placeholder so the column can be NOT NULL, then drop the default so future
-- inserts must supply a real name.
ALTER TABLE "StaffMember" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Unnamed Staff';
ALTER TABLE "StaffMember" ALTER COLUMN "name" DROP DEFAULT;
