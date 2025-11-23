-- AlterTable
ALTER TABLE "taxi_rides" ADD COLUMN     "retryAttempts" INTEGER NOT NULL DEFAULT 0;
