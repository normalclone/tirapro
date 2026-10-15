import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface TrashItemDto {
  id: string;
  key: string;
  summary: string;
  type: { name: string; color: string | null };
  deletedAt: string;
  deletedBy: { id: string; displayName: string } | null;
}

/** Thùng rác của dự án: danh sách việc đã xoá mềm. Khôi phục dùng `IssuesService.restore` (đã chặn dự án lưu trữ). */
@Injectable()
export class TrashService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, projectId: string): Promise<TrashItemDto[]> {
    // allow-deleted: Thùng rác cố ý đọc việc đã xoá mềm
    const rows = await this.prisma.issue.findMany({
      where: { workspaceId, projectId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        key: true,
        summary: true,
        deletedAt: true,
        updatedById: true,
        type: { select: { name: true, color: true } },
      },
    });
    // `softDelete` ghi `updatedById` = người xoá → dùng làm "Xoá bởi" mà không cần cột mới.
    const userIds = [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => !!x))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = r.updatedById ? byId.get(r.updatedById) : undefined;
      return {
        id: r.id,
        key: r.key,
        summary: r.summary,
        type: { name: r.type.name, color: r.type.color },
        deletedAt: (r.deletedAt as Date).toISOString(),
        deletedBy: u ? { id: u.id, displayName: u.displayName } : null,
      };
    });
  }
}
