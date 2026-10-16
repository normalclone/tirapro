-- Sổ "đã báo ai" của @mention: mỗi (bình luận, người) và mỗi (công việc, người) cho @ ở mô tả chỉ một dòng,
-- để hai tiến trình/sự kiện đồng thời không cùng báo đôi (INSERT ... ON CONFLICT DO NOTHING quyết định ai thắng).

-- Xoá bản trùng hiện có (giữ dòng cũ nhất theo id — cuid tăng dần theo thời gian).
DELETE FROM "Mention" m
USING "Mention" d
WHERE m."commentId" IS NOT NULL
  AND d."commentId" = m."commentId"
  AND d."mentionedUserId" = m."mentionedUserId"
  AND d."id" < m."id";

DELETE FROM "Mention" m
USING "Mention" d
WHERE m."commentId" IS NULL
  AND m."issueId" IS NOT NULL
  AND d."commentId" IS NULL
  AND d."issueId" = m."issueId"
  AND d."mentionedUserId" = m."mentionedUserId"
  AND d."id" < m."id";

-- Bình luận: NULL trong "commentId" luôn khác nhau nên chỉ mục đầy đủ cũng chỉ ràng buộc các dòng của bình luận.
CREATE UNIQUE INDEX "Mention_commentId_mentionedUserId_key" ON "Mention"("commentId", "mentionedUserId");

-- Mô tả công việc: dòng bình luận cũng mang "issueId" nên phải giới hạn ở "commentId" IS NULL.
CREATE UNIQUE INDEX "Mention_issueId_mentionedUserId_desc_key" ON "Mention"("issueId", "mentionedUserId") WHERE "commentId" IS NULL;
