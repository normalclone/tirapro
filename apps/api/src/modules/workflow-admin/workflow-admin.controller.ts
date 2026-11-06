import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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
    organizationId: string,
    kind: 'workflow' | 'status' | 'transition',
    id: string,
  ): Promise<{ owned: boolean; organizationAdmin: boolean }> {
    const owner = await this.workflows.ownerProjectId(organizationId, kind, id);
    const organizationAdmin =
      user.isSystemAdmin || !!user.permissions?.includes(PERMISSIONS.ORGANIZATION_ADMIN);
    if (owner === null && !organizationAdmin)
      throw new ForbiddenAppException('Quy trình chung của tổ chức chỉ Quản trị sửa được');
    return { owned: owner !== null, organizationAdmin };
  }

  // ----- Workflows -----

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('workflows')
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('isTemplate') isTemplate?: string,
    @Query('includeTrashed') includeTrashed?: string,
  ) {
    return this.workflows.listWorkflows(
      organizationId,
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
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workflows.getWorkflow(organizationId, id, user.id);
  }

  @Post('workflows')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async create(
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createWorkflowSchema)) dto: CreateWorkflowBody,
  ) {
    return this.workflows.createWorkflow(organizationId, dto);
  }

  @Patch('workflows/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowBody,
  ) {
    const { organizationAdmin } = await this.assertCanEdit(user, organizationId, 'workflow', id);
    // Đặt "mặc định" là việc của Quản trị chung; Quản trị dự án chỉ đổi tên/mô tả quy trình của dự án mình.
    if (dto.isDefault !== undefined && !organizationAdmin)
      throw new ForbiddenAppException('Chỉ Quản trị đặt được quy trình mặc định');
    return this.workflows.updateWorkflow(organizationId, id, dto);
  }

  @Delete('workflows/:id')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.workflows.removeWorkflow(organizationId, id);
  }

  // ----- Statuses -----

  @Post('workflows/:id/statuses')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async createStatus(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createStatusSchema)) dto: CreateStatusBody,
  ) {
    await this.assertCanEdit(user, organizationId, 'workflow', workflowId);
    return this.workflows.createStatus(organizationId, workflowId, dto);
  }

  @Patch('statuses/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowStatus', 'id')
  async updateStatus(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusBody,
  ) {
    await this.assertCanEdit(user, organizationId, 'status', id);
    return this.workflows.updateStatus(organizationId, id, dto);
  }

  /** Còn việc ở trạng thái này thì phải kèm `?replacementStatusId=` (409 STATUS_HAS_ISSUES nếu thiếu). */
  @Delete('statuses/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowStatus', 'id')
  async removeStatus(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('replacementStatusId') replacementStatusId?: string,
  ) {
    await this.assertCanEdit(user, organizationId, 'status', id);
    return this.workflows.removeStatus(
      organizationId,
      user.id,
      id,
      replacementStatusId || undefined,
    );
  }

  // ----- Transitions -----

  @Post('workflows/:id/transitions')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflow', 'id')
  async createTransition(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createTransitionSchema)) dto: CreateTransitionBody,
  ) {
    await this.assertCanEdit(user, organizationId, 'workflow', workflowId);
    return this.workflows.createTransition(organizationId, workflowId, dto);
  }

  @Patch('transitions/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowTransition', 'id')
  async updateTransition(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTransitionSchema)) dto: UpdateTransitionBody,
  ) {
    await this.assertCanEdit(user, organizationId, 'transition', id);
    return this.workflows.updateTransition(organizationId, id, dto);
  }

  @Delete('transitions/:id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('workflowTransition', 'id')
  async removeTransition(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.assertCanEdit(user, organizationId, 'transition', id);
    return this.workflows.removeTransition(organizationId, id);
  }
}
