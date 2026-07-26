import { Injectable } from '@nestjs/common';
import type { KeyResultUnit, ObjectiveStatus, Prisma, StatusCategory } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type {
  CreateGoalInput,
  CreateKeyResultInput,
  KeyResultUpsertInput,
  UpdateGoalInput,
  UpdateKeyResultInput,
} from './goals.schemas';

const OWNER_SELECT = { id: true, displayName: true, email: true, avatarUrl: true } as const;

const OBJECTIVE_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  name: true,
  description: true,
  period: true,
  status: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: OWNER_SELECT },
  project: { select: { id: true, key: true, name: true } },
  keyResults: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true, name: true, unit: true, startValue: true, targetValue: true, currentValue: true,
    },
  },
  issues: {
    where: { issue: { deletedAt: null } },
    select: {
      issue: {
        select: {
          id: true, key: true, summary: true,
          type: { select: { name: true, color: true } },
          status: { select: { name: true, category: true, color: true } },
        },
      },
    },
  },
} satisfies Prisma.ObjectiveSelect;

type ObjectiveRow = Prisma.ObjectiveGetPayload<{ select: typeof OBJECTIVE_SELECT }>;

interface GoalListFilter {
  period?: string;
  projectId?: string;
  status?: string;
  ownerId?: string;
}

/** Kẹp về [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * MỤC TIÊU / OKR — Objective + KeyResult + issue gắn kèm.
 *
 * Tiến độ (`progress`) tính theo trung bình % của các Key Result:
 * `(current - start) / (target - start)`, kẹp trong [0,1]. Nếu mục tiêu có gắn
 * issue/epic thì kèm thêm `issueProgress` = % issue đã ở trạng thái DONE.
 * Mục tiêu chưa có KR nào thì lấy luôn `issueProgress` làm tiến độ chính.
 */
