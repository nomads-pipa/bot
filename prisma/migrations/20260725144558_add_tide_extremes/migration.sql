-- CreateTable
CREATE TABLE "tide_extremes" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tide_extremes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tide_extremes_date_idx" ON "tide_extremes"("date");
