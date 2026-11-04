import type { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';

export interface StatusRef {
  id: string;
  name: string;
  category: StatusCategory;
  /** Có khi nạp từ DB (kế hoạch chuyển) — để biết các quy trình cũ cần ánh xạ cho quy tắc automation. */
  workflowId?: string;
}

const CHUNK = 1000;

/**
 * Chuyển TOÀN BỘ việc khớp `where` đang ở trạng thái `from` sang `to` (đổi quy trình / xoá trạng thái): tăng `version`,
 * ghi MỘT dòng IssueHistory STATUS cho mỗi việc. Vào nhóm DONE thì đặt `resolvedAt` + Resolution (giữ cái đã có, không có thì
 * mặc định); rời DONE thì xoá cả hai — cùng luật với `IssuesService.transition`. Chạy trong transaction của bên gọi.
 *
 * Gồm cả việc ở thùng rác: nếu bỏ sót, khôi phục sau này sẽ trả về một việc trỏ vào trạng thái của quy trình không còn dùng.
 * Không phát sự kiện miền: đây là thay đổi cấu hình hàng loạt, không phải người dùng chuyển từng việc (tránh bão thông báo/
 * automation).
 */
export async function moveIssuesToStatus(
  tx: Prisma.TransactionClient,
  args: {
    where: Prisma.IssueWhereInput;
    from: StatusRef;
    to: StatusRef;
    /** Người sửa việc (`updatedById`). */
    actorId: string;
    /** Người thực hiện ghi vào lịch sử STATUS; mặc định = `actorId`. Chuyển hàng loạt do cấu hình thì truyền người dùng hệ thống. */
    historyActorId?: string;
    defaultResolutionId: string | null;
  },
): Promise<{ count: number; projectIds: string[] }> {
  const { from, to, actorId } = args;
  // allow-deleted: cả việc trong thùng rác phải rời trạng thái của quy trình bị bỏ
  const rows = await tx.issue.findMany({
    where: { ...args.where, statusId: from.id },
    select: { id: true, projectId: true, sprintId: true, resolutionId: true },
  });
  if (rows.length === 0) return { count: 0, projectIds: [] };

  const now = new Date();
  const enteringDone = to.category === 'DONE' && from.category !== 'DONE';
  const leavingDone = to.category !== 'DONE' && from.category === 'DONE';
  const base: Prisma.IssueUncheckedUpdateManyInput = {
    statusId: to.id,
    updatedById: actorId,
    version: { increment: 1 },
  };

  // Mỗi nhóm ghi MỘT câu: việc đã có Resolution giữ nguyên, việc chưa có nhận mặc định khi vào DONE.
  const groups: Array<{ ids: string[]; data: Prisma.IssueUncheckedUpdateManyInput }> = [];
  if (enteringDone) {
    const withRes = rows.filter((r) => r.resolutionId).map((r) => r.id);
    const noRes = rows.filter((r) => !r.resolutionId).map((r) => r.id);
    groups.push({ ids: withRes, data: { ...base, resolvedAt: now } });
    groups.push({
      ids: noRes,
      data: {
        ...base,
        resolvedAt: now,
        ...(args.defaultResolutionId ? { resolutionId: args.defaultResolutionId } : {}),
      },
    });
  } else if (leavingDone) {
    groups.push({
      ids: rows.map((r) => r.id),
      data: { ...base, resolvedAt: null, resolutionId: null },
    });
  } else {
    groups.push({ ids: rows.map((r) => r.id), data: base });
  }
  for (const g of groups)
    for (let i = 0; i < g.ids.length; i += CHUNK)
      await tx.issue.updateMany({ where: { id: { in: g.ids.slice(i, i + CHUNK) } }, data: g.data });

  for (let i = 0; i < rows.length; i += CHUNK)
    await tx.issueHistory.createMany({
      data: rows.slice(i, i + CHUNK).map((r) => ({
        issueId: r.id,
        projectId: r.projectId,
        sprintId: r.sprintId,
        field: 'STATUS' as const,
        oldValue: from.name,
        newValue: to.name,
        oldCategory: from.category,
        newCategory: to.category,
        actorId: args.historyActorId ?? actorId,
        occurredAt: now,
      })),
    });

  return { count: rows.length, projectIds: [...new Set(rows.map((r) => r.projectId))] };
}
