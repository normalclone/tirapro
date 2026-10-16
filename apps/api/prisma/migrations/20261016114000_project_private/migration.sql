-- Dự án riêng tư: chỉ thành viên dự án + quản trị workspace/admin hệ thống thấy.
ALTER TABLE "Project" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Project_workspaceId_isPrivate_idx" ON "Project"("workspaceId", "isPrivate");
