import type { Prisma } from '@prisma/client';
import { BusinessRuleException } from './exceptions/app.exception';

const PROJECT_ARCHIVED_MESSAGE = 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi';

/**
 * Bộ lọc quan hệ `project` cho truy vấn issue ở đường KHÔNG có người dùng để báo lỗi (webhook, cron): chỉ khớp
 * issue của dự án còn sống và chưa lưu trữ → dự án lưu trữ bị bỏ qua im lặng thay vì ném 422.
 */
export const WRITABLE_PROJECT_FILTER = { deletedAt: null, archivedAt: null } as const;

/** Ném lỗi nếu dự án đã lưu trữ (`archivedAt` đã đọc sẵn cùng truy vấn khác thì dùng hàm này, khỏi query thêm). */
export function assertNotArchived(archivedAt: Date | null | undefined): void {
  if (archivedAt) throw new BusinessRuleException(PROJECT_ARCHIVED_MESSAGE);
}

/**
 * Mọi thay đổi issue/sprint/board phải đi qua kiểm này: dự án đã lưu trữ là chỉ đọc.
 * Nhận `db` để chạy được cả trong transaction của bên gọi.
 */
export async function assertProjectWritable(
  db: Pick<Prisma.TransactionClient, 'project'>,
  projectId: string,
): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { archivedAt: true } });
  assertNotArchived(p?.archivedAt);
}

/** `projectId` tuỳ chọn (mục cấp workspace có thể không gắn dự án) — null/undefined thì bỏ qua. */
export async function assertProjectIdWritable(
  db: Pick<Prisma.TransactionClient, 'project'>,
  projectId: string | null | undefined,
): Promise<void> {
  if (projectId) await assertProjectWritable(db, projectId);
}

/** Như `assertProjectWritable` nhưng từ issue — dùng cho comment/liên kết/đính kèm/checklist… gắn với issue. */
export async function assertIssueWritable(
  db: Pick<Prisma.TransactionClient, 'issue'>,
  issueId: string,
): Promise<void> {
  const i = await db.issue.findUnique({
    where: { id: issueId },
    select: { project: { select: { archivedAt: true } } },
  });
  assertNotArchived(i?.project.archivedAt);
}
