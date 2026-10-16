-- AlterTable: số phiên bản nội dung trang wiki (OCC), chỉ tăng khi sửa tiêu đề/nội dung.
ALTER TABLE "WikiPage" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
