import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertProjectIdWritable } from '../../common/project-writable';
import { ProjectAccessService } from '../rbac/project-access.service';

// ---------------------------------------------------------------------------
// DTOs trả về (config-driven: board & validate transition đọc các bản ghi này)
// ---------------------------------------------------------------------------

export interface StatusDto {
  id: string;
  workflowId: string;
  name: string;
  category: StatusCategory;
  color: string | null;
  order: number;
  isInitial: boolean;
}

export interface TransitionDto {
  id: string;
  workflowId: string;
  name: string;
  fromStatusId: string | null;
  toStatusId: string;
  order: number;
}

/** Dự án đang dùng một quy trình làm quy trình mặc định (`Project.defaultWorkflowId`). */
export interface WorkflowUsedByDto {
  id: string;
  key: string;
  name: string;
  /** Dự án đã xoá mềm — vẫn giữ tham chiếu nên vẫn chặn xoá quy trình. */
  deleted: boolean;
}

export interface WorkflowDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  isTemplate: boolean;
  isDefault: boolean;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
  statuses: StatusDto[];
  transitions: TransitionDto[];
  /** Chỉ dự án người xem thấy được (dự án riêng tư người ngoài không lộ khoá/tên). */
  usedBy: WorkflowUsedByDto[];
  /**
   * Số dự án (riêng tư, người xem không thấy) cũng đang dùng quy trình này — để UI hiện "+N dự án riêng tư" và vẫn
   * giải thích vì sao quy trình không xoá được mà không lộ khoá/tên.
   */
  hiddenCount: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ListWorkflowsFilter {
  projectId?: string;
  isTemplate?: boolean;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  projectId?: string;
  isTemplate?: boolean;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface CreateStatusInput {
  name: string;
  category: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface UpdateStatusInput {
  name?: string;
  category?: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface CreateTransitionInput {
  name: string;
  fromStatusId?: string | null;
  toStatusId: string;
  order?: number;
}

export interface UpdateTransitionInput {
  name?: string;
  fromStatusId?: string | null;
  toStatusId?: string;
  order?: number;
}

const workflowInclude = {
  statuses: { orderBy: { order: 'asc' } },
  transitions: { orderBy: { order: 'asc' } },
} satisfies Prisma.WorkflowInclude;

type WorkflowRow = Prisma.WorkflowGetPayload<{ include: typeof workflowInclude }>;
/** Dự án dùng một quy trình, tách theo người xem: thấy được (`usedBy`) và không thấy (`hiddenCount`). */
interface UsedBy {
  usedBy: WorkflowUsedByDto[];
  hiddenCount: number;
}
type StatusRow = Prisma.StatusGetPayload<true>;
type TransitionRow = Prisma.WorkflowTransitionGetPayload<true>;

const WORKFLOW_DUPLICATE = 'Đã có quy trình trùng tên — hãy đặt tên khác';
const STATUS_DUPLICATE = 'Tên trạng thái đã tồn tại trong workflow';
const workflowInUse = (keys: string[]) =>
  `Quy trình đang được dự án {${keys.join(', ')}} dùng — dự án (kể cả dự án đã xoá) vẫn giữ quy trình này nên không xoá được`;
const STATUS_IN_USE =
  'Vẫn còn công việc đang ở trạng thái này — hãy chuyển chúng sang trạng thái khác trước khi xoá';

@Injectable()
export class WorkflowAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  // ----- Workflows -----

  /**
   * Điều kiện Workflow người xem được đọc: quy trình chung (không gắn dự án) + quy trình của dự án người đó thấy.
   * `visible` = `ProjectAccessService.visibleWhere` (`{}` = thấy hết → không thêm điều kiện).
   */
  private readableWhere(visible: Prisma.ProjectWhereInput): Prisma.WorkflowWhereInput {
    return Object.keys(visible).length ? { OR: [{ projectId: null }, { project: visible }] } : {};
  }

  /** `viewerId` bắt buộc: quy trình của dự án riêng tư người xem không thấy bị loại; `usedBy` chỉ gồm dự án thấy được. */
  async listWorkflows(
    workspaceId: string,
    filter: ListWorkflowsFilter,
    viewerId: string,
  ): Promise<WorkflowDto[]> {
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const where: Prisma.WorkflowWhereInput = { workspaceId, ...this.readableWhere(visible) };
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.isTemplate !== undefined) where.isTemplate = filter.isTemplate;
    const rows = await this.prisma.workflow.findMany({
      where,
      include: workflowInclude,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    const usedBy = await this.usedByMap(
      workspaceId,
      rows.map((r) => r.id),
      visible,
    );
    return rows.map((r) => this.toWorkflowDto(r, usedBy.get(r.id)));
  }

  /**
   * Gom dự án đang dùng từng quy trình (ProjectDto không có defaultWorkflowId nên FE không tự ghép được): MỘT truy vấn
   * lấy dự án người xem thấy + MỘT groupBy đếm dự án không thấy (`hidden`). `visible` = `{}` → thấy hết, `hidden` rỗng.
   */
  private async usedByMap(
    workspaceId: string,
    workflowIds: string[],
    visible: Prisma.ProjectWhereInput,
  ): Promise<Map<string, UsedBy>> {
    const map = new Map<string, UsedBy>();
    if (workflowIds.length === 0) return map;
    const entry = (id: string): UsedBy => {
      let e = map.get(id);
      if (!e) map.set(id, (e = { usedBy: [], hiddenCount: 0 }));
      return e;
    };
    // allow-deleted: liệt kê cả dự án đã xoá mềm vì chúng vẫn giữ tham chiếu
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, defaultWorkflowId: { in: workflowIds }, ...visible },
      select: { id: true, key: true, name: true, defaultWorkflowId: true, deletedAt: true },
      orderBy: { key: 'asc' },
    });
    for (const p of projects) {
      if (!p.defaultWorkflowId) continue;
      entry(p.defaultWorkflowId).usedBy.push({
        id: p.id,
        key: p.key,
        name: p.name,
        deleted: p.deletedAt !== null,
      });
    }
    if (Object.keys(visible).length) {
      // allow-deleted: dự án đã xoá mềm (riêng tư) vẫn giữ tham chiếu nên vẫn chặn xoá quy trình
      const hidden = await this.prisma.project.groupBy({
        by: ['defaultWorkflowId'],
        where: { workspaceId, defaultWorkflowId: { in: workflowIds }, NOT: visible },
        _count: { _all: true },
      });
      for (const h of hidden) {
        if (h.defaultWorkflowId) entry(h.defaultWorkflowId).hiddenCount = h._count._all;
      }
    }
    return map;
  }

  /** Quy trình của dự án riêng tư người xem không thấy = không tồn tại (404 như id sai). */
  async getWorkflow(workspaceId: string, id: string, viewerId: string): Promise<WorkflowDto> {
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const row = await this.prisma.workflow.findFirst({
      where: { id, workspaceId, ...this.readableWhere(visible) },
      include: workflowInclude,
    });
    if (!row) throw new NotFoundAppException('Quy trình');
    const usedBy = await this.usedByMap(workspaceId, [row.id], visible);
    return this.toWorkflowDto(row, usedBy.get(row.id));
  }

  async createWorkflow(workspaceId: string, input: CreateWorkflowInput): Promise<WorkflowDto> {
    if (input.projectId) {
      await this.requireProject(workspaceId, input.projectId);
    }
    await assertProjectIdWritable(this.prisma, input.projectId);
    try {
      const row = await this.prisma.workflow.create({
        data: {
          workspaceId,
          name: input.name,
          description: input.description ?? null,
          projectId: input.projectId ?? null,
          isTemplate: input.isTemplate ?? false,
        },
        include: workflowInclude,
      });
      return this.toWorkflowDto(row);
    } catch (e) {
      throw this.mapWorkflowError(e);
    }
  }

  async updateWorkflow(
    workspaceId: string,
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowDto> {
    const existing = await this.requireWorkflow(workspaceId, id);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.WorkflowUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // isDefault chỉ duy nhất trong phạm vi (workspace, project) của workflow.
        if (input.isDefault === true) {
          await tx.workflow.updateMany({
            where: {
              workspaceId,
              projectId: existing.projectId,
              isDefault: true,
              id: { not: id },
            },
            data: { isDefault: false },
          });
        }
        return tx.workflow.update({
          where: { id },
          data,
          include: workflowInclude,
        });
      });
      // Chỉ Quản trị workspace gọi được (thấy mọi dự án) → không lọc usedBy.
      const usedBy = await this.usedByMap(workspaceId, [row.id], {});
      return this.toWorkflowDto(row, usedBy.get(row.id));
    } catch (e) {
      throw this.mapWorkflowError(e);
    }
  }

  async removeWorkflow(workspaceId: string, id: string): Promise<{ success: true }> {
    const existing = await this.requireWorkflow(workspaceId, id);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    // Project.defaultWorkflowId là String? (không phải FK) nên xóa sẽ không tự
    // báo P2003 — phải tự kiểm tra tham chiếu.
    // allow-deleted: dự án đã xoá mềm vẫn giữ tham chiếu defaultWorkflowId
    const usedByProjects = await this.prisma.project.findMany({
      where: { workspaceId, defaultWorkflowId: id },
      select: { key: true },
      orderBy: { key: 'asc' },
    });
    if (usedByProjects.length > 0)
      throw new BusinessRuleException(workflowInUse(usedByProjects.map((p) => p.key)));
    try {
      await this.prisma.workflow.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BusinessRuleException('Quy trình đang được dùng ở nơi khác — không xoá được');
      }
      throw e;
    }
    return { success: true };
  }

  // ----- Statuses -----

  async createStatus(
    workspaceId: string,
    workflowId: string,
    input: CreateStatusInput,
  ): Promise<StatusDto> {
    const wf = await this.requireWorkflow(workspaceId, workflowId);
    await assertProjectIdWritable(this.prisma, wf.projectId);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isInitial === true) {
          await tx.status.updateMany({
            where: { workflowId, isInitial: true },
            data: { isInitial: false },
          });
        }
        return tx.status.create({
          data: {
            workflowId,
            name: input.name,
            category: input.category,
            color: input.color ?? null,
            order: input.order ?? 0,
            isInitial: input.isInitial ?? false,
          },
        });
      });
      return this.toStatusDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(STATUS_DUPLICATE);
      }
      throw e;
    }
  }

  async updateStatus(
    workspaceId: string,
    statusId: string,
    input: UpdateStatusInput,
  ): Promise<StatusDto> {
    const existing = await this.requireStatus(workspaceId, statusId);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.StatusUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.category !== undefined) data.category = input.category;
    if (input.color !== undefined) data.color = input.color;
    if (input.order !== undefined) data.order = input.order;
    if (input.isInitial !== undefined) data.isInitial = input.isInitial;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isInitial === true) {
          await tx.status.updateMany({
            where: {
              workflowId: existing.workflowId,
              isInitial: true,
              id: { not: statusId },
            },
            data: { isInitial: false },
          });
        }
        return tx.status.update({ where: { id: statusId }, data });
      });
      return this.toStatusDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(STATUS_DUPLICATE);
      }
      throw e;
    }
  }

  async removeStatus(workspaceId: string, statusId: string): Promise<{ success: true }> {
    const existing = await this.requireStatus(workspaceId, statusId);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    // allow-deleted: issue đã xoá mềm vẫn giữ FK statusId nên vẫn chặn xoá trạng thái
    const usedByIssues = await this.prisma.issue.count({
      where: { statusId },
    });
    if (usedByIssues > 0) throw new BusinessRuleException(STATUS_IN_USE);
    try {
      await this.prisma.status.delete({ where: { id: statusId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BusinessRuleException(STATUS_IN_USE);
      }
      throw e;
    }
    return { success: true };
  }

  // ----- Transitions -----

  async createTransition(
    workspaceId: string,
    workflowId: string,
    input: CreateTransitionInput,
  ): Promise<TransitionDto> {
    const wf = await this.requireWorkflow(workspaceId, workflowId);
    await assertProjectIdWritable(this.prisma, wf.projectId);
    await this.assertStatusInWorkflow(workflowId, input.toStatusId, 'toStatusId');
    if (input.fromStatusId) {
      await this.assertStatusInWorkflow(workflowId, input.fromStatusId, 'fromStatusId');
    }
    const row = await this.prisma.workflowTransition.create({
      data: {
        workflowId,
        name: input.name,
        fromStatusId: input.fromStatusId ?? null,
        toStatusId: input.toStatusId,
        order: input.order ?? 0,
      },
    });
    return this.toTransitionDto(row);
  }

  async updateTransition(
    workspaceId: string,
    transitionId: string,
    input: UpdateTransitionInput,
  ): Promise<TransitionDto> {
    const existing = await this.requireTransition(workspaceId, transitionId);
    await assertProjectIdWritable(this.prisma, existing.projectId);

    const data: Prisma.WorkflowTransitionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.order !== undefined) data.order = input.order;
    if (input.toStatusId !== undefined) {
      await this.assertStatusInWorkflow(existing.workflowId, input.toStatusId, 'toStatusId');
      data.toStatus = { connect: { id: input.toStatusId } };
    }
    if (input.fromStatusId !== undefined) {
      if (input.fromStatusId === null) {
        data.fromStatus = { disconnect: true };
      } else {
        await this.assertStatusInWorkflow(existing.workflowId, input.fromStatusId, 'fromStatusId');
        data.fromStatus = { connect: { id: input.fromStatusId } };
      }
    }

    const row = await this.prisma.workflowTransition.update({
      where: { id: transitionId },
      data,
    });
    return this.toTransitionDto(row);
  }

  async removeTransition(workspaceId: string, transitionId: string): Promise<{ success: true }> {
    const existing = await this.requireTransition(workspaceId, transitionId);
    await assertProjectIdWritable(this.prisma, existing.projectId);
    await this.prisma.workflowTransition.delete({ where: { id: transitionId } });
    return { success: true };
  }

  // ----- Helpers -----

  private async requireProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireWorkflow(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; workspaceId: string; projectId: string | null }> {
    const wf = await this.prisma.workflow.findFirst({
      where: { id, workspaceId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!wf) throw new NotFoundAppException('Quy trình');
    return wf;
  }

  private async requireStatus(
    workspaceId: string,
    statusId: string,
  ): Promise<{ id: string; workflowId: string; projectId: string | null }> {
    const status = await this.prisma.status.findFirst({
      where: { id: statusId, workflow: { workspaceId } },
      select: { id: true, workflowId: true, workflow: { select: { projectId: true } } },
    });
    if (!status) throw new NotFoundAppException('Trạng thái');
    return { id: status.id, workflowId: status.workflowId, projectId: status.workflow.projectId };
  }

  private async requireTransition(
    workspaceId: string,
    transitionId: string,
  ): Promise<{ id: string; workflowId: string; projectId: string | null }> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, workflow: { workspaceId } },
      select: { id: true, workflowId: true, workflow: { select: { projectId: true } } },
    });
    if (!transition) throw new NotFoundAppException('Bước chuyển trạng thái');
    return {
      id: transition.id,
      workflowId: transition.workflowId,
      projectId: transition.workflow.projectId,
    };
  }

  /** Đảm bảo status thuộc đúng workflow (from/to phải cùng workflow). */
  private async assertStatusInWorkflow(
    workflowId: string,
    statusId: string,
    field: string,
  ): Promise<void> {
    const status = await this.prisma.status.findFirst({
      where: { id: statusId, workflowId },
      select: { id: true },
    });
    if (!status) {
      throw new BusinessRuleException('Trạng thái không thuộc workflow này', [
        { field, code: 'STATUS_NOT_IN_WORKFLOW', message: 'Trạng thái không thuộc workflow này' },
      ]);
    }
  }

  private mapWorkflowError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BusinessRuleException(WORKFLOW_DUPLICATE);
    }
    return e;
  }

  private toWorkflowDto(
    row: WorkflowRow,
    used: UsedBy = { usedBy: [], hiddenCount: 0 },
  ): WorkflowDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      isTemplate: row.isTemplate,
      isDefault: row.isDefault,
      sourceTemplateId: row.sourceTemplateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      statuses: row.statuses.map((s) => this.toStatusDto(s)),
      transitions: row.transitions.map((t) => this.toTransitionDto(t)),
      usedBy: used.usedBy,
      hiddenCount: used.hiddenCount,
    };
  }

  private toStatusDto(row: StatusRow): StatusDto {
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      category: row.category,
      color: row.color,
      order: row.order,
      isInitial: row.isInitial,
    };
  }

  private toTransitionDto(row: TransitionRow): TransitionDto {
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      fromStatusId: row.fromStatusId,
      toStatusId: row.toStatusId,
      order: row.order,
    };
  }
}
