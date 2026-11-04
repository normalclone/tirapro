-- Gộp menu "Danh mục" vào các chức năng liên quan.
--   1. Dự án ↔ nhóm dự án (Program) thành nhiều–nhiều: ProjectProgram, chép nguyên Project.programId rồi bỏ cột cũ.
--   2. Mục tiêu / sổ rủi ro (RAID) / chính sách SLA luôn thuộc MỘT dự án: projectId NOT NULL.
--   3. Bỏ khách hàng: Client, Contract, Project.clientId, quyền client:manage.
-- Chạy được trên dữ liệu prod hiện tại (3 nhóm / 8 liên kết; 2 mục tiêu đều có dự án; 0 rủi ro; 0 SLA; 0 khách hàng /
-- hợp đồng). Gặp dữ liệu KHÔNG thuộc các giả định đó thì DỪNG kèm thông báo — không tự xoá hay đoán dự án.

-- ── Chặn sớm, báo rõ (thay cho lỗi "column contains null values" khó hiểu) ──
DO $$
DECLARE
  n_obj  integer;
  n_raid integer;
  n_sla  integer;
  n_cli  integer;
  n_con  integer;
BEGIN
  SELECT count(*) INTO n_obj  FROM "Objective" WHERE "projectId" IS NULL;
  SELECT count(*) INTO n_raid FROM "RaidItem"  WHERE "projectId" IS NULL;
  SELECT count(*) INTO n_sla  FROM "SlaPolicy" WHERE "projectId" IS NULL;
  IF n_obj > 0 OR n_raid > 0 OR n_sla > 0 THEN
    RAISE EXCEPTION 'menu_regroup: còn dữ liệu chưa thuộc dự án nào (mục tiêu: %, rủi ro: %, chính sách SLA: %). Gán dự án hoặc xoá chúng trước khi chạy migration này.', n_obj, n_raid, n_sla;
  END IF;

  SELECT count(*) INTO n_cli FROM "Client";
  SELECT count(*) INTO n_con FROM "Contract";
  IF n_cli > 0 OR n_con > 0 THEN
    RAISE EXCEPTION 'menu_regroup: còn dữ liệu khách hàng (khách hàng: %, hợp đồng: %). Migration này xoá bảng khách hàng/hợp đồng — sao lưu rồi dọn chúng trước khi chạy.', n_cli, n_con;
  END IF;
END $$;

-- ── 1. Dự án ↔ nhóm dự án ──
CREATE TABLE "ProjectProgram" (
    "projectId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,

    CONSTRAINT "ProjectProgram_pkey" PRIMARY KEY ("projectId","programId")
);

CREATE INDEX "ProjectProgram_programId_idx" ON "ProjectProgram"("programId");

ALTER TABLE "ProjectProgram" ADD CONSTRAINT "ProjectProgram_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectProgram" ADD CONSTRAINT "ProjectProgram_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chép MỌI liên kết cũ (kể cả dự án đã lưu trữ / xoá mềm — dữ liệu vẫn giữ như trước).
INSERT INTO "ProjectProgram" ("projectId", "programId")
SELECT "id", "programId" FROM "Project" WHERE "programId" IS NOT NULL;

-- Kiểm: số liên kết mới = số dự án có nhóm cũ.
DO $$
DECLARE
  expected integer;
  actual   integer;
BEGIN
  SELECT count(*) INTO expected FROM "Project" WHERE "programId" IS NOT NULL;
  SELECT count(*) INTO actual   FROM "ProjectProgram";
  IF expected <> actual THEN
    RAISE EXCEPTION 'menu_regroup: chép liên kết dự án–nhóm lệch (cần %, có %).', expected, actual;
  END IF;
END $$;

-- ── 2. projectId bắt buộc ──
ALTER TABLE "Objective" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "RaidItem"  ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "SlaPolicy" ALTER COLUMN "projectId" SET NOT NULL;

-- ── 3. Bỏ khách hàng / hợp đồng và cột nhóm cũ ──
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_clientId_fkey";
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_projectId_fkey";
ALTER TABLE "Client" DROP CONSTRAINT "Client_workspaceId_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_clientId_fkey";
ALTER TABLE "Project" DROP CONSTRAINT "Project_programId_fkey";

ALTER TABLE "Project" DROP COLUMN "clientId",
DROP COLUMN "programId";

DROP TABLE "Contract";
DROP TABLE "Client";

-- Quyền client:manage không còn trong danh mục; vai trò đang giữ nó được gỡ theo (RolePermission xoá theo khoá ngoại).
DELETE FROM "Permission" WHERE "key" = 'client:manage';
