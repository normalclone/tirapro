-- Hạn bắt buộc: điền hạn cho việc cũ chưa có (idempotent — chỉ động vào dòng dueDate IS NULL, chạy lại không đổi gì).
-- dueDate là NGÀY LỊCH lưu 00:00 UTC (kiểu TIMESTAMP không múi giờ). Ngày lấy theo lịch Việt Nam (Asia/Ho_Chi_Minh).
-- Cột timestamp lưu giờ UTC nên phải "AT TIME ZONE 'UTC'" (gán là UTC) rồi mới "AT TIME ZONE 'Asia/Ho_Chi_Minh'" (đổi sang giờ VN).
-- Cột vẫn NULLABLE (nhập dữ liệu cũ không vỡ ở mức DB); quy tắc bắt buộc nằm ở service.

-- Chưa xong (nhóm trạng thái khác DONE): hạn = ngày triển khai (hôm nay giờ VN) + 1.
UPDATE "Issue" i
SET "dueDate" = ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1)::timestamp
FROM "Status" s
WHERE i."statusId" = s."id"
  AND i."dueDate" IS NULL
  AND s."category" <> 'DONE';

-- Đã xong: hạn = ngày kết thúc (resolvedAt, thiếu thì updatedAt) theo giờ VN. Có thể sớm hơn ngày tạo — chấp nhận (dữ liệu lịch sử).
UPDATE "Issue" i
SET "dueDate" = ((COALESCE(i."resolvedAt", i."updatedAt") AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp
FROM "Status" s
WHERE i."statusId" = s."id"
  AND i."dueDate" IS NULL
  AND s."category" = 'DONE';
