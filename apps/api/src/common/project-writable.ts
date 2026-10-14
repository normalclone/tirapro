import type { Prisma } from '@prisma/client';
import { BusinessRuleException } from './exceptions/app.exception';

export const PROJECT_ARCHIVED_MESSAGE = 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi';

/** Ném lỗi nếu dự án đã lưu trữ (`archivedAt` đã đọc sẵn cùng truy vấn khác thì dùng hàm này, khỏi query thêm). */
export function assertNotArchived(archivedAt: Date | null | undefined): void {
  if (archivedAt) throw new BusinessRuleException(PROJECT_ARCHIVED_MESSAGE);
}

/**
 * Mọi thay đổi issue/sprint/board phải đi qua kiểm này: dự án đã lưu trữ là chỉ đọc.
 * Nhận `db` để chạy được cả trong transaction của bên gọi.
 */
export async function assertProjectWritable(db: Pick<Prisma.TransactionClient, 'project'>, projectId: string): Promise<void> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { archivedAt: true } });
  assertNotArchived(p?.archivedAt);
}
