-- AlterTable: personal profile photo for the store owner (Settings > Edit
-- Profile "Add Your Photo"), distinct from Store.logoUrl (the business logo).
ALTER TABLE "Store" ADD COLUMN "ownerPhotoUrl" TEXT;

-- AlterTable: Store.userId -> User.id was ON DELETE RESTRICT, unlike every
-- other 1:1 user relation in this schema (SenditConnection, etc., all
-- CASCADE). That meant deleting a user who owns a store failed at the FK.
-- Switch it to CASCADE so DELETE /users/me can delete the User row directly
-- and let the store (and everything scoped to it) cascade away with it.
ALTER TABLE "Store" DROP CONSTRAINT "Store_userId_fkey";
ALTER TABLE "Store" ADD CONSTRAINT "Store_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
