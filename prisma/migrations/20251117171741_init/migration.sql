-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" SERIAL NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxi_rides" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "locationText" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "destination" TEXT,
    "identifier" TEXT,
    "waitTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "feedbackSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "taxi_rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_assignments" (
    "id" SERIAL NOT NULL,
    "rideId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "ride_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "natal_rides" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "originalMsg" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "natal_rides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_jid_key" ON "users"("jid");

-- CreateIndex
CREATE INDEX "users_jid_idx" ON "users"("jid");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_jid_key" ON "drivers"("jid");

-- CreateIndex
CREATE INDEX "drivers_jid_idx" ON "drivers"("jid");

-- CreateIndex
CREATE INDEX "taxi_rides_status_createdAt_idx" ON "taxi_rides"("status", "createdAt");

-- CreateIndex
CREATE INDEX "taxi_rides_userId_idx" ON "taxi_rides"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ride_assignments_rideId_key" ON "ride_assignments"("rideId");

-- CreateIndex
CREATE INDEX "ride_assignments_driverId_idx" ON "ride_assignments"("driverId");

-- CreateIndex
CREATE INDEX "natal_rides_direction_datetime_idx" ON "natal_rides"("direction", "datetime");

-- CreateIndex
CREATE INDEX "natal_rides_userId_idx" ON "natal_rides"("userId");

-- AddForeignKey
ALTER TABLE "taxi_rides" ADD CONSTRAINT "taxi_rides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_assignments" ADD CONSTRAINT "ride_assignments_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "taxi_rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_assignments" ADD CONSTRAINT "ride_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "natal_rides" ADD CONSTRAINT "natal_rides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
