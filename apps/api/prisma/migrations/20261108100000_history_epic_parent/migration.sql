-- Lịch sử việc: ghi thêm đổi Epic và đổi Việc cha (đổi loại sang Epic gỡ việc khỏi Epic/việc cha — TIRA-BUG-20).
-- ADD VALUE chạy được trong transaction (PG ≥ 12) miễn là giá trị mới chưa được dùng ngay trong migration này.
ALTER TYPE "HistoryField" ADD VALUE IF NOT EXISTS 'EPIC';
ALTER TYPE "HistoryField" ADD VALUE IF NOT EXISTS 'PARENT';
