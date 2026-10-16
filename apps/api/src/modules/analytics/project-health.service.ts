import { Injectable } from '@nestjs/common';
import type { ProjectHealthDto } from '@tirapro/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { computeProjectHealth } from './project-health';

/**
 * Sức khoẻ dự án = ghi đè của quản trị dự án (nếu có) hoặc giá trị tự tính từ dữ liệu thật (xem `computeProjectHealth`).
 *
 * `forProjects`: danh sách `projectIds` do NGƯỜI GỌI đã lọc theo quyền xem (Tổng quan/Danh mục); hàm ràng mọi truy vấn
 * vào `projectId IN (ids)` và vào đúng workspace. Có `viewerId` thì lọc thêm một lớp phòng thủ theo ProjectAccessService:
 * dự án người đó không thấy KHÔNG có trong kết quả (không lộ tiêu đề RAID ở `reasons`, ghi chú ghi đè của PM, v.v.).
 * Số truy vấn cố định theo kích thước lô (không N+1): dự án, 3 groupBy việc theo dự án, sprint đang chạy,
 * 2 groupBy điểm theo sprint, rủi ro RAID mở.
 */
@Injectable()
export class ProjectHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async forProjects(
    workspaceId: string,
    projectIds: string[],
    viewerId?: string,
  ): Promise<Map<string, ProjectHealthDto>> {
    const out = new Map<string, ProjectHealthDto>();
    if (projectIds.length === 0) return out;
    const now = new Date();
    const visible = viewerId ? await this.access.visibleWhere(viewerId, workspaceId) : {};

    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds }, workspaceId, deletedAt: null, ...visible },
      select: {
        id: true,
        createdAt: true,
        healthOverride: true,
        healthNote: true,
        healthUpdatedAt: true,
        healthUpdatedBy: { select: { id: true, displayName: true } },
      },
    });
    if (projects.length === 0) return out;
    const ids = projects.map((p) => p.id);

    const live: Prisma.IssueWhereInput = { projectId: { in: ids }, deletedAt: null };
    const notDone: Prisma.IssueWhereInput = { status: { category: { not: 'DONE' } } };
    const [totalGroups, openGroups, overdueGroups, activeSprints, risks] = await Promise.all([
      // Tổng việc + lần hoàn tất gần nhất (`_max resolvedAt` bỏ qua NULL).
      this.prisma.issue.groupBy({
        by: ['projectId'],
        where: live,
        _count: { _all: true },
        _max: { resolvedAt: true },
      }),
      this.prisma.issue.groupBy({
        by: ['projectId'],
        where: { ...live, ...notDone },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['projectId'],
        where: { ...live, ...notDone, dueDate: { lt: now } },
        _count: { _all: true },
      }),
      this.prisma.sprint.findMany({
        where: { projectId: { in: ids }, state: 'ACTIVE', deletedAt: null },
        select: { id: true, projectId: true, name: true, endDate: true, sequence: true },
        orderBy: { sequence: 'desc' },
      }),
      this.prisma.raidItem.findMany({
        // Chỉ loại Risk: Giả định/Vấn đề/Phụ thuộc cũng có điểm xác suất×ảnh hưởng nhưng không phải "rủi ro".
        where: { workspaceId, kind: 'RISK', status: 'OPEN', projectId: { in: ids } },
        select: { projectId: true, title: true, probability: true, impact: true },
      }),
    ]);

    // Sprint đang chạy mỗi dự án (sequence cao nhất nếu lỡ có >1) + điểm cam kết / còn lại của nó.
    const sprintOf = new Map<string, (typeof activeSprints)[number]>();
    for (const s of activeSprints) if (!sprintOf.has(s.projectId)) sprintOf.set(s.projectId, s);
    const sprintIds = [...sprintOf.values()].map((s) => s.id);
    const [sprintAll, sprintOpen] = sprintIds.length
      ? await Promise.all([
          this.prisma.issue.groupBy({
            by: ['sprintId'],
            where: { sprintId: { in: sprintIds }, deletedAt: null },
            _sum: { storyPoints: true },
          }),
          this.prisma.issue.groupBy({
            by: ['sprintId'],
            where: { sprintId: { in: sprintIds }, deletedAt: null, ...notDone },
            _sum: { storyPoints: true },
          }),
        ])
      : [[], []];

    const countOf = <T extends { projectId: string; _count: { _all: number } }>(rows: T[]) =>
      new Map(rows.map((r) => [r.projectId, r._count._all]));
    const total = countOf(totalGroups);
    const open = countOf(openGroups);
    const overdue = countOf(overdueGroups);
    const lastResolved = new Map(totalGroups.map((g) => [g.projectId, g._max.resolvedAt]));
    const pointsOf = (
      rows: Array<{ sprintId: string | null; _sum: { storyPoints: number | null } }>,
    ) => new Map(rows.map((r) => [r.sprintId, r._sum.storyPoints ?? 0]));
    const committedBySprint = pointsOf(sprintAll);
    const remainingBySprint = pointsOf(sprintOpen);
    const risksOf = new Map<
      string,
      Array<{ title: string; probability: number; impact: number }>
    >();
    for (const r of risks) {
      if (!r.projectId) continue;
      const arr = risksOf.get(r.projectId) ?? [];
      arr.push({ title: r.title, probability: r.probability, impact: r.impact });
      risksOf.set(r.projectId, arr);
    }

    for (const p of projects) {
      const sprint = sprintOf.get(p.id);
      const auto = computeProjectHealth({
        total: total.get(p.id) ?? 0,
        open: open.get(p.id) ?? 0,
        overdue: overdue.get(p.id) ?? 0,
        activeSprint: sprint
          ? {
              name: sprint.name,
              endDate: sprint.endDate,
              committedPoints: committedBySprint.get(sprint.id) ?? 0,
              remainingPoints: remainingBySprint.get(sprint.id) ?? 0,
            }
          : null,
        openRisks: risksOf.get(p.id) ?? [],
        lastResolvedAt: lastResolved.get(p.id) ?? null,
        now,
        createdAt: p.createdAt,
      });
      const override = p.healthOverride
        ? {
            level: p.healthOverride,
            note: p.healthNote ?? '',
            updatedAt: (p.healthUpdatedAt ?? now).toISOString(),
            updatedBy: p.healthUpdatedBy,
          }
        : null;
      out.set(p.id, { level: override?.level ?? auto.level, auto, override });
    }
    return out;
  }
}
