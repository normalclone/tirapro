-- AlterTable: thêm mô tả & màu nhãn cho vai trò (đặc biệt cho custom role)
ALTER TABLE "Role" ADD COLUMN "description" TEXT;
ALTER TABLE "Role" ADD COLUMN "color" TEXT;
