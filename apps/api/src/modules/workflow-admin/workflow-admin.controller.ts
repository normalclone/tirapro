import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { WorkflowAdminService } from './workflow-admin.service';

// ---------------------------------------------------------------------------
// Schemas (zod) — dùng ZodValidationPipe, message tiếng Việt
// ---------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Tên không được để trống')
  .max(80, 'Tên tối đa 80 ký tự');

const descriptionSchema = z
  .string()
  .trim()
  .max(500, 'Mô tả tối đa 500 ký tự');

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

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ----- Workflows -----

  @Get('workflows')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('isTemplate') isTemplate?: string,
  ) {
    return this.workflows.listWorkflows(this.ws(user), {
      projectId: projectId || undefined,
      isTemplate:
        isTemplate === undefined
          ? undefined
          : isTemplate === 'true' || isTemplate === '1',
    });
  }

  @Get('workflows/:id')
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.getWorkflow(this.ws(user), id);
  }

  @Post('workflows')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkflowSchema)) dto: CreateWorkflowBody,
  ) {
    return this.workflows.createWorkflow(this.ws(user), dto);
  }

  @Patch('workflows/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) dto: UpdateWorkflowBody,
  ) {
    return this.workflows.updateWorkflow(this.ws(user), id, dto);
  }

  @Delete('workflows/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.removeWorkflow(this.ws(user), id);
  }

  // ----- Statuses -----

  @Post('workflows/:id/statuses')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createStatusSchema)) dto: CreateStatusBody,
  ) {
    return this.workflows.createStatus(this.ws(user), workflowId, dto);
  }

  @Patch('statuses/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusBody,
  ) {
    return this.workflows.updateStatus(this.ws(user), id, dto);
  }

  @Delete('statuses/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removeStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.removeStatus(this.ws(user), id);
  }

  // ----- Transitions -----

  @Post('workflows/:id/transitions')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(createTransitionSchema)) dto: CreateTransitionBody,
  ) {
    return this.workflows.createTransition(this.ws(user), workflowId, dto);
  }

  @Patch('transitions/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updateTransition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTransitionSchema)) dto: UpdateTransitionBody,
  ) {
    return this.workflows.updateTransition(this.ws(user), id, dto);
  }

  @Delete('transitions/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removeTransition(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflows.removeTransition(this.ws(user), id);
  }
}
