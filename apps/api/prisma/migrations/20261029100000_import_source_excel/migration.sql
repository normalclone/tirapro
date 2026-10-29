-- ADD VALUE chạy được trong transaction (PG ≥ 12) miễn là giá trị mới chưa được dùng ngay trong migration này.
ALTER TYPE "ImportSource" ADD VALUE IF NOT EXISTS 'EXCEL';
