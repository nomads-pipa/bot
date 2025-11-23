-- AlterTable
ALTER TABLE "conversation_states" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completionReason" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Mark all existing conversations as inactive (they're from before we added this tracking)
-- Set completedAt to their last activity time and reason as 'migration'
UPDATE "conversation_states"
SET "isActive" = false,
    "completionReason" = 'migration',
    "completedAt" = "lastActivityAt"
WHERE "isActive" = true;

-- CreateIndex
CREATE INDEX "conversation_states_isActive_idx" ON "conversation_states"("isActive");
