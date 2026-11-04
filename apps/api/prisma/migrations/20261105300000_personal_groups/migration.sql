-- Nhóm dự án là của RIÊNG từng người (chủ nhóm = Program.ownerId): người khác không thấy, không sửa.
-- Nhóm đang có giữ nguyên cho người tạo (ownerId) cùng các liên kết ProjectProgram của nó. Nhóm KHÔNG có chủ
-- (ownerId NULL) không thuộc về ai → xoá (liên kết xoá theo, cascade). Prod: 0 nhóm như vậy.
DELETE FROM "Program" WHERE "ownerId" IS NULL;

ALTER TABLE "Program" DROP CONSTRAINT "Program_ownerId_fkey";
ALTER TABLE "Program" ALTER COLUMN "ownerId" SET NOT NULL;
-- Xoá người dùng thì xoá luôn nhóm riêng của họ (trước đây SET NULL, nay không còn nhóm vô chủ).
ALTER TABLE "Program" ADD CONSTRAINT "Program_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tên nhóm duy nhất theo từng chủ (trong một tổ chức), không còn duy nhất toàn tổ chức.
DROP INDEX "Program_workspaceId_name_key";
CREATE UNIQUE INDEX "Program_workspaceId_ownerId_name_key" ON "Program"("workspaceId", "ownerId", "name");
CREATE INDEX "Program_ownerId_idx" ON "Program"("ownerId");
