import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import type { CreateProgramInput, UpdateProgramInput } from './programs.schemas';

const PROGRAM_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  color: true,
  startDate: true,
  targetDate: true,
  createdAt: true,
  owner: { select: { id: true, displayName: true, avatarUrl: true } },
  projects: {
    where: { deletedAt: null },
    orderBy: { name: 'asc' as const },
    select: { id: true, key: true, name: true, isArchived: true },
  },
} satisfies Prisma.ProgramSelect;

/** Số liệu tổng hợp cho một dự án hoặc một chương trình. */
export interface RollupStats {
  issueCount: number;
  doneCount: number;
  inProgressCount: number;
  todoCount: number;
  overdueCount: number;
  /** % issue đã ở nhóm trạng thái Hoàn thành (0–100, làm tròn). */
  progressPct: number;
}

export interface RollupProject extends RollupStats {
  id: string;
  key: string;
  name: string;
  isArchived: boolean;
  leadName: string | null;
  /** Khoảng thời gian suy ra từ issue: sớm nhất → hạn muộn nhất. */
  startDate: string | null;
  targetDate: string | null;
}

export interface RollupGroup extends RollupStats {
  /** null = nhóm "Chưa thuộc chương trình". */
  id: string | null;
  name: string;
  color: string | null;
  description: string | null;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** Ngày mục tiêu do người dùng đặt trên chương trình (null với nhóm chưa gán). */
  plannedTargetDate: string | null;
  projectCount: number;
  projects: RollupProject[];
}

const EMPTY_STATS: RollupStats = {
  issueCount: 0,
  doneCount: 0,
  inProgressCount: 0,
  todoCount: 0,
  overdueCount: 0,
  progressPct: 0,
};

const UNASSIGNED_NAME = 'Chưa thuộc chương trình';

/**
 * Chương trình (program / portfolio) — gom nhiều dự án để theo dõi tiến độ ở cấp cao.
 * Xoá chương trình = hard delete; Project.programId tự về null (FK SET NULL).
 */
