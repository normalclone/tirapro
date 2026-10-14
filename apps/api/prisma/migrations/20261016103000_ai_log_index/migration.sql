-- Truy vấn dùng AI theo workspace + khoảng thời gian (không lọc feature) cần index riêng.
CREATE INDEX IF NOT EXISTS "AiGenerationLog_workspaceId_createdAt_idx" ON "AiGenerationLog"("workspaceId", "createdAt");
