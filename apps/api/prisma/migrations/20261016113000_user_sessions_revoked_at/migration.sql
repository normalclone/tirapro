-- Mốc thu hồi phiên: access token cấp trước mốc này bị từ chối ngay (không chờ hết hạn 15 phút).
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
