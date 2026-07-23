-- ============================================================================
-- Raw SQL chạy SAU `prisma migrate` (qua `prisma db execute`).
-- Idempotent: dùng IF NOT EXISTS để rerun an toàn.
-- Thêm: full-text search (tsvector generated) + semantic search (pgvector).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ---------- Full-text search trên Issue ----------
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("summary", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
    to_tsvector('simple', coalesce("key", ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS issue_search_gin   ON "Issue" USING gin ("searchVector");
CREATE INDEX IF NOT EXISTS issue_summary_trgm ON "Issue" USING gin ("summary" gin_trgm_ops);

-- ---------- Semantic search trên IssueEmbedding ----------
-- Dimension mặc định 1024 (voyage-3). Đổi EMBEDDING_DIM => sửa số này + reindex.
ALTER TABLE "IssueEmbedding" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

CREATE INDEX IF NOT EXISTS issue_embedding_hnsw
  ON "IssueEmbedding" USING hnsw ("embedding" vector_cosine_ops);

-- ---------- Partial indexes (Prisma không hỗ trợ WHERE) — nhỏ, cache tốt ----------
-- Điều kiện sống còn: soft-delete extension PHẢI luôn thêm "deletedAt" IS NULL để planner dùng được.
CREATE INDEX IF NOT EXISTS issue_ws_status_active
  ON "Issue" ("workspaceId", "statusId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS issue_triage_pending
  ON "Issue" ("workspaceId", "projectId") WHERE "triageState" = 'PENDING'::"TriageState";
CREATE INDEX IF NOT EXISTS notif_unread
  ON "Notification" ("recipientId", "createdAt") WHERE "readAt" IS NULL;

-- ---------- Covering index cho board/backlog list (index-only scan) ----------
CREATE INDEX IF NOT EXISTS issue_board_covering
  ON "Issue" ("workspaceId", "projectId", "statusId")
  INCLUDE ("key", "summary", "assigneeId", "priorityId", "rank")
  WHERE "deletedAt" IS NULL;

-- ---------- Autovacuum / fillfactor tuning per-table ----------
ALTER TABLE "Issue"        SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE "IssueHistory" SET (autovacuum_vacuum_insert_scale_factor = 0.02);
ALTER TABLE "ActivityLog"  SET (autovacuum_vacuum_insert_scale_factor = 0.02);
ALTER TABLE "Notification" SET (autovacuum_vacuum_insert_scale_factor = 0.05);
