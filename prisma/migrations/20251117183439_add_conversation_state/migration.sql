-- CreateTable
CREATE TABLE "conversation_states" (
    "id" SERIAL NOT NULL,
    "userJid" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "language" TEXT,
    "vehicleType" TEXT,
    "skipUserInfo" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "phone" TEXT,
    "locationText" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "destination" TEXT,
    "identifier" TEXT,
    "waitTime" TEXT,
    "rideId" INTEGER,
    "conversationStartedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_states_userJid_key" ON "conversation_states"("userJid");

-- CreateIndex
CREATE INDEX "conversation_states_userJid_idx" ON "conversation_states"("userJid");

-- CreateIndex
CREATE INDEX "conversation_states_lastActivityAt_idx" ON "conversation_states"("lastActivityAt");
