-- Lưu trữ dự án: archivedAt là nguồn sự thật (isArchived giữ lại để các báo cáo cũ vẫn đọc được, luôn ghi đồng bộ).
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Dự án đã đánh dấu lưu trữ từ trước: lấy lần sửa cuối làm mốc lưu trữ.
UPDATE "Project" SET "archivedAt" = "updatedAt" WHERE "isArchived" = true;

CREATE INDEX "Project_workspaceId_archivedAt_idx" ON "Project"("workspaceId", "archivedAt");
