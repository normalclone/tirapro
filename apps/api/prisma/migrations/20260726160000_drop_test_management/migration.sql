-- Gỡ module quản lý ca kiểm thử (không nằm trong phạm vi sản phẩm: việc gán/chạy test
-- được thực hiện qua workflow động của issue). Chỉ chứa dữ liệu mẫu nên xoá an toàn.
DROP TABLE IF EXISTS "TestExecution";
DROP TABLE IF EXISTS "TestCaseIssue";
DROP TABLE IF EXISTS "TestRun";
DROP TABLE IF EXISTS "TestCase";
DROP TYPE IF EXISTS "TestResult";
