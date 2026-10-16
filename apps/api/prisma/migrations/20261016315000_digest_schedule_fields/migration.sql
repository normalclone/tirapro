-- L20/L21: lịch gửi báo cáo định kỳ theo thứ/giờ/múi giờ + kênh email.
-- Cột có DEFAULT nên digest cũ = "thứ Hai 08:00 giờ Việt Nam" (đúng hành vi 8h sáng thứ Hai trước đây
-- khi máy chủ ở UTC+7). WEEKLY dùng weekday+hour, DAILY chỉ hour; SPRINT_END/MANUAL bỏ qua.
ALTER TABLE "ReportSubscription"
  ADD COLUMN "weekday" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "hour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN "deliverEmail" BOOLEAN NOT NULL DEFAULT false;
