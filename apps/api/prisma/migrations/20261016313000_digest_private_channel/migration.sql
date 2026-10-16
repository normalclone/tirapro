-- L19 (review vòng 1, I3): digest gắn dự án RIÊNG TƯ chỉ được gửi vào kênh chung (nhóm Telegram) khi người tạo/sửa
-- bật tường minh cờ này (đã cảnh báo trong form). Mặc định false = không gửi kênh (chỉ email theo quyền từng người).
ALTER TABLE "ReportSubscription" ADD COLUMN "allowPrivateToChannel" BOOLEAN NOT NULL DEFAULT false;
