import type { Prisma } from '@prisma/client';

/** Issue của dự án đã xoá mềm = không tồn tại. Trải vào `where` của Issue: `{ ..., ...LIVE_PROJECT }`. */
export const LIVE_PROJECT: Prisma.IssueWhereInput = { project: { deletedAt: null } };
