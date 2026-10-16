-- ============================================================================
-- Raw SQL chạy SAU `prisma migrate` (qua `prisma db execute`).
-- Idempotent: dùng IF NOT EXISTS để rerun an toàn.
-- Thêm: full-text search (tsvector generated) + semantic search (pgvector).
-- ============================================================================

-- Tuần tự hoá `db:raw`: hai instance khởi động cùng lúc (rolling deploy, --scale, k8s) sẽ đụng nhau ở
-- CREATE OR REPLACE FUNCTION ("tuple concurrently updated") và ở bước DROP/ADD cột. Khoá advisory theo transaction:
-- `prisma db execute` chạy cả file trong MỘT transaction ngầm nên khoá giữ đến hết file rồi tự nhả; bên đến sau
-- chờ, rồi thấy mọi thứ đã có → chạy như no-op.
SELECT pg_advisory_xact_lock(hashtext('tirapro:db:raw'));

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ---------- Full-text search trên Issue ----------
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() chỉ STABLE → bọc IMMUTABLE để dùng được trong cột sinh và chỉ mục biểu thức.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- searchVector bản cũ (không bỏ dấu, có "key") → bỏ để tạo lại bản mới. Chỉ chạy khi biểu thức cũ còn tồn tại
-- (idempotent: lần sau biểu thức đã chứa immutable_unaccent). CẢNH BÁO: khoá ACCESS EXCLUSIVE bảng "Issue" và
-- ghi lại toàn bộ hàng một lần lúc deploy.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO def
  FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = '"Issue"'::regclass AND a.attname = 'searchVector' AND NOT a.attisdropped;
  IF def IS NOT NULL AND position('immutable_unaccent' IN def) = 0 THEN
    ALTER TABLE "Issue" DROP COLUMN "searchVector";   -- kéo theo issue_search_gin
  END IF;
END $$;

-- Bỏ dấu + KHÔNG chứa "key" (mã issue khớp bằng ILIKE/trigram, tránh "số 37" khớp DEMO-TASK-37).
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("summary", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("description", ''))), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS issue_search_gin   ON "Issue" USING gin ("searchVector");
CREATE INDEX IF NOT EXISTS issue_summary_trgm ON "Issue" USING gin ("summary" gin_trgm_ops);
-- ILIKE '%…%' trên description/key (JQL `text ~`, Cmd+K) — không có index này là quét tuần tự.
CREATE INDEX IF NOT EXISTS issue_description_trgm ON "Issue" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS issue_key_trgm ON "Issue" USING gin ("key" gin_trgm_ops);
-- Khớp một phần từ + typo (toán tử <%) theo biểu thức đã bỏ dấu; chỉ mục thô ở trên giữ cho Prisma `contains`.
CREATE INDEX IF NOT EXISTS issue_summary_unaccent_trgm
  ON "Issue" USING gin (lower(immutable_unaccent("summary")) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS issue_description_unaccent_trgm
  ON "Issue" USING gin (lower(immutable_unaccent("description")) gin_trgm_ops);

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
