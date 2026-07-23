-- Bật các extension cần thiết ngay khi Postgres khởi tạo lần đầu.
-- pgvector: semantic search; pg_trgm: fuzzy/full-text; btree_gin: composite GIN index.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
