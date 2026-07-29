-- AlterTable
ALTER TABLE "taxi_rides" ADD COLUMN     "driverRatingRequestSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passengerRatingRequestSent" BOOLEAN NOT NULL DEFAULT false;
