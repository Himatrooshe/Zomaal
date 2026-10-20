-- Additive schedule timezone; existing records keep their UTC calendar agreement.
BEGIN;
ALTER TABLE "StaffSalaryProfile" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
COMMIT;
