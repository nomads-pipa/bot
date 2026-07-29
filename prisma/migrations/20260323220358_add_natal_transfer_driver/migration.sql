-- AlterTable
ALTER TABLE "conversation_states" ADD COLUMN     "pickupDatetime" TEXT,
ADD COLUMN     "transferDirection" TEXT;

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "isNatalTransferDriver" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "taxi_rides" ADD COLUMN     "pickupAt" TIMESTAMP(3),
ADD COLUMN     "pickupDatetime" TEXT,
ADD COLUMN     "transferDirection" TEXT;

-- CreateIndex
CREATE INDEX "drivers_isNatalTransferDriver_idx" ON "drivers"("isNatalTransferDriver");
