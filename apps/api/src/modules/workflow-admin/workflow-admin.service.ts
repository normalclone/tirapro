import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StatusCategory } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

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
type StatusRow = Prisma.StatusGetPayload<true>;
type TransitionRow = Prisma.WorkflowTransitionGetPayload<true>;

const WORKFLOW_DUPLICATE = 'Tên workflow đã tồn tại';
const STATUS_DUPLICATE = 'Tên trạng thái đã tồn tại trong workflow';
const WORKFLOW_IN_USE = 'Workflow đang được dùng';
const STATUS_IN_USE = 'Trạng thái đang được issue sử dụng';

@Injectable()
export class WorkflowAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Workflows -----

  async listWorkflows(
    workspaceId: string,
    filter: ListWorkflowsFilter,
  ): Promise<WorkflowDto[]> {
    const where: Prisma.WorkflowWhereInput = { workspaceId };
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.isTemplate !== undefined) where.isTemplate = filter.isTemplate;
    const rows = await this.prisma.workflow.findMany({
      where,
      include: workflowInclude,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toWorkflowDto(r));
  }

  async getWorkflow(workspaceId: string, id: string): Promise<WorkflowDto> {
    const row = await this.prisma.workflow.findFirst({
      where: { id, workspaceId },
      include: workflowInclude,
    });
    if (!row) throw new NotFoundAppException('Workflow');
    return this.toWorkflowDto(row);
  }

  async createWorkflow(
    workspaceId: string,
    input: CreateWorkflowInput,
  ): Promise<WorkflowDto> {
    if (input.projectId) {
      await this.requireProject(workspaceId, input.projectId);
    }
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
      return this.toWorkflowDto(row);
    } catch (e) {
      throw this.mapWorkflowError(e);
    }
  }

  async removeWorkflow(
    workspaceId: string,
    id: string,
  ): Promise<{ success: true }> {
    await this.requireWorkflow(workspaceId, id);
    // Project.defaultWorkflowId là String? (không phải FK) nên xóa sẽ không tự
    // báo P2003 — phải tự kiểm tra tham chiếu.
    const usedByProject = await this.prisma.project.count({
      where: { workspaceId, defaultWorkflowId: id },
    });
    if (usedByProject > 0) throw new BusinessRuleException(WORKFLOW_IN_USE);
    try {
      await this.prisma.workflow.delete({ where: { id } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw new BusinessRuleException(WORKFLOW_IN_USE);
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
    await this.requireWorkflow(workspaceId, workflowId);
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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BusinessRuleException(STATUS_DUPLICATE);
      }
      throw e;
    }
  }

  async removeStatus(
    workspaceId: string,
    statusId: string,
  ): Promise<{ success: true }> {
    await this.requireStatus(workspaceId, statusId);
    const usedByIssues = await this.prisma.issue.count({
      where: { statusId },
    });
    if (usedByIssues > 0) throw new BusinessRuleException(STATUS_IN_USE);
    try {
      await this.prisma.status.delete({ where: { id: statusId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
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
    await this.requireWorkflow(workspaceId, workflowId);
    await this.assertStatusInWorkflow(workflowId, input.toStatusId, 'toStatusId');
    if (input.fromStatusId) {
      await this.assertStatusInWorkflow(
        workflowId,
        input.fromStatusId,
        'fromStatusId',
      );
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

    const data: Prisma.WorkflowTransitionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.order !== undefined) data.order = input.order;
    if (input.toStatusId !== undefined) {
      await this.assertStatusInWorkflow(
        existing.workflowId,
        input.toStatusId,
        'toStatusId',
      );
      data.toStatus = { connect: { id: input.toStatusId } };
    }
    if (input.fromStatusId !== undefined) {
      if (input.fromStatusId === null) {
        data.fromStatus = { disconnect: true };
      } else {
        await this.assertStatusInWorkflow(
          existing.workflowId,
          input.fromStatusId,
          'fromStatusId',
        );
        data.fromStatus = { connect: { id: input.fromStatusId } };
      }
    }

    const row = await this.prisma.workflowTransition.update({
      where: { id: transitionId },
      data,
    });
    return this.toTransitionDto(row);
  }

  async removeTransition(
    workspaceId: string,
    transitionId: string,
  ): Promise<{ success: true }> {
    await this.requireTransition(workspaceId, transitionId);
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
    if (!wf) throw new NotFoundAppException('Workflow');
    return wf;
  }

  private async requireStatus(
    workspaceId: string,
    statusId: string,
  ): Promise<{ id: string; workflowId: string }> {
    const status = await this.prisma.status.findFirst({
      where: { id: statusId, workflow: { workspaceId } },
      select: { id: true, workflowId: true },
    });
    if (!status) throw new NotFoundAppException('Trạng thái');
    return status;
  }

  private async requireTransition(
    workspaceId: string,
    transitionId: string,
  ): Promise<{ id: string; workflowId: string }> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, workflow: { workspaceId } },
      select: { id: true, workflowId: true },
    });
    if (!transition) throw new NotFoundAppException('Bước chuyển trạng thái');
    return transition;
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
      throw new BusinessRuleException(
        'Trạng thái không thuộc workflow này',
        [{ field, code: 'STATUS_NOT_IN_WORKFLOW', message: 'Trạng thái không thuộc workflow này' }],
      );
    }
  }

  private mapWorkflowError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new BusinessRuleException(WORKFLOW_DUPLICATE);
    }
    return e;
  }

  private toWorkflowDto(row: WorkflowRow): WorkflowDto {
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
    };
  }

  private toStatusDto(row: StatusRow): StatusDto {
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      category: row.category as StatusCategory,
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
