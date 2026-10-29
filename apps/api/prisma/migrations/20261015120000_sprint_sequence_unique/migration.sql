-- Sprint.sequence phải duy nhất trong từng dự án (trước đây hai request tạo sprint đồng thời
-- có thể cùng tính ra một số thứ tự).
--
-- Bước 1: nếu dữ liệu cũ đã có sprint trùng (projectId, sequence) thì đánh lại số cho các bản
-- trùng (giữ nguyên bản cũ nhất) bằng cách nối tiếp sau số lớn nhất của dự án.
WITH ranked AS (
  SELECT "id", "projectId", "sequence",
         ROW_NUMBER() OVER (PARTITION BY "projectId", "sequence" ORDER BY "createdAt", "id") AS rn
  FROM "Sprint"
), extra AS (
  SELECT "id", "projectId",
         ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "sequence", "id") AS k
  FROM ranked
  WHERE rn > 1
)
UPDATE "Sprint" AS s
SET "sequence" = (SELECT MAX(x."sequence") FROM "Sprint" AS x WHERE x."projectId" = s."projectId") + e.k
FROM extra AS e
WHERE s."id" = e."id";

-- Bước 2: ràng buộc duy nhất.
CREATE UNIQUE INDEX "Sprint_projectId_sequence_key" ON "Sprint"("projectId","sequence");
