import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { WorkflowAdminService } from './workflow-admin.service';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';

// ---------------------------------------------------------------------------
// Schemas (zod) — dùng ZodValidationPipe, message tiếng Việt
// ---------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Tên không được để trống')
  .max(80, 'Tên tối đa 80 ký tự');

const descriptionSchema = z.string().trim().max(500, 'Mô tả tối đa 500 ký tự');

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Màu phải là mã hex hợp lệ');

const categorySchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE'], {
  errorMap: () => ({ message: 'Nhóm trạng thái không hợp lệ' }),
});

const orderSchema = z.number().int('Thứ tự phải là số nguyên');

const idSchema = z.string().min(1, 'ID không hợp lệ');

// ----- Workflow -----

const createWorkflowSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  projectId: idSchema.optional(),
  isTemplate: z.boolean().optional(),
});
type CreateWorkflowBody = z.infer<typeof createWorkflowSchema>;

const updateWorkflowSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateWorkflowBody = z.infer<typeof updateWorkflowSchema>;

// ----- Status -----

const createStatusSchema = z.object({
  name: nameSchema,
  category: categorySchema,
  color: hexColor.optional(),
  order: orderSchema.optional(),
  isInitial: z.boolean().optional(),
});
type CreateStatusBody = z.infer<typeof createStatusSchema>;

const updateStatusSchema = z
  .object({
    name: nameSchema.optional(),
    category: categorySchema.optional(),
    color: hexColor.optional(),
    order: orderSchema.optional(),
    isInitial: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateStatusBody = z.infer<typeof updateStatusSchema>;

// ----- Transition -----

const createTransitionSchema = z.object({
  name: nameSchema,
  fromStatusId: idSchema.nullable().optional(),
  toStatusId: idSchema,
  order: orderSchema.optional(),
});
type CreateTransitionBody = z.infer<typeof createTransitionSchema>;

const updateTransitionSchema = z
  .object({
    name: nameSchema.optional(),
    fromStatusId: idSchema.nullable().optional(),
    toStatusId: idSchema.optional(),
    order: orderSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateTransitionBody = z.infer<typeof updateTransitionSchema>;

@ApiTags('workflow-admin')
@Controller()
export class WorkflowAdminController {
  constructor(private readonly workflows: WorkflowAdminService) {}

  /**
   * Ai được sửa: quy trình của DỰ ÁN (`projectId` khác null) do Quản trị dự án đó sửa — PermissionsGuard đã tính `project:admin`
   * tại đúng dự án sở hữu (Quản trị dự án A không sửa được quy trình của dự án B); quy trình CHUNG của tổ chức chỉ Quản trị chung
   * (hoặc SA), vì vai tuỳ biến có thể mang `project:admin` cấp tổ chức.
   */
  private async assertCanEdit(
    user: AuthUser,
    workspaceId: string,
    kind: 'workflow' | 'status' | 'transition',
    id: string,
  ): Promise<{ owned: boolean; workspaceAdmin: boolean }> {
    const owner = await this.workflows.ownerProjectId(workspaceId, kind, id);
    const workspaceAdmin =
      user.isSystemAdmin || !!user.permissions?.includes(PERMISSIONS.WORKSPACE_ADMIN);
    if (owner === null && !workspaceAdmin)
      throw new ForbiddenAppException('Quy trình chung của tổ chức chỉ Quản trị chung sửa được');
    return { owned: owner !== null, workspaceAdmin };
  }

  // ----- Workflows -----

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('workflows')
  async list(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('isTemplate') isTemplate?: string,
    @Query('includeTrashed') includeTrashed?: string,
  ) {
    return this.workflows.listWorkflows(
      workspaceId,
      {
        projectId: projectId || undefined,
        isTemplate:
          isTemplate === undefined ? undefined : isTemplate === 'true' || isTemplate === '1',
        includeTrashed: includeTrashed === 'true' || includeTrashed === '1',
      },
      user.id,
    );
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get('workflows/:id')
  async getOne(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workflows.getWorkflow(workspaceId, id, user.id);
  }

  @Post('workflows')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createWorkflowSchema)) dto: CreateWorkflowBody,
  ) {
    return this.workflows.createWorkflow(workspaceId, dto);
  }

  @Patch('workflows/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowBody,
  ) {
    const { workspaceAdmin } = await this.assertCanEdit(user, workspaceId, 'workflow', id);
    // Đặt "mặc định" là việc của Quản trị chung; Quản trị dự án chỉ đổi tên/mô tả quy trình của dự án mình.
    if (dto.isDefault !== undefined && !workspaceAdmin)
      throw new ForbiddenAppException('Chỉ Quản trị chung đặt được quy trình mặc định');
    return this.workflows.updateWorkflow(workspaceId, id, dto);
  }

  @Delete('workflows/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.workflows.removeWorkflow(workspaceId, id);
  }

  // ----- Statuses -----

  @Post('workflows/:id/statuses')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async createStatus(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createStatusSchema)) dto: CreateStatusBody,
  ) {
    await this.assertCanEdit(user, workspaceId, 'workflow', workflowId);
    return this.workflows.createStatus(workspaceId, workflowId, dto);
  }

  @Patch('statuses/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowStatus', 'id')
  async updateStatus(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusBody,
  ) {
    await this.assertCanEdit(user, workspaceId, 'status', id);
    return this.workflows.updateStatus(workspaceId, id, dto);
  }

  /** Còn việc ở trạng thái này thì phải kèm `?replacementStatusId=` (409 STATUS_HAS_ISSUES nếu thiếu). */
  @Delete('statuses/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowStatus', 'id')
  async removeStatus(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('replacementStatusId') replacementStatusId?: string,
  ) {
    await this.assertCanEdit(user, workspaceId, 'status', id);
    return this.workflows.removeStatus(workspaceId, user.id, id, replacementStatusId || undefined);
  }

  // ----- Transitions -----

  @Post('workflows/:id/transitions')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async createTransition(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createTransitionSchema)) dto: CreateTransitionBody,
  ) {
    await this.assertCanEdit(user, workspaceId, 'workflow', workflowId);
    return this.workflows.createTransition(workspaceId, workflowId, dto);
  }

  @Patch('transitions/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowTransition', 'id')
  async updateTransition(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTransitionSchema)) dto: UpdateTransitionBody,
  ) {
    await this.assertCanEdit(user, workspaceId, 'transition', id);
    return this.workflows.updateTransition(workspaceId, id, dto);
  }

  @Delete('transitions/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowTransition', 'id')
  async removeTransition(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.assertCanEdit(user, workspaceId, 'transition', id);
    return this.workflows.removeTransition(workspaceId, id);
  }
}
