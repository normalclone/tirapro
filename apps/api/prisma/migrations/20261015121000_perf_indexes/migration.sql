-- Index phục vụ analytics/sprint dạng aggregate và danh sách theo sprint/người làm/hạn chót.
-- (IssueHistory [projectId, field, occurredAt] đã có từ migration init nên không tạo lại.)
-- CREATE INDEX CONCURRENTLY không chạy được trong transaction của migration → dùng CREATE INDEX thường.
CREATE INDEX IF NOT EXISTS "Issue_projectId_sprintId_rank_idx" ON "Issue"("projectId", "sprintId", "rank");
CREATE INDEX IF NOT EXISTS "Issue_workspaceId_assigneeId_idx" ON "Issue"("workspaceId", "assigneeId");
CREATE INDEX IF NOT EXISTS "Issue_workspaceId_dueDate_idx" ON "Issue"("workspaceId", "dueDate");

-- RefreshToken.tokenHash đã có UNIQUE index nên index thường là thừa (tốn ghi).
DROP INDEX IF EXISTS "RefreshToken_tokenHash_idx";
