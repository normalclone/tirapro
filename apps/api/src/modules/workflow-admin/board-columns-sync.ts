import type { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';

interface ColumnInfo {
  id: string;
  /** Nhóm của các trạng thái đang nằm trong cột (có thể trùng). */
  categories: StatusCategory[];
}

/**
 * Cột nhận trạng thái mới theo NHÓM: cột đầu tiên (theo thứ tự cột) đang chứa trạng thái cùng nhóm — tức cột mặc định
 * To Do / In Progress / Done của bảng. Bảng không có trạng thái nhóm đó: TODO → cột đầu, DONE → cột cuối, IN_PROGRESS →
 * cột liền sau cột đầu (hoặc cột đầu nếu chỉ có một). Cột phải sắp theo `order` tăng dần; rỗng → null.
 */
export function pickColumnForCategory(
  columns: ColumnInfo[],
  category: StatusCategory,
): string | null {
  if (columns.length === 0) return null;
  const same = columns.find((c) => c.categories.includes(category));
  if (same) return same.id;
  if (category === 'TODO') return columns[0]!.id;
  if (category === 'DONE') return columns[columns.length - 1]!.id;
  return (columns[1] ?? columns[0])!.id;
}

/**
 * Sau khi đổi quy trình của một dự án (cấu hình tổ chức / ghi đè): thêm vào MỖI bảng của dự án các trạng thái của quy
 * trình đang dùng mà chưa nằm trong cột nào — để bảng vẫn lưu được (`setColumns` bắt buộc phủ mọi trạng thái) và không
 * thẻ nào biến mất. Không bao giờ gỡ trạng thái cũ khỏi cột. Chạy trong transaction của bên gọi; idempotent.
 */
export async function appendMissingBoardStatuses(
  tx: Prisma.TransactionClient,
  projectId: string,
  workflowIds: string[],
): Promise<{ added: number }> {
  if (workflowIds.length === 0) return { added: 0 };
  const required = await tx.status.findMany({
    where: { workflowId: { in: workflowIds } },
    orderBy: [{ workflowId: 'asc' }, { order: 'asc' }],
    select: { id: true, category: true },
  });
  if (required.length === 0) return { added: 0 };
  const boards = await tx.board.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true,
      columns: {
        orderBy: { order: 'asc' },
        select: { id: true, statuses: { select: { statusId: true } } },
      },
    },
  });
  if (boards.length === 0) return { added: 0 };
  const known = await tx.status.findMany({
    where: {
      id: {
        in: boards.flatMap((b) => b.columns.flatMap((c) => c.statuses.map((s) => s.statusId))),
      },
    },
    select: { id: true, category: true },
  });
  const categoryOf = new Map([...known, ...required].map((s) => [s.id, s.category]));

  let added = 0;
  for (const board of boards) {
    const present = new Set(board.columns.flatMap((c) => c.statuses.map((s) => s.statusId)));
    const columns: ColumnInfo[] = board.columns.map((c) => ({
      id: c.id,
      categories: c.statuses.flatMap((s) => {
        const cat = categoryOf.get(s.statusId);
        return cat ? [cat] : [];
      }),
    }));
    const links: Prisma.BoardColumnStatusCreateManyInput[] = [];
    for (const s of required) {
      if (present.has(s.id)) continue;
      const columnId = pickColumnForCategory(columns, s.category);
      if (columnId) links.push({ columnId, statusId: s.id });
    }
    if (links.length > 0) {
      await tx.boardColumnStatus.createMany({ data: links, skipDuplicates: true });
      added += links.length;
    }
  }
  return { added };
}
