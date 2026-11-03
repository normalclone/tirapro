-- Phiên đăng nhập nhớ workspace đang mở (chuyển workspace rồi tải lại trang không bị về workspace đầu tiên).
ALTER TABLE "RefreshToken" ADD COLUMN "workspaceId" TEXT;
