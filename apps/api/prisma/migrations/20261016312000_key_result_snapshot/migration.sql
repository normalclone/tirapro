-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "KeyResultCheckIn" ADD COLUMN     "snapshotDate" DATE,
ADD COLUMN     "source" "CheckInSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE UNIQUE INDEX "KeyResultCheckIn_keyResultId_snapshotDate_key" ON "KeyResultCheckIn"("keyResultId", "snapshotDate");