@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.program.findMany({
      where: { workspaceId },
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
      select: PROGRAM_SELECT,
    });
    return rows.map((p) => this.toDto(p));
  }

  async get(workspaceId: string, id: string) {
    const p = await this.prisma.program.findFirst({ where: { id, workspaceId }, select: PROGRAM_SELECT });
    if (!p) throw new NotFoundAppException('Chương trình');
    return this.toDto(p);
  }

  async create(workspaceId: string, dto: CreateProgramInput) {
    const name = dto.name.trim();
    await this.assertNameFree(workspaceId, name);
    const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
    const created = await this.prisma.program.create({
      data: {
        workspaceId,
        name,
        description: dto.description?.trim() || null,
        color: dto.color ?? null,
        ownerId,
        startDate: toDate(dto.startDate),
        targetDate: toDate(dto.targetDate),
      },
      select: { id: true },
    });
    if (dto.projectIds?.length) await this.setProjects(workspaceId, created.id, dto.projectIds);
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateProgramInput) {
    await this.require(workspaceId, id);
    const data: Prisma.ProgramUpdateInput = {};

    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên chương trình bắt buộc');
      await this.assertNameFree(workspaceId, name, id);
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.color !== undefined) data.color = dto.color ?? null;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate);
    if (dto.targetDate !== undefined) data.targetDate = toDate(dto.targetDate);
    if (dto.ownerId !== undefined) {
      const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }

    await this.prisma.program.update({ where: { id }, data });
    if (dto.projectIds !== undefined) await this.setProjects(workspaceId, id, dto.projectIds);
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.require(workspaceId, id);
    await this.prisma.program.delete({ where: { id } }); // Project.programId → null (FK SET NULL)
    return { success: true };
  }

  /** Đặt lại TOÀN BỘ tập dự án của chương trình: ngoài danh sách → gỡ khỏi chương trình. */
  async setProjects(workspaceId: string, id: string, projectIds: string[]) {
    await this.require(workspaceId, id);
    const ids = [...new Set(projectIds)];
    if (ids.length > 0) {
      const found = await this.prisma.project.findMany({
        where: { id: { in: ids }, workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== ids.length) throw new BusinessRuleException('Một số dự án không thuộc không gian làm việc này — hãy bỏ chọn những dự án đó');
    }
    await this.prisma.$transaction([
      this.prisma.project.updateMany({
        where: { workspaceId, programId: id, ...(ids.length ? { id: { notIn: ids } } : {}) },
        data: { programId: null },
      }),
      ...(ids.length
        ? [this.prisma.project.updateMany({ where: { workspaceId, id: { in: ids } }, data: { programId: id } })]
        : []),
    ]);
    return this.get(workspaceId, id);
  }

  /**
   * Rollup toàn workspace: mỗi chương trình + nhóm "Chưa thuộc chương trình",
   * kèm số liệu issue của từng dự án con (tổng / xong / quá hạn / % tiến độ).
   */
  async rollup(workspaceId: string): Promise<{ groups: RollupGroup[]; totals: RollupStats & { projectCount: number; programCount: number } }> {
    const [programs, projects, statuses] = await Promise.all([
      this.prisma.program.findMany({
        where: { workspaceId },
        orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
        select: {
          id: true, name: true, color: true, description: true, startDate: true, targetDate: true,
          owner: { select: { displayName: true } },
        },
      }),
      this.prisma.project.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true, key: true, name: true, isArchived: true, programId: true,
          lead: { select: { displayName: true } },
        },
      }),
      this.prisma.status.findMany({
        where: { workflow: { workspaceId } },
        select: { id: true, category: true },
      }),
    ]);

    const categoryOf = new Map(statuses.map((s) => [s.id, s.category]));
    const doneStatusIds = statuses.filter((s) => s.category === 'DONE').map((s) => s.id);
    const now = new Date();

    const [byStatus, overdue, spans] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['projectId', 'statusId'],
        where: { workspaceId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['projectId'],
        where: {
          workspaceId,
          deletedAt: null,
          dueDate: { lt: now },
          ...(doneStatusIds.length ? { statusId: { notIn: doneStatusIds } } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['projectId'],
        where: { workspaceId, deletedAt: null },
        _min: { startDate: true },
        _max: { dueDate: true },
      }),
    ]);

    const statsOf = new Map<string, RollupStats>();
    const ensure = (projectId: string): RollupStats => {
      let s = statsOf.get(projectId);
      if (!s) { s = { ...EMPTY_STATS }; statsOf.set(projectId, s); }
      return s;
    };
    for (const row of byStatus) {
      const s = ensure(row.projectId);
      const n = row._count._all;
      s.issueCount += n;
      const cat = categoryOf.get(row.statusId);
      if (cat === 'DONE') s.doneCount += n;
      else if (cat === 'IN_PROGRESS') s.inProgressCount += n;
      else s.todoCount += n;
    }
    for (const row of overdue) ensure(row.projectId).overdueCount += row._count._all;

    const spanOf = new Map(spans.map((r) => [r.projectId, r]));

    const rollupProjects: RollupProject[] = projects.map((p) => {
      const s = statsOf.get(p.id) ?? { ...EMPTY_STATS };
      const span = spanOf.get(p.id);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        isArchived: p.isArchived,
        leadName: p.lead?.displayName ?? null,
        startDate: span?._min.startDate?.toISOString() ?? null,
        targetDate: span?._max.dueDate?.toISOString() ?? null,
        ...s,
        progressPct: pct(s.doneCount, s.issueCount),
      };
    });
    const byProgram = new Map<string | null, RollupProject[]>();
    projects.forEach((p, i) => {
      const key = p.programId ?? null;
      const arr = byProgram.get(key) ?? [];
      arr.push(rollupProjects[i]!);
      byProgram.set(key, arr);
    });

    const groups: RollupGroup[] = programs.map((prog) => {
      const items = byProgram.get(prog.id) ?? [];
      return {
        ...sum(items),
        id: prog.id,
        name: prog.name,
        color: prog.color,
        description: prog.description,
        ownerName: prog.owner?.displayName ?? null,
        startDate: prog.startDate?.toISOString() ?? earliest(items),
        targetDate: prog.targetDate?.toISOString() ?? latest(items),
        plannedTargetDate: prog.targetDate?.toISOString() ?? null,
        projectCount: items.length,
        projects: items,
      };
    });

    const orphans = byProgram.get(null) ?? [];
    if (orphans.length > 0) {
      groups.push({
        ...sum(orphans),
        id: null,
        name: UNASSIGNED_NAME,
        color: null,
        description: null,
        ownerName: null,
        startDate: earliest(orphans),
        targetDate: latest(orphans),
        plannedTargetDate: null,
        projectCount: orphans.length,
        projects: orphans,
      });
    }

    return {
      groups,
      totals: { ...sum(rollupProjects), projectCount: projects.length, programCount: programs.length },
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async require(workspaceId: string, id: string) {
    const p = await this.prisma.program.findFirst({ where: { id, workspaceId }, select: { id: true, name: true } });
    if (!p) throw new NotFoundAppException('Chương trình');
    return p;
  }

  private async assertNameFree(workspaceId: string, name: string, excludeId?: string) {
    const clash = await this.prisma.program.findFirst({
      where: { workspaceId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new BusinessRuleException('Tên chương trình đã tồn tại');
  }

  /** Chủ nhiệm chương trình phải là thành viên workspace. */
  private async resolveOwner(workspaceId: string, ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const m = await this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId: ownerId },
      select: { userId: true },
    });
    if (!m) throw new ForbiddenAppException('Người phụ trách không thuộc không gian làm việc này — hãy chọn một thành viên khác');
    return ownerId;
  }

  private toDto(p: {
    id: string; workspaceId: string; name: string; description: string | null; color: string | null;
    startDate: Date | null; targetDate: Date | null; createdAt: Date;
    owner: { id: string; displayName: string; avatarUrl: string | null } | null;
    projects: { id: string; key: string; name: string; isArchived: boolean }[];
  }) {
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      name: p.name,
      description: p.description,
      color: p.color,
      owner: p.owner,
      startDate: p.startDate?.toISOString() ?? null,
      targetDate: p.targetDate?.toISOString() ?? null,
      projects: p.projects,
      projectCount: p.projects.length,
      createdAt: p.createdAt.toISOString(),
    };
  }
}

function toDate(v: string | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function sum(items: RollupStats[]): RollupStats {
  const acc = { ...EMPTY_STATS };
  for (const it of items) {
    acc.issueCount += it.issueCount;
    acc.doneCount += it.doneCount;
    acc.inProgressCount += it.inProgressCount;
    acc.todoCount += it.todoCount;
    acc.overdueCount += it.overdueCount;
  }
  acc.progressPct = pct(acc.doneCount, acc.issueCount);
  return acc;
}

function earliest(items: { startDate: string | null }[]): string | null {
  const xs = items.map((i) => i.startDate).filter((v): v is string => !!v).sort();
  return xs[0] ?? null;
}

function latest(items: { targetDate: string | null }[]): string | null {
  const xs = items.map((i) => i.targetDate).filter((v): v is string => !!v).sort();
  return xs[xs.length - 1] ?? null;
}
