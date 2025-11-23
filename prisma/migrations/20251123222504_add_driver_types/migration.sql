-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "isMotoTaxiDriver" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTaxiDriver" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "drivers_isTaxiDriver_idx" ON "drivers"("isTaxiDriver");

-- CreateIndex
CREATE INDEX "drivers_isMotoTaxiDriver_idx" ON "drivers"("isMotoTaxiDriver");
