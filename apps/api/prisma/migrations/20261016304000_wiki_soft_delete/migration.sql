-- AlterTable: xoá mềm trang wiki (hai cột nullable → không khoá bảng lâu, không cần backfill).
ALTER TABLE "WikiPage" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "WikiPage_workspaceId_deletedAt_idx" ON "WikiPage"("workspaceId", "deletedAt");
