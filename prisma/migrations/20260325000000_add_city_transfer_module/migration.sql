-- CreateTable: transfer_rides (replaces natal_rides, adds city field)
CREATE TABLE "transfer_rides" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "originalMsg" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_rides_pkey" PRIMARY KEY ("id")
);

-- Migrate existing natal_rides data into transfer_rides
INSERT INTO "transfer_rides" ("city", "direction", "datetime", "originalMsg", "userId", "createdAt")
SELECT
    'natal' AS "city",
    CASE
        WHEN "direction" = 'toAirport' THEN 'toCity'
        WHEN "direction" = 'fromAirport' THEN 'fromCity'
        ELSE "direction"
    END AS "direction",
    "datetime",
    "originalMsg",
    "userId",
    "createdAt"
FROM "natal_rides";

-- DropTable
DROP TABLE "natal_rides";

-- CreateIndex
CREATE INDEX "transfer_rides_city_direction_datetime_idx" ON "transfer_rides"("city", "direction", "datetime");

-- CreateIndex
CREATE INDEX "transfer_rides_userId_idx" ON "transfer_rides"("userId");

-- AddForeignKey
ALTER TABLE "transfer_rides" ADD CONSTRAINT "transfer_rides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add new driver flags
ALTER TABLE "drivers" ADD COLUMN "isRecifeTransferDriver" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drivers" ADD COLUMN "isJoaoPessoaTransferDriver" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex for new driver flags
CREATE INDEX "drivers_isRecifeTransferDriver_idx" ON "drivers"("isRecifeTransferDriver");
CREATE INDEX "drivers_isJoaoPessoaTransferDriver_idx" ON "drivers"("isJoaoPessoaTransferDriver");
