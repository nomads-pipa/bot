-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "reputation" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "taxi_rides" ADD COLUMN     "ratingDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "ratingRequestSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reputation" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ratings" (
    "id" SERIAL NOT NULL,
    "rideId" INTEGER NOT NULL,
    "raterType" TEXT NOT NULL,
    "raterUserId" INTEGER,
    "raterDriverId" INTEGER,
    "rateeType" TEXT NOT NULL,
    "rateeUserId" INTEGER,
    "rateeDriverId" INTEGER,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ratings_rideId_idx" ON "ratings"("rideId");

-- CreateIndex
CREATE INDEX "ratings_raterUserId_idx" ON "ratings"("raterUserId");

-- CreateIndex
CREATE INDEX "ratings_raterDriverId_idx" ON "ratings"("raterDriverId");

-- CreateIndex
CREATE INDEX "ratings_rateeUserId_idx" ON "ratings"("rateeUserId");

-- CreateIndex
CREATE INDEX "ratings_rateeDriverId_idx" ON "ratings"("rateeDriverId");

-- CreateIndex
CREATE INDEX "taxi_rides_ratingRequestSentAt_idx" ON "taxi_rides"("ratingRequestSentAt");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "taxi_rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_raterUserId_fkey" FOREIGN KEY ("raterUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_raterDriverId_fkey" FOREIGN KEY ("raterDriverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rateeUserId_fkey" FOREIGN KEY ("rateeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rateeDriverId_fkey" FOREIGN KEY ("rateeDriverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
