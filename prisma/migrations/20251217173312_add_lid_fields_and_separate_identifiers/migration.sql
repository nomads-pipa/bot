-- AlterTable: Add lid field to users and drivers
-- Make jid nullable, add lid with nullable and unique constraints
-- Migrate existing data: move @lid identifiers from jid to lid field

-- Step 1: Add lid column to users table
ALTER TABLE "users" ADD COLUMN "lid" TEXT;

-- Step 2: Add lid column to drivers table
ALTER TABLE "drivers" ADD COLUMN "lid" TEXT;

-- Step 3: Make jid nullable in users table
ALTER TABLE "users" ALTER COLUMN "jid" DROP NOT NULL;

-- Step 4: Make jid nullable in drivers table
ALTER TABLE "drivers" ALTER COLUMN "jid" DROP NOT NULL;

-- Step 5: Migrate existing LID identifiers from jid to lid field for users
-- Move identifiers ending with @lid to the lid field
UPDATE "users"
SET "lid" = "jid", "jid" = NULL
WHERE "jid" LIKE '%@lid';

-- Step 6: Migrate existing LID identifiers from jid to lid field for drivers
-- Move identifiers ending with @lid to the lid field
UPDATE "drivers"
SET "lid" = "jid", "jid" = NULL
WHERE "jid" LIKE '%@lid';

-- Step 7: Add unique constraint on lid for users
CREATE UNIQUE INDEX "users_lid_key" ON "users"("lid");

-- Step 8: Add unique constraint on lid for drivers
CREATE UNIQUE INDEX "drivers_lid_key" ON "drivers"("lid");

-- Step 9: Add unique constraint on cpf for drivers
CREATE UNIQUE INDEX "drivers_cpf_key" ON "drivers"("cpf");

-- Step 10: Add index on lid for users (for faster lookups)
CREATE INDEX "users_lid_idx" ON "users"("lid");

-- Step 11: Add index on lid for drivers (for faster lookups)
CREATE INDEX "drivers_lid_idx" ON "drivers"("lid");