@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, filter: GoalListFilter) {
    const where: Prisma.ObjectiveWhereInput = { workspaceId };
    if (filter.period) where.period = filter.period;
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.status) where.status = filter.status as ObjectiveStatus;
    if (filter.ownerId) where.ownerId = filter.ownerId;

    const rows = await this.prisma.objective.findMany({
      where,
      orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
      select: OBJECTIVE_SELECT,
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Các kỳ đã dùng (mới nhất trước) — để FE dựng bộ chọn kỳ mà không cần tải hết mục tiêu. */
  async periods(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.objective.findMany({
      where: { workspaceId },
      distinct: ['period'],
      orderBy: { period: 'desc' },
      select: { period: true },
    });
    return rows.map((r) => r.period);
  }

  async get(workspaceId: string, id: string) {
    const row = await this.prisma.objective.findFirst({ where: { id, workspaceId }, select: OBJECTIVE_SELECT });
    if (!row) throw new NotFoundAppException('Mục tiêu');
    return this.toDto(row);
  }

  async create(workspaceId: string, dto: CreateGoalInput) {
    const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
    const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
    const issueIds = dto.issueIds?.length ? await this.validateIssues(workspaceId, dto.issueIds, projectId) : [];

    const created = await this.prisma.objective.create({
      data: {
        workspaceId,
        projectId,
        ownerId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        period: dto.period.trim(),
        status: (dto.status ?? 'ACTIVE') as ObjectiveStatus,
        keyResults: { create: (dto.keyResults ?? []).map((kr) => this.krCreateData(kr)) },
        issues: { create: issueIds.map((issueId) => ({ issueId })) },
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateGoalInput) {
    const current = await this.requireObjective(workspaceId, id);
    const data: Prisma.ObjectiveUpdateInput = {};

    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên mục tiêu bắt buộc');
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.period !== undefined && dto.period !== null) {
      const period = dto.period.trim();
      if (!period) throw new ForbiddenAppException('Kỳ bắt buộc');
      data.period = period;
    }
    if (dto.status !== undefined && dto.status !== null) data.status = dto.status as ObjectiveStatus;
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null);
      data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
    }
    if (dto.ownerId !== undefined) {
      const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.objective.update({ where: { id }, data })];

    // Danh sách KR gửi lên = danh sách MỚI: có id → update, không id → create, thiếu → xoá.
    if (dto.keyResults !== undefined) {
      const existing = await this.prisma.keyResult.findMany({ where: { objectiveId: id }, select: { id: true } });
      const keptIds = new Set(dto.keyResults.map((kr) => kr.id).filter((v): v is string => !!v));
      const removed = existing.filter((kr) => !keptIds.has(kr.id)).map((kr) => kr.id);
      if (removed.length) ops.push(this.prisma.keyResult.deleteMany({ where: { id: { in: removed }, objectiveId: id } }));
      for (const kr of dto.keyResults) {
        if (kr.id && existing.some((e) => e.id === kr.id)) {
          ops.push(this.prisma.keyResult.update({ where: { id: kr.id }, data: this.krCreateData(kr) }));
        } else {
          ops.push(this.prisma.keyResult.create({ data: { objectiveId: id, ...this.krCreateData(kr) } }));
        }
      }
    }

    if (dto.issueIds !== undefined) {
      const projectId = dto.projectId !== undefined ? (dto.projectId ?? null) : current.projectId;
      const issueIds = dto.issueIds.length ? await this.validateIssues(workspaceId, dto.issueIds, projectId) : [];
      ops.push(this.prisma.objectiveIssue.deleteMany({ where: { objectiveId: id } }));
      if (issueIds.length) {
        ops.push(this.prisma.objectiveIssue.createMany({ data: issueIds.map((issueId) => ({ objectiveId: id, issueId })) }));
      }
    }

    await this.prisma.$transaction(ops);
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.requireObjective(workspaceId, id);
    await this.prisma.objective.delete({ where: { id } }); // KR + ObjectiveIssue cascade
    return { success: true };
  }

  // ───────────────────────── key results ─────────────────────────

  async addKeyResult(workspaceId: string, objectiveId: string, dto: CreateKeyResultInput) {
    await this.requireObjective(workspaceId, objectiveId);
    await this.prisma.keyResult.create({ data: { objectiveId, ...this.krCreateData(dto) } });
    return this.get(workspaceId, objectiveId);
  }

  async updateKeyResult(workspaceId: string, objectiveId: string, keyResultId: string, dto: UpdateKeyResultInput) {
    await this.requireObjective(workspaceId, objectiveId);
    const kr = await this.prisma.keyResult.findFirst({ where: { id: keyResultId, objectiveId }, select: { id: true } });
    if (!kr) throw new NotFoundAppException('Kết quả then chốt');

    const data: Prisma.KeyResultUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên kết quả then chốt bắt buộc');
      data.name = name;
    }
    if (dto.unit !== undefined) data.unit = dto.unit as KeyResultUnit;
    if (dto.startValue !== undefined) data.startValue = dto.startValue;
    if (dto.targetValue !== undefined) data.targetValue = dto.targetValue;
    if (dto.currentValue !== undefined) data.currentValue = dto.currentValue;

    await this.prisma.keyResult.update({ where: { id: keyResultId }, data });
    return this.get(workspaceId, objectiveId);
  }

  async removeKeyResult(workspaceId: string, objectiveId: string, keyResultId: string) {
    await this.requireObjective(workspaceId, objectiveId);
    const { count } = await this.prisma.keyResult.deleteMany({ where: { id: keyResultId, objectiveId } });
    if (count === 0) throw new NotFoundAppException('Kết quả then chốt');
    return this.get(workspaceId, objectiveId);
  }

  // ───────────────────────── issues gắn kèm ─────────────────────────

  async addIssues(workspaceId: string, objectiveId: string, issueIds: string[]) {
    const objective = await this.requireObjective(workspaceId, objectiveId);
    const ids = await this.validateIssues(workspaceId, issueIds, objective.projectId);
    await this.prisma.objectiveIssue.createMany({
      data: ids.map((issueId) => ({ objectiveId, issueId })),
      skipDuplicates: true,
    });
    return this.get(workspaceId, objectiveId);
  }

  async removeIssues(workspaceId: string, objectiveId: string, issueIds: string[]) {
    await this.requireObjective(workspaceId, objectiveId);
    await this.prisma.objectiveIssue.deleteMany({ where: { objectiveId, issueId: { in: issueIds } } });
    return this.get(workspaceId, objectiveId);
  }

  // ───────────────────────── helpers ─────────────────────────

  private krCreateData(kr: KeyResultUpsertInput) {
    return {
      name: kr.name.trim(),
      unit: (kr.unit ?? 'NUMBER') as KeyResultUnit,
      startValue: kr.startValue ?? 0,
      targetValue: kr.targetValue,
      currentValue: kr.currentValue ?? kr.startValue ?? 0,
    };
  }

  private async requireObjective(workspaceId: string, id: string) {
    const row = await this.prisma.objective.findFirst({
      where: { id, workspaceId },
      select: { id: true, projectId: true },
    });
    if (!row) throw new NotFoundAppException('Mục tiêu');
    return row;
  }

  private async resolveProject(workspaceId: string, projectId: string | null): Promise<string | null> {
    if (!projectId) return null;
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p.id;
  }

  private async resolveOwner(workspaceId: string, ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const m = await this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId: ownerId },
      select: { userId: true },
    });
    if (!m) throw new ForbiddenAppException('Chủ sở hữu không thuộc workspace này');
    return m.userId;
  }

  /** Issue phải thuộc workspace (và thuộc đúng dự án nếu mục tiêu gắn với 1 dự án). */
  private async validateIssues(workspaceId: string, issueIds: string[], projectId: string | null): Promise<string[]> {
    const unique = [...new Set(issueIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: unique }, workspaceId, deletedAt: null, ...(projectId ? { projectId } : {}) },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new ForbiddenAppException(
        projectId ? 'Một số issue không thuộc dự án của mục tiêu này' : 'Một số issue không thuộc workspace này',
      );
    }
    return unique;
  }

  private toDto(o: ObjectiveRow) {
    const keyResults = o.keyResults.map((kr) => {
      const span = kr.targetValue - kr.startValue;
      const ratio = span === 0
        ? (kr.currentValue >= kr.targetValue ? 1 : 0)
        : clamp01((kr.currentValue - kr.startValue) / span);
      return {
        id: kr.id,
        name: kr.name,
        unit: kr.unit,
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        currentValue: kr.currentValue,
        progress: Math.round(ratio * 100),
      };
    });

    const issues = o.issues.map((oi) => ({
      id: oi.issue.id,
      key: oi.issue.key,
      summary: oi.issue.summary,
      typeName: oi.issue.type?.name ?? null,
      typeColor: oi.issue.type?.color ?? null,
      statusName: oi.issue.status?.name ?? null,
      statusCategory: (oi.issue.status?.category ?? null) as StatusCategory | null,
      statusColor: oi.issue.status?.color ?? null,
    }));

    const doneCount = issues.filter((i) => i.statusCategory === 'DONE').length;
    const keyResultProgress = keyResults.length
      ? Math.round(keyResults.reduce((s, kr) => s + kr.progress, 0) / keyResults.length)
      : null;
    const issueProgress = issues.length ? Math.round((doneCount / issues.length) * 100) : null;

    return {
      id: o.id,
      workspaceId: o.workspaceId,
      projectId: o.projectId,
      project: o.project,
      name: o.name,
      description: o.description,
      period: o.period,
      status: o.status,
      owner: o.owner,
      keyResults,
      issues,
      issueCount: issues.length,
      issueDoneCount: doneCount,
      keyResultProgress,
      issueProgress,
      /** Tiến độ hiển thị: ưu tiên Key Result; chưa có KR thì lấy % issue Done. */
      progress: keyResultProgress ?? issueProgress ?? 0,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
