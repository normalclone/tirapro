-- Tiêu chí chấp nhận (Markdown, nullable) — số "đạt" tính từ ô tick, không lưu riêng.
ALTER TABLE "Issue" ADD COLUMN "acceptanceCriteria" TEXT;
