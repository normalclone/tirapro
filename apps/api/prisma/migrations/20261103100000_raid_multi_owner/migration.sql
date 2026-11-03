-- RAID: nhiều người phụ trách (logbug #27). `RaidItem.ownerId` giữ làm người phụ trách chính.

-- CreateTable
CREATE TABLE "RaidOwner" (
    "raidItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidOwner_pkey" PRIMARY KEY ("raidItemId","userId")
);

-- CreateIndex
CREATE INDEX "RaidOwner_userId_idx" ON "RaidOwner"("userId");

-- AddForeignKey
ALTER TABLE "RaidOwner" ADD CONSTRAINT "RaidOwner_raidItemId_fkey" FOREIGN KEY ("raidItemId") REFERENCES "RaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidOwner" ADD CONSTRAINT "RaidOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chuyển người phụ trách đơn hiện có sang bảng nhiều–nhiều (giữ nguyên ownerId).
INSERT INTO "RaidOwner" ("raidItemId", "userId")
SELECT "id", "ownerId" FROM "RaidItem" WHERE "ownerId" IS NOT NULL
ON CONFLICT DO NOTHING;
