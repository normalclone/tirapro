-- AlterTable
ALTER TABLE "KeyResult" ADD COLUMN     "unitLabel" VARCHAR(20);

-- CreateTable
CREATE TABLE "KeyResultCheckIn" (
    "id" TEXT NOT NULL,
    "keyResultId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "note" VARCHAR(500),
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyResultCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyResultCheckIn_keyResultId_createdAt_idx" ON "KeyResultCheckIn"("keyResultId", "createdAt");

-- AddForeignKey
ALTER TABLE "KeyResultCheckIn" ADD CONSTRAINT "KeyResultCheckIn_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "KeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyResultCheckIn" ADD CONSTRAINT "KeyResultCheckIn_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

