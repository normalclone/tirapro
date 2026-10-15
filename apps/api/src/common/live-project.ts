import type { Prisma } from '@prisma/client';

/** Issue của dự án đã xoá mềm = không tồn tại. Trải vào `where` của Issue: `{ ..., ...LIVE_PROJECT }`. */
export const LIVE_PROJECT: Prisma.IssueWhereInput = { project: { deletedAt: null } };

/**
 * Issue của dự án còn sống VÀ chưa lưu trữ — cho đường chạy nền không có người dùng để báo lỗi (cron quy tắc):
 * dự án lưu trữ bị bỏ qua im lặng thay vì sinh lỗi 422 mỗi phút. (Cùng điều kiện với `WRITABLE_PROJECT_FILTER`.)
 */
export const ACTIVE_PROJECT: Prisma.IssueWhereInput = {
  project: { deletedAt: null, archivedAt: null },
};
